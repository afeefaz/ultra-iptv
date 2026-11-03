import { favoriteKeys, getItem, log, type SeriesInfo, type SeriesRow } from '@ultra/core';
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js';
import { FocusButton } from '../components/FocusButton';
import { Icon } from '../components/Icon';
import { VirtualList, type VirtualListApi } from '../components/VirtualList';
import { catalog } from '../data/catalog';
import { episodeItem, episodeKey, episodesOf, progressRatio, resumePosition, useProgress, watch, type EpisodeEntry } from '../data/media';
import { activePlaylist } from '../data/playlists';
import { FocusZone } from '../focus';
import { errorText, formatDuration } from '../format';
import { formatNumber, t } from '../i18n';

/** Series page (spec §5): season tabs, episodes with per-episode progress, "Continue". */
export function SeriesDetailScreen(props: { id: string }): JSX.Element {
  const [row, setRow] = createSignal<SeriesRow | null | undefined>(undefined);
  const [info, setInfo] = createSignal<SeriesInfo | null>(null);
  const [error, setError] = createSignal('');
  const [season, setSeason] = createSignal<number | null>(null);
  const [favorite, setFavorite] = createSignal(false);
  const progress = useProgress();
  let list: VirtualListApi | undefined;

  createEffect(
    on([() => activePlaylist()?.id, () => props.id], async ([pid, id]) => {
      if (!pid) return setRow(null);
      const r = await getItem(pid, 'series', id);
      setRow(r ?? null);
      if (!r) return;
      void favoriteKeys(pid, 'series').then((keys) => setFavorite(keys.indexOf(r.key) >= 0));
      if (!r.episodes) {
        catalog()
          .call('seriesInfo', pid, r.seriesId)
          .then(setInfo, (e) => {
            log.warn('series', 'details failed', { error: e });
            setError(errorText(e));
          });
      }
    }),
  );

  const episodes = createMemo<EpisodeEntry[]>(() => {
    const r = row();
    if (!r) return [];
    if (!r.episodes && !info()) return [];
    return episodesOf(r, info()?.episodes);
  });
  const seasons = createMemo(() => {
    const out: number[] = [];
    for (const e of episodes()) if (out.indexOf(e.season) < 0) out.push(e.season);
    return out;
  });
  const progressOf = (e: EpisodeEntry) => {
    const r = row();
    return r ? progress().get(`episode|${episodeKey(r, e)}`) : undefined;
  };

  /** Next thing to watch: the last episode touched (if unfinished) or the one after it. */
  const upNext = createMemo<{ index: number; startAt: number } | null>(() => {
    const list = episodes();
    if (!list.length) return null;
    let best = -1;
    let bestAt = 0;
    list.forEach((e, i) => {
      const p = progressOf(e);
      if (p && p.updatedAt > bestAt) {
        best = i;
        bestAt = p.updatedAt;
      }
    });
    if (best < 0) return { index: 0, startAt: 0 };
    const p = progressOf(list[best]);
    if (p && !p.watched) return { index: best, startAt: resumePosition(p) };
    return best + 1 < list.length ? { index: best + 1, startAt: 0 } : { index: best, startAt: 0 };
  });

  // Open on the season of the next episode.
  createEffect(
    on(upNext, (n) => {
      if (n && season() === null) setSeason(episodes()[n.index].season);
    }),
  );

  const currentSeason = () => season() ?? seasons()[0];
  const seasonEpisodes = createMemo(() => episodes().filter((e) => e.season === currentSeason()));
  const watchedCount = createMemo(() => episodes().filter((e) => progressOf(e)?.watched).length);

  const play = (e: EpisodeEntry, startAt: number) => {
    const r = row();
    if (!r) return;
    const all = episodes();
    watch({ ...episodeItem(r, all, all.indexOf(e)), startAt }, 'series');
  };

  const toggleFavorite = async () => {
    const r = row();
    if (!r) return;
    setFavorite(await catalog().call('toggleFavorite', { playlistId: r.playlistId, kind: 'series', key: r.key, name: r.name }));
  };

  const upNextLabel = () => {
    const n = upNext();
    if (!n) return '';
    const e = episodes()[n.index];
    const params = { s: e.season, e: e.episode };
    return n.startAt ? t('series.continue', params) + ` (${formatDuration(n.startAt)})` : t('series.play', params);
  };

  const poster = () => info()?.poster ?? row()?.logo;

  return (
    <div class="screen detail">
      <Show when={info()?.backdrop}>
        {(src) => (
          <div class="detail-backdrop">
            <img src={src()} alt="" referrerPolicy="no-referrer" />
          </div>
        )}
      </Show>
      <Show when={row() !== undefined} fallback={<p class="hint">{t('detail.loading')}</p>}>
        <Show when={row()} fallback={<p class="hint">{t('detail.notFound')}</p>}>
          {(r) => (
            <>
              <div class="crumbs">
                <Icon name="series" />
                <span class="accent">{t('tab.series')}</span>
                <span class="sep">/</span>
                <bdi>{r().name}</bdi>
              </div>
              <div class="detail-body">
                <div class="detail-side">
                  <div class="detail-poster">
                    <Show when={poster()} fallback={<span class="poster-initial">{r().name.slice(0, 1)}</span>}>
                      {(src) => <img src={src()} alt="" referrerPolicy="no-referrer" />}
                    </Show>
                  </div>
                  <Show when={episodes().length > 0}>
                    <div class="watch-card">
                      <div class="watch-card-row">
                        <span>{t('series.watchedOf', { n: formatNumber(watchedCount()), total: formatNumber(episodes().length) })}</span>
                        <span class="accent">{formatNumber(Math.round((watchedCount() / episodes().length) * 100))}%</span>
                      </div>
                      <span class="progress progress-accent">
                        <span class="progress-fill" style={{ width: `${Math.round((watchedCount() / episodes().length) * 100)}%` }} />
                      </span>
                    </div>
                  </Show>
                </div>
                <div class="detail-main">
                  <div class="detail-badges">
                    <span class="pill pill-accent">{t('detail.series')}</span>
                    <Show when={seasons().length}>
                      <span class="pill pill-cyan">{t('series.seasons', { n: formatNumber(seasons().length) })}</span>
                    </Show>
                  </div>
                  <h1 class="detail-title">
                    <bdi>{r().name}</bdi>
                  </h1>
                  <div class="facts">
                    <Show when={info()?.rating ?? r().rating}>
                      <span class="fact fact-star">
                        <Icon name="starFill" />
                        {info()?.rating ?? r().rating}
                      </span>
                    </Show>
                    <Show when={r().year}>
                      <span class="fact">
                        <Icon name="calendar" />
                        {r().year}
                      </span>
                    </Show>
                    <Show when={info()?.genre}>
                      <span class="fact">
                        <bdi>{info()!.genre}</bdi>
                      </span>
                    </Show>
                    <span class="fact">
                      <Icon name="series" />
                      {t('series.episodes', { n: formatNumber(episodes().length) })}
                    </span>
                  </div>
                  <FocusZone id="series-actions">
                    <div class="button-row detail-actions">
                      <Show when={upNext()}>
                        {(n) => (
                          <FocusButton id="series-next" class="btn-primary btn-lg" autofocus onSelect={() => play(episodes()[n().index], n().startAt)}>
                            <Icon name="play" />
                            <span>{upNextLabel()}</span>
                          </FocusButton>
                        )}
                      </Show>
                      <FocusButton id="series-fav" class="btn-lg" onSelect={() => void toggleFavorite()}>
                        <Icon name={favorite() ? 'bookmarked' : 'bookmark'} />
                        <span>{favorite() ? t('live.removeFav') : t('live.addFav')}</span>
                      </FocusButton>
                    </div>
                  </FocusZone>
                  <Show when={info()?.plot}>
                    <p class="detail-plot clamp">
                      <bdi>{info()!.plot}</bdi>
                    </p>
                  </Show>
                </div>
              </div>

              <Show when={seasons().length > 1}>
                <FocusZone id="series-seasons" remember>
                  <div class="day-tabs season-tabs">
                    <For each={seasons()}>
                      {(s) => (
                        <FocusButton
                          id={`season-${s}`}
                          selected={currentSeason() === s}
                          onSelect={() => {
                            setSeason(s);
                            setTimeout(() => list?.focusIndex(0), 0);
                          }}
                        >
                          {t('series.season', { n: s })}
                        </FocusButton>
                      )}
                    </For>
                  </div>
                </FocusZone>
              </Show>
              <FocusZone id="series-episodes" remember>
                <div class="episode-list">
                  <VirtualList
                    id="ep"
                    label={t('series.season', { n: currentSeason() ?? 1 })}
                    items={seasonEpisodes()}
                    rowHeight={4.4}
                    ref={(api) => (list = api)}
                    rowClass={() => 'list-item episode-row'}
                    onSelect={(e) => play(e, resumePosition(progressOf(e)))}
                    empty={<p class="hint pane-empty">{error() || (info() || r().episodes ? t('series.noEpisodes') : t('detail.loadingInfo'))}</p>}
                    renderRow={(e) => (
                      <>
                        <span class="list-number">{e.episode}</span>
                        <span class="channel-text">
                          <span class="list-label">
                            <bdi>{e.title}</bdi>
                          </span>
                          <Show when={progressRatio(progressOf(e)) > 0 && !progressOf(e)?.watched}>
                            <span class="progress">
                              <span class="progress-fill" style={{ width: `${Math.round(progressRatio(progressOf(e)) * 100)}%` }} />
                            </span>
                          </Show>
                        </span>
                        <Show when={progressOf(e)?.watched}>
                          <span class="watched-mark">
                            <Icon name="checkCircle" />
                          </span>
                        </Show>
                        <Show when={e.durationSecs}>
                          <span class="list-count" dir="ltr">
                            {formatDuration(e.durationSecs!)}
                          </span>
                        </Show>
                        <Icon name="play" />
                      </>
                    )}
                  />
                </div>
              </FocusZone>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
