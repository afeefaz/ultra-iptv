// Read-only queries used by the UI thread. All writes go through the worker (catalog/service.ts).
import { perf } from '../perf/perf';
import { openUltraDb, playlistRange } from './db';
import { EMPTY_RULE, type HiddenRule } from './groups';
import { readSnapshot, type LibrarySnapshot } from './store';
import {
  catKey,
  hiddenCategoriesKey,
  hiddenRuleKey,
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
  return (await (await openUltraDb()).get(kind as 'live', [playlistId, id])) as unknown as KindRows[K] | undefined;
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
