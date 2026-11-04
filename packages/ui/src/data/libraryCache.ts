import { listCategories, listItems, perf, type CategoryRow, type ContentKind } from '@ultra/core';
import { normalizeText } from './categories';
import { versionOf } from './playlists';

const MAX_SORTED = 8;

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
  ) {}

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
  const [cats, rows] = await Promise.all([listCategories(playlistId, kind), listItems(playlistId, kind, null)]);
  span.end({ rows: rows.length });
  const library = new Library<R>(version, cats, rows as unknown as R[]);
  // Only the active playlist stays in memory.
  if (heldPlaylist !== playlistId) libraries.clear();
  heldPlaylist = playlistId;
  libraries.set(kind, library as unknown as Library<never>);
  return library;
}
