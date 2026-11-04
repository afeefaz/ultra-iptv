import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { setFetch } from '../net/http';
import { mockM3u, mockXtream } from '../testing/mock-provider';
import { openUltraDb, useDatabaseName } from './db';
import { favoriteKeys, listCategories, listItems, listPlaylists } from './queries';
import { PlaylistService } from './service';

const ORIGIN = 'http://mock.test';
let generation = 0;
let active = 0;
let maxActive = 0;
let failAction: string | null = null;
const requested: string[] = [];

setFetch(async (url) => {
  requested.push(url);
  active++;
  maxActive = Math.max(maxActive, active);
  await new Promise((r) => setTimeout(r, 5));
  active--;
  const u = new URL(url);
  if (u.pathname.endsWith('/player_api.php')) {
    const action = u.searchParams.get('action');
    if (action && action === failAction) return new Response('boom', { status: 500 });
    const body = mockXtream(action, u.searchParams.get('username')!, u.searchParams.get('password')!, generation, ORIGIN, u.searchParams.get('stream_id') ?? u.searchParams.get('vod_id') ?? u.searchParams.get('series_id'));
    return new Response(JSON.stringify(body), { status: 200 });
  }
  if (u.pathname.endsWith('/list.m3u')) return new Response(mockM3u('demo', generation, ORIGIN), { status: 200 });
  return new Response('not found', { status: 404 });
});

let n = 0;
let events: string[] = [];
let service: PlaylistService;

beforeEach(() => {
  useDatabaseName(`svc-test-${n++}`);
  generation = 0;
  maxActive = 0;
  failAction = null;
  requested.length = 0;
  events = [];
  service = new PlaylistService({
    changed: (id, kinds) => events.push(`changed:${id}:${kinds.join(',')}`),
    progress: (p) => events.push(p.step === 'saved' ? `progress:${p.kind}:${p.count}` : `step:${p.done}/${p.total}`),
    secrets: () => undefined,
  });
});

const XTREAM = { name: 'Demo', type: 'xtream' as const, server: `${ORIGIN}/`, username: 'demo', password: 'demo' };

describe('PlaylistService (Xtream)', () => {
  it('tests credentials and rejects bad ones', async () => {
    const ok = await service.test(XTREAM);
    expect(ok.account).toMatchObject({ status: 'Active', maxConnections: 2 });
    await expect(service.test({ ...XTREAM, password: 'wrong' })).rejects.toMatchObject({ info: { code: 'auth' } });
  });

  it('saves with encrypted credentials only', async () => {
    const rec = await service.save(XTREAM);
    expect(rec).toMatchObject({ type: 'xtream', host: 'mock.test', userHint: 'de•••' });
    const db = await openUltraDb();
    const stored = JSON.stringify(await db.get('playlists', rec.id));
    expect(stored).not.toContain('demo"');
    const blob = await db.get('secrets', rec.id);
    expect(new TextDecoder().decode(blob!.data)).not.toContain('demo');
  });

  it('loads in parallel (max 3), live first, and writes per playlist', async () => {
    const rec = await service.save(XTREAM);
    const result = await service.refresh(rec.id);
    expect(result).toMatchObject({ ok: true, counts: { live: 300, vod: 200, series: 60 } });
    expect(maxActive).toBe(3);
    expect(events.filter((e) => e.startsWith('progress'))[0]).toBe('progress:live:300');
    // Percentage steps only go up and end at 100 %.
    const steps = events.filter((e) => e.startsWith('step') || e.startsWith('progress'));
    expect(steps.length).toBe(10);
    expect(events.filter((e) => e.startsWith('step')).every((e, i, all) => i === 0 || Number(e.split(/[:/]/)[1]) > Number(all[i - 1].split(/[:/]/)[1]))).toBe(true);
    expect(await listItems(rec.id, 'live', null)).toHaveLength(300);
    expect((await listCategories(rec.id, 'live')).length).toBe(12);
    expect((await listPlaylists())[0]).toMatchObject({ counts: { live: 300 }, account: { status: 'Active' } });
  });

  it('keeps favourites across a refresh that renumbers every stream', async () => {
    const rec = await service.save(XTREAM);
    await service.refresh(rec.id);
    const before = await listItems(rec.id, 'live', '1');
    const fav = before[3];
    await service.toggleFavorite({ playlistId: rec.id, kind: 'live', key: fav.key, name: fav.name, tvgId: fav.tvgId });

    generation = 1;
    await service.refresh(rec.id);
    const after = await listItems(rec.id, 'live', null);
    const same = after.filter((r) => r.key === fav.key)[0];
    expect(same.id).not.toBe(fav.id);
    expect(same.name).toBe(fav.name);
    expect(await favoriteKeys(rec.id, 'live')).toEqual([fav.key]);
    expect(after.length).toBe(300 - 4 + 3); // every 97th from #5 removed (5, 102, 199, 296), 3 added
  });

  it('keeps cached data and reports partial failures', async () => {
    const rec = await service.save(XTREAM);
    await service.refresh(rec.id);
    failAction = 'get_vod_streams';
    const result = await service.refresh(rec.id);
    expect(result.ok).toBe(true);
    expect(result.partial).toEqual(['vod']);
    expect(await listItems(rec.id, 'vod', null)).toHaveLength(200);
    failAction = 'get_live_streams';
    const failed = await service.refresh(rec.id);
    expect(failed).toMatchObject({ ok: false, error: { code: 'http', status: 500 } });
    expect(await listItems(rec.id, 'live', null)).toHaveLength(300);
  });

  it('accepts a pasted get.php URL as M3U input and treats it as Xtream', async () => {
    const rec = await service.save({ name: '', type: 'm3u', m3uUrl: `${ORIGIN}/get.php?username=demo&password=demo&type=m3u_plus` });
    expect(rec.type).toBe('xtream');
    expect((await service.refresh(rec.id)).ok).toBe(true);
  });

  it('keeps the saved password when editing without retyping it', async () => {
    const rec = await service.save(XTREAM);
    const updated = await service.save({ ...XTREAM, id: rec.id, name: 'Renamed', password: '' });
    expect(updated.name).toBe('Renamed');
    expect((await service.refresh(rec.id)).ok).toBe(true);
  });

  it('deletes everything for one playlist only', async () => {
    const a = await service.save(XTREAM);
    const b = await service.save({ ...XTREAM, name: 'Second' });
    await service.refresh(a.id);
    await service.refresh(b.id);
    await service.remove(a.id);
    expect(await listItems(a.id, 'live', null)).toHaveLength(0);
    expect(await listItems(b.id, 'live', null)).toHaveLength(300);
    expect((await listPlaylists()).map((p) => p.id)).toEqual([b.id]);
  });
});

describe('PlaylistService (playback support)', () => {
  it('caches the short EPG and serves it without refetching', async () => {
    const rec = await service.save(XTREAM);
    const first = await service.shortEpg(rec.id, '1001');
    expect(first).toHaveLength(4);
    const before = requested.length;
    const again = await service.shortEpg(rec.id, '1001');
    expect(again).toEqual(first);
    expect(requested.length).toBe(before);
    expect(await service.shortEpg(rec.id, '1003')).toEqual([]); // every 7th mock channel has no guide
  });

  it('builds stream URLs with the account’s credentials', async () => {
    const rec = await service.save(XTREAM);
    const r = await service.streamUrl(rec.id, { t: 'x', id: '1005' }, 'auto', true);
    expect(r.url).toBe(`${ORIGIN}/live/demo/demo/1005.m3u8`);
  });

  it('keeps the 30 most recent channels, newest first', async () => {
    const rec = await service.save(XTREAM);
    for (let i = 0; i < 35; i++) await service.addRecent(rec.id, 'live', `k${i}`, `Channel ${i}`);
    const { recentKeys } = await import('./queries');
    const keys = await recentKeys(rec.id, 'live');
    expect(keys).toHaveLength(30);
    expect(keys[0]).toBe('k34');
    expect(keys[29]).toBe('k5');
  });

  it('toggles locks and runs the PIN life cycle', async () => {
    const rec = await service.save(XTREAM);
    expect(await service.toggleLock(rec.id, 'category', '2')).toBe(true);
    expect(await service.toggleLock(rec.id, 'category', '2')).toBe(false);
    expect(await service.pinStatus()).toEqual({ set: false });
    await service.setPin(null, '1234');
    expect(await service.pinStatus()).toEqual({ set: true });
    expect(await service.verifyPin('1234')).toBe(true);
    expect(await service.verifyPin('0000')).toBe(false);
    await expect(service.setPin('0000', '5555')).rejects.toMatchObject({ info: { code: 'auth' } });
    await service.setPin('1234', '5555');
    expect(await service.verifyPin('5555')).toBe(true);
    await expect(service.clearPin('1234')).rejects.toMatchObject({ info: { code: 'auth' } });
    await service.clearPin('5555');
    expect(await service.pinStatus()).toEqual({ set: false });
  });
});

describe('PlaylistService (movies, series, catch-up)', () => {
  it('caches movie and series details', async () => {
    const rec = await service.save(XTREAM);
    const vod = await service.vodInfo(rec.id, '500003');
    expect(vod).toMatchObject({ ext: 'mkv', durationSecs: 300 });
    const before = requested.length;
    expect(await service.vodInfo(rec.id, '500003')).toEqual(vod);
    expect(requested.length).toBe(before);
    const series = await service.seriesInfo(rec.id, '700001');
    expect(series.seasons).toEqual([1, 2]);
  });

  it('lists only past, replayable programmes, newest first', async () => {
    const rec = await service.save(XTREAM);
    const list = await service.catchupListings(rec.id, '1000', 3);
    expect(list.length).toBeGreaterThan(100);
    expect(list.every((e) => e.stop <= Date.now())).toBe(true);
    expect(list[0].start).toBeGreaterThan(list[1].start);
    expect(await service.catchupListings(rec.id, '1001', 3)).toEqual([]); // no archive on this mock channel
  });

  it('stores, lists and clears progress per playlist', async () => {
    const rec = await service.save(XTREAM);
    const { listProgress } = await import('./queries');
    const row = {
      playlistId: rec.id,
      kind: 'vod' as const,
      key: 'k1',
      position: 130,
      duration: 300,
      updatedAt: Date.now(),
      watched: false,
      title: 'Movie',
      ref: { t: 'movie' as const, id: '500000', ext: 'mp4' },
    };
    await service.saveProgress(row);
    await service.saveProgress({ ...row, key: 'k2', updatedAt: row.updatedAt + 5 });
    expect((await listProgress(rec.id)).map((r) => r.key)).toEqual(['k2', 'k1']);
    await service.clearProgress(rec.id, 'vod', 'k2');
    expect((await listProgress(rec.id)).map((r) => r.key)).toEqual(['k1']);
    await service.remove(rec.id);
    expect(await listProgress(rec.id)).toEqual([]);
  });
});

describe('PlaylistService (category pins)', () => {
  it('pins in order, unpins, and forgets them with the playlist', async () => {
    const rec = await service.save(XTREAM);
    const { categoryPins } = await import('./queries');
    expect(await service.togglePin(rec.id, 'live', '3')).toBe(true);
    expect(await service.togglePin(rec.id, 'live', '1')).toBe(true);
    expect(await service.togglePin(rec.id, 'vod', '9')).toBe(true);
    expect(await categoryPins(rec.id, 'live')).toEqual(['3', '1']);
    expect(await service.togglePin(rec.id, 'live', '3')).toBe(false);
    expect(await categoryPins(rec.id, 'live')).toEqual(['1']);
    const { hiddenCategories } = await import('./queries');
    expect(await hiddenCategories(rec.id, 'live')).toEqual([]);
    await service.setHiddenCategories(rec.id, 'live', ['2']);
    expect(await hiddenCategories(rec.id, 'live')).toEqual(['2']);
    expect(await hiddenCategories(rec.id, 'vod')).toEqual([]);
    await service.remove(rec.id);
    expect(await categoryPins(rec.id, 'live')).toEqual([]);
    expect(await categoryPins(rec.id, 'vod')).toEqual([]);
  });
});

describe('PlaylistService (M3U)', () => {
  it('parses, templates stream credentials and searches', async () => {
    const rec = await service.save({ name: 'List', type: 'm3u', m3uUrl: `${ORIGIN}/list.m3u` });
    const result = await service.refresh(rec.id);
    expect(result.counts).toMatchObject({ live: 300, vod: 50 });
    const rows = await listItems(rec.id, 'live', null);
    expect(JSON.stringify(rows)).not.toContain('/demo/demo/');
    expect(rows[0].stream).toEqual({ t: 'u', url: `${ORIGIN}/__fixtures/live/{u}/{p}/1000.ts` });
    const found = await service.search(rec.id, 'news 1 hd');
    expect(found.hits.live[0].name).toBe('News 1 HD');
  });
});
