import {
  categoriesOfKeys,
  categoryRowsFromFiles,
  librarySnapshot,
  listCategories,
  listItems,
  log,
  perf,
  sectionFiles,
  type CategoryRow,
  type ContentKind,
} from '@ultra/core';
import { catalog } from './catalog';
import { normalizeText } from './categories';
import { versionOf } from './playlists';

const MAX_SORTED = 8;
/** A section stored in files keeps at most this many rows in memory; the oldest categories go first. */
const MAX_RESIDENT_ROWS = 60_000;

/** A section kept in files (Samsung): which categories are in memory, and how many items there are in all. */
export interface FileSection {
  items: number;
  /** Category ids in memory, oldest first. */
  loaded: string[];
}

/**
 * One section's catalogue, held in memory for the active playlist. Reading tens of thousands of
 * rows from the database blocks a TV for seconds, so coming back from the player or a detail page
 * must not repeat it. A refresh changes the playlist's version, which drops this copy.
 */
export class Library<R extends { key: string; name: string }> {
  /** Last known lists, shown straight away on the way back and refreshed right after. */
  favs: string[] = [];
  recent: string[] = [];
  private keyMap: Map<string, R> | undefined;
  private names: Map<string, string> | undefined;
  private readonly sortedLists = new Map<string, R[]>();

  constructor(
    readonly version: number,
    readonly cats: CategoryRow[],
    readonly rows: R[],
    /** Set when the section is in files: then `rows` holds only the categories read so far. */
    readonly files?: FileSection,
  ) {}

  /** How many items the section has, whether or not they are in memory. */
  total(): number {
    return this.files ? this.files.items : this.rows.length;
  }

  byKey(): Map<string, R> {
    if (!this.keyMap) this.keyMap = perf.timedSync('library.byKey', () => new Map(this.rows.map((r) => [r.key, r] as [string, R])));
    return this.keyMap;
  }

  /** Normalized once, so filtering 50,000 names per keystroke stays cheap. */
  normNames(): Map<string, string> {
    if (!this.names) this.names = perf.timedSync('library.normNames', () => new Map(this.rows.map((r) => [r.key, normalizeText(r.name)] as [string, string])));
    return this.names;
  }

  /** A sorted list by category and order; sorting a big catalogue is too slow to repeat. */
  sorted(key: string, build: () => R[]): R[] {
    let list = this.sortedLists.get(key);
    perf.count(list ? 'cache.sorted.hit' : 'cache.sorted.miss');
    if (!list) {
      list = perf.timedSync('library.sort', build);
      if (this.sortedLists.size >= MAX_SORTED) this.sortedLists.delete(this.sortedLists.keys().next().value as string);
      this.sortedLists.set(key, list);
    }
    return list;
  }
}

let heldPlaylist: string | null = null;
const libraries = new Map<ContentKind, Library<never>>();

export function cachedLibrary<R extends { key: string; name: string }>(playlistId: string | null, kind: ContentKind): Library<R> | undefined {
  if (!playlistId || playlistId !== heldPlaylist) return undefined;
  const library = libraries.get(kind) as unknown as Library<R> | undefined;
  return library && library.version === versionOf(playlistId) ? library : undefined;
}

export async function loadLibrary<R extends { key: string; name: string }>(playlistId: string, kind: ContentKind): Promise<Library<R>> {
  const held = cachedLibrary<R>(playlistId, kind);
  perf.count(held ? `cache.library.hit.${kind}` : `cache.library.miss.${kind}`);
  if (held) return held;
  const version = versionOf(playlistId);
  const span = perf.span(`library.load.${kind}`);
  const section = await sectionFiles(playlistId, kind);
  if (section) {
    // In files: only the category list now; each category is read when it's shown.
    const library = new Library<R>(version, await listCategories(playlistId, kind), [], { items: section.items, loaded: [] });
    span.end({ rows: 0, files: true });
    return hold(playlistId, kind, library);
  }
  const snapshot = await librarySnapshot(playlistId, kind);
  let cats: CategoryRow[];
  let rows: unknown[];
  if (snapshot) {
    perf.count('cache.snapshot.hit');
    cats = JSON.parse(snapshot.categories) as CategoryRow[];
    rows = [];
    for (const chunk of snapshot.chunks) {
      rows = rows.concat(perf.timedSync('library.parseChunk', () => JSON.parse(chunk) as unknown[]));
      // Lets key presses and painting through between chunks.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } else {
    perf.count('cache.snapshot.miss');
    [cats, rows] = await Promise.all([listCategories(playlistId, kind), listItems(playlistId, kind, null)]);
    catalog()
      .call('ensureSnapshot', playlistId, kind)
      .catch((e) => log.warn('library', 'could not save the fast copy', { error: e }));
  }
  span.end({ rows: rows.length });
  return hold(playlistId, kind, new Library<R>(version, cats, rows as unknown as R[]));
}

function hold<R extends { key: string; name: string }>(playlistId: string, kind: ContentKind, library: Library<R>): Library<R> {
  // Only the active playlist stays in memory.
  if (heldPlaylist !== playlistId) libraries.clear();
  heldPlaylist = playlistId;
  libraries.set(kind, library as unknown as Library<never>);
  return library;
}

/**
 * A section in files: the library with these categories read in, or undefined if they already
 * were (or the section isn't in files). `ids` is everything on screen now: when memory is short,
 * only categories outside it are let go, so what's shown is never dropped. The newest held copy is
 * extended, so two calls at once both end up in it.
 */
export async function withCategories<R extends { key: string; name: string; categoryIds: string[] }>(
  base: Library<R>,
  playlistId: string,
  kind: ContentKind,
  ids: string[],
): Promise<Library<R> | undefined> {
  if (!base.files) return undefined;
  const wanted = ids.filter((id, i) => ids.indexOf(id) === i && base.files!.loaded.indexOf(id) < 0);
  if (!wanted.length) return undefined;
  const added: R[] = [];
  for (const id of wanted) {
    const rows = await perf.timed(`library.categoryFile.${kind}`, () => categoryRowsFromFiles(playlistId, kind, id));
    if (rows) for (const r of rows as unknown as R[]) added.push(r);
  }
  const current = cachedLibrary<R>(playlistId, kind) ?? base;
  if (current.version !== base.version || !current.files) return undefined;
  let loaded = current.files.loaded.filter((id) => wanted.indexOf(id) < 0).concat(wanted);
  let rows = current.rows;
  // Too many in memory: let go of what isn't on screen (it's read again when shown).
  if (rows.length + added.length > MAX_RESIDENT_ROWS) {
    const keep = new Set(ids);
    loaded = loaded.filter((id) => keep.has(id));
    rows = rows.filter((r) => r.categoryIds.some((c) => keep.has(c)));
  }
  const seen = new Set(rows.map((r) => r.key));
  const merged = rows.concat(added.filter((r) => !seen.has(r.key) && (seen.add(r.key), true)));
  const next = new Library<R>(current.version, current.cats, merged, { items: current.files.items, loaded });
  next.favs = current.favs;
  next.recent = current.recent;
  return hold(playlistId, kind, next);
}

/** The same for some items' keys (favourites, recents, continue watching, search results). */
export async function withKeys<R extends { key: string; name: string; categoryIds: string[] }>(
  base: Library<R>,
  playlistId: string,
  kind: ContentKind,
  keys: string[],
): Promise<Library<R> | undefined> {
  if (!base.files || !keys.length) return undefined;
  const have = base.byKey();
  const missing = keys.filter((k) => !have.has(k));
  if (!missing.length) return undefined;
  return withCategories(base, playlistId, kind, await categoriesOfKeys(playlistId, kind, missing));
}
