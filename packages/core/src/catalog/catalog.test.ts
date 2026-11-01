import { describe, expect, it } from 'vitest';
import type { M3uEntry } from '../sources/m3u';
import { buildM3u, buildXtreamLive, kindOfM3uEntry, UNCATEGORIZED } from './build';
import { rematchFavorites } from './favorites';
import { normalizeText } from './hash';
import type { FavoriteRow } from './model';
import { SearchIndex } from './search';
import { dominantPair, fillUrl, templateUrl } from './stream-creds';

const cats = [
  { category_id: '1', category_name: 'News' },
  { category_id: '2', category_name: 'Sports' },
  { category_id: '3', category_name: 'Empty' },
];
const streams = [
  { num: 1, name: 'Alpha News', stream_id: 101, category_id: '1', epg_channel_id: 'alpha.news', tv_archive: 1, tv_archive_duration: '3' },
  { num: 2, name: 'Beta Sports', stream_id: 102, category_ids: [2, 1] },
  { num: 3, name: 'Gamma', stream_id: 103, category_id: null },
  { num: 4, name: 'Delta', stream_id: 104, category_id: '99' },
];

describe('buildXtreamLive', () => {
  const built = buildXtreamLive('pl', cats, streams);

  it('maps rows, multiple categories and catch-up', () => {
    expect(built.items[0]).toMatchObject({ id: '101', num: 1, tvgId: 'alpha.news', catchupDays: 3, categoryIds: ['1'] });
    expect(built.items[1].categoryIds).toEqual(['2', '1']);
    expect(built.items[1].catKeys).toEqual(['pl|2', 'pl|1']);
    expect(built.items[2].categoryIds).toEqual([UNCATEGORIZED]);
    expect(built.items[3].categoryIds).toEqual([UNCATEGORIZED]); // unknown category id
  });

  it('counts items per category and drops empty ones', () => {
    expect(built.categories.map((c) => [c.id, c.count])).toEqual([
      ['1', 2],
      ['2', 1],
      [UNCATEGORIZED, 2],
    ]);
  });

  it('keeps stable keys when the provider renumbers stream ids', () => {
    const renumbered = buildXtreamLive('pl', cats, streams.map((s) => ({ ...s, stream_id: Number(s.stream_id) + 5000, num: 10 + Number(s.num) })));
    expect(renumbered.items.map((i) => i.key)).toEqual(built.items.map((i) => i.key));
    expect(renumbered.items.map((i) => i.id)).not.toEqual(built.items.map((i) => i.id));
    expect(renumbered.items[0].sig).not.toBe(built.items[0].sig);
  });

  it('gives exact duplicates distinct keys', () => {
    const dup = buildXtreamLive('pl', cats, [streams[0], { ...streams[0], stream_id: 999 }]);
    expect(dup.items[0].key).not.toBe(dup.items[1].key);
  });
});

describe('M3U credentials and kinds', () => {
  const urls = [
    'http://h/live/al/pw/1.ts',
    'http://h/live/al/pw/2.ts',
    'http://h/al/pw/3',
    'http://h/movie/al/pw/9.mkv',
    'http://other/get?username=x&password=y',
  ];

  it('finds the dominant pair and templates matching URLs only', () => {
    const pair = dominantPair(urls)!;
    expect(pair).toEqual({ u: 'al', p: 'pw' });
    expect(templateUrl(urls[0], pair)).toBe('http://h/live/{u}/{p}/1.ts');
    expect(templateUrl(urls[2], pair)).toBe('http://h/{u}/{p}/3');
    expect(templateUrl(urls[4], pair)).toBe(urls[4]);
    expect(templateUrl('http://h/x?username=al&password=pw&a=1', pair)).toBe('http://h/x?username={u}&password={p}&a=1');
    for (const u of urls) expect(fillUrl(templateUrl(u, pair), pair)).toBe(u);
  });

  it('classifies entries by path and extension', () => {
    expect(kindOfM3uEntry('http://h/live/a/b/1.ts')).toBe('live');
    expect(kindOfM3uEntry('http://h/movie/a/b/1.mp4')).toBe('vod');
    expect(kindOfM3uEntry('http://h/series/a/b/1.mkv')).toBe('series');
    expect(kindOfM3uEntry('http://h/films/x.MKV?token=1')).toBe('vod');
    expect(kindOfM3uEntry('http://h/hls/index.m3u8')).toBe('live');
  });

  it('builds rows without credentials in stored URLs', () => {
    const entries: M3uEntry[] = urls.slice(0, 4).map((url, i) => ({ name: `Ch ${i}`, url, attrs: { 'group-title': i < 2 ? 'G1' : '' } }));
    const built = buildM3u('pl', entries, dominantPair(urls));
    const json = JSON.stringify(built);
    expect(json).not.toContain('/al/');
    expect(json).not.toContain('/pw/');
    expect(built.live.items).toHaveLength(3);
    expect(built.vod.items).toHaveLength(1);
    expect(built.live.categories.map((c) => c.name)).toEqual(['G1', 'Uncategorized']);
  });
});

describe('rematchFavorites', () => {
  const fav = (key: string, name: string, tvgId?: string): FavoriteRow => ({ playlistId: 'pl', kind: 'live', key, name, tvgId, addedAt: 1 });

  it('keeps present keys, re-attaches moved channels and reports lost ones', () => {
    const items = [
      { key: 'k1', name: 'Alpha' },
      { key: 'k2-new', name: 'Beta HD', tvgId: 'beta' },
      { key: 'k3-new', name: 'Gamma' },
      { key: 'x1', name: 'Twin' },
      { key: 'x2', name: 'Twin' },
    ];
    const { moved, lost } = rematchFavorites(
      [fav('k1', 'Alpha'), fav('k2', 'beta hd', 'BETA'), fav('k3', 'Gamma'), fav('k4', 'Twin'), fav('k5', 'Gone')],
      items,
    );
    expect(moved.map((m) => [m.from.key, m.to.key])).toEqual([
      ['k2', 'k2-new'],
      ['k3', 'k3-new'],
    ]);
    expect(lost.map((l) => l.key)).toEqual(['k4', 'k5']); // "Twin" is ambiguous
  });
});

describe('SearchIndex', () => {
  const index = new SearchIndex([
    { kind: 'live', id: '1', key: 'a', name: 'BBC One HD' },
    { kind: 'live', id: '2', key: 'b', name: 'One' },
    { kind: 'vod', id: '3', key: 'c', name: 'The One Movie' },
    { kind: 'live', id: '4', key: 'd', name: 'الجزيرة الإخبارية' },
  ]);

  it('matches every word, ranks exact and prefix matches first, groups by kind', () => {
    const r = index.search('one');
    expect(r.hits.live.map((h) => h.id)).toEqual(['2', '1']);
    expect(r.hits.vod.map((h) => h.id)).toEqual(['3']);
    expect(index.search('bbc hd').hits.live.map((h) => h.id)).toEqual(['1']);
    expect(index.search('   ').total.live).toBe(0);
  });

  it('ignores case, accents and Arabic diacritics', () => {
    expect(index.search('الجَزيرة').hits.live.map((h) => h.id)).toEqual(['4']);
    expect(normalizeText('  Café  ÉTÉ ')).toBe('cafe ete');
  });
});
