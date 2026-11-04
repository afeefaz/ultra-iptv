import type { IDBPDatabase } from 'idb';
import type { Built } from './build';
import { categoryRange, playlistRange, type UltraDb } from './db';
import { rematchFavorites, type Rematch } from './favorites';
import { pinsKey, type ContentKind } from './model';

export interface WriteStats {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  favorites: { moved: number; lost: number };
}

/**
 * Writes one kind's catalogue for a playlist, touching only rows whose content changed
 * (spec §6 "diff and write"). Other playlists are never touched. Favourites are re-matched in
 * the same transaction so the UI never sees them pointing at missing rows.
 */
export async function writeKind<K extends ContentKind>(
  db: IDBPDatabase<UltraDb>,
  playlistId: string,
  kind: K,
  built: Built<K>,
): Promise<WriteStats> {
  const tx = db.transaction(['categories', kind, 'favorites'], 'readwrite');
  const categories = tx.objectStore('categories');
  const store = tx.objectStore(kind);
  const favStore = tx.objectStore('favorites');

  // Requests are queued without awaiting each one: one IndexedDB round trip per row made a
  // 50,000-row first load take tens of seconds on phones. Errors still abort the transaction.
  const pending: Array<Promise<unknown>> = [];
  // Failures surface through Promise.all below (and abort the transaction); don't report them twice.
  const track = (p: Promise<unknown>) => {
    p.catch(() => undefined);
    pending.push(p);
  };
  track(categories.delete(categoryRange(playlistId, kind)));
  for (const c of built.categories) track(categories.put(c));

  const existing = new Map<string, string>();
  for (const row of (await store.getAll(playlistRange(playlistId))) as Array<{ id: string; sig: string }>) {
    existing.set(row.id, row.sig);
  }
  const stats: WriteStats = { added: 0, updated: 0, removed: 0, unchanged: 0, favorites: { moved: 0, lost: 0 } };
  const fresh = new Set<string>();
  for (const item of built.items) {
    fresh.add(item.id);
    const sig = existing.get(item.id);
    if (sig === item.sig) {
      stats.unchanged++;
      continue;
    }
    // The generic store type can't follow K through the union; rows are built for this kind.
    track((store.put as (value: unknown) => Promise<unknown>)(item));
    if (sig === undefined) stats.added++;
    else stats.updated++;
  }
  for (const id of Array.from(existing.keys())) {
    if (fresh.has(id)) continue;
    track(store.delete([playlistId, id]));
    stats.removed++;
  }

  const favorites = await favStore.index('byPlaylistKind').getAll([playlistId, kind]);
  const rematch: Rematch = rematchFavorites(favorites, built.items);
  for (const { from, to } of rematch.moved) {
    track(favStore.delete([from.playlistId, from.kind, from.key]));
    track(favStore.put(to));
  }
  stats.favorites = { moved: rematch.moved.length, lost: rematch.lost.length };
  await Promise.all(pending);
  await tx.done;
  return stats;
}

/** Removes every row belonging to a playlist (delete). */
export async function deletePlaylistData(db: IDBPDatabase<UltraDb>, playlistId: string): Promise<void> {
  const tx = db.transaction(
    ['playlists', 'secrets', 'categories', 'live', 'vod', 'series', 'favorites', 'epg', 'recent', 'locks', 'progress', 'details', 'settings'],
    'readwrite',
  );
  await tx.objectStore('playlists').delete(playlistId);
  await tx.objectStore('secrets').delete(playlistId);
  for (const kind of ['live', 'vod', 'series'] as const) {
    const kindRange = IDBKeyRange.bound([playlistId, kind, ''], [playlistId, kind, '\uffff']);
    await tx.objectStore('categories').delete(categoryRange(playlistId, kind));
    await tx.objectStore(kind).delete(playlistRange(playlistId));
    await tx.objectStore('favorites').delete(kindRange);
    await tx.objectStore('recent').delete(kindRange);
    await tx.objectStore('settings').delete(pinsKey(playlistId, kind));
  }
  await tx.objectStore('epg').delete(playlistRange(playlistId));
  for (const type of ['category', 'channel'] as const) {
    await tx.objectStore('locks').delete(IDBKeyRange.bound([playlistId, type, ''], [playlistId, type, '\uffff']));
  }
  for (const kind of ['vod', 'episode'] as const) {
    await tx.objectStore('progress').delete(IDBKeyRange.bound([playlistId, kind, ''], [playlistId, kind, '\uffff']));
  }
  for (const kind of ['vod', 'series', 'catchup']) {
    await tx.objectStore('details').delete(IDBKeyRange.bound([playlistId, kind, ''], [playlistId, kind, '\uffff']));
  }
  await tx.done;
}
