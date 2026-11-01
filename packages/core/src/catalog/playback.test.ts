import { describe, expect, it } from 'vitest';
import { checkPin, hashPin, isValidPin } from '../secure/pin';
import { mockShortEpg } from '../testing/mock-provider';
import { decodeEpgText, nowNext, parseShortEpg } from './epg';
import { containerOf, resolveLiveStream } from './stream-url';

describe('EPG', () => {
  it('decodes base64 UTF-8 titles and leaves plain text alone', () => {
    expect(decodeEpgText(Buffer.from('نشرة الأخبار').toString('base64'))).toBe('نشرة الأخبار');
    expect(decodeEpgText('Plain Title')).toBe('Plain Title');
    expect(decodeEpgText('abcd')).toBe('abcd'); // valid base64 but not valid UTF-8 text → kept
    expect(decodeEpgText(undefined)).toBe('');
  });

  it('parses Xtream listings using UTC timestamps', () => {
    const now = Date.UTC(2026, 9, 31, 20, 10);
    const items = parseShortEpg(mockShortEpg('1001', now));
    expect(items).toHaveLength(4);
    expect(items[0].start).toBeLessThanOrEqual(now);
    expect(items[0].stop).toBeGreaterThan(now);
    expect(items[0].title.length).toBeGreaterThan(0);
    expect(items[1].start).toBe(items[0].stop);
  });

  it('falls back to the date strings and drops broken entries', () => {
    const items = parseShortEpg([
      { title: 'QQ==', start: '2026-10-31 20:00:00', end: '2026-10-31 21:00:00' },
      { title: 'bad', start: '2026-10-31 22:00:00', end: '2026-10-31 21:00:00' },
    ]);
    expect(items).toEqual([
      { start: Date.UTC(2026, 9, 31, 20), stop: Date.UTC(2026, 9, 31, 21), title: 'A', description: undefined, serverStart: '2026-10-31 20:00:00' },
    ]);
  });

  it('picks now/next and applies the playlist offset', () => {
    const h = 3600_000;
    const items = [
      { start: 10 * h, stop: 11 * h, title: 'A' },
      { start: 11 * h, stop: 12 * h, title: 'B' },
    ];
    expect(nowNext(items, 10.5 * h)).toMatchObject({ now: { title: 'A' }, next: { title: 'B' }, progress: 0.5 });
    expect(nowNext(items, 9 * h)).toMatchObject({ next: { title: 'A' } });
    expect(nowNext(items, 13 * h)).toEqual({});
    // Provider an hour behind: +1 h makes "A" current at 11:30.
    expect(nowNext(items, 11.5 * h, 1)).toMatchObject({ now: { title: 'A', start: 11 * h } });
  });
});

describe('resolveLiveStream', () => {
  const secret = { server: 'http://h.tv:8080', username: 'u s', password: 'p/w' };
  const ref = { t: 'x' as const, id: '42' };

  it('prefers HLS for browsers and offers TS as the fallback', () => {
    const r = resolveLiveStream(ref, secret, 'auto', true);
    expect(r).toEqual({
      url: 'http://h.tv:8080/live/u%20s/p%2Fw/42.m3u8',
      container: 'hls',
      fallback: { url: 'http://h.tv:8080/live/u%20s/p%2Fw/42.ts', container: 'ts' },
    });
    expect(resolveLiveStream(ref, secret, 'auto', false).container).toBe('ts');
    expect(resolveLiveStream(ref, secret, 'ts', true).container).toBe('ts');
  });

  it('respects the account’s allowed output formats', () => {
    const r = resolveLiveStream(ref, secret, 'auto', true, { outputFormats: ['ts'] });
    expect(r.container).toBe('ts');
    expect(r.fallback).toBeUndefined();
  });

  it('fills M3U credential placeholders', () => {
    const m3u = resolveLiveStream({ t: 'u', url: 'http://x/live/{u}/{p}/1.ts' }, { streamUser: 'al', streamPass: 'pw' }, 'auto', true);
    expect(m3u).toEqual({ url: 'http://x/live/al/pw/1.ts', container: 'ts' });
    expect(containerOf('http://x/a.m3u8?token=1')).toBe('hls');
    expect(containerOf('http://x/movie.mkv')).toBe('progressive');
  });
});

describe('PIN hashing', () => {
  it('verifies the right PIN only and salts every hash', async () => {
    const a = await hashPin('1234');
    const b = await hashPin('1234');
    expect(a.hash).not.toBe(b.hash);
    expect(await checkPin('1234', a)).toBe(true);
    expect(await checkPin('4321', a)).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('0000')).toBe(true);
  });
});
