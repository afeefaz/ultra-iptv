import { toNumber } from '../sources/xtream';
import { normalizeText } from './hash';
import type { Episode, SeriesInfo, VodInfo } from './model';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);
const firstImage = (v: unknown): string | undefined => (Array.isArray(v) ? str(v[0]) : str(v));

function durationOf(info: Obj): number | undefined {
  const secs = toNumber(info.duration_secs);
  if (secs) return secs;
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(str(info.duration) ?? '');
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : undefined;
}

function baseInfo(info: Obj): VodInfo {
  return {
    plot: str(info.plot) ?? str(info.description),
    genre: str(info.genre),
    director: str(info.director),
    cast: str(info.cast) ?? str(info.actors),
    releaseDate: str(info.releasedate) ?? str(info.releaseDate) ?? str(info.release_date),
    durationSecs: durationOf(info),
    rating: toNumber(info.rating),
    poster: str(info.movie_image) ?? str(info.cover) ?? str(info.cover_big),
    backdrop: firstImage(info.backdrop_path),
    trailer: str(info.youtube_trailer),
  };
}

/** `get_vod_info` → details plus the container extension the stream actually uses. */
export function parseVodInfo(raw: unknown): VodInfo & { ext?: string } {
  const root = obj(raw);
  const data = obj(root.movie_data);
  return { ...baseInfo(obj(root.info)), ext: str(data.container_extension) };
}

/** `get_series_info`; `episodes` is an object keyed by season on most panels, an array on some. */
export function parseSeriesInfo(raw: unknown): SeriesInfo {
  const root = obj(raw);
  const list: unknown[] = [];
  const eps = root.episodes;
  if (Array.isArray(eps)) list.push(...eps.reduce<unknown[]>((all, e) => all.concat(Array.isArray(e) ? e : [e]), []));
  else for (const k of Object.keys(obj(eps))) list.push(...((obj(eps)[k] as unknown[]) || []));
  const episodes: Episode[] = [];
  for (const e of list) {
    const o = obj(e);
    const id = str(o.id);
    if (!id) continue;
    const info = obj(o.info);
    episodes.push({
      id,
      season: toNumber(o.season) ?? toNumber(info.season) ?? 1,
      episode: toNumber(o.episode_num) ?? episodes.length + 1,
      title: str(o.title) ?? `Episode ${episodes.length + 1}`,
      ext: str(o.container_extension),
      durationSecs: durationOf(info),
      plot: str(info.plot),
      image: str(info.movie_image),
    });
  }
  episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  const seasons: number[] = [];
  for (const e of episodes) if (seasons.indexOf(e.season) < 0) seasons.push(e.season);
  return { ...baseInfo(obj(root.info)), seasons, episodes };
}

const TAGS = /\b(4k|uhd|fhd|hd|sd|hevc|h\.?265|h\.?264|1080p|720p|2160p|multi|vostfr|subbed|dubbed|multi-?subs?)\b/g;

/**
 * Title used to find the same movie in several categories (spec §5 "versions" selector):
 * drops "EN| " style prefixes, quality tags, bracketed notes and the year.
 */
export function versionKey(name: string): string {
  return normalizeText(name)
    .replace(/^[a-z0-9]{2,6}\s*[|:-]\s*/, '')
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(TAGS, ' ')
    // Explicit ranges instead of \p{L}: Unicode property escapes need Chrome 64.
    .replace(/[^0-9a-z\u00c0-\u024f\u0600-\u06ff]+/g, ' ')
    .trim();
}
