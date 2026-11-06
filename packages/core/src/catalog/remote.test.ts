import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { setFetch } from '../net/http';
import { deriveDeviceBoxes, DEVICE_TTL_SECONDS, open, RelayClient, seal, type DeviceBoxes, type RemotePlaylist, type RemoteState } from '../pair/pair';
import { mockXtream } from '../testing/mock-provider';
import { useDatabaseName } from './db';
import { listPlaylists } from './queries';
import { PlaylistService } from './service';

const ORIGIN = 'http://mock.test';
const PASSWORD = 'demo';
let providerCalls = 0;

setFetch(async (url) => {
  providerCalls++;
  const u = new URL(url);
  const body = mockXtream(u.searchParams.get('action'), u.searchParams.get('username')!, u.searchParams.get('password')!, 0, ORIGIN, null);
  return new Response(JSON.stringify(body), { status: 200 });
});

/** A relay in memory that records everything it's sent. */
function fakeRelay() {
  const boxes = new Map<string, string>();
  const calls: Array<{ method: string; url: string; body: string }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = (init?.body as string | undefined) ?? '';
    calls.push({ method, url, body });
    const id = new URL(url).pathname.split('/').pop()!;
    if (method === 'PUT') {
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
  return { boxes, calls, client: new RelayClient('http://relay.test', fetcher) };
}

const XTREAM = { name: 'Demo', type: 'xtream' as const, server: `${ORIGIN}/`, username: 'demo', password: PASSWORD };
const remote = (id: string, extra: Partial<RemotePlaylist> = {}): RemotePlaylist => ({ id, ...XTREAM, ...extra });

let n = 0;
let service: PlaylistService;
let relay: ReturnType<typeof fakeRelay>;

beforeEach(() => {
  useDatabaseName(`remote-test-${n++}`);
  providerCalls = 0;
  relay = fakeRelay();
  service = new PlaylistService({ changed: () => undefined, progress: () => undefined, secrets: () => undefined });
  service.remote.relay = relay.client;
});

/** What the website gets from the ID and key. */
async function websiteBoxes(): Promise<DeviceBoxes> {
  const { id, key } = await service.remote.enable();
  return deriveDeviceBoxes(id, key);
}

const read = async (boxes: DeviceBoxes) => (await open<RemoteState>(boxes.key, (await relay.client.get(boxes.stateBox))!)).playlists;
const websiteSaves = async (boxes: DeviceBoxes, playlists: RemotePlaylist[]) => relay.client.put(boxes.stateBox, await seal(boxes.key, { playlists }), DEVICE_TTL_SECONDS);
const requests = (since: number) => relay.calls.slice(since).map((c) => c.method);

describe('remote access', () => {
  it('makes the ID and key without the relay, so the QR code works offline', async () => {
    const first = await service.remote.enable();
    expect(relay.calls).toEqual([]);
    expect(first.id).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
    expect(first.key).toMatch(/^[2-9A-HJKMNP-TV-Z]{8}$/);
    expect(await service.remote.enable()).toEqual(first);
  });

  it('takes what the website saved while the TV was off, with one request', async () => {
    const boxes = await websiteBoxes();
    await websiteSaves(boxes, [remote('from-website')]);
    // A new launch, months later: nothing but the database carries over.
    service = new PlaylistService({ changed: () => undefined, progress: () => undefined, secrets: () => undefined });
    service.remote.relay = relay.client;
    const since = relay.calls.length;
    const result = await service.remote.tick();
    expect(result.saved).toEqual([{ id: 'from-website', isNew: true, reload: true }]);
    expect((await listPlaylists()).map((p) => p.id)).toEqual(['from-website']);
    expect(requests(since)).toEqual(['GET']);
  });

  it('never reports back: the website only sees what was saved', async () => {
    const boxes = await websiteBoxes();
    const saved = [remote('a', { password: 'wrong' })];
    await websiteSaves(boxes, saved);
    await service.remote.tick();
    expect(relay.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(await read(boxes)).toEqual(saved);
  });

  it('takes a wrong login without calling the provider, so the TV can show the error', async () => {
    const boxes = await websiteBoxes();
    await websiteSaves(boxes, [remote('a', { password: 'wrong' })]);
    const result = await service.remote.tick();
    expect(providerCalls).toBe(0);
    expect(result.saved).toEqual([{ id: 'a', isNew: true, reload: true }]);
    expect((await service.editData('a')).password).toBe('wrong');
  });

  it('marks a changed login for reloading, and a rename not', async () => {
    const boxes = await websiteBoxes();
    await websiteSaves(boxes, [remote('a')]);
    await service.remote.tick();
    await websiteSaves(boxes, [remote('a', { name: 'Renamed' })]);
    expect((await service.remote.tick()).saved).toEqual([{ id: 'a', isNew: false, reload: false }]);
    expect((await listPlaylists())[0]?.name).toBe('Renamed');
    await websiteSaves(boxes, [remote('a', { name: 'Renamed', username: 'other' })]);
    expect((await service.remote.tick()).saved).toEqual([{ id: 'a', isNew: false, reload: true }]);
  });

  it('uses one request and changes nothing when nothing is new', async () => {
    const boxes = await websiteBoxes();
    // A pasted link is saved differently than it was typed, which must not look like a change each time.
    await websiteSaves(boxes, [remote('a', { server: `${ORIGIN}/get.php?username=demo&password=demo` })]);
    await service.remote.tick();
    const since = relay.calls.length;
    const result = await service.remote.tick();
    expect(result.saved).toEqual([]);
    expect(requests(since)).toEqual(['GET']);
  });

  it('deletes a playlist that was deleted on the website', async () => {
    const boxes = await websiteBoxes();
    await websiteSaves(boxes, [remote('a'), remote('b')]);
    await service.remote.tick();
    await websiteSaves(boxes, [remote('b')]);
    expect((await service.remote.tick()).deleted).toEqual(['a']);
    expect((await listPlaylists()).map((p) => p.id)).toEqual(['b']);
  });

  it('deletes everything if the website emptied the list', async () => {
    const boxes = await websiteBoxes();
    await websiteSaves(boxes, [remote('a')]);
    await service.remote.tick();
    await websiteSaves(boxes, []);
    expect((await service.remote.tick()).deleted).toEqual(['a']);
  });

  it('uploads what a TV already has on its first Refresh', async () => {
    const { id } = await service.save({ ...XTREAM, name: 'On the TV' });
    const boxes = await websiteBoxes();
    await service.remote.tick();
    expect((await read(boxes)).map((p) => [p.id, p.name, p.password])).toEqual([[id, 'On the TV', PASSWORD]]);
  });

  it('never deletes a playlist added on the TV, even if the website saved first', async () => {
    const { id } = await service.save({ ...XTREAM, name: 'On the TV' });
    const boxes = await websiteBoxes();
    await websiteSaves(boxes, [remote('from-website')]);
    const result = await service.remote.tick();
    expect(result.deleted).toEqual([]);
    expect((await listPlaylists()).map((p) => p.id).sort()).toEqual([id, 'from-website'].sort());
    expect((await read(boxes)).map((p) => p.id).sort()).toEqual([id, 'from-website'].sort());
  });

  it('keeps going past a playlist it cannot take, and says which', async () => {
    const boxes = await websiteBoxes();
    await websiteSaves(boxes, [remote('bad', { name: 'Bad', server: 'not a url' }), remote('good')]);
    const result = await service.remote.tick();
    expect(result.failed.map((f) => f.name)).toEqual(['Bad']);
    expect((await listPlaylists()).map((p) => p.id)).toEqual(['good']);
  });

  it('sends nothing the relay can read', async () => {
    await service.save({ ...XTREAM, name: 'Private name' });
    const { id, key } = await service.remote.enable();
    await service.remote.tick();
    const sent = relay.calls.map((c) => c.url + c.body).join('\n');
    expect(relay.calls.some((c) => c.method === 'PUT')).toBe(true);
    for (const secret of ['Private name', ORIGIN, '"password"', key, id, id.replace(/:/g, '')]) expect(sent).not.toContain(secret);
  });

  it('saves for far longer than a TV might sit unused', async () => {
    await service.save(XTREAM);
    await websiteBoxes();
    await service.remote.tick();
    const put = relay.calls.filter((c) => c.method === 'PUT')[0]!;
    expect(Number(new URL(put.url).searchParams.get('ttl'))).toBeGreaterThan(5 * 365 * 24 * 3600);
  });

  describe('changes made on the TV', () => {
    it('send nothing before the first Refresh', async () => {
      const { id } = await service.save(XTREAM);
      await service.remote.enable();
      await service.remote.localSaved(id);
      await service.remote.localDeleted(id);
      expect(relay.calls).toEqual([]);
    });

    it('update only that playlist, keeping what the website changed meanwhile', async () => {
      const boxes = await websiteBoxes();
      await websiteSaves(boxes, [remote('a'), remote('b')]);
      await service.remote.tick();
      await websiteSaves(boxes, [remote('a'), remote('b', { name: 'Website edit' })]);
      await service.save({ ...XTREAM, id: 'a', name: 'TV edit' });
      await service.remote.localSaved('a');
      expect((await read(boxes)).map((p) => p.name)).toEqual(['TV edit', 'Website edit']);
      // And the website's edit still reaches the TV.
      await service.remote.tick();
      expect((await listPlaylists()).filter((p) => p.id === 'b')[0]?.name).toBe('Website edit');
    });

    it('add a new one, and delete one without it coming back', async () => {
      const boxes = await websiteBoxes();
      await websiteSaves(boxes, [remote('a')]);
      await service.remote.tick();
      const { id } = await service.save({ ...XTREAM, name: 'New on TV' });
      await service.remote.localSaved(id);
      expect((await read(boxes)).map((p) => p.name)).toEqual(['Demo', 'New on TV']);
      await service.remove('a');
      await service.remote.localDeleted('a');
      expect((await read(boxes)).map((p) => p.id)).toEqual([id]);
      const result = await service.remote.tick();
      expect(result.saved).toEqual([]);
      expect(result.deleted).toEqual([]);
    });
  });
});
