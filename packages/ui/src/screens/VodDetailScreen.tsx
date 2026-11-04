import { favoriteKeys, getItem, listCategories, listItems, log, versionKey, type VodInfo, type VodRow } from '@ultra/core';
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js';
import { FocusButton } from '../components/FocusButton';
import { Icon } from '../components/Icon';
import { PosterTile, qualityOf } from '../components/PosterTile';
import { catalog } from '../data/catalog';
import { movieItem, progressRatio, resumePosition, useProgress, watch } from '../data/media';
import { activePlaylist } from '../data/playlists';
import { FocusZone } from '../focus';
import { formatDuration, formatLeft, timeAgo } from '../format';
import { formatNumber, t } from '../i18n';
import { navigate } from '../nav';

const MORE_LIMIT = 16;

interface Version {
  row: VodRow;
  category: string;
}

export interface DetailProps {
  id: string;
  /** Shown inside the Movies/Series grid area instead of as a page (Settings → Browsing). */
  embedded?: boolean;
  /** Opens another title (versions, "More in"); defaults to navigating to its page. */
  onOpen?: (id: string) => void;
  /** Embedded only: back to the grid. */
  onClose?: () => void;
}

/** Movie page (spec §5): details, Play / Resume / Start over, favourite, other versions. */
export function VodDetailScreen(props: DetailProps): JSX.Element {
  const openOther = (id: string) => (props.onOpen ? props.onOpen(id) : navigate({ name: 'vod-detail', id }));
  const [row, setRow] = createSignal<VodRow | null | undefined>(undefined);
  const [info, setInfo] = createSignal<(VodInfo & { ext?: string }) | null>(null);
  const [infoLoading, setInfoLoading] = createSignal(false);
  const [versions, setVersions] = createSignal<Version[]>([]);
  const [more, setMore] = createSignal<VodRow[]>([]);
  const [categoryName, setCategoryName] = createSignal('');
  const [favorite, setFavorite] = createSignal(false);
  const progress = useProgress();

  createEffect(
    on([() => activePlaylist()?.id, () => props.id], async ([pid, id]) => {
      if (!pid) return setRow(null);
      const r = await getItem(pid, 'vod', id);
      setRow(r ?? null);
      if (!r) return;
      void favoriteKeys(pid, 'vod').then((keys) => setFavorite(keys.indexOf(r.key) >= 0));
      if (r.stream.t === 'x') {
        setInfoLoading(true);
        catalog()
          .call('vodInfo', pid, r.stream.id)
          .then(setInfo, (e) => log.warn('vod', 'details failed', { error: e }))
          .then(() => setInfoLoading(false));
      }
      // Same title in other categories (language / quality variants), and more from its category.
      const [rows, cats] = await Promise.all([listItems(pid, 'vod', null), listCategories(pid, 'vod')]);
      const catName = new Map(cats.map((c) => [c.id, c.name] as [string, string]));
      setCategoryName(catName.get(r.categoryIds[0]) ?? '');
      const vk = versionKey(r.name);
      setVersions(
        rows
          .filter((o) => o.key !== r.key && versionKey(o.name) === vk)
          .slice(0, 12)
          .map((o) => ({ row: o, category: o.categoryIds.map((c) => catName.get(c) ?? '').join(' · ') })),
      );
      setMore(rows.filter((o) => o.key !== r.key && o.categoryIds[0] === r.categoryIds[0] && versionKey(o.name) !== vk).slice(0, MORE_LIMIT));
    }),
  );

  const saved = createMemo(() => {
    const r = row();
    return r ? progress().get(`vod|${r.key}`) : undefined;
  });
  const resumeAt = () => resumePosition(saved());

  const play = (startAt: number) => {
    const r = row();
    if (!r) return;
    const i = info();
    watch({ ...movieItem(r, i?.poster, i?.ext), startAt }, 'movies');
  };

  const toggleFavorite = async () => {
    const r = row();
    if (!r) return;
    setFavorite(await catalog().call('toggleFavorite', { playlistId: r.playlistId, kind: 'vod', key: r.key, name: r.name }));
  };

  const year = () => row()?.year ?? (info()?.releaseDate ? Number(info()!.releaseDate!.slice(0, 4)) || undefined : undefined);
  const poster = () => info()?.poster ?? row()?.logo;

  return (
    <div class="screen detail" classList={{ embedded: !!props.embedded }}>
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
                <Show when={props.onClose}>
                  <FocusZone id="detail-back">
                    <FocusButton id="detail-back" class="chip-button back-chip" label={t('common.back')} onSelect={() => props.onClose!()}>
                      <Icon name="back" />
                    </FocusButton>
                  </FocusZone>
                </Show>
                <Icon name="movie" />
                <span class="accent">{t('tab.movies')}</span>
                <Show when={categoryName()}>
                  <span class="sep">/</span>
                  <bdi>{categoryName()}</bdi>
                </Show>
              </div>
              <div class="detail-body">
                <div class="detail-side">
                  <div class="detail-poster">
                    <Show when={poster()} fallback={<span class="poster-initial">{r().name.slice(0, 1)}</span>}>
                      {(src) => <img src={src()} alt="" referrerPolicy="no-referrer" />}
                    </Show>
                  </div>
                  <Show when={saved() && saved()!.position > 0 && !saved()!.watched}>
                    <div class="watch-card">
                      <div class="watch-card-row">
                        <span>{t('detail.progress')}</span>
                        <span class="accent">{formatNumber(Math.round(progressRatio(saved()) * 100))}%</span>
                      </div>
                      <span class="progress progress-accent">
                        <span class="progress-fill" style={{ width: `${Math.round(progressRatio(saved()) * 100)}%` }} />
                      </span>
                      <div class="watch-card-row">
                        <span>{timeAgo(saved()!.updatedAt)}</span>
                        <span>{t('home.left', { time: formatLeft(saved()!.duration - saved()!.position) })}</span>
                      </div>
                    </div>
                  </Show>
                </div>
                <div class="detail-main">
                  <div class="detail-badges">
                    <span class="pill pill-accent">{t('detail.movie')}</span>
                    <Show when={qualityOf(r().name)}>{(q) => <span class="pill pill-cyan">{q()}</span>}</Show>
                    <Show when={saved()?.watched}>
                      <span class="pill">✓ {t('detail.watched')}</span>
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
                    <Show when={year()}>
                      <span class="fact">
                        <Icon name="calendar" />
                        {year()}
                      </span>
                    </Show>
                    <Show when={info()?.durationSecs}>
                      <span class="fact">
                        <Icon name="schedule" />
                        {formatLeft(info()!.durationSecs!)}
                      </span>
                    </Show>
                    <Show when={info()?.genre}>
                      <span class="fact">
                        <bdi>{info()!.genre}</bdi>
                      </span>
                    </Show>
                  </div>
                  <FocusZone id="detail-actions">
                    <div class="button-row detail-actions">
                      <Show
                        when={resumeAt()}
                        fallback={
                          <FocusButton id="detail-play" class="btn-primary btn-lg" autofocus onSelect={() => play(0)}>
                            <Icon name="play" />
                            <span>{t('detail.play')}</span>
                          </FocusButton>
                        }
                      >
                        <FocusButton id="detail-resume" class="btn-primary btn-lg" autofocus onSelect={() => play(resumeAt())}>
                          <Icon name="play" />
                          <span>{t('detail.resume', { time: formatDuration(resumeAt()) })}</span>
                        </FocusButton>
                        <FocusButton id="detail-restart" class="btn-lg" onSelect={() => play(0)}>
                          <Icon name="restart" />
                          <span>{t('detail.startOver')}</span>
                        </FocusButton>
                      </Show>
                      <FocusButton id="detail-fav" class="btn-lg" onSelect={() => void toggleFavorite()}>
                        <Icon name={favorite() ? 'bookmarked' : 'bookmark'} />
                        <span>{favorite() ? t('live.removeFav') : t('live.addFav')}</span>
                      </FocusButton>
                    </div>
                  </FocusZone>
                  <Show when={info()?.plot} fallback={<p class="hint">{infoLoading() ? t('detail.loadingInfo') : ''}</p>}>
                    <div class="overview-title">{t('detail.overview')}</div>
                    <p class="detail-plot">
                      <bdi>{info()!.plot}</bdi>
                    </p>
                  </Show>
                  <Show when={info()?.director || info()?.cast}>
                    <div class="credits">
                      <Show when={info()?.director}>
                        <div class="credit">
                          <span class="credit-key">{t('detail.directorLabel')}</span>
                          <span class="credit-value accent">
                            <bdi>{info()!.director}</bdi>
                          </span>
                        </div>
                      </Show>
                      <Show when={info()?.cast}>
                        <div class="credit">
                          <span class="credit-key">{t('detail.castLabel')}</span>
                          <span class="credit-value">
                            <bdi>{info()!.cast}</bdi>
                          </span>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>

              <Show when={versions().length > 0}>
                <div class="section-head">
                  <h2 class="section-title">
                    {t('detail.versions')}
                    <span class="pill pill-cyan">{formatNumber(versions().length)}</span>
                  </h2>
                </div>
                <FocusZone id="detail-versions">
                  <div class="shelf version-cards">
                    <For each={versions()}>
                      {(v) => (
                        <FocusButton id={`detail-v-${v.row.id}`} onSelect={() => openOther(v.row.id)}>
                          <div class="version-title">
                            <bdi>{v.row.name}</bdi>
                          </div>
                          <div class="version-sub">
                            <bdi>{v.category}</bdi>
                          </div>
                        </FocusButton>
                      )}
                    </For>
                    <span class="shelf-end" />
                  </div>
                </FocusZone>
              </Show>

              <Show when={more().length > 0}>
                <div class="section-head">
                  <h2 class="section-title">{t('detail.moreIn', { name: categoryName() })}</h2>
                </div>
                <FocusZone id="detail-more">
                  <div class="shelf">
                    <For each={more()}>
                      {(m) => (
                        <FocusButton id={`detail-m-${m.id}`} class="poster-card" onSelect={() => openOther(m.id)}>
                          <PosterTile title={m.name} poster={m.logo} year={m.year} rating={m.rating} progress={progressRatio(progress().get(`vod|${m.key}`))} />
                        </FocusButton>
                      )}
                    </For>
                    <span class="shelf-end" />
                  </div>
                </FocusZone>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
