import { listPlaylists, log, type PlaylistRecord, type RefreshResult } from '@ultra/core';
import { createSignal } from 'solid-js';
import { catalog, onCatalogEvent } from './catalog';

const ACTIVE_KEY = 'ultraiptv.activePlaylist';
const HOUR = 3600_000;

const [playlists, setPlaylists] = createSignal<PlaylistRecord[]>([]);
const [loaded, setLoaded] = createSignal(false);
const [activeIdSignal, setActiveIdSignal] = createSignal<string | null>(readActive());
const [refreshing, setRefreshing] = createSignal<Record<string, boolean>>({});
/** Bumped whenever a playlist's catalogue changes; screens re-query on it. */
const [catalogVersion, setCatalogVersion] = createSignal<Record<string, number>>({});

export { catalogVersion, loaded as playlistsLoaded, playlists, refreshing };

export const activePlaylist = (): PlaylistRecord | null => {
  const list = playlists();
  const id = activeIdSignal();
  return list.filter((p) => p.id === id)[0] ?? list[0] ?? null;
};

export const versionOf = (playlistId: string | null | undefined): number =>
  playlistId ? (catalogVersion()[playlistId] ?? 0) : 0;

export async function reloadPlaylists(): Promise<void> {
  try {
    setPlaylists(await listPlaylists());
  } catch (e) {
    log.error('playlist', 'could not read playlists', { error: e });
  } finally {
    setLoaded(true);
  }
}

export function setActivePlaylist(id: string): void {
  setActiveIdSignal(id);
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // ignore
  }
  log.info('playlist', 'switched', { playlist: id });
  const record = playlists().filter((p) => p.id === id)[0];
  if (record && isStale(record)) void refreshPlaylist(id);
}

export function isStale(p: PlaylistRecord): boolean {
  return !p.lastSync || Date.now() - p.lastSync > p.refreshHours * HOUR;
}

/** Background refresh (spec §6): cached data stays on screen while this runs. */
export async function refreshPlaylist(id: string): Promise<RefreshResult | null> {
  setRefreshing((r) => ({ ...r, [id]: true }));
  try {
    return await catalog().call('refresh', id);
  } catch (e) {
    log.warn('playlist', 'refresh request failed', { playlist: id, error: e });
    return null;
  } finally {
    setRefreshing((r) => ({ ...r, [id]: false }));
    void reloadPlaylists();
  }
}

let started = false;

/** Loads playlists, listens for worker changes, and refreshes the active playlist if it is stale. */
export function startPlaylists(): void {
  if (started) return;
  started = true;
  onCatalogEvent((e) => {
    if (e.event !== 'changed') return;
    // Only catalogue writes bump the version; favourites/metadata changes just reload the list.
    if (e.playlistId && e.kinds.length) bump(e.playlistId);
    scheduleReload();
  });
  void reloadPlaylists().then(() => {
    const active = activePlaylist();
    if (active && isStale(active)) void refreshPlaylist(active.id);
  });
}

function bump(playlistId: string): void {
  setCatalogVersion((v) => ({ ...v, [playlistId]: (v[playlistId] ?? 0) + 1 }));
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReload(): void {
  if (reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void reloadPlaylists();
  }, 150);
}

function readActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
