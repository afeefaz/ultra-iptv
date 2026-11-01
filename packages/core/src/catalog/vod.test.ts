import { describe, expect, it } from 'vitest';
import { M3uParser, type M3uEntry } from '../sources/m3u';
import { mockM3u, mockSeriesInfo, mockVodInfo } from '../testing/mock-provider';
import { buildM3u, parseEpisodeName } from './build';
import { fillCatchupTemplate, m3uCatchupUrl, xtreamStartParam, xtreamTimeshiftUrl } from './catchup';
import { parseSeriesInfo, parseVodInfo, versionKey } from './details';
import { resolveMedia } from './stream-url';

const START = Date.UTC(2026, 10, 1, 18, 30); // 2026-11-01 18:30 UTC
const END = START + 30 * 60_000;
const NOW = START + 3 * 3600_000;

describe('details parsing', () => {
  it('reads get_vod_info including the real container extension', () => {
    const info = parseVodInfo(mockVodInfo('500003', 'http://o'));
    expect(info).toMatchObject({ genre: 'Documentary', durationSecs: 300, rating: 3.5, ext: 'mkv', releaseDate: '1983-06-01' });
    expect(parseVodInfo({ info: { duration: '01:30:00', backdrop_path: ['http://b/1.jpg'] } })).toMatchObject({
      durationSecs: 5400,
      backdrop: 'http://b/1.jpg',
    });
    expect(parseVodInfo(null)).toMatchObject({ ext: undefined });
  });

  it('reads get_series_info with episodes keyed by season, or as a flat array', () => {
    const info = parseSeriesInfo(mockSeriesInfo('700002', 'http://o'));
    expect(info.seasons).toEqual([1, 2, 3]);
    expect(info.episodes).toHaveLength(18);
    expect(info.episodes[6]).toMatchObject({ season: 2, episode: 1, ext: 'mp4', durationSecs: 300 });
    const flat = parseSeriesInfo({ episodes: [[{ id: '9', season: 2, episode_num: 3, title: 'X' }], { id: '8', season: 1 }] });
    expect(flat.episodes.map((e) => e.id)).toEqual(['8', '9']);
    expect(flat.seasons).toEqual([1, 2]);
  });

  it('matches versions of the same movie across categories', () => {
    expect(versionKey('EN| The Matrix (1999) 4K')).toBe(versionKey('The Matrix [MULTI-SUBS] FHD'));
    expect(versionKey('AR: فيلم الرسالة HD')).toBe(versionKey('فيلم الرسالة'));
    expect(versionKey('The Matrix')).not.toBe(versionKey('The Matrix Reloaded'));
  });
});

describe('catch-up URLs', () => {
  it('formats Xtream start times, preferring the server’s own string', () => {
    expect(xtreamStartParam(START)).toBe('2026-11-01:18-30');
    expect(xtreamStartParam(START, '2026-11-01 20:30:00')).toBe('2026-11-01:20-30');
    expect(xtreamTimeshiftUrl('http://h:8080', 'u s', 'p', '42', START, 30, 'm3u8')).toBe(
      'http://h:8080/timeshift/u%20s/p/30/2026-11-01:18-30/42.m3u8',
    );
  });

  it('fills placeholders in both {x} and ${x} forms, with dividers', () => {
    expect(fillCatchupTemplate('?s={utc}&e=${end}&d={duration:60}&o={offset}&t={Y}-{m}-{d}T{H}:{M}', START, END, NOW)).toBe(
      `?s=${START / 1000}&e=${END / 1000}&d=30&o=${3 * 3600}&t=2026-11-01T18:30`,
    );
    expect(fillCatchupTemplate('{unknown}', START, END, NOW)).toBe('{unknown}');
  });

  it('supports the common M3U catchup modes', () => {
    const live = 'http://h/live/u/p/42.ts';
    const s = START / 1000;
    expect(m3uCatchupUrl(live, 'default', 'http://a/{utc}/{duration}.m3u8', START, END, NOW)).toBe(`http://a/${s}/1800.m3u8`);
    expect(m3uCatchupUrl(live, 'append', '?utc={utc}', START, END, NOW)).toBe(`${live}?utc=${s}`);
    expect(m3uCatchupUrl(live, 'shift', undefined, START, END, NOW)).toBe(`${live}?utc=${s}&lutc=${NOW / 1000}`);
    expect(m3uCatchupUrl('http://f/ch/index.m3u8?token=1', 'flussonic', undefined, START, END, NOW)).toBe(
      `http://f/ch/index-${s}-1800.m3u8?token=1`,
    );
    expect(m3uCatchupUrl('http://f/ch/mpegts', 'flussonic', undefined, START, END, NOW)).toBe(`http://f/ch/mpegts/archive-${s}-1800.m3u8`);
    expect(m3uCatchupUrl(live, 'xc', undefined, START, END, NOW)).toBe('http://h/timeshift/u/p/30/2026-11-01:18-30/42.ts');
    expect(m3uCatchupUrl('http://h/pre/live/u/p/42.ts', 'xc', undefined, START, END, NOW)).toBe(
      'http://h/pre/timeshift/u/p/30/2026-11-01:18-30/42.ts',
    );
    expect(m3uCatchupUrl(live, undefined, undefined, START, END, NOW)).toBeNull();
    expect(m3uCatchupUrl(live, undefined, '?x={utc}', START, END, NOW)).toBe(`${live}?x=${s}`); // source alone → append
  });
});

describe('resolveMedia', () => {
  const secret = { server: 'http://h', username: 'u', password: 'p', streamUser: 'su', streamPass: 'sp' };

  it('builds movie and episode URLs with their container', () => {
    expect(resolveMedia({ t: 'movie', id: '5', ext: 'mkv' }, secret, true, NOW)).toEqual({ url: 'http://h/movie/u/p/5.mkv', container: 'progressive' });
    expect(resolveMedia({ t: 'episode', id: '9' }, secret, true, NOW)).toEqual({ url: 'http://h/series/u/p/9.mp4', container: 'progressive' });
    expect(resolveMedia({ t: 'url', url: 'http://x/movie/{u}/{p}/1.mp4' }, secret, true, NOW).url).toBe('http://x/movie/su/sp/1.mp4');
  });

  it('prefers HLS for Xtream catch-up in browsers, TS elsewhere', () => {
    const ref = { t: 'catchup' as const, stream: { t: 'x' as const, id: '42' }, start: START, durationMin: 30 };
    const web = resolveMedia(ref, secret, true, NOW);
    expect(web.container).toBe('hls');
    expect(web.fallback?.container).toBe('ts');
    expect(resolveMedia(ref, secret, false, NOW).url).toMatch(/\/42\.ts$/);
    expect(() =>
      resolveMedia({ ...ref, stream: { t: 'u', url: 'http://h/live/u/p/42.ts' } }, secret, true, NOW),
    ).toThrow(/no catch-up/);
  });
});

describe('M3U series', () => {
  it('splits episode names', () => {
    expect(parseEpisodeName('Show Name S02 E05')).toEqual({ show: 'Show Name', season: 2, episode: 5 });
    expect(parseEpisodeName('Show.Name.s1e12 720p')).toEqual({ show: 'Show.Name', season: 1, episode: 12 });
    expect(parseEpisodeName('Show 3x04')).toEqual({ show: 'Show', season: 3, episode: 4 });
    expect(parseEpisodeName('Documentary')).toEqual({ show: 'Documentary', season: 1, episode: 0 });
  });

  it('groups one entry per episode into series rows', () => {
    const entries: M3uEntry[] = [];
    const parser = new M3uParser((e) => entries.push(e));
    parser.push(mockM3u('demo', 0, 'http://o')!);
    parser.end();
    const built = buildM3u('p', entries, { u: 'demo', p: 'demo' });
    expect(built.series.items).toHaveLength(5);
    const show = built.series.items[0];
    expect(show.name).toBe('Show 1');
    expect(show.episodes!.map((e) => `${e.season}x${e.episode}`)).toEqual(['1x1', '1x2', '2x3', '2x4']);
    expect(show.episodes![0].url).toBe('http://o/__fixtures/series/{u}/{p}/800001.mp4');
  });
});
