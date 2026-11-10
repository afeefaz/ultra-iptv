import { catalogFiles } from './files';
import { readCategoryFile, readFileIndex, readNames, rowByIdFromFiles, rowsByKeysFromFiles } from './fileStore';
// Read-only queries used by the UI thread. All writes go through the worker (catalog/service.ts).
import { perf } from '../perf/perf';
import { openUltraDb, playlistRange } from './db';
import { EMPTY_RULE, type HiddenRule } from './groups';
import { readSnapshot, type LibrarySnapshot } from './store';
import {
  catKey,
  hiddenCategoriesKey,
  hiddenRuleKey,
  categoryNamesKey,
  pinsKey,
  type CategoryRow,
  type ContentKind,
  type KindRows,
  type LockRow,
  type PlaylistRecord,
  type ProgressKind,
  type ProgressRow,
} from './model';

export async function listPlaylists(): Promise<PlaylistRecord[]> {
  const rows = await (await openUltraDb()).getAll('playlists');
  return rows.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export async function listCategories(playlistId: string, kind: ContentKind): Promise<CategoryRow[]> {
  const span = perf.span(`db.listCategories.${kind}`);
  const rows = await (await openUltraDb()).getAllFromIndex('categories', 'byPlaylistKind', [playlistId, kind]);
  span.end({ rows: rows.length });
  return rows.sort((a, b) => a.order - b.order);
}

/** The fast copy of a whole section (see store.ts), or null if it hasn't been written yet. */
export async function librarySnapshot(playlistId: string, kind: ContentKind): Promise<LibrarySnapshot | null> {
  return perf.timed(`db.snapshot.${kind}`, async () => readSnapshot(await openUltraDb(), playlistId, kind));
}

const byNumber = (a: { num?: number; name: string }, b: { num?: number; name: string }) =>
  (a.num ?? 0) - (b.num ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Items of one category, or every item of the playlist (`categoryId` null), in channel order. */
export async function listItems<K extends ContentKind>(
  playlistId: string,
  kind: K,
  categoryId: string | null,
): Promise<KindRows[K][]> {
  const span = perf.span(`db.listItems.${kind}`);
  const db = await openUltraDb();
  // The three item stores share one shape for these lookups; `as 'live'` just picks a concrete store type.
  const store = kind as 'live';
  const rows = (
    categoryId === null
      ? await db.getAll(store, playlistRange(playlistId))
      : await db.getAllFromIndex(store, 'byCat', catKey(playlistId, categoryId))
  ) as unknown as Array<KindRows[K]>;
  span.end({ rows: rows.length });
  return perf.timedSync(`db.sortItems.${kind}`, () => rows.sort(byNumber as (a: KindRows[K], b: KindRows[K]) => number));
}

/** A few items by their stable keys, in that order, without reading the whole catalogue. */
export async function itemsByKeys<K extends 'live' | 'vod'>(playlistId: string, kind: K, keys: string[]): Promise<KindRows[K][]> {
  const db = await openUltraDb();
  const files = catalogFiles();
  if (files) {
    const fromFiles = await rowsByKeysFromFiles(db, files, playlistId, kind, keys);
    if (fromFiles) return fromFiles;
  }
  const span = perf.span(`db.itemsByKeys.${kind}`);
  const rows = await Promise.all(keys.map((key) => db.getFromIndex(kind as 'live', 'byKey', [playlistId, key])));
  span.end({ rows: rows.length });
  return rows.filter((r) => !!r) as unknown as KindRows[K][];
}

/** Most recently played first. */
export async function recentKeys(playlistId: string, kind: ContentKind): Promise<string[]> {
  const rows = await (await openUltraDb()).getAllFromIndex('recent', 'byPlaylistKind', [playlistId, kind]);
  return rows.sort((a, b) => b.playedAt - a.playedAt).map((r) => r.key);
}

export async function listLocks(playlistId: string): Promise<LockRow[]> {
  return (await openUltraDb()).getAllFromIndex('locks', 'byPlaylist', playlistId);
}

export async function favoriteKeys(playlistId: string, kind: ContentKind): Promise<string[]> {
  const rows = await (await openUltraDb()).getAllFromIndex('favorites', 'byPlaylistKind', [playlistId, kind]);
  return rows.sort((a, b) => a.addedAt - b.addedAt).map((f) => f.key);
}

/** Every saved position for a playlist, most recently watched first. */
export async function listProgress(playlistId: string): Promise<ProgressRow[]> {
  const rows = await (await openUltraDb()).getAllFromIndex('progress', 'byPlaylist', playlistId);
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProgress(playlistId: string, kind: ProgressKind, key: string): Promise<ProgressRow | undefined> {
  return (await openUltraDb()).get('progress', [playlistId, kind, key]);
}

export async function getItem<K extends ContentKind>(playlistId: string, kind: K, id: string): Promise<KindRows[K] | undefined> {
  const db = await openUltraDb();
  const files = catalogFiles();
  if (files) {
    const fromFiles = await rowByIdFromFiles(db, files, playlistId, kind, id);
    if (fromFiles !== null) return fromFiles;
  }
  return (await db.get(kind as 'live', [playlistId, id])) as unknown as KindRows[K] | undefined;
}

/** Names given to categories in Settings, by category id. */
export async function categoryNames(playlistId: string, kind: ContentKind): Promise<Record<string, string>> {
  const v = (await (await openUltraDb()).get('settings', categoryNamesKey(playlistId, kind))) as Record<string, string> | undefined;
  return v && typeof v === 'object' ? v : {};
}

/** Whole groups hidden in Settings for one section. */
export async function hiddenRule(playlistId: string, kind: ContentKind): Promise<HiddenRule> {
  const v = (await (await openUltraDb()).get('settings', hiddenRuleKey(playlistId, kind))) as HiddenRule | undefined;
  return v ?? EMPTY_RULE;
}

/** Category ids hidden in Settings for one section. */
export async function hiddenCategories(playlistId: string, kind: ContentKind): Promise<string[]> {
  const v = await (await openUltraDb()).get('settings', hiddenCategoriesKey(playlistId, kind));
  return Array.isArray(v) ? (v as string[]) : [];
}

/** Pinned category ids, in the order they were pinned. */
export async function categoryPins(playlistId: string, kind: ContentKind): Promise<string[]> {
  const v = await (await openUltraDb()).get('settings', pinsKey(playlistId, kind));
  return Array.isArray(v) ? (v as string[]) : [];
}

/** A section stored in files (Samsung): its index, or undefined when it's in the database. */
export async function sectionFiles(playlistId: string, kind: ContentKind): Promise<{ items: number } | undefined> {
  const files = catalogFiles();
  if (!files) return undefined;
  const index = await readFileIndex(await openUltraDb(), playlistId, kind);
  return index ? { items: index.items } : undefined;
}

/** One category's rows from its file, or null if the section isn't in files. */
export async function categoryRowsFromFiles<K extends ContentKind>(playlistId: string, kind: K, categoryId: string): Promise<KindRows[K][] | null> {
  const files = catalogFiles();
  if (!files) return null;
  return readCategoryFile(await openUltraDb(), files, playlistId, kind, categoryId);
}

/** Keys → the categories they are in, for a section stored in files. */
export async function categoriesOfKeys(playlistId: string, kind: ContentKind, keys: string[]): Promise<string[]> {
  const files = catalogFiles();
  if (!files) return [];
  const lookup = await readNames(await openUltraDb(), files, playlistId, kind);
  if (!lookup) return [];
  const cats = new Set<string>();
  for (const k of keys) {
    const e = lookup.byKey.get(k);
    if (e) cats.add(e[2]);
  }
  return Array.from(cats);
}

/** Every item's key, name and category in a section stored in files, for searching all of it. */
export async function sectionNames(playlistId: string, kind: ContentKind): Promise<Array<[string, string, string, string]> | null> {
  const files = catalogFiles();
  if (!files) return null;
  const lookup = await readNames(await openUltraDb(), files, playlistId, kind);
  return lookup ? lookup.entries : null;
}

/**
 * Forgets which lists were saved and where, so every playlist loads in full on its next refresh.
 * For changing where the catalogue is kept (Settings → Playlists → Loading).
 */
export async function forgetSavedLists(): Promise<void> {
  const db = await openUltraDb();
  const tx = db.transaction('settings', 'readwrite');
  for (const key of await tx.store.getAllKeys()) {
    if (typeof key === 'string' && (key.indexOf('listhash|') === 0 || key.indexOf('catfiles|') === 0)) await tx.store.delete(key);
  }
  await tx.done;
}
