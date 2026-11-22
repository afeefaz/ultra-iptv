import { log, type FetchResult, type LinkResult, type PushResult, type SyncStatus } from '@ultra/core';
import { createSignal } from 'solid-js';
import { catalog } from './catalog';
import { activePlaylist } from './playlists';
import { track } from './usage';

const PREFIX = 'ultraiptv.';
const ACTIVE_KEY = 'ultraiptv.activePlaylist';
/** Belong to this device: what it's measured, and how it logs. Every other setting travels. */
// Which way up the screen is belongs to one phone, not to every device.
const NOT_SYNCED = ['ultraiptv.usage', 'ultraiptv.log.salt', 'ultraiptv.log.level', 'ultraiptv.display.orientation', ACTIVE_KEY];

const [status, setStatus] = createSignal<SyncStatus | null>(null);
export { status as syncStatus };

export async function loadSyncStatus(): Promise<void> {
  try {
    setStatus(await catalog().call('syncStatus'));
  } catch (e) {
    log.debug('sync', 'could not read status', { error: e });
  }
}

/** Whether a stored key is a setting that Push and Pull carry to the other devices. */
export function isSyncedSetting(key: string): boolean {
  return key.indexOf(PREFIX) === 0 && NOT_SYNCED.indexOf(key) < 0;
}

/** Every device setting, so one added later syncs without touching this. */
function settingKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && isSyncedSetting(key)) keys.push(key);
  }
  return keys;
}

function readSettings(): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const key of settingKeys()) settings[key] = localStorage.getItem(key) ?? '';
  return settings;
}

export async function pushNow(): Promise<PushResult> {
  track('sync.push');
  const result = await catalog().call('syncPush', readSettings(), activePlaylist()?.id ?? null);
  void loadSyncStatus();
  return result;
}

export function fetchPush(): Promise<FetchResult> {
  track('sync.fetch');
  return catalog().call('syncFetch');
}

/** Replaces everything here with what fetchPush found, then restarts so every screen shows it. */
export async function applyPull(): Promise<void> {
  const result = await catalog().call('syncApply');
  if (!result) return;
  track('sync.pull');
  for (const key of settingKeys()) if (!(key in result.settings)) localStorage.removeItem(key);
  for (const key of Object.keys(result.settings)) localStorage.setItem(key, result.settings[key]!);
  if (result.activeId) localStorage.setItem(ACTIVE_KEY, result.activeId);
  location.reload();
}

export async function linkDevice(id: string, key: string): Promise<LinkResult> {
  track('sync.link');
  const result = await catalog().call('syncLink', id, key);
  void loadSyncStatus();
  return result;
}

export async function unlinkDevice(): Promise<boolean> {
  track('sync.unlink');
  const done = await catalog().call('syncUnlink');
  void loadSyncStatus();
  return done;
}
