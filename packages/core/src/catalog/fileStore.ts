import { perf } from '../perf/perf';
import type { IDBPDatabase } from 'idb';
import { AppError } from '../net/http';
import type { Built } from './build';
import { categoryRange, playlistRange, type UltraDb } from './db';
import { rematchFavorites, type Rematch } from './favorites';
import { measure, type CatalogFileStore } from './files';
import { snapshotKey, type CategoryRow, type ContentKind, type FavoriteRow, type KindRows } from './model';
import type { WriteStats } from './store';

/**
 * Where one section of a playlist lives on disk. Each refresh writes a new generation folder and
 * only switches to it once every file is written, so a refresh that fails half way leaves the
 * previous catalogue exactly as it was.
 */
export interface FileIndex {
  gen: string;
  /**
   * Category id → where its rows are: a file name (first version, one file per category), or
   * [UTF-8 byte offset, code points] in the section's one data file (each file cost ~90 ms on a TV).
   */
  files: Record<string, string | [number, number]>;
  items: number;
  bytes: number;
}

export const fileIndexKey = (playlistId: string, kind: ContentKind) => `catfiles|${playlistId}|${kind}`;
export const folder = (playlistId: string, kind: ContentKind, gen: string) => `${playlistId}/${kind}-${gen}`;
/** One entry per item for search, "All", favourites and detail pages: key, name, first category, id. */
export const NAMES_FILE = 'names.json';
/** Every category's rows, one after another; the index says where each one is. */
export const DATA_FILE = 'data.json';
/** Text sent to the page per write: big enough that there are few, small enough for a TV's memory. */
const BATCH_CHARS = 4 * 1024 * 1024;

/** Room the device keeps for everything else; the catalogue never takes the last of the space. */
const RESERVE_BYTES = 300 * 1024 * 1024;
const SAMPLE_ROWS = 300;

/** Items in several categories are written once per category. */
function duplication(byCategory: Map<string, unknown[]>, items: number): number {
  let placed = 0;
  byCategory.forEach((rows) => (placed += rows.length));
  return items ? placed / items : 1;
}

let generation = 0;
const newGeneration = () => `${Date.now().toString(36)}${(generation++).toString(36)}`;

/** Rows per category, in the order they arrived, plus the slim names list. */
export type NameEntry = [key: string, name: string, categoryId: string, id: string];

export function splitByCategory<K extends ContentKind>(built: Built<K>): { byCategory: Map<string, Array<KindRows[K]>>; names: NameEntry[] } {
  const byCategory = new Map<string, Array<KindRows[K]>>();
  const names: NameEntry[] = [];
  for (const item of built.items) {
    const row = item as unknown as { id: string; key: string; name: string; categoryIds: string[] };
    names.push([row.key, row.name, row.categoryIds[0], row.id]);
    for (const id of row.categoryIds) {
      let list = byCategory.get(id);
      if (!list) {
        list = [];
        byCategory.set(id, list);
      }
      list.push(item);
    }
  }
  return { byCategory, names };
}

/** A section turned into file text, ready to commit. Made in either worker; holds no rows. */
export interface EncodedSection {
  categories: CategoryRow[];
  files: Record<string, [number, number]>;
  bytes: number;
  items: number;
  namesText: string;
  rematch: Rematch;
}

/**
 * Turns built rows into file text, category by category, handing it over in batches of about
 * 4 MB (`onBatch` may wait, which holds the next batch back). `check` gets the estimated size
 * first and can refuse. Pure work: no database, no files. The section worker runs it too.
 */
export async function encodeSection<K extends ContentKind>(
  kind: K,
  built: Built<K>,
  favorites: FavoriteRow[],
  check: (estimate: number) => Promise<void>,
  onBatch: (text: string, start: boolean) => Promise<void>,
): Promise<EncodedSection> {
  const { byCategory, names } = perf.timedSync(`files.split.${kind}`, () => splitByCategory(built));
  const namesText = perf.timedSync(`files.names.${kind}`, () => JSON.stringify(names));
  // The size is estimated from a sample, so the whole section never exists twice as text in memory.
  const sample = built.items.slice(0, SAMPLE_ROWS);
  const perRow = sample.length ? JSON.stringify(sample).length / sample.length : 0;
  await check(Math.round(perRow * built.items.length * duplication(byCategory, built.items.length) + namesText.length));

  const out: EncodedSection = { categories: built.categories, files: {}, bytes: 0, items: built.items.length, namesText, rematch: { moved: [], lost: [] } };
  let stringifyMs = 0;
  let measureMs = 0;
  let batch: string[] = [];
  let batchChars = 0;
  let first = true;
  const flush = async () => {
    if (!batch.length) return;
    const text = batch.join('');
    const start = first;
    batch = [];
    batchChars = 0;
    first = false;
    await onBatch(text, start);
  };
  for (const c of built.categories) {
    const rows = byCategory.get(c.id);
    if (!rows) continue;
    const t0 = Date.now();
    const text = JSON.stringify(rows);
    const t1 = Date.now();
    const size = measure(text);
    stringifyMs += t1 - t0;
    measureMs += Date.now() - t1;
    out.files[c.id] = [out.bytes, size.points];
    out.bytes += size.bytes;
    batch.push(text);
    batchChars += text.length;
    if (batchChars >= BATCH_CHARS) await flush();
  }
  await flush();
  out.bytes += namesText.length;
  perf.count(`files.stringifyMs.${kind}`, stringifyMs);
  perf.count(`files.measureMs.${kind}`, measureMs);
  out.rematch = rematchFavorites(favorites, built.items as unknown as Array<{ key: string; name: string; tvgId?: string }>);
  return out;
}

/** Appends batches to one file, keeping up to two writes in flight so the TV is always writing. */
export function pipeWriter(files: CatalogFileStore, path: string): { send(text: string, start: boolean): Promise<void>; done(): Promise<void> } {
  let writing: Promise<void> = Promise.resolve();
  let waiting: Promise<void> = Promise.resolve();
  let waitMs = 0;
  return {
    async send(text, start) {
      const w0 = Date.now();
      await waiting;
      waitMs += Date.now() - w0;
      waiting = writing;
      // In order: each append starts once the one before it has finished.
      writing = writing.then(() => files.append(path, text, start));
      writing.catch(() => undefined);
    },
    async done() {
      const w1 = Date.now();
      await writing;
      perf.count('files.waitWritesMs', waitMs + Date.now() - w1);
    },
  };
}

/** A new generation folder for a section. */
export function newSectionFolder(playlistId: string, kind: ContentKind): { gen: string; dir: string; data: string } {
  const gen = newGeneration();
  const dir = folder(playlistId, kind, gen);
  return { gen, dir, data: `${dir}/${DATA_FILE}` };
}

/** Refuses when the device would be left with too little space. */
export async function checkRoom(files: CatalogFileStore, estimate: number): Promise<void> {
  const free = await files.freeBytes();
  // The previous generation is deleted afterwards, but both exist for a moment.
  if (free !== undefined && free - estimate < RESERVE_BYTES) {
    throw new AppError({ code: 'storage', message: `Needs about ${Math.round(estimate / 1048576)} MB, ${Math.round(free / 1048576)} MB free` });
  }
}

/** Everything is on disk: switch to it, with the categories and favourites, in one transaction. */
export async function commitSection(
  db: IDBPDatabase<UltraDb>,
  files: CatalogFileStore,
  playlistId: string,
  kind: ContentKind,
  gen: string,
  encoded: EncodedSection,
  previous: FileIndex | undefined,
): Promise<WriteStats> {
  const switchSpan = perf.span(`files.switch.${kind}`);
  const index: FileIndex = { gen, files: encoded.files, items: encoded.items, bytes: encoded.bytes };
  const tx = db.transaction(['categories', kind, 'favorites', 'settings'], 'readwrite');
  const pending: Array<Promise<unknown>> = [];
  const track = (p: Promise<unknown>) => {
    p.catch(() => undefined);
    pending.push(p);
  };
  const categories = tx.objectStore('categories');
  track(categories.delete(categoryRange(playlistId, kind)));
  for (const c of encoded.categories) track(categories.put(c));
  // Rows from before files were used go: they are what filled the database.
  track(tx.objectStore(kind).delete(playlistRange(playlistId)));
  track(tx.objectStore('settings').delete(snapshotKey(playlistId, kind)));
  track(tx.objectStore('settings').put(index, fileIndexKey(playlistId, kind)));
  const favStore = tx.objectStore('favorites');
  for (const { from, to } of encoded.rematch.moved) {
    track(favStore.delete([from.playlistId, from.kind, from.key]));
    track(favStore.put(to));
  }
  await Promise.all(pending);
  await tx.done;
  switchSpan.end();
  if (previous && previous.gen !== gen) await files.removeDir(folder(playlistId, kind, previous.gen)).catch(() => undefined);
  return {
    added: previous ? 0 : encoded.items,
    updated: previous ? encoded.items : 0,
    removed: 0,
    unchanged: 0,
    favorites: { moved: encoded.rematch.moved.length, lost: encoded.rematch.lost.length },
  };
}

/**
 * Saves a section as files: every category's rows in one data file (an index says where each
 * category starts), plus the names list. The web database keeps only the category list, the
 * favourites and that index.
 */
export async function writeKindToFiles<K extends ContentKind>(
  db: IDBPDatabase<UltraDb>,
  files: CatalogFileStore,
  playlistId: string,
  kind: K,
  built: Built<K>,
): Promise<WriteStats> {
  const previous = await readFileIndex(db, playlistId, kind);
  const favorites = await db.getAllFromIndex('favorites', 'byPlaylistKind', [playlistId, kind]);
  const { gen, dir, data } = newSectionFolder(playlistId, kind);
  const writer = pipeWriter(files, data);
  let encoded: EncodedSection;
  try {
    encoded = await encodeSection(kind, built, favorites, (estimate) => checkRoom(files, estimate), (text, start) => writer.send(text, start));
    await writer.done();
    await perf.timed(`files.namesWrite.${kind}`, () => files.write(`${dir}/${NAMES_FILE}`, encoded.namesText));
  } catch (e) {
    await writer.done().catch(() => undefined);
    await files.removeDir(dir).catch(() => undefined);
    throw e;
  }
  return commitSection(db, files, playlistId, kind, gen, encoded, previous);
}

export async function readFileIndex(db: IDBPDatabase<UltraDb>, playlistId: string, kind: ContentKind): Promise<FileIndex | undefined> {
  return (await db.get('settings', fileIndexKey(playlistId, kind))) as FileIndex | undefined;
}

/** Recently read category files, parsed, so going back and forth between categories reads nothing. */
const CACHED_FILES = 12;
const fileCache = new Map<string, unknown[]>();
const names = new Map<string, Promise<NameLookup>>();

function remember(key: string, rows: unknown[]): void {
  fileCache.delete(key);
  fileCache.set(key, rows);
  if (fileCache.size > CACHED_FILES) fileCache.delete(fileCache.keys().next().value as string);
}

/**
 * The rows of one category, or null if the section isn't stored in files (or the file is gone).
 * A category the index doesn't list has no items: an empty list.
 */
export async function readCategoryFile<K extends ContentKind>(
  db: IDBPDatabase<UltraDb>,
  files: CatalogFileStore,
  playlistId: string,
  kind: K,
  categoryId: string,
): Promise<Array<KindRows[K]> | null> {
  const index = await readFileIndex(db, playlistId, kind);
  if (!index) return null;
  const where = index.files[categoryId];
  if (!where) return [];
  const cacheKey = `${playlistId}|${kind}|${index.gen}|${categoryId}`;
  const cached = fileCache.get(cacheKey);
  if (cached) {
    remember(cacheKey, cached);
    return cached as Array<KindRows[K]>;
  }
  const base = folder(playlistId, kind, index.gen);
  const text = typeof where === 'string' ? await files.read(`${base}/${where}`) : await files.readSlice(`${base}/${DATA_FILE}`, where[0], where[1]);
  if (text === null) return null;
  const rows = JSON.parse(text) as Array<KindRows[K]>;
  // Not stored per row (it's the same for all of them, and only the database needs the others).
  for (const row of rows as unknown as Array<{ playlistId: string; sig: string; catKeys: string[] }>) {
    row.playlistId = playlistId;
    if (row.sig === undefined) row.sig = '';
    if (row.catKeys === undefined) row.catKeys = [];
  }
  remember(cacheKey, rows);
  return rows;
}

/** Where each item is, by key and by id. Read once per section and generation. */
export interface NameLookup {
  gen: string;
  entries: NameEntry[];
  byKey: Map<string, NameEntry>;
  byId: Map<string, NameEntry>;
}

export function readNames(db: IDBPDatabase<UltraDb>, files: CatalogFileStore, playlistId: string, kind: ContentKind): Promise<NameLookup | null> {
  return readFileIndex(db, playlistId, kind).then((index) => {
    if (!index) return null;
    const cacheKey = `${playlistId}|${kind}|${index.gen}`;
    let pending = names.get(cacheKey);
    if (!pending) {
      pending = files.read(`${folder(playlistId, kind, index.gen)}/${NAMES_FILE}`).then((text) => {
        const entries = text ? (JSON.parse(text) as NameEntry[]) : [];
        const byKey = new Map<string, NameEntry>();
        const byId = new Map<string, NameEntry>();
        for (const e of entries) {
          byKey.set(e[0], e);
          byId.set(e[3], e);
        }
        return { gen: index.gen, entries, byKey, byId };
      });
      // One section's names at a time: a big one is several MB.
      names.forEach((_, k) => {
        if (k.indexOf(`${playlistId}|${kind}|`) === 0) names.delete(k);
      });
      names.set(cacheKey, pending);
      pending.catch(() => names.delete(cacheKey));
    }
    return pending;
  });
}

/** Rows for some keys (favourites, recents, continue watching), reading only the categories they are in. */
export async function rowsByKeysFromFiles<K extends ContentKind>(
  db: IDBPDatabase<UltraDb>,
  files: CatalogFileStore,
  playlistId: string,
  kind: K,
  keys: string[],
): Promise<Array<KindRows[K]> | null> {
  const lookup = await readNames(db, files, playlistId, kind);
  if (!lookup) return null;
  const found = new Map<string, KindRows[K]>();
  const cats = new Set<string>();
  for (const key of keys) {
    const e = lookup.byKey.get(key);
    if (e) cats.add(e[2]);
  }
  for (const cat of Array.from(cats)) {
    const rows = (await readCategoryFile(db, files, playlistId, kind, cat)) ?? [];
    for (const row of rows) {
      const k = (row as unknown as { key: string }).key;
      if (keys.indexOf(k) >= 0) found.set(k, row);
    }
  }
  return keys.map((k) => found.get(k)).filter((r): r is KindRows[K] => !!r);
}

/** One row by its provider id (detail pages, catch-up), or null if the section isn't in files. */
export async function rowByIdFromFiles<K extends ContentKind>(
  db: IDBPDatabase<UltraDb>,
  files: CatalogFileStore,
  playlistId: string,
  kind: K,
  id: string,
): Promise<KindRows[K] | undefined | null> {
  const lookup = await readNames(db, files, playlistId, kind);
  if (!lookup) return null;
  const e = lookup.byId.get(id);
  if (!e) return undefined;
  const rows = (await readCategoryFile(db, files, playlistId, kind, e[2])) ?? [];
  return rows.filter((r) => (r as unknown as { id: string }).id === id)[0];
}

/** Every file of a playlist (deleting it). */
export function removePlaylistFiles(files: CatalogFileStore, playlistId: string): Promise<void> {
  return files.removeDir(playlistId);
}
