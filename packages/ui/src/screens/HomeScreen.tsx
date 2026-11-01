import { favoriteKeys, listItems, type ChannelRow, type ProgressRow } from '@ultra/core';
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js';
import { FocusButton } from '../components/FocusButton';
import { activePlaylist, playlistsLoaded, refreshing, refreshPlaylist, versionOf } from '../data/playlists';
import { FocusZone } from '../focus';
import { countsText, statusText } from '../format';
import { t } from '../i18n';
import { navigate, openRoot } from '../nav';
import { ChannelLogo } from '../components/ChannelLogo';
import { PosterTile } from '../components/PosterTile';
import { itemFromProgress, progressRatio, useProgress, watch } from '../data/media';

const MAX_FAVORITES = 30;
const MAX_CONTINUE = 20;

export function HomeScreen(): JSX.Element {
  const [favorites, setFavorites] = createSignal<ChannelRow[]>([]);
  const progress = useProgress();
  /** Unfinished movies and episodes, most recent first (spec §5 "Continue watching"). */
  const continueRows = createMemo(() => {
    const rows: ProgressRow[] = [];
    progress().forEach((p) => !p.watched && p.position > 0 && rows.push(p));
    return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONTINUE);
  });

  createEffect(
    on([() => activePlaylist()?.id, () => versionOf(activePlaylist()?.id)], async ([id]) => {
      if (!id) return setFavorites([]);
      const keys = await favoriteKeys(id, 'live');
      if (!keys.length) return setFavorites([]);
      const all = await listItems(id, 'live', null);
      const byKey = new Map(all.map((c) => [c.key, c] as [string, ChannelRow]));
      setFavorites(keys.map((k) => byKey.get(k)).filter((c): c is ChannelRow => !!c).slice(0, MAX_FAVORITES));
    }),
  );

  return (
    <div class="screen home">
      <Show when={playlistsLoaded()}>
        <Show when={activePlaylist()} fallback={<Welcome />}>
          {(p) => (
            <FocusZone id="home-main" remember>
              <div class="home-header">
                <div>
                  <h1 class="screen-title">
                    <bdi>{p().name}</bdi>
                  </h1>
                  <div class="hint">{countsText(p())}</div>
                  <div class="hint" classList={{ 'text-error': !!p().lastError && !refreshing()[p().id] }}>
                    {statusText(p(), !!refreshing()[p().id])}
                  </div>
                </div>
                <div class="button-row">
                  <FocusButton id="home-live" class="btn-primary" autofocus onSelect={() => openRoot({ name: 'live' })}>
                    {t('home.openLive')}
                  </FocusButton>
                  <FocusButton id="home-refresh" onSelect={() => void refreshPlaylist(p().id)}>
                    {t('playlists.refresh')}
                  </FocusButton>
                  <FocusButton id="home-playlists" onSelect={() => navigate({ name: 'playlists' })}>
                    {t('home.playlists')}
                  </FocusButton>
                </div>
              </div>
              <Show when={continueRows().length > 0}>
                <h2 class="section-title">{t('home.continue')}</h2>
                <div class="tile-row continue-row">
                  <For each={continueRows()}>
                    {(p) => (
                      <FocusButton
                        id={`home-cw-${p.kind}-${p.key}`}
                        class="tile poster-tile"
                        onSelect={() => watch(itemFromProgress(p), p.kind === 'vod' ? 'movies' : 'series')}
                      >
                        <PosterTile title={p.title} poster={p.poster} sub={p.kind === 'episode' ? p.subtitle : undefined} progress={progressRatio(p)} />
                      </FocusButton>
                    )}
                  </For>
                </div>
              </Show>
              <h2 class="section-title">{t('home.favorites')}</h2>
              <Show when={favorites().length > 0} fallback={<p class="hint">{t('home.noFavorites')}</p>}>
                <div class="tile-row">
                  <For each={favorites()}>
                    {(c) => (
                      <FocusButton id={`home-fav-${c.key}`} class="tile" onSelect={() => openRoot({ name: 'live', focusKey: c.key })}>
                        <ChannelLogo src={c.logo} large />
                        <span class="tile-label">
                          <bdi>{c.name}</bdi>
                        </span>
                      </FocusButton>
                    )}
                  </For>
                </div>
              </Show>
            </FocusZone>
          )}
        </Show>
      </Show>
    </div>
  );
}

function Welcome(): JSX.Element {
  const devServer = import.meta.env.DEV ? `${location.origin}/__fixtures/xtream` : '';
  return (
    <div class="welcome">
      <h1 class="screen-title">{t('home.welcome')}</h1>
      <p class="hint">{t('home.welcomeBody')}</p>
      <FocusZone id="home-welcome">
        <FocusButton id="home-add" class="btn-primary" autofocus onSelect={() => navigate({ name: 'playlist-form' })}>
          {t('home.addPlaylist')}
        </FocusButton>
      </FocusZone>
      <Show when={devServer}>
        <p class="hint dev-hint">{t('home.devHint', { server: devServer })}</p>
      </Show>
    </div>
  );
}
