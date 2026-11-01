import { listLocks, log, type ChannelRow, type LockType } from '@ultra/core';
import { createEffect, createSignal, on } from 'solid-js';
import { catalog } from './catalog';
import { activePlaylist } from './playlists';

export type PinMode = 'verify' | 'create' | 'change' | 'remove';

interface PinRequest {
  mode: PinMode;
  resolve: (ok: boolean) => void;
}

const [pinRequest, setPinRequest] = createSignal<PinRequest | null>(null);
const [pinSet, setPinSet] = createSignal(false);
/** Unlocked for this session after one correct PIN (spec §5). */
const [unlocked, setUnlocked] = createSignal(false);
const [lockedCategories, setLockedCategories] = createSignal<Set<string>>(new Set());
const [lockedChannels, setLockedChannels] = createSignal<Set<string>>(new Set());

export { lockedCategories, lockedChannels, pinRequest, pinSet, unlocked };

/** Shows the PIN dialog (rendered by the App) and resolves when it closes. */
export function requestPin(mode: PinMode): Promise<boolean> {
  return new Promise((resolve) => {
    pinRequest()?.resolve(false);
    setPinRequest({ mode, resolve });
  });
}

export function finishPinRequest(ok: boolean): void {
  const req = pinRequest();
  setPinRequest(null);
  if (!req) return;
  if (ok && (req.mode === 'verify' || req.mode === 'create' || req.mode === 'change')) setUnlocked(true);
  if (ok && req.mode === 'remove') setUnlocked(false);
  void refreshPinStatus();
  req.resolve(ok);
}

export async function refreshPinStatus(): Promise<void> {
  try {
    setPinSet((await catalog().call('pinStatus')).set);
  } catch (e) {
    log.warn('parental', 'pin status failed', { error: e });
  }
}

export async function reloadLocks(playlistId: string | null | undefined): Promise<void> {
  if (!playlistId) {
    setLockedCategories(new Set<string>());
    setLockedChannels(new Set<string>());
    return;
  }
  const rows = await listLocks(playlistId);
  setLockedCategories(new Set(rows.filter((r) => r.type === 'category').map((r) => r.id)));
  setLockedChannels(new Set(rows.filter((r) => r.type === 'channel').map((r) => r.id)));
}

let started = false;
export function startParental(): void {
  if (started) return;
  started = true;
  void refreshPinStatus();
  createEffect(on(() => activePlaylist()?.id, (id) => void reloadLocks(id)));
}

export const isCategoryLocked = (id: string) => lockedCategories().has(id);

export function isChannelLocked(row: Pick<ChannelRow, 'key' | 'categoryIds'>): boolean {
  if (lockedChannels().has(row.key)) return true;
  const cats = lockedCategories();
  for (const id of row.categoryIds) if (cats.has(id)) return true;
  return false;
}

/** True when content may be shown: no PIN, already unlocked, or the PIN was just entered. */
export async function ensureUnlocked(): Promise<boolean> {
  if (!pinSet() || unlocked()) return true;
  return requestPin('verify');
}

/** Lock/unlock a category or channel. Creates a PIN first if none exists. */
export async function toggleLock(type: LockType, id: string): Promise<boolean | null> {
  const playlistId = activePlaylist()?.id;
  if (!playlistId) return null;
  if (!pinSet()) {
    if (!(await requestPin('create'))) return null;
  } else if (!(await ensureUnlocked())) {
    return null;
  }
  const locked = await catalog().call('toggleLock', playlistId, type, id);
  await reloadLocks(playlistId);
  return locked;
}
