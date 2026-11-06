import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { setFetch } from '../net/http';
import { deriveDeviceBoxes, DEVICE_TTL_SECONDS, open, RelayClient, seal, type RemoteState } from '../pair/pair';
import { mockXtream } from '../testing/mock-provider';
import { openUltraDb, useDatabaseName } from './db';
import { hiddenCategoriesKey, pinsKey, type ProgressRow } from './model';
import { listPlaylists } from './queries';
import { PlaylistService } from './service';

const ORIGIN = 'http://mock.test';

setFetch(async (url) => {
  const u = new URL(url);
  const body = mockXtream(u.searchParams.get('action'), u.searchParams.get('username')!, u.searchParams.get('password')!, 0, ORIGIN, null);
  return new Response(JSON.stringify(body), { status: 200 });
});

function fakeRelay() {
  const boxes = new Map<string, string>();
  const calls: Array<{ method: string; url: string; body: string }> = [];
  let limit = Infinity;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = (init?.body as string | undefined) ?? '';
    calls.push({ method, url, body });
    const id = new URL(url).pathname.split('/').pop()!;
    if (method === 'PUT') {
      if (body.length > limit) return new Response('too large', { status: 413 });
      boxes.set(id, body);
      return new Response(null, { status: 204 });
    }
    if (method === 'DELETE') {
      boxes.delete(id);
      return new Response(null, { status: 204 });
    }
    const found = boxes.get(id);
    return found === undefined ? new Response('', { status: 404 }) : new Response(found, { status: 200 });
  }) as typeof fetch;
  return { boxes, calls, setLimit: (n: number) => (limit = n), client: new RelayClient('http://relay.test', fetcher) };
}

const XTREAM = { name: 'Demo', type: 'xtream' as const, server: `${ORIGIN}/`, username: 'demo', password: 'demo' };

let run = 0;
let relay: ReturnType<typeof fakeRelay>;

interface Device {
  service: PlaylistService;
  dbName: string;
}

function device(): Device {
  const dbName = `sync-test-${run++}`;
  useDatabaseName(dbName);
  const service = new PlaylistService({ changed: () => undefined, progress: () => undefined, secrets: () => undefined });
  service.remote.relay = relay.client;
  return { service, dbName };
}

/** Everything after this runs on that device. */
function on(d: Device): PlaylistService {
  useDatabaseName(d.dbName);
  return d.service;
}

const progressRow = (key: string, position: number): Omit<ProgressRow, 'playlistId'> => ({ kind: 'vod', key, position, duration: 100, updatedAt: 1, watched: false, title: key, ref: { t: 'movie', id: key } });

async function addUserData(playlistId: string, label: string): Promise<void> {
  const db = await openUltraDb();
  await db.put('favorites', { playlistId, kind: 'live', key: `fav-${label}`, name: 'A channel', addedAt: 1 });
  await db.put('recent', { playlistId, kind: 'vod', key: `recent-${label}`, name: 'A movie', playedAt: 1 });
  await db.put('progress', { ...progressRow(`progress-${label}`, 42), playlistId });
  await db.put('locks', { playlistId, type: 'category', id: `lock-${label}` });
  await db.put('settings', [`pin-${label}`], pinsKey(playlistId, 'live'));
  await db.put('settings', [`hidden-${label}`], hiddenCategoriesKey(playlistId, 'vod'));
}

async function userData(playlistId: string) {
  const db = await openUltraDb();
  return {
    favorites: (await db.getAllFromIndex('favorites', 'byPlaylistKind', [playlistId, 'live'])).map((r) => r.key),
    recent: (await db.getAllFromIndex('recent', 'byPlaylistKind', [playlistId, 'vod'])).map((r) => r.key),
    progress: (await db.getAllFromIndex('progress', 'byPlaylist', playlistId)).map((r) => [r.key, r.position]),
    locks: (await db.getAllFromIndex('locks', 'byPlaylist', playlistId)).map((r) => r.id),
    pins: await db.get('settings', pinsKey(playlistId, 'live')),
    hidden: await db.get('settings', hiddenCategoriesKey(playlistId, 'vod')),
  };
}

/** Linking needs a push to find, so this makes sure there is one. */
async function linkTo(from: Device, to: Device): Promise<void> {
  const identity = await on(to).remote.enable();
  expect((await on(to).sync.push({}, null)).ok).toBe(true);
  expect((await on(from).sync.link(identity.id, identity.key)).ok).toBe(true);
}

async function pull(d: Device) {
  const service = on(d);
  const found = await service.sync.fetch();
  expect(found.kind).toBe('found');
  return service.sync.apply();
}

beforeEach(() => {
  relay = fakeRelay();
});

describe('sync', () => {
  it('sends nothing until someone presses a button', async () => {
    const a = device();
    await on(a).save(XTREAM);
    await on(a).sync.status();
    expect(relay.calls).toEqual([]);
  });

  it('pushes in one request and pulls in one request', async () => {
    const a = device();
    const b = device();
    await on(a).save(XTREAM);
    await linkTo(b, a);
    let since = relay.calls.length;
    expect((await on(a).sync.push({}, null)).ok).toBe(true);
    expect(relay.calls.slice(since).map((c) => c.method)).toEqual(['PUT']);
    since = relay.calls.length;
    await pull(b);
    expect(relay.calls.slice(since).map((c) => c.method)).toEqual(['GET']);
  });

  it('copies playlists, logins and all user data to another device', async () => {
    const a = device();
    const b = device();
    const { id } = await on(a).save({ ...XTREAM, name: 'From A' });
    await addUserData(id, 'a');
    await linkTo(b, a);
    await on(a).sync.push({ 'ultraiptv.display.textScale': '120' }, id);
    const result = await pull(b);
    const lists = await listPlaylists();
    expect(lists.map((p) => p.name)).toEqual(['From A']);
    const here = lists[0]!.id;
    expect((await on(b).editData(here)).password).toBe('demo');
    expect(await userData(here)).toEqual({ favorites: ['fav-a'], recent: ['recent-a'], progress: [['progress-a', 42]], locks: ['lock-a'], pins: ['pin-a'], hidden: ['hidden-a'] });
    expect(result?.settings).toEqual({ 'ultraiptv.display.textScale': '120' });
    expect(result?.activeId).toBe(here);
  });

  it('makes a device match exactly: what is not in the push goes', async () => {
    const a = device();
    const b = device();
    await on(a).save({ ...XTREAM, name: 'Keep' });
    await on(b).save({ ...XTREAM, username: 'other', name: 'Not in the push' });
    await linkTo(b, a);
    await on(a).sync.push({}, null);
    await pull(b);
    expect((await listPlaylists()).map((p) => p.name)).toEqual(['Keep']);
  });

  it('replaces progress and favourites rather than merging', async () => {
    const a = device();
    const b = device();
    const { id: idA } = await on(a).save(XTREAM);
    await addUserData(idA, 'a');
    const { id: idB } = await on(b).save(XTREAM);
    await addUserData(idB, 'b');
    await linkTo(b, a);
    await on(a).sync.push({}, null);
    await pull(b);
    const data = await userData(idB);
    expect(data.favorites).toEqual(['fav-a']);
    expect(data.progress).toEqual([['progress-a', 42]]);
    expect(data.locks).toEqual(['lock-a']);
  });

  it('keeps the catalogue of an account already here, so nothing downloads again', async () => {
    const a = device();
    const b = device();
    await on(a).save({ ...XTREAM, server: `${ORIGIN}/`, name: 'On A' });
    const { id: idB } = await on(b).save({ ...XTREAM, name: 'On B' });
    const db = await openUltraDb();
    await db.put('playlists', { ...(await db.get('playlists', idB))!, lastSync: 12345 });
    await db.put('live', { playlistId: idB, id: 'kept' } as never);
    await linkTo(b, a);
    await on(a).sync.push({}, null);
    await pull(b);
    const after = await openUltraDb();
    const record = (await listPlaylists())[0]!;
    expect(record.id).toBe(idB);
    expect(record.name).toBe('On A');
    expect(record.lastSync).toBe(12345);
    expect(await after.get('live', [idB, 'kept'])).toBeTruthy();
  });

  it('marks a catalogue stale when the password changed, and a new playlist needs loading', async () => {
    const a = device();
    const b = device();
    await on(a).save({ ...XTREAM, password: 'new-password' });
    const { id: idB } = await on(b).save(XTREAM);
    const db = await openUltraDb();
    await db.put('playlists', { ...(await db.get('playlists', idB))!, lastSync: 12345 });
    await linkTo(b, a);
    await on(a).sync.push({}, null);
    await pull(b);
    const record = (await listPlaylists())[0]!;
    expect(record.id).toBe(idB);
    expect(record.lastSync).toBeUndefined();
    expect((await on(b).editData(idB)).password).toBe('new-password');
  });

  it('keeps the order of the playlists', async () => {
    const a = device();
    const b = device();
    await on(a).save({ ...XTREAM, name: 'One', username: 'one' });
    await on(a).save({ ...XTREAM, name: 'Two', username: 'two' });
    await linkTo(b, a);
    await on(a).sync.push({}, null);
    await pull(b);
    expect((await listPlaylists()).map((p) => p.name)).toEqual(['One', 'Two']);
  });

  it('brings the parental PIN across, and removes it if the source has none', async () => {
    const a = device();
    const b = device();
    await on(a).setPin(null, '1234');
    await linkTo(b, a);
    await on(a).sync.push({}, null);
    await pull(b);
    expect(await on(b).verifyPin('1234')).toBe(true);
    await on(a).clearPin('1234');
    await on(a).sync.push({}, null);
    await pull(b);
    expect((await on(b).pinStatus()).set).toBe(false);
  });

  it('treats whichever device pushed last as the source of truth, across three devices', async () => {
    const a = device();
    const b = device();
    const c = device();
    await linkTo(b, a);
    await linkTo(c, a);
    await on(a).save({ ...XTREAM, name: 'From A' });
    await on(a).sync.push({}, null);
    await pull(c);
    expect((await listPlaylists()).map((p) => p.name)).toEqual(['From A']);
    await on(b).save({ ...XTREAM, name: 'From B', username: 'bee' });
    await on(b).sync.push({}, null);
    await pull(a);
    expect((await listPlaylists()).map((p) => p.name)).toEqual(['From B']);
    await pull(c);
    expect((await listPlaylists()).map((p) => p.name)).toEqual(['From B']);
  });

  it('finds the group when linking to a device that is itself linked', async () => {
    const a = device();
    const b = device();
    const c = device();
    await linkTo(b, a);
    await linkTo(c, b);
    await on(a).save({ ...XTREAM, name: 'From A' });
    await on(a).sync.push({}, null);
    await pull(c);
    expect((await listPlaylists()).map((p) => p.name)).toEqual(['From A']);
    expect((await on(c).sync.status()).linkedTo).toBe((await on(a).remote.enable()).id);
  });

  it('does not get stuck when two devices link to each other', async () => {
    const a = device();
    const b = device();
    await linkTo(b, a);
    const identity = await on(b).remote.enable();
    expect((await on(a).sync.link(identity.id, identity.key)).ok).toBe(true);
    await on(a).save(XTREAM);
    await on(a).sync.push({}, null);
    await pull(b);
    expect(await listPlaylists()).toHaveLength(1);
  });

  it('refuses a mistyped ID or key, says so, and saves nothing', async () => {
    const a = device();
    const b = device();
    await on(a).save(XTREAM);
    await on(a).sync.push({}, null);
    const real = await on(a).remote.enable();
    const wrongId = real.id.slice(0, 6) + (real.id[6] === '0' ? 'C' : '0') + real.id.slice(7);
    const wrongKey = (real.key[0] === 'A' ? 'B' : 'A') + real.key.slice(1);
    const writes = () => relay.calls.filter((c) => c.method === 'PUT').length;
    const before = writes();
    expect(await on(b).sync.link(wrongId, real.key)).toEqual({ ok: false, reason: 'not-found' });
    expect(await on(b).sync.link(real.id, wrongKey)).toEqual({ ok: false, reason: 'not-found' });
    expect(writes()).toBe(before);
    expect((await on(b).sync.status()).linkedTo).toBeNull();
  });

  it('can replace a bad link by linking again', async () => {
    const a = device();
    const b = device();
    await on(a).save({ ...XTREAM, name: 'From A' });
    await on(a).sync.push({}, null);
    const real = await on(a).remote.enable();
    // How a build that didn't check could have left things.
    const box = (b.service as unknown as { box: { seal(v: unknown): Promise<unknown> } }).box;
    on(b);
    await (await openUltraDb()).put('settings', await box.seal({ id: '02:00:00:00:00:01', key: 'ABCD2345' }), 'sync.group');
    expect(await on(b).sync.fetch()).toEqual({ kind: 'none' });
    expect((await on(b).sync.link(real.id, real.key)).ok).toBe(true);
    await pull(b);
    expect((await listPlaylists()).map((p) => p.name)).toEqual(['From A']);
  });

  it('refuses this device’s own ID, and nonsense', async () => {
    const a = device();
    const own = await on(a).remote.enable();
    expect(await on(a).sync.link(own.id, own.key)).toEqual({ ok: false, reason: 'invalid' });
    expect(await on(a).sync.link('nope', 'nope')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('says when nothing has been pushed, and changes nothing', async () => {
    const a = device();
    await on(a).save(XTREAM);
    expect(await on(a).sync.fetch()).toEqual({ kind: 'none' });
    expect(await on(a).sync.apply()).toBeNull();
    expect(await listPlaylists()).toHaveLength(1);
  });

  it('changes nothing on fetch, only after confirming', async () => {
    const a = device();
    const b = device();
    await on(a).save({ ...XTREAM, name: 'From A' });
    await on(b).save({ ...XTREAM, name: 'From B', username: 'bee' });
    await linkTo(b, a);
    await on(a).sync.push({}, null);
    const found = await on(b).sync.fetch();
    expect(found).toMatchObject({ kind: 'found', playlists: 1, pushedBy: (await on(a).remote.enable()).id });
    on(b);
    expect((await listPlaylists()).map((p) => p.name)).toEqual(['From B']);
  });

  it('reports a push too large for the relay, and a relay it cannot reach', async () => {
    const a = device();
    await on(a).save(XTREAM);
    relay.setLimit(10);
    expect(await on(a).sync.push({}, null)).toEqual({ ok: false, reason: 'too-large' });
    expect((await on(a).sync.status()).pushedAt).toBeNull();
    on(a).remote.relay = new RelayClient('http://relay.test', (async () => {
      throw new Error('no network');
    }) as typeof fetch);
    expect(await on(a).sync.push({}, null)).toEqual({ ok: false, reason: 'offline' });
  });

  it('sends nothing the relay can read', async () => {
    const a = device();
    const { id } = await on(a).save({ ...XTREAM, name: 'Private name' });
    await addUserData(id, 'secret-favourite');
    await on(a).sync.push({ 'ultraiptv.locale': 'ar' }, id);
    const sent = relay.calls.map((c) => c.url + c.body).join('\n');
    for (const text of ['Private name', ORIGIN, 'secret-favourite', 'ultraiptv.locale', '"password"']) expect(sent).not.toContain(text);
  });

  it('keeps a website-managed device in step, so Refresh does not undo a pull', async () => {
    const a = device();
    const b = device();
    await on(a).save({ ...XTREAM, name: 'From A' });
    await on(a).sync.push({}, null);
    const { id: idB } = await on(b).save({ ...XTREAM, name: 'Old', username: 'bee' });
    const own = await on(b).remote.enable();
    const boxes = await deriveDeviceBoxes(own.id, own.key);
    await relay.client.put(boxes.stateBox, await seal(boxes.key, { playlists: [] }), DEVICE_TTL_SECONDS);
    await on(b).remote.tick();
    await linkTo(b, a);
    await pull(b);
    const state = await open<RemoteState>(boxes.key, (await relay.client.get(boxes.stateBox))!);
    expect(state.playlists.map((p) => p.name)).toEqual(['From A']);
    const result = await on(b).remote.tick();
    expect(result.saved).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect((await listPlaylists()).map((p) => p.name)).toEqual(['From A']);
    expect((await listPlaylists()).some((p) => p.id === idB)).toBe(false);
  });

  it('leaves the website alone on a device that does not use it', async () => {
    const a = device();
    const b = device();
    await on(a).save(XTREAM);
    await linkTo(b, a);
    await on(a).sync.push({}, null);
    const own = await on(b).remote.enable();
    const boxes = await deriveDeviceBoxes(own.id, own.key);
    await pull(b);
    expect(relay.boxes.has(boxes.stateBox)).toBe(false);
  });

  it('can unlink', async () => {
    const a = device();
    const b = device();
    await linkTo(b, a);
    expect((await on(b).sync.status()).linkedTo).not.toBeNull();
    expect(await on(b).sync.unlink()).toBe(true);
    expect((await on(b).sync.status()).linkedTo).toBeNull();
  });
});
