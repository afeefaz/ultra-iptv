// Managing this device's playlists from a website (docs/remote-and-sync-plan.md). The relay holds
// the list, encrypted. The website edits it there, and Refresh makes this device match it. Nothing
// about what happened goes back: a login that doesn't work shows here, and gets fixed on the website.
import { logging, log } from '../log';
import { toErrorInfo } from '../net/http';
import {
  deriveDeviceBoxes,
  DEVICE_TTL_SECONDS,
  generateDeviceId,
  generateDeviceKey,
  open,
  RelayClient,
  seal,
  type DeviceBoxes,
  type RemotePlaylist,
  type RemoteState,
} from '../pair/pair';
import type { SecretBox } from '../secure/secret-box';
import { openUltraDb } from './db';
import { hash64 } from './hash';
import type { EncryptedBlob, PlaylistInput, PlaylistRecord } from './model';
import { listPlaylists } from './queries';

const ID_SETTING = 'remote.deviceId';
const KEY_SETTING = 'remote.key';
/** The playlists last matched with the relay: id to hashes of what it held (see matchValue). */
const SYNCED_SETTING = 'remote.synced';

const LOGIN_FIELDS = ['server', 'username', 'password', 'm3uUrl', 'userAgent'] as const;

/** Hashes the whole playlist, then just its login: a rename shouldn't reload the catalogue. */
const matchValue = (p: RemotePlaylist) => `${hash64(JSON.stringify(p))}:${hash64(JSON.stringify(LOGIN_FIELDS.map((f) => p[f] ?? '')))}`;

export interface RemoteHost {
  editData(id: string): Promise<PlaylistInput>;
  save(input: PlaylistInput): Promise<PlaylistRecord>;
  remove(id: string): Promise<void>;
  secretsFound(secrets: string[]): void;
}

/** What the TV shows, and what the website asks for. */
export interface RemoteIdentity {
  id: string;
  key: string;
}

export interface TickResult {
  enabled: boolean;
  /** The relay couldn't be reached. */
  offline?: boolean;
  /** Playlists added or changed by this Refresh. Only a new login means reloading the catalogue. */
  saved: Array<{ id: string; isNew: boolean; reload: boolean }>;
  deleted: string[];
  /** Playlists the website saved that this device couldn't take, such as an invalid address. */
  failed: Array<{ name: string; code: string; message: string }>;
}

export class RemoteAccess {
  /** Replaced in tests. */
  relay = new RelayClient();
  private ticking: Promise<TickResult> | null = null;
  private boxes: { identity: string; boxes: DeviceBoxes } | null = null;

  constructor(
    private readonly host: RemoteHost,
    private readonly box: SecretBox,
  ) {}

  /** Null until the first launch has made them. */
  async identity(): Promise<RemoteIdentity | null> {
    const db = await openUltraDb();
    const blob = await db.get('settings', KEY_SETTING);
    const id = (await db.get('settings', ID_SETTING)) as string | undefined;
    if (!blob || !id) return null;
    const key = await this.box.open<string>(blob as EncryptedBlob);
    logging.redactor.addSecret(key);
    this.host.secretsFound([key]);
    return { id, key };
  }

  /** Local only, so the QR code works offline. The first Refresh publishes. */
  async enable(): Promise<RemoteIdentity> {
    const existing = await this.identity();
    if (existing) return existing;
    const db = await openUltraDb();
    let id = (await db.get('settings', ID_SETTING)) as string | undefined;
    if (!id) {
      id = generateDeviceId();
      await db.put('settings', id, ID_SETTING);
    }
    const key = generateDeviceKey();
    await db.put('settings', await this.box.seal(key), KEY_SETTING);
    logging.redactor.addSecret(key);
    this.host.secretsFound([key]);
    return { id, key };
  }

  private async boxesFor(identity: RemoteIdentity): Promise<DeviceBoxes> {
    const name = `${identity.id}|${identity.key}`;
    // Stretching the key is slow by design.
    if (this.boxes?.identity !== name) this.boxes = { identity: name, boxes: await deriveDeviceBoxes(identity.id, identity.key) };
    return this.boxes.boxes;
  }

  /** What Refresh does: makes this device match the relay. */
  tick(): Promise<TickResult> {
    if (!this.ticking) {
      const done = () => {
        this.ticking = null;
      };
      this.ticking = this.runTick();
      this.ticking.then(done, done);
    }
    return this.ticking;
  }

  private async runTick(): Promise<TickResult> {
    const result: TickResult = { enabled: false, saved: [], deleted: [], failed: [] };
    const identity = await this.identity();
    if (!identity) return result;
    result.enabled = true;
    const boxes = await this.boxesFor(identity);
    try {
      const sealed = await this.relay.get(boxes.stateBox);
      await this.match(boxes, sealed ? (await open<RemoteState>(boxes.key, sealed)).playlists : null, result);
    } catch (e) {
      result.offline = true;
      log.debug('remote', 'refresh failed', { error: toErrorInfo(e) });
    }
    return result;
  }

  private async match(boxes: DeviceBoxes, remote: RemotePlaylist[] | null, result: TickResult): Promise<void> {
    const db = await openUltraDb();
    const locals = await listPlaylists();
    const synced = ((await db.get('settings', SYNCED_SETTING)) as Record<string, string> | undefined) ?? {};
    const next: Record<string, string> = {};

    for (const playlist of remote ?? []) {
      const value = matchValue(playlist);
      next[playlist.id] = value;
      const here = locals.some((l) => l.id === playlist.id);
      if (here && synced[playlist.id] === value) continue;
      try {
        await this.applyPlaylist(playlist, here, synced[playlist.id], result);
      } catch (e) {
        const info = toErrorInfo(e);
        log.info('remote', 'could not take a playlist', { code: info.code });
        result.failed.push({ name: playlist.name, code: info.code, message: info.message });
      }
    }

    // On the relay before and gone now means it was deleted there. Never on the relay means someone
    // added it on this device, so the website should get it, not delete it.
    const uploads: RemotePlaylist[] = [];
    for (const local of locals) {
      if (next[local.id]) continue;
      if (remote && synced[local.id]) {
        await this.host.remove(local.id);
        result.deleted.push(local.id);
      } else {
        const playlist = await this.toRemote(local);
        uploads.push(playlist);
        next[local.id] = matchValue(playlist);
      }
    }
    if (uploads.length) await this.save(boxes, [...(remote ?? []), ...uploads]);
    await db.put('settings', next, SYNCED_SETTING);
  }

  private async applyPlaylist(playlist: RemotePlaylist, here: boolean, lastValue: string | undefined, result: TickResult): Promise<void> {
    const input = fromRemote(playlist);
    const reload = !here || (await this.loginChanged(input, playlist, lastValue));
    await this.host.save(input);
    result.saved.push({ id: playlist.id, isNew: !here, reload });
    log.info('remote', 'took a playlist', { isNew: !here, reload });
  }

  /** Compared with what was last fetched, because a saved address gets tidied (a trailing slash, say). */
  private async loginChanged(input: PlaylistInput, playlist: RemotePlaylist, lastValue: string | undefined): Promise<boolean> {
    const lastLogin = lastValue?.split(':')[1];
    if (lastLogin) return lastLogin !== matchValue(playlist).split(':')[1];
    const previous = await this.host.editData(playlist.id);
    return LOGIN_FIELDS.some((f) => (previous[f] ?? '') !== (input[f] ?? ''));
  }

  /** Someone added or edited a playlist here. Silent until this device has pressed Refresh. */
  async localSaved(id: string): Promise<void> {
    await this.changeOnRelay(async (list) => {
      const record = await (await openUltraDb()).get('playlists', id);
      if (!record) return list;
      const playlist = await this.toRemote(record);
      return list.some((p) => p.id === id) ? list.map((p) => (p.id === id ? playlist : p)) : [...list, playlist];
    });
  }

  /** Someone deleted a playlist here. Silent until this device has pressed Refresh. */
  async localDeleted(id: string): Promise<void> {
    await this.changeOnRelay(async (list) => list.filter((p) => p.id !== id));
  }

  /** Reads first, so only this one playlist changes: the website may have changed others meanwhile. */
  private async changeOnRelay(change: (list: RemotePlaylist[]) => Promise<RemotePlaylist[]>): Promise<void> {
    const db = await openUltraDb();
    const synced = (await db.get('settings', SYNCED_SETTING)) as Record<string, string> | undefined;
    const identity = await this.identity();
    if (!synced || !identity) return;
    const boxes = await this.boxesFor(identity);
    const sealed = await this.relay.get(boxes.stateBox);
    const before = sealed ? (await open<RemoteState>(boxes.key, sealed)).playlists : [];
    const after = await change(before);
    await this.save(boxes, after);
    // Only what this device changed counts as matched: anything else new still has to reach it.
    const next = { ...synced };
    for (const p of before) if (!after.some((a) => a.id === p.id)) delete next[p.id];
    for (const p of after) if (!before.some((b) => JSON.stringify(b) === JSON.stringify(p))) next[p.id] = matchValue(p);
    await db.put('settings', next, SYNCED_SETTING);
  }

  private async save(boxes: DeviceBoxes, playlists: RemotePlaylist[]): Promise<void> {
    const state: RemoteState = { playlists };
    await this.relay.put(boxes.stateBox, await seal(boxes.key, state), DEVICE_TTL_SECONDS);
  }

  private async toRemote(record: PlaylistRecord): Promise<RemotePlaylist> {
    const data = await this.host.editData(record.id);
    return {
      id: record.id,
      name: record.name,
      type: record.type,
      server: data.server,
      username: data.username,
      password: data.password,
      m3uUrl: data.m3uUrl,
      userAgent: data.userAgent,
      refreshHours: data.refreshHours,
      epgOffsetHours: data.epgOffsetHours,
    };
  }
}

function fromRemote(p: RemotePlaylist): PlaylistInput {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    server: p.server,
    username: p.username,
    password: p.password,
    m3uUrl: p.m3uUrl,
    userAgent: p.userAgent,
    refreshHours: p.refreshHours,
    epgOffsetHours: p.epgOffsetHours,
  };
}
