import type { M3uEntry } from '../sources/m3u';
import {
  toNumber,
  type XtreamCategory,
  type XtreamLiveStream,
  type XtreamSeries,
  type XtreamVodStream,
} from '../sources/xtream';
import { hash64, normalizeText } from './hash';
import {
  catKey,
  type CategoryRow,
  type ChannelRow,
  type ContentKind,
  type KindRows,
  type SeriesRow,
  type VodRow,
} from './model';
import { templateUrl, type CredPair } from './stream-creds';

export const UNCATEGORIZED = '__none';

export interface Built<K extends ContentKind> {
  categories: CategoryRow[];
  items: KindRows[K][];
}

/** Stable keys: kind + normalised name + first group, with a suffix for exact duplicates (spec §6). */
class KeyMaker {
  private seen = new Map<string, number>();
  constructor(private readonly kind: ContentKind) {}
  make(name: string, group: string): string {
    const base = hash64(`${this.kind}|${normalizeText(name)}|${normalizeText(group)}`);
    const n = (this.seen.get(base) ?? 0) + 1;
    this.seen.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  }
}

function sign<T extends { sig: string }>(row: T): T {
  row.sig = '';
  row.sig = hash64(JSON.stringify(row));
  return row;
}

function finishCategories(
  playlistId: string,
  kind: ContentKind,
  order: Array<{ id: string; name: string }>,
  items: Array<{ categoryIds: string[] }>,
): CategoryRow[] {
  const counts = new Map<string, number>();
  for (const item of items) for (const id of item.categoryIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const rows: CategoryRow[] = [];
  order.forEach((c, i) => {
    const count = counts.get(c.id) ?? 0;
    // Empty provider categories are noise on a TV; leave them out.
    if (count > 0) rows.push({ playlistId, kind, id: c.id, name: c.name, order: i, count });
  });
  return rows;
}

function xtreamCategoryIndex(cats: XtreamCategory[]) {
  const order: Array<{ id: string; name: string }> = [];
  const names = new Map<string, string>();
  for (const c of cats) {
    const id = String(c.category_id);
    if (names.has(id)) continue;
    names.set(id, c.category_name || id);
    order.push({ id, name: c.category_name || id });
  }
  order.push({ id: UNCATEGORIZED, name: 'Uncategorized' });
  return { order, names };
}

function xtreamCategoryIds(row: { category_id?: string | number | null; category_ids?: Array<string | number> }, known: Map<string, string>): string[] {
  const raw = row.category_ids && row.category_ids.length ? row.category_ids : row.category_id != null ? [row.category_id] : [];
  const ids: string[] = [];
  for (const r of raw) {
    const id = String(r);
    if (known.has(id) && ids.indexOf(id) < 0) ids.push(id);
  }
  return ids.length ? ids : [UNCATEGORIZED];
}

const timestamp = (v: unknown) => {
  const n = toNumber(v);
  return n && n > 0 ? n * 1000 : undefined;
};

export function buildXtreamLive(playlistId: string, cats: XtreamCategory[], streams: XtreamLiveStream[]): Built<'live'> {
  const { order, names } = xtreamCategoryIndex(cats);
  const keys = new KeyMaker('live');
  const items = streams.map((s, i): ChannelRow => {
    const categoryIds = xtreamCategoryIds(s, names);
    const archive = String(s.tv_archive) === '1' ? toNumber(s.tv_archive_duration) : undefined;
    return sign({
      playlistId,
      id: String(s.stream_id),
      key: keys.make(s.name, names.get(categoryIds[0]) ?? ''),
      name: s.name,
      logo: s.stream_icon || undefined,
      categoryIds,
      catKeys: categoryIds.map((c) => catKey(playlistId, c)),
      added: timestamp(s.added),
      num: toNumber(s.num) ?? i + 1,
      tvgId: s.epg_channel_id || undefined,
      catchupDays: archive && archive > 0 ? archive : undefined,
      stream: { t: 'x', id: String(s.stream_id) },
      sig: '',
    });
  });
  return { categories: finishCategories(playlistId, 'live', order, items), items };
}

export function buildXtreamVod(playlistId: string, cats: XtreamCategory[], streams: XtreamVodStream[]): Built<'vod'> {
  const { order, names } = xtreamCategoryIndex(cats);
  const keys = new KeyMaker('vod');
  const items = streams.map((s): VodRow => {
    const categoryIds = xtreamCategoryIds(s, names);
    return sign({
      playlistId,
      id: String(s.stream_id),
      key: keys.make(s.name, names.get(categoryIds[0]) ?? ''),
      name: s.name,
      logo: s.stream_icon || undefined,
      categoryIds,
      catKeys: categoryIds.map((c) => catKey(playlistId, c)),
      added: timestamp(s.added),
      rating: toNumber(s.rating),
      year: toNumber(s.year),
      stream: { t: 'x', id: String(s.stream_id), ext: s.container_extension || undefined },
      sig: '',
    });
  });
  return { categories: finishCategories(playlistId, 'vod', order, items), items };
}

export function buildXtreamSeries(playlistId: string, cats: XtreamCategory[], list: XtreamSeries[]): Built<'series'> {
  const { order, names } = xtreamCategoryIndex(cats);
  const keys = new KeyMaker('series');
  const items = list.map((s): SeriesRow => {
    const categoryIds = xtreamCategoryIds(s, names);
    return sign({
      playlistId,
      id: String(s.series_id),
      key: keys.make(s.name, names.get(categoryIds[0]) ?? ''),
      name: s.name,
      logo: s.cover || undefined,
      categoryIds,
      catKeys: categoryIds.map((c) => catKey(playlistId, c)),
      added: timestamp(s.last_modified),
      seriesId: String(s.series_id),
      rating: toNumber(s.rating),
      year: toNumber(s.year) ?? toNumber((s.releaseDate || '').slice(0, 4)),
      sig: '',
    });
  });
  return { categories: finishCategories(playlistId, 'series', order, items), items };
}

const VOD_EXT = /\.(mkv|mp4|avi|mov|m4v|wmv|flv|webm)$/i;

export function kindOfM3uEntry(url: string): ContentKind {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.indexOf('/movie/') >= 0) return 'vod';
  if (path.indexOf('/series/') >= 0) return 'series';
  return VOD_EXT.test(path) ? 'vod' : 'live';
}

export interface BuiltM3u {
  live: Built<'live'>;
  vod: Built<'vod'>;
  series: Built<'series'>;
}

/** Splits a parsed M3U into live / VOD / series rows. `pair` is the credential pair to template out. */
export function buildM3u(playlistId: string, entries: M3uEntry[], pair: CredPair | null): BuiltM3u {
  const groups = { live: new GroupIndex('live'), vod: new GroupIndex('vod'), series: new GroupIndex('series') };
  const keys = { live: new KeyMaker('live'), vod: new KeyMaker('vod'), series: new KeyMaker('series') };
  const live: ChannelRow[] = [];
  const vod: VodRow[] = [];
  const series: SeriesRow[] = [];
  const seriesByName = new Map<string, SeriesRow>();
  // Ids follow the stream URL, so reordering a playlist doesn't rewrite every row on refresh.
  const ids = new KeyMaker('live');
  entries.forEach((e) => {
    const kind = kindOfM3uEntry(e.url);
    const group = e.attrs['group-title'] || e.group || '';
    const categoryId = groups[kind].idFor(group);
    const url = pair ? templateUrl(e.url, pair) : e.url;
    const base = {
      playlistId,
      id: ids.make(e.url, kind),
      key: keys[kind].make(e.name, group),
      name: e.name,
      logo: e.attrs['tvg-logo'] || e.attrs['logo'] || undefined,
      categoryIds: [categoryId],
      catKeys: [catKey(playlistId, categoryId)],
      sig: '',
    };
    if (kind === 'live') {
      const days = toNumber(e.attrs['catchup-days'] || e.attrs['tvg-rec'] || e.attrs['timeshift']);
      live.push(
        sign({
          ...base,
          num: toNumber(e.attrs['tvg-chno']) ?? live.length + 1,
          tvgId: e.attrs['tvg-id'] || undefined,
          catchupDays: days && days > 0 ? days : undefined,
          catchup:
            e.attrs['catchup'] || e.attrs['catchup-source']
              ? { mode: e.attrs['catchup'] || undefined, source: e.attrs['catchup-source'] || undefined }
              : undefined,
          stream: { t: 'u', url },
          headers: e.userAgent || e.referrer ? { userAgent: e.userAgent, referrer: e.referrer } : undefined,
        }),
      );
    } else if (kind === 'vod') {
      vod.push(sign({ ...base, stream: { t: 'u', url } }));
    } else {
      // One M3U entry per episode: group "Show S01 E02" entries into one series row.
      const ep = parseEpisodeName(e.name);
      const groupKey = normalizeText(ep.show) + '|' + categoryId;
      let row = seriesByName.get(groupKey);
      if (!row) {
        row = { ...base, key: keys.series.make(ep.show, group), name: ep.show, seriesId: base.id, episodes: [] };
        seriesByName.set(groupKey, row);
        series.push(row);
      }
      row.episodes!.push({ season: ep.season, episode: ep.episode || row.episodes!.length + 1, title: e.name, url });
    }
  });
  for (const row of series) {
    row.episodes!.sort((a, b) => a.season - b.season || a.episode - b.episode);
    sign(row);
  }
  return {
    live: { categories: groups.live.rows(playlistId, live), items: live },
    vod: { categories: groups.vod.rows(playlistId, vod), items: vod },
    series: { categories: groups.series.rows(playlistId, series), items: series },
  };
}

/** "Show Name S01 E02" / "Show Name 1x02" → parts; anything else is season 1 of a show named after the entry. */
export function parseEpisodeName(name: string): { show: string; season: number; episode: number } {
  const m = /^(.*?)[\s._-]*(?:s(\d{1,3})[\s._-]*e(\d{1,4})|(\d{1,2})x(\d{1,3}))\b/i.exec(name);
  if (!m || !m[1].trim()) return { show: name.trim(), season: 1, episode: 0 };
  return { show: m[1].trim(), season: Number(m[2] || m[4]), episode: Number(m[3] || m[5]) };
}

class GroupIndex {
  private order: Array<{ id: string; name: string }> = [];
  private ids = new Map<string, string>();
  constructor(private readonly kind: ContentKind) {}
  idFor(group: string): string {
    const name = group.trim();
    if (!name) return UNCATEGORIZED;
    let id = this.ids.get(name);
    if (!id) {
      id = hash64(`${this.kind}|${name}`).slice(0, 12);
      this.ids.set(name, id);
      this.order.push({ id, name });
    }
    return id;
  }
  rows(playlistId: string, items: Array<{ categoryIds: string[] }>): CategoryRow[] {
    return finishCategories(playlistId, this.kind, this.order.concat({ id: UNCATEGORIZED, name: 'Uncategorized' }), items);
  }
}
