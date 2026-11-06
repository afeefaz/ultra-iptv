import { log, type RemoteIdentity } from '@ultra/core';
import { createSignal } from 'solid-js';
import { catalog } from './catalog';
import { errorText } from '../format';
import { playlists, refreshPlaylist, reloadPlaylists } from './playlists';
import { track } from './usage';

const [identity, setIdentity] = createSignal<RemoteIdentity | null>(null);
/** Set when a playlist added from another device has finished loading. */
const [remoteAdded, setRemoteAdded] = createSignal<{ id: string; ok: boolean } | null>(null);
/** Set while a playlist added from another device is loading. */
const [remoteLoading, setRemoteLoading] = createSignal<string | null>(null);
export { identity as remoteIdentity, remoteAdded, remoteLoading };

let checking: Promise<CheckOutcome> | null = null;

export type CheckOutcome = { kind: 'updated' | 'none' | 'offline' } | { kind: 'failed'; name: string; reason: string };

async function runCheck(): Promise<CheckOutcome> {
  try {
    const result = await catalog().call('remoteTick');
    if (result.offline) return { kind: 'offline' };
    if (result.saved.length || result.deleted.length) await reloadPlaylists();
    let failed: CheckOutcome | null = null;
    for (const problem of result.failed) failed = failed ?? { kind: 'failed', name: problem.name, reason: errorText({ code: problem.code, message: problem.message }) };
    for (const { id, isNew, reload } of result.saved) {
      track('remote.applied');
      if (!reload) continue;
      if (isNew) setRemoteLoading(id);
      const loaded = await refreshPlaylist(id);
      if (isNew) {
        setRemoteLoading(null);
        setRemoteAdded({ id, ok: !!loaded?.ok });
      }
      if (!loaded?.ok && !failed) {
        const name = playlists().filter((p) => p.id === id)[0]?.name ?? '';
        failed = { kind: 'failed', name, reason: errorText(loaded?.error ?? { code: 'network', message: '' }) };
      }
    }
    if (failed) return failed;
    return { kind: result.saved.length || result.deleted.length ? 'updated' : 'none' };
  } catch (e) {
    log.debug('remote', 'refresh failed', { error: e });
    return { kind: 'offline' };
  }
}

/** The Refresh button. One at a time: two at once would load the same new playlist twice. */
export function checkNow(): Promise<CheckOutcome> {
  track('remote.check');
  if (!identity()) return Promise.resolve({ kind: 'none' });
  if (!checking) {
    const done = () => {
      checking = null;
    };
    checking = runCheck();
    checking.then(done, done);
  }
  return checking;
}

/** A playlist added or edited on this device, so the website doesn't keep the old one. */
export function publishSaved(id: string): void {
  catalog()
    .call('remoteLocalSaved', id)
    .catch((e) => log.debug('remote', 'could not save to the relay', { error: e }));
}

/** A playlist deleted on this device. */
export function publishDeleted(id: string): void {
  catalog()
    .call('remoteLocalDeleted', id)
    .catch((e) => log.debug('remote', 'could not save to the relay', { error: e }));
}

/** Makes or reads the ID and key for the QR code. This doesn't contact the relay. */
export function startRemoteAccess(): void {
  void catalog().call('remoteEnable').then(setIdentity);
}
