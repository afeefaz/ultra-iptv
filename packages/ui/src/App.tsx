import { log, logging } from '@ultra/core';
import type { KeyPress, Platform } from '@ultra/platform';
import { createEffect, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js';
import { FocusButton } from './components/FocusButton';
import { Icon } from './components/Icon';
import { PickerDialog } from './components/PickerDialog';
import { PinHost } from './components/PinDialog';
import { VideoLayer } from './components/VideoLayer';
import { clock, formatClock } from './data/epg';
import { startParental } from './data/parental';
import { playingPlaylistId, stopPlayback } from './data/playback';
import { activePlaylist, playlists, setActivePlaylist, startPlaylists } from './data/playlists';
import { DebugScreen } from './debug/DebugScreen';
import { CONTENT_ZONE, focusManager, FocusZone } from './focus';
import { countsText, shortCounts } from './format';
import { applyLocaleToDocument, direction, locale, t } from './i18n';
import { dispatchKey } from './keys';
import { currentRoute, goBack, navigate, switchTab, tabOf, TABS, type Route, type Tab } from './nav';
import { PlatformContext } from './platform-context';
import { AboutScreen } from './screens/AboutScreen';
import { CatchupScreen } from './screens/CatchupScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LiveScreen } from './screens/LiveScreen';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { PlaylistFormScreen } from './screens/PlaylistFormScreen';
import { PlaylistsScreen } from './screens/PlaylistsScreen';
import { SeriesDetailScreen } from './screens/SeriesDetailScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { VodDetailScreen } from './screens/VodDetailScreen';
import { VodScreen } from './screens/VodScreen';

// Last focused content item per route, restored when coming back.
const focusByRoute = new Map<string, string>();

export function App(props: { platform: Platform }): JSX.Element {
  applyLocaleToDocument();

  const stopFocusTracking = focusManager.onChange((id) => {
    if (id && focusManager.isInZone(id, CONTENT_ZONE)) focusByRoute.set(currentRoute().name, id);
  });
  onCleanup(stopFocusTracking);

  // A channel from another playlist must not keep playing after a switch.
  createEffect(
    on(
      () => activePlaylist()?.id,
      (id) => {
        const playing = playingPlaylistId();
        if (playing && playing !== id) stopPlayback();
      },
      { defer: true },
    ),
  );

  const handleKey = (press: KeyPress): boolean => {
    log.debug('keys', 'press', { key: press.key, raw: press.raw, repeat: press.repeat });
    if (dispatchKey(press)) return true;
    switch (press.key) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        focusManager.move(press.key);
        return true; // never let arrows scroll the page
      case 'ok':
        return focusManager.select();
      case 'back':
        if (leaveTextField()) return true;
        if (!goBack()) return false;
        restoreFocus(currentRoute());
        return true;
      default:
        return false;
    }
  };

  onMount(() => {
    // Dev builds only: inspect focus state from DevTools (`__ultra.focus.currentId`).
    if (import.meta.env.DEV) (window as unknown as { __ultra: unknown }).__ultra = { focus: focusManager };
    startPlaylists();
    startParental();
    const stopKeys = props.platform.keys.start(handleKey);
    const onPointer = () => (focusManager.pointerMode = true);
    document.addEventListener('mousemove', onPointer);
    onCleanup(() => {
      stopKeys();
      document.removeEventListener('mousemove', onPointer);
    });
  });

  return (
    <PlatformContext.Provider value={props.platform}>
      <div class="app" dir={direction()} lang={locale()}>
        <FocusZone id="topbar" remember>
          <header class="topbar">
            <div class="brand" aria-label={t('app.name')}>
              <span class="brand-mark">
                <Icon name="play" />
              </span>
              <span class="brand-name" dir="ltr">
                ULTRA <b>IPTV</b>
              </span>
            </div>
            <nav class="tabs">
              <For each={TABS}>{(tab) => <TabButton tab={tab} />}</For>
            </nav>
            <div class="topbar-end">
              <PlaylistSwitcher />
              <FocusButton
                id="tab-settings"
                class="icon-button"
                selected={tabOf(currentRoute()) === 'settings'}
                label={t('tab.settings')}
                onSelect={() => switchTab('settings')}
              >
                <Icon name="settings" />
              </FocusButton>
              <span class="topbar-clock" dir="ltr">
                {formatClock(clock())}
              </span>
            </div>
          </header>
        </FocusZone>
        <FocusZone id={CONTENT_ZONE}>
          <main class="content">
            <Switch>
              <Match when={currentRoute().name === 'home'}>
                <HomeScreen />
              </Match>
              <Match when={currentRoute().name === 'live' && currentRoute()} keyed>
                {(r) => <LiveScreen focusKey={(r as { focusKey?: string }).focusKey} />}
              </Match>
              <Match when={currentRoute().name === 'player'}>
                <PlayerScreen />
              </Match>
              <Match when={currentRoute().name === 'movies'}>
                <VodScreen kind="vod" />
              </Match>
              <Match when={currentRoute().name === 'series'}>
                <VodScreen kind="series" />
              </Match>
              <Match when={currentRoute().name === 'vod-detail' && currentRoute()} keyed>
                {(r) => <VodDetailScreen id={(r as { id: string }).id} />}
              </Match>
              <Match when={currentRoute().name === 'series-detail' && currentRoute()} keyed>
                {(r) => <SeriesDetailScreen id={(r as { id: string }).id} />}
              </Match>
              <Match when={currentRoute().name === 'catchup' && currentRoute()} keyed>
                {(r) => <CatchupScreen channelId={(r as { channelId: string }).channelId} />}
              </Match>
              <Match when={currentRoute().name === 'settings'}>
                <SettingsScreen />
              </Match>
              <Match when={currentRoute().name === 'playlists'}>
                <PlaylistsScreen />
              </Match>
              <Match when={currentRoute().name === 'playlist-form' && currentRoute()} keyed>
                {(r) => <PlaylistFormScreen id={(r as { id?: string }).id} />}
              </Match>
              <Match when={currentRoute().name === 'about'}>
                <AboutScreen />
              </Match>
              <Match when={currentRoute().name === 'debug'}>
                <DebugScreen />
              </Match>
              <Match when={true}>
                <PlaceholderScreen tab={tabOf(currentRoute())} />
              </Match>
            </Switch>
          </main>
        </FocusZone>
        <VideoLayer />
        <PinHost />
      </div>
    </PlatformContext.Provider>
  );
}

function TabButton(props: { tab: Tab }): JSX.Element {
  return (
    <FocusButton
      id={`tab-${props.tab}`}
      class="tab"
      selected={tabOf(currentRoute()) === props.tab}
      onSelect={() => switchTab(props.tab)}
    >
      {t(`tab.${props.tab}`)}
    </FocusButton>
  );
}

/** Top bar playlist switcher (spec §5). */
function PlaylistSwitcher(): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <Show when={playlists().length > 0}>
      <FocusButton id="topbar-playlist" class="playlist-chip" onSelect={() => setOpen(true)} label={t('playlists.switch')}>
        <span class="playlist-chip-name">
          <bdi>{activePlaylist()?.name ?? t('playlists.none')}</bdi>
        </span>
        <Show when={activePlaylist()}>{(p) => <span class="playlist-chip-counts">{shortCounts(p())}</span>}</Show>
        <Icon name="down" />
      </FocusButton>
      <Show when={open()}>
        <PickerDialog
          id="playlist-picker"
          title={t('playlists.switch')}
          options={playlists().map((p) => ({ id: p.id, label: p.name, detail: countsText(p) }))}
          selected={activePlaylist()?.id}
          onCancel={() => setOpen(false)}
          onPick={(id) => {
            setOpen(false);
            setActivePlaylist(id);
          }}
          footer={
            <div class="button-row dialog-actions">
              <FocusButton
                id="playlist-picker-manage"
                onSelect={() => {
                  setOpen(false);
                  navigate({ name: 'playlists' });
                }}
              >
                {t('playlists.manage')}
              </FocusButton>
            </div>
          }
        />
      </Show>
    </Show>
  );
}

function leaveTextField(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return false;
  active.blur();
  const id = focusManager.currentId;
  if (id) focusManager.focus(id);
  return true;
}

function restoreFocus(route: Route): void {
  const id = focusByRoute.get(route.name);
  if (id) setTimeout(() => focusManager.focus(id), 0);
}

/** Startup logging: ring buffer, uncaught errors, and how long the first render took. */
export function startLogging(platform: Platform): void {
  logging.attachRingBuffer();
  window.addEventListener('error', (e) => {
    log.error('app', 'uncaught error', { message: e.message, source: e.filename, line: e.lineno, error: e.error });
  });
  window.addEventListener('unhandledrejection', (e) => {
    log.error('app', 'unhandled rejection', { reason: e.reason });
  });
  const device = platform.device();
  log.info('app', 'start', {
    version: __APP_VERSION__,
    legacy: __LEGACY__,
    platform: device.platform,
    engine: device.engine,
    screen: `${device.screen.width}x${device.screen.height}`,
  });
}
