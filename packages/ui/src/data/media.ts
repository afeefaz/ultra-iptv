import {
  getItem,
  listProgress,
  log,
  type Episode,
  type MediaRef,
  type ProgressRow,
  type SeriesRow,
  type VodRow,
} from '@ultra/core';
import { createEffect, createMemo, createSignal, on, type Accessor } from 'solid-js';
import { navigate, type Tab } from '../nav';
import { catalog } from './catalog';
import { playMedia, progressVersion, resumePosition, setEpisodeNeighbours, type MediaItem } from './playback';
import { activePlaylist } from './playlists';

/** Every saved position of the active playlist, keyed `${kind}|${key}`; reloads after each save. */
export function useProgress(): Accessor<Map<string, ProgressRow>> {
  const [rows, setRows] = createSignal<ProgressRow[]>([]);
  createEffect(
    on([() => activePlaylist()?.id, progressVersion], ([id]) => {
      if (!id) return setRows([]);
      listProgress(id).then(setRows, (e) => log.warn('media', 'could not load progress', { error: e }));
    }),
  );
  return createMemo(() => new Map(rows().map((r) => [`${r.kind}|${r.key}`, r] as [string, ProgressRow])));
}

export { resumePosition };

export function progressRatio(row: ProgressRow | undefined): number {
  if (!row) return 0;
  if (row.watched) return 1;
  return row.duration ? Math.min(1, row.position / row.duration) : 0;
}

export function movieRef(row: VodRow, ext?: string): MediaRef {
  return row.stream.t === 'x' ? { t: 'movie', id: row.stream.id, ext: ext ?? row.stream.ext } : { t: 'url', url: row.stream.url };
}

export function movieItem(row: VodRow, poster?: string, ext?: string): MediaItem {
  return { playlistId: row.playlistId, kind: 'vod', key: row.key, title: row.name, poster: poster ?? row.logo, ref: movieRef(row, ext) };
}

/** Uniform episode shape for Xtream (fetched) and M3U (grouped at refresh) series. */
export interface EpisodeEntry {
  season: number;
  episode: number;
  title: string;
  ref: MediaRef;
  durationSecs?: number;
  plot?: string;
  image?: string;
}

export function episodesOf(series: SeriesRow, fetched: Episode[] | undefined): EpisodeEntry[] {
  if (fetched) {
    return fetched.map((e) => ({
      season: e.season,
      episode: e.episode,
      title: e.title,
      ref: { t: 'episode', id: e.id, ext: e.ext },
      durationSecs: e.durationSecs,
      plot: e.plot,
      image: e.image,
    }));
  }
  return (series.episodes ?? []).map((e) => ({ season: e.season, episode: e.episode, title: e.title, ref: { t: 'url', url: e.url } }));
}

export const episodeKey = (series: SeriesRow, e: { season: number; episode: number }) => `${series.key}|${e.season}x${e.episode}`;

/** The episode as a playable item, linked to the ones either side of it, across seasons. */
export function episodeItem(series: SeriesRow, list: EpisodeEntry[], index: number): MediaItem {
  const items = list.map((e) => toItem(series, e));
  items.forEach((item, i) => {
    item.prev = items[i - 1];
    item.next = items[i + 1];
  });
  return items[index];
}

function toItem(series: SeriesRow, e: EpisodeEntry): MediaItem {
  return {
    playlistId: series.playlistId,
    kind: 'episode',
    key: episodeKey(series, e),
    title: series.name,
    // Provider titles often already say "S01E02"; don't repeat it.
    subtitle: /\bs\d+\s*e\d+\b/i.test(e.title) ? e.title : `S${e.season} E${e.episode} · ${e.title}`,
    poster: series.logo,
    ref: e.ref,
    seriesKey: series.key,
    seriesId: series.id,
  };
}

/** Starts a movie/episode/programme and opens the full-screen player. */
export function watch(item: MediaItem, tab: Tab): void {
  void playMedia(item);
  navigate({ name: 'player', tab });
  void findNeighbours(item);
}

/** Continue watching knows one episode, not the series. The rest is on the device by then, as it was opened to play this one. */
async function findNeighbours(item: MediaItem): Promise<void> {
  if (item.kind !== 'episode' || item.prev || item.next || !item.seriesId) return;
  try {
    const series = await getItem(item.playlistId, 'series', item.seriesId);
    if (!series) return;
    const info = series.episodes ? undefined : await catalog().call('seriesInfo', item.playlistId, series.seriesId);
    const list = episodesOf(series, info?.episodes);
    const index = list.map((e) => episodeKey(series, e)).indexOf(item.key);
    if (index < 0) return;
    const linked = episodeItem(series, list, index);
    setEpisodeNeighbours(item, linked.prev, linked.next);
  } catch (e) {
    log.warn('media', 'could not find the next episode', { error: e });
  }
}

/** "Continue watching" entry → item (`watch` finds the episodes either side). */
export function itemFromProgress(row: ProgressRow): MediaItem {
  return {
    playlistId: row.playlistId,
    kind: row.kind === 'vod' ? 'vod' : 'episode',
    key: row.key,
    title: row.title,
    subtitle: row.subtitle,
    poster: row.poster,
    ref: row.ref,
    seriesKey: row.seriesKey,
    seriesId: row.seriesId,
    startAt: resumePosition(row) || row.position,
  };
}
