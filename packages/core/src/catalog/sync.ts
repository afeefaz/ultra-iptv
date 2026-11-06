// On-demand sync between devices (docs/remote-and-sync-plan.md). Push makes this device the source of
// truth for its group, and Pull replaces everything here with the last push. One encrypted box holds
// it, and nothing happens unless someone presses a button.
import { log } from '../log';
import { deriveDeviceBoxes, DEVICE_TTL_SECONDS, normalizeDeviceId, normalizeDeviceKey, open, seal, type DeviceBoxes, type RelayClient, type RemotePlaylist } from '../pair/pair';
import type { SecretBox } from '../secure/secret-box';
import { openUltraDb } from './db';
import { hiddenCategoriesKey, pinsKey, type ContentKind, type EncryptedBlob, type FavoriteRow, type LockRow, type PlaylistInput, type PlaylistRecord, type ProgressRow, type RecentRow } from './model';
import { listPlaylists } from './queries';

const GROUP_SETTING = 'sync.group';
const PUSHED_SETTING = 'sync.pushedAt';
const PULLED_SETTING = 'sync.pulledAt';
const KINDS: ContentKind[] = ['live', 'vod', 'series'];
/** Enough for any real chain of links, and it stops a loop. */
const MAX_LINKS = 4;

type WithoutPlaylist<T> = Omit<T, 'playlistId'>;

interface SyncedPlaylist extends RemotePlaylist {
  order: number;
  favorites: Array<WithoutPlaylist<FavoriteRow>>;
  recent: Array<WithoutPlaylist<RecentRow>>;
  progress: Array<WithoutPlaylist<ProgressRow>>;
  locks: Array<WithoutPlaylist<LockRow>>;
  pins: Partial<Record<ContentKind, string[]>>;
  hidden: Partial<Record<ContentKind, string[]>>;
}

interface Snapshot {
  type: 'snapshot';
  pushedAt: number;
  pushedBy: string;
  activeId: string | null;
  pin: unknown;
  /** Everything the interface keeps as device settings, exactly as stored. */
  settings: Record<string, string>;
  playlists: SyncedPlaylist[];
}

/** Left in a linked device's box, so linking to it finds the group. */
interface Link {
  type: 'link';
  id: string;
  key: string;
}

interface Identity {
  id: string;
  key: string;
}

export interface SyncHost {
  relay(): RelayClient;
  identity(): Promise<Identity>;
  editData(id: string): Promise<PlaylistInput>;
  save(input: PlaylistInput): Promise<PlaylistRecord>;
  remove(id: string): Promise<void>;
  readPin(): Promise<unknown>;
  writePin(pin: unknown): Promise<void>;
  /** Keeps the website's copy of this device's playlists in step, if it uses the website. */
  playlistsReplaced(): Promise<void>;
}

export interface SyncStatus {
  /** The device this one is linked to, if any. */
  linkedTo: string | null;
  pushedAt: number | null;
  pulledAt: number | null;
}

export type PushResult = { ok: true; at: number; bytes: number } | { ok: false; reason: 'offline' | 'too-large' };
export type FetchResult = { kind: 'found'; pushedAt: number; pushedBy: string; playlists: number } | { kind: 'none' } | { kind: 'offline' };
export type LinkResult = { ok: true } | { ok: false; reason: 'offline' | 'invalid' | 'not-found' };

export interface ApplyResult {
  settings: Record<string, string>;
  activeId: string | null;
}

const sameText = (a?: string, b?: string) => (a ?? '').trim().replace(/\/+$/, '').toLowerCase() === (b ?? '').trim().replace(/\/+$/, '').toLowerCase();

/** The same account at the same provider, so its catalogue here is still good. */
const sameAccount = (a: PlaylistInput, b: PlaylistInput) => a.type === b.type && (a.type === 'm3u' ? sameText(a.m3uUrl, b.m3uUrl) : sameText(a.server, b.server) && sameText(a.username, b.username));

export class SyncAccess {
  /** What Pull downloaded, waiting for the user to confirm. */
  private pending: Snapshot | null = null;
  private derived: { name: string; boxes: DeviceBoxes } | null = null;

  constructor(
    private readonly host: SyncHost,
    private readonly box: SecretBox,
  ) {}

  private async boxesOf(identity: Identity): Promise<DeviceBoxes> {
    const name = `${identity.id}|${identity.key}`;
    // Stretching the key is slow by design.
    if (this.derived?.name === name) return this.derived.boxes;
    const boxes = await deriveDeviceBoxes(identity.id, identity.key);
    this.derived = { name, boxes };
    return boxes;
  }

  private async group(): Promise<Identity | null> {
    const blob = await (await openUltraDb()).get('settings', GROUP_SETTING);
    return blob ? this.box.open<Identity>(blob as EncryptedBlob) : null;
  }

  async status(): Promise<SyncStatus> {
    const db = await openUltraDb();
    const group = await this.group();
    return {
      linkedTo: group?.id ?? null,
      pushedAt: ((await db.get('settings', PUSHED_SETTING)) as number | undefined) ?? null,
      pulledAt: ((await db.get('settings', PULLED_SETTING)) as number | undefined) ?? null,
    };
  }

  /**
   * Links to any device in a group, following it if that one is itself linked. It only succeeds if
   * a push is there: a mistyped ID or key finds an empty box, which would otherwise look like a link
   * that works and has nothing to pull yet.
   */
  async link(rawId: string, rawKey: string): Promise<LinkResult> {
    const id = normalizeDeviceId(rawId);
    const key = normalizeDeviceKey(rawKey);
    const own = await this.host.identity();
    if (!id || !key || id === own.id) return { ok: false, reason: 'invalid' };
    let target: Identity = { id, key };
    try {
      let found = false;
      for (let hop = 0; hop < MAX_LINKS && !found; hop++) {
        const boxes = await this.boxesOf(target);
        const sealed = await this.host.relay().get(boxes.syncBox);
        if (!sealed) return { ok: false, reason: 'not-found' };
        const content = await open<Snapshot | Link>(boxes.key, sealed);
        if (content.type === 'snapshot') {
          found = true;
        } else {
          target = { id: content.id, key: content.key };
          // The chain led back here: this device is already where the group's data lives.
          if (target.id === own.id) {
            await (await openUltraDb()).delete('settings', GROUP_SETTING);
            return { ok: true };
          }
        }
      }
      if (!found) return { ok: false, reason: 'not-found' };
      const ownBoxes = await this.boxesOf(own);
      const link: Link = { type: 'link', ...target };
      await this.host.relay().put(ownBoxes.syncBox, await seal(ownBoxes.key, link), DEVICE_TTL_SECONDS);
    } catch (e) {
      log.debug('sync', 'link failed', { error: e });
      return { ok: false, reason: 'offline' };
    }
    await (await openUltraDb()).put('settings', await this.box.seal(target), GROUP_SETTING);
    log.info('sync', 'linked');
    return { ok: true };
  }

  async unlink(): Promise<boolean> {
    try {
      const own = await this.boxesOf(await this.host.identity());
      await this.host.relay().remove(own.syncBox);
    } catch (e) {
      log.debug('sync', 'unlink failed', { error: e });
      return false;
    }
    await (await openUltraDb()).delete('settings', GROUP_SETTING);
    log.info('sync', 'unlinked');
    return true;
  }

  /** Makes this device the source of truth: one request. */
  async push(settings: Record<string, string>, activeId: string | null): Promise<PushResult> {
    const identity = await this.host.identity();
    const target = (await this.group()) ?? identity;
    const snapshot: Snapshot = {
      type: 'snapshot',
      pushedAt: Date.now(),
      pushedBy: identity.id,
      activeId,
      pin: (await this.host.readPin()) ?? null,
      settings,
      playlists: await this.gather(),
    };
    const boxes = await this.boxesOf(target);
    const sealed = await seal(boxes.key, snapshot);
    try {
      await this.host.relay().put(boxes.syncBox, sealed, DEVICE_TTL_SECONDS);
    } catch (e) {
      log.debug('sync', 'push failed', { error: e });
      return { ok: false, reason: e instanceof Error && e.message.indexOf('413') >= 0 ? 'too-large' : 'offline' };
    }
    await (await openUltraDb()).put('settings', snapshot.pushedAt, PUSHED_SETTING);
    log.info('sync', 'pushed', { playlists: snapshot.playlists.length, bytes: sealed.length });
    return { ok: true, at: snapshot.pushedAt, bytes: sealed.length };
  }

  private async gather(): Promise<SyncedPlaylist[]> {
    const db = await openUltraDb();
    const out: SyncedPlaylist[] = [];
    for (const record of await listPlaylists()) {
      const data = await this.host.editData(record.id);
      const synced: SyncedPlaylist = {
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
        order: record.order,
        favorites: [],
        recent: [],
        progress: strip(await db.getAllFromIndex('progress', 'byPlaylist', record.id)),
        locks: strip(await db.getAllFromIndex('locks', 'byPlaylist', record.id)),
        pins: {},
        hidden: {},
      };
      for (const kind of KINDS) {
        synced.favorites.push(...strip(await db.getAllFromIndex('favorites', 'byPlaylistKind', [record.id, kind])));
        synced.recent.push(...strip(await db.getAllFromIndex('recent', 'byPlaylistKind', [record.id, kind])));
        const pins = (await db.get('settings', pinsKey(record.id, kind))) as string[] | undefined;
        const hidden = (await db.get('settings', hiddenCategoriesKey(record.id, kind))) as string[] | undefined;
        if (pins) synced.pins[kind] = pins;
        if (hidden) synced.hidden[kind] = hidden;
      }
      out.push(synced);
    }
    return out;
  }

  /** Step one of Pull: one request, and nothing changes until apply. */
  async fetch(): Promise<FetchResult> {
    let target = (await this.group()) ?? (await this.host.identity());
    try {
      for (let hop = 0; hop < MAX_LINKS; hop++) {
        const boxes = await this.boxesOf(target);
        const sealed = await this.host.relay().get(boxes.syncBox);
        if (!sealed) return { kind: 'none' };
        const content = await open<Snapshot | Link>(boxes.key, sealed);
        if (content.type === 'snapshot') {
          this.pending = content;
          return { kind: 'found', pushedAt: content.pushedAt, pushedBy: content.pushedBy, playlists: content.playlists.length };
        }
        target = { id: content.id, key: content.key };
      }
    } catch (e) {
      log.debug('sync', 'fetch failed', { error: e });
      return { kind: 'offline' };
    }
    return { kind: 'none' };
  }

  /** Step two of Pull: this device now matches the push. The interface reloads after this. */
  async apply(): Promise<ApplyResult | null> {
    const snapshot = this.pending;
    if (!snapshot) return null;
    this.pending = null;
    const db = await openUltraDb();
    const locals = await listPlaylists();
    const localData = new Map<string, PlaylistInput>();
    for (const local of locals) localData.set(local.id, await this.host.editData(local.id));
    const used = new Set<string>();
    const ids = new Map<string, string>();

    for (const playlist of snapshot.playlists) {
      const input = fromSynced(playlist);
      // The same account keeps its local id, and with it the catalogue already downloaded here.
      let localId = locals.filter((l) => !used.has(l.id) && sameAccount(localData.get(l.id)!, input))[0]?.id;
      if (!localId && localData.has(playlist.id) && !used.has(playlist.id)) localId = playlist.id;
      const finalId = localId ?? playlist.id;
      used.add(finalId);
      ids.set(playlist.id, finalId);
      const previous = localId ? localData.get(localId) : undefined;
      await this.host.save({ ...input, id: finalId });
      const record = await db.get('playlists', finalId);
      if (record) {
        // A different login makes the catalogue here stale, so the app reloads it when it's next opened.
        const stale = !!previous && !(sameAccount(previous, input) && previous.password === input.password);
        await db.put('playlists', { ...record, order: playlist.order, lastSync: stale ? undefined : record.lastSync });
      }
      await this.replaceUserData(finalId, playlist);
    }
    for (const local of locals) if (!used.has(local.id)) await this.host.remove(local.id);
    await this.host.writePin(snapshot.pin);
    await db.put('settings', Date.now(), PULLED_SETTING);
    await this.host.playlistsReplaced().catch((e) => log.debug('sync', 'could not update the website copy', { error: e }));
    log.info('sync', 'pulled', { playlists: snapshot.playlists.length });
    return { settings: snapshot.settings, activeId: snapshot.activeId ? (ids.get(snapshot.activeId) ?? null) : null };
  }

  private async replaceUserData(playlistId: string, playlist: SyncedPlaylist): Promise<void> {
    const db = await openUltraDb();
    const tx = db.transaction(['favorites', 'recent', 'progress', 'locks', 'settings'], 'readwrite');
    const favorites = tx.objectStore('favorites');
    const recent = tx.objectStore('recent');
    const progress = tx.objectStore('progress');
    const locks = tx.objectStore('locks');
    const settings = tx.objectStore('settings');
    for (const kind of KINDS) {
      const range = IDBKeyRange.bound([playlistId, kind, ''], [playlistId, kind, '\uffff']);
      await favorites.delete(range);
      await recent.delete(range);
      await settings.delete(pinsKey(playlistId, kind));
      await settings.delete(hiddenCategoriesKey(playlistId, kind));
      const pins = playlist.pins[kind];
      const hidden = playlist.hidden[kind];
      if (pins) await settings.put(pins, pinsKey(playlistId, kind));
      if (hidden) await settings.put(hidden, hiddenCategoriesKey(playlistId, kind));
    }
    for (const key of await progress.index('byPlaylist').getAllKeys(playlistId)) await progress.delete(key);
    for (const key of await locks.index('byPlaylist').getAllKeys(playlistId)) await locks.delete(key);
    for (const row of playlist.favorites) await favorites.put({ ...row, playlistId });
    for (const row of playlist.recent) await recent.put({ ...row, playlistId });
    for (const row of playlist.progress) await progress.put({ ...row, playlistId });
    for (const row of playlist.locks) await locks.put({ ...row, playlistId });
    await tx.done;
  }
}

function strip<T extends { playlistId: string }>(rows: T[]): Array<WithoutPlaylist<T>> {
  return rows.map((row) => {
    const copy: Partial<T> = { ...row };
    delete copy.playlistId;
    return copy as WithoutPlaylist<T>;
  });
}

function fromSynced(p: SyncedPlaylist): PlaylistInput {
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
