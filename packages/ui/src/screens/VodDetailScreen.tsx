import { favoriteKeys, getItem, listCategories, listItems, log, versionKey, type VodInfo, type VodRow } from '@ultra/core';
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js';
import { FocusButton } from '../components/FocusButton';
import { catalog } from '../data/catalog';
import { movieItem, resumePosition, useProgress, watch } from '../data/media';
import { activePlaylist } from '../data/playlists';
import { FocusZone } from '../focus';
import { formatDuration } from '../format';
import { formatNumber, t } from '../i18n';
import { navigate } from '../nav';

interface Version {
  row: VodRow;
  category: string;
}

/** Movie page (spec §5): details, Play / Resume / Start over, favourite, other versions. */
export function VodDetailScreen(props: { id: string }): JSX.Element {
  const [row, setRow] = createSignal<VodRow | null | undefined>(undefined);
  const [info, setInfo] = createSignal<(VodInfo & { ext?: string }) | null>(null);
  const [infoLoading, setInfoLoading] = createSignal(false);
  const [versions, setVersions] = createSignal<Version[]>([]);
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
      // Same title in other categories (language / quality variants).
      const [rows, cats] = await Promise.all([listItems(pid, 'vod', null), listCategories(pid, 'vod')]);
      const catName = new Map(cats.map((c) => [c.id, c.name] as [string, string]));
      const vk = versionKey(r.name);
      setVersions(
        rows
          .filter((o) => o.key !== r.key && versionKey(o.name) === vk)
          .slice(0, 12)
          .map((o) => ({ row: o, category: o.categoryIds.map((c) => catName.get(c) ?? '').join(' · ') })),
      );
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

  const facts = () => {
    const r = row();
    const i = info();
    if (!r) return '';
    const year = r.year ?? (i?.releaseDate ? Number(i.releaseDate.slice(0, 4)) || undefined : undefined);
    return [
      year,
      i?.genre,
      i?.durationSecs ? t('detail.duration', { n: formatNumber(Math.round(i.durationSecs / 60)) }) : '',
      (i?.rating ?? r.rating) ? `★ ${i?.rating ?? r.rating}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  };

  return (
    <div class="screen detail">
      <Show when={row() !== undefined} fallback={<p class="hint">{t('detail.loading')}</p>}>
        <Show when={row()} fallback={<p class="hint">{t('detail.notFound')}</p>}>
          {(r) => (
            <div class="detail-body">
              <div class="detail-poster">
                <Show when={info()?.poster ?? r().logo}>{(src) => <img src={src()} alt="" referrerPolicy="no-referrer" />}</Show>
              </div>
              <div class="detail-main">
                <h1 class="screen-title">
                  <bdi>{r().name}</bdi>
                </h1>
                <p class="detail-facts">{facts()}</p>
                <FocusZone id="detail-actions">
                  <div class="button-row">
                    <Show
                      when={resumeAt()}
                      fallback={
                        <FocusButton id="detail-play" class="btn-primary" autofocus onSelect={() => play(0)}>
                          ▶ {t('detail.play')}
                        </FocusButton>
                      }
                    >
                      <FocusButton id="detail-resume" class="btn-primary" autofocus onSelect={() => play(resumeAt())}>
                        ▶ {t('detail.resume', { time: formatDuration(resumeAt()) })}
                      </FocusButton>
                      <FocusButton id="detail-restart" onSelect={() => play(0)}>
                        {t('detail.startOver')}
                      </FocusButton>
                    </Show>
                    <FocusButton id="detail-fav" onSelect={() => void toggleFavorite()}>
                      {favorite() ? '★ ' + t('live.removeFav') : '☆ ' + t('live.addFav')}
                    </FocusButton>
                  </div>
                </FocusZone>
                <Show when={saved()?.watched}>
                  <p class="hint">✓ {t('detail.watched')}</p>
                </Show>
                <Show when={info()?.plot} fallback={<p class="hint">{infoLoading() ? t('detail.loadingInfo') : ''}</p>}>
                  <p class="detail-plot">
                    <bdi>{info()!.plot}</bdi>
                  </p>
                </Show>
                <Show when={info()?.director}>
                  <p class="hint">{t('detail.director', { name: info()!.director! })}</p>
                </Show>
                <Show when={info()?.cast}>
                  <p class="hint">{t('detail.cast', { names: info()!.cast! })}</p>
                </Show>
                <Show when={versions().length > 0}>
                  <h2 class="section-title">{t('detail.versions')}</h2>
                  <FocusZone id="detail-versions">
                    <div class="button-row wrap">
                      <For each={versions()}>
                        {(v) => (
                          <FocusButton id={`detail-v-${v.row.id}`} onSelect={() => navigate({ name: 'vod-detail', id: v.row.id })}>
                            <bdi>{v.row.name}</bdi>
                            <span class="hint"> · <bdi>{v.category}</bdi></span>
                          </FocusButton>
                        )}
                      </For>
                    </div>
                  </FocusZone>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}
