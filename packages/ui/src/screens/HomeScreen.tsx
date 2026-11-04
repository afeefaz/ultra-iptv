import { favoriteKeys, itemsByKeys, log, perf, recentKeys, type ChannelRow, type ProgressRow, type VodInfo } from '@ultra/core';
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js';
import { ChannelLogo } from '../components/ChannelLogo';
import { FocusButton } from '../components/FocusButton';
import { Icon } from '../components/Icon';
import { catalog } from '../data/catalog';
import { formatClock, useNowNext } from '../data/epg';
import { itemFromProgress, progressRatio, useProgress, watch } from '../data/media';
import { recentVersion } from '../data/playback';
import { activePlaylist, playlistsLoaded, refreshing, refreshPlaylist, versionOf } from '../data/playlists';
import { guideOnEveryRow, homeShows } from '../data/settings';
import { FocusZone } from '../focus';
import { formatLeft, statusText } from '../format';
import { formatNumber, t } from '../i18n';
import { navigate, openRoot } from '../nav';

const MAX_CHANNELS = 20;
const MAX_CONTINUE = 20;

export function HomeScreen(): JSX.Element {
  const [favorites, setFavorites] = createSignal<ChannelRow[]>([]);
  const [recent, setRecent] = createSignal<ChannelRow[]>([]);
  const progress = useProgress();

  /** Unfinished movies and episodes, most recent first (spec §5 "Continue watching"). */
  const continueRows = createMemo(() => {
    const rows: ProgressRow[] = [];
    progress().forEach((p) => !p.watched && p.position > 0 && rows.push(p));
    return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONTINUE);
  });

  createEffect(
    on([() => activePlaylist()?.id, () => versionOf(activePlaylist()?.id), recentVersion], async ([id]) => {
      if (!id) {
        setFavorites([]);
        setRecent([]);
        return;
      }
      const [favKeys, recKeys] = await Promise.all([favoriteKeys(id, 'live'), recentKeys(id, 'live')]);
      if (!favKeys.length && !recKeys.length) {
        setFavorites([]);
        setRecent([]);
        return;
      }
      const [favs, recs] = await Promise.all([
        itemsByKeys(id, 'live', favKeys.slice(0, MAX_CHANNELS)),
        itemsByKeys(id, 'live', recKeys.slice(0, MAX_CHANNELS)),
      ]);
      perf.mark('startup.homeData');
      setFavorites(favs);
      setRecent(recs);
    }),
  );

  return (
    <div class="screen home">
      <Show when={playlistsLoaded()}>
        <Show when={activePlaylist()} fallback={<Welcome />}>
          {(p) => (
            <FocusZone id="home-main" remember>
              <Show when={homeShows('hero')}>
                <Show when={continueRows()[0]} fallback={<WelcomeBackHero />}>
                  {(row) => <ResumeHero row={row()} />}
                </Show>
              </Show>

              <Show when={homeShows('continue') && continueRows().length > 0}>
                <div class="section-head">
                  <h2 class="section-title">
                    {t('home.continue')}
                    <span class="pill pill-accent">{t('home.inProgress', { n: formatNumber(continueRows().length) })}</span>
                  </h2>
                </div>
                <div class="shelf">
                  <For each={continueRows()}>{(row) => <ContinueCard row={row} />}</For>
                  <span class="shelf-end" />
                </div>
              </Show>

              <Show when={homeShows('favorites')}>
                <ChannelShelf id="fav" title={t('home.favorites')} channels={favorites()} empty={t('home.noFavorites')} />
              </Show>
              <Show when={homeShows('recent') && recent().length > 0}>
                <ChannelShelf id="recent" title={t('home.recent')} channels={recent()} />
              </Show>

              <div class="section-head">
                <h2 class="section-title">{t('home.library')}</h2>
                <div class="home-status">
                  <span classList={{ 'text-error': !!p().lastError && !refreshing()[p().id] }}>{statusText(p(), !!refreshing()[p().id])}</span>
                  <FocusButton id="home-refresh" class="chip-button" onSelect={() => void refreshPlaylist(p().id)}>
                    <Icon name="sync" />
                    <span>{t('playlists.refresh')}</span>
                  </FocusButton>
                </div>
              </div>
              <div class="library">
                <LibraryCard id="home-lib-live" icon="live" tone="" title={t('home.libLive')} sub={t('home.libLiveSub', { n: formatNumber(p().counts?.live ?? 0) })} onSelect={() => openRoot({ name: 'live' })} />
                <LibraryCard id="home-lib-movies" icon="movie" tone="cyan" title={t('home.libMovies')} sub={t('home.libMoviesSub', { n: formatNumber(p().counts?.vod ?? 0) })} onSelect={() => openRoot({ name: 'movies' })} />
                <LibraryCard id="home-lib-series" icon="series" tone="grey" title={t('home.libSeries')} sub={t('home.libSeriesSub', { n: formatNumber(p().counts?.series ?? 0) })} onSelect={() => openRoot({ name: 'series' })} />
              </div>
            </FocusZone>
          )}
        </Show>
      </Show>
    </div>
  );
}

/** Big "resume" banner for the most recent unfinished movie or episode. */
function ResumeHero(props: { row: ProgressRow }): JSX.Element {
  const [info, setInfo] = createSignal<VodInfo | null>(null);
  // Movies on Xtream have backdrops and genres in their details (cached by the worker).
  createEffect(
    on(
      () => props.row,
      (row) => {
        setInfo(null);
        if (row.ref.t !== 'movie' || activePlaylist()?.type !== 'xtream') return;
        catalog()
          .call('vodInfo', row.playlistId, row.ref.id)
          .then(setInfo, (e) => log.debug('home', 'hero details failed', { error: e }));
      },
    ),
  );
  const art = () => info()?.backdrop ?? info()?.poster ?? props.row.poster;
  const left = () => Math.max(0, props.row.duration - props.row.position);
  const openDetails = async () => {
    const row = props.row;
    if (row.kind === 'episode' && row.seriesId) return navigate({ name: 'series-detail', id: row.seriesId });
    if (row.ref.t === 'movie') return navigate({ name: 'vod-detail', id: row.ref.id });
    const [match] = await itemsByKeys(row.playlistId, 'vod', [row.key]);
    if (match) navigate({ name: 'vod-detail', id: match.id });
  };
  return (
    <div class="hero">
      <Show when={art()}>
        {(src) => (
          <div class="hero-art">
            <img src={src()} alt="" referrerPolicy="no-referrer" />
          </div>
        )}
      </Show>
      <div class="hero-shade" />
      <div class="hero-shade-bottom" />
      <div class="hero-body">
        <div class="hero-kicker">
          <span class="pill pill-live">{t('home.resumeKicker')}</span>
          <Show when={info()?.genre || props.row.subtitle}>
            <span class="meta">
              <bdi>{info()?.genre ?? props.row.subtitle}</bdi>
            </span>
          </Show>
        </div>
        <h1 class="hero-title">
          <bdi>{props.row.title}</bdi>
        </h1>
        <div class="hero-meta">
          <Show when={info()?.rating}>
            <span class="pill pill-accent">★ {info()!.rating}</span>
          </Show>
          <span>{formatLeft(props.row.duration)}</span>
          <span class="remaining">{t('home.remaining', { time: formatLeft(left()), pct: formatNumber(Math.round(progressRatio(props.row) * 100)) })}</span>
        </div>
        <span class="progress progress-accent">
          <span class="progress-fill" style={{ width: `${Math.round(progressRatio(props.row) * 100)}%` }} />
        </span>
        <div class="button-row">
          <FocusButton
            id="home-resume"
            class="btn-primary btn-lg"
            autofocus
            onSelect={() => watch(itemFromProgress(props.row), props.row.kind === 'vod' ? 'movies' : 'series')}
          >
            <Icon name="play" />
            <span>{t('home.resume')}</span>
          </FocusButton>
          <FocusButton id="home-details" class="btn-lg" onSelect={() => void openDetails()}>
            <Icon name="info" />
            <span>{t('home.details')}</span>
          </FocusButton>
        </div>
      </div>
    </div>
  );
}

/** Hero when nothing is in progress: the playlist and the ways in. */
function WelcomeBackHero(): JSX.Element {
  const p = activePlaylist;
  return (
    <div class="hero">
      <div class="hero-shade" />
      <div class="hero-body">
        <div class="hero-kicker">
          <span class="pill pill-accent">{t('home.yourPlaylist')}</span>
        </div>
        <h1 class="hero-title">
          <bdi>{p()?.name}</bdi>
        </h1>
        <div class="hero-meta">
          <span>{t('home.libLiveSub', { n: formatNumber(p()?.counts?.live ?? 0) })}</span>
          <span>·</span>
          <span>{t('home.libMoviesSub', { n: formatNumber(p()?.counts?.vod ?? 0) })}</span>
          <span>·</span>
          <span>{t('home.libSeriesSub', { n: formatNumber(p()?.counts?.series ?? 0) })}</span>
        </div>
        <div class="button-row">
          <FocusButton id="home-live" class="btn-primary btn-lg" autofocus onSelect={() => openRoot({ name: 'live' })}>
            <Icon name="live" />
            <span>{t('home.openLive')}</span>
          </FocusButton>
          <FocusButton id="home-movies" class="btn-lg" onSelect={() => openRoot({ name: 'movies' })}>
            <Icon name="movie" />
            <span>{t('home.browseMovies')}</span>
          </FocusButton>
        </div>
      </div>
    </div>
  );
}

function ContinueCard(props: { row: ProgressRow }): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  return (
    <FocusButton
      id={`home-cw-${props.row.kind}-${props.row.key}`}
      class="cw-card"
      onSelect={() => watch(itemFromProgress(props.row), props.row.kind === 'vod' ? 'movies' : 'series')}
    >
      <div class="cw-art">
        <Show when={props.row.poster && !failed()} fallback={<span class="cw-initial">{props.row.title.slice(0, 1)}</span>}>
          <img src={props.row.poster} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        </Show>
        <span class="cw-left">{t('home.left', { time: formatLeft(props.row.duration - props.row.position) })}</span>
        <span class="progress">
          <span class="progress-fill" style={{ width: `${Math.round(progressRatio(props.row) * 100)}%` }} />
        </span>
      </div>
      <div class="cw-text">
        <div class="cw-title">
          <bdi>{props.row.title}</bdi>
        </div>
        <div class="cw-sub">
          <bdi>{props.row.kind === 'episode' ? props.row.subtitle : t('home.movie')}</bdi>
        </div>
      </div>
    </FocusButton>
  );
}

function ChannelShelf(props: { id: string; title: string; channels: ChannelRow[]; empty?: string }): JSX.Element {
  return (
    <>
      <div class="section-head">
        <h2 class="section-title">{props.title}</h2>
      </div>
      <Show when={props.channels.length > 0} fallback={<p class="hint">{props.empty}</p>}>
        <div class="shelf">
          <For each={props.channels}>{(c) => <ChannelCard id={`home-${props.id}-${c.key}`} channel={c} />}</For>
          <span class="shelf-end" />
        </div>
      </Show>
    </>
  );
}

/** Channel with what's on now (Xtream guide) and how long it has left. */
function ChannelCard(props: { id: string; channel: ChannelRow }): JSX.Element {
  const epg = useNowNext(() => (guideOnEveryRow() && props.channel.stream.t === 'x' ? props.channel.id : null));
  return (
    <FocusButton id={props.id} class="channel-card" onSelect={() => openRoot({ name: 'live', focusKey: props.channel.key })}>
      <div class="channel-card-head">
        <ChannelLogo src={props.channel.logo} name={props.channel.name} />
        <Show when={epg().now}>
          <span class="pill pill-live">{t('player.live')}</span>
        </Show>
      </div>
      <div class="channel-card-name">
        <bdi>{props.channel.name}</bdi>
      </div>
      <div class="channel-card-now">
        <bdi>{epg().now?.title ?? ''}</bdi>
      </div>
      <Show when={epg().now}>
        {(now) => (
          <>
            <span class="progress">
              <span class="progress-fill" style={{ width: `${Math.round((epg().progress ?? 0) * 100)}%` }} />
            </span>
            <div class="channel-card-foot">
              <span>{t('home.left', { time: formatLeft((now().stop - Date.now()) / 1000) })}</span>
              <Show when={epg().next}>{(next) => <span dir="ltr">{formatClock(next().start)}</span>}</Show>
            </div>
          </>
        )}
      </Show>
    </FocusButton>
  );
}

function LibraryCard(props: { id: string; icon: 'live' | 'movie' | 'series'; tone: string; title: string; sub: string; onSelect: () => void }): JSX.Element {
  return (
    <FocusButton id={props.id} class="library-card" onSelect={props.onSelect}>
      <div class="library-card-head">
        <span class={`library-icon ${props.tone}`}>
          <Icon name={props.icon} />
        </span>
        <Icon name="forward" />
      </div>
      <div class="library-title">{props.title}</div>
      <div class="library-sub">{props.sub}</div>
    </FocusButton>
  );
}

function Welcome(): JSX.Element {
  const devServer = import.meta.env.DEV ? `${location.origin}/__fixtures/xtream` : '';
  return (
    <div class="welcome">
      <div class="brand-mark">
        <Icon name="play" />
      </div>
      <h1 class="screen-title">{t('home.welcome')}</h1>
      <p class="hint">{t('home.welcomeBody')}</p>
      <FocusZone id="home-welcome">
        <FocusButton id="home-add" class="btn-primary btn-lg" autofocus onSelect={() => navigate({ name: 'playlist-form' })}>
          <Icon name="add" />
          <span>{t('home.addPlaylist')}</span>
        </FocusButton>
      </FocusZone>
      <Show when={devServer}>
        <p class="hint dev-hint">{t('home.devHint', { server: devServer })}</p>
      </Show>
    </div>
  );
}
