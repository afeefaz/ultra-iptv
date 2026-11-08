import { log, logging, perf, type ContentKind } from '@ultra/core';
import type { KeyPress, Platform } from '@ultra/platform';
import { createEffect, createRenderEffect, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js';
import { FocusButton } from './components/FocusButton';
import { Icon } from './components/Icon';
import { LoadingLine } from './components/LoadingProgress';
import { PickerDialog } from './components/PickerDialog';
import { PinHost } from './components/PinDialog';
import { toastText } from './data/toast';
import { SystemUsageReadout } from './components/SystemUsageReadout';
import { VideoLayer } from './components/VideoLayer';
import { setCatalogPlatform } from './data/catalog';
import { clock, formatClock } from './data/epg';
import { startParental } from './data/parental';
import { playingPlaylistId, stopPlayback } from './data/playback';
import { activePlaylist, playlists, setActivePlaylist, startPlaylists } from './data/playlists';
import { startRemoteAccess } from './data/remoteAccess';
import { startPerfRuntime } from './data/perfRuntime';
import { accentColor, accentVariables } from './data/accent';
import { accent, setDeviceIsTv, textScale, theme } from './data/settings';
import { startUsage, track } from './data/usage';
import { DebugScreen } from './debug/DebugScreen';
import { CONTENT_ZONE, focusManager, FocusZone } from './focus';
import { countsText } from './format';
import { applyLocaleToDocument, direction, locale, t } from './i18n';
import { dispatchKey } from './keys';
import { currentRoute, goBack, navigate, onBackNavigated, screenRoute, switchTab, tabOf, TABS, type Route, type Tab } from './nav';
import { PlatformContext } from './platform-context';
import { AboutScreen } from './screens/AboutScreen';
import { CatchupScreen } from './screens/CatchupScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LiveScreen } from './screens/LiveScreen';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { PlaylistFormScreen } from './screens/PlaylistFormScreen';
import { PlaylistsScreen } from './screens/PlaylistsScreen';
import { HiddenCategoriesScreen } from './screens/HiddenCategoriesScreen';
import { RenameCategoriesScreen } from './screens/RenameCategoriesScreen';
import { SeriesDetailScreen } from './screens/SeriesDetailScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { VodDetailScreen } from './screens/VodDetailScreen';
import { VodScreen } from './screens/VodScreen';

/** The root size in styles.css: one rem is 1/120 of the screen's width at 100%. */
const BASE_ROOT_VW = 0.8333;

// Last focused content item per route, restored when coming back.
const focusByRoute = new Map<string, string>();
const BIG_TEXT_PERCENT = 125;

export function App(props: { platform: Platform }): JSX.Element {
  applyLocaleToDocument();
  setCatalogPlatform(props.platform);
  Promise.resolve(props.platform.isTv?.()).then(
    (tv) => setDeviceIsTv(!!tv),
    (e) => log.warn('app', 'could not tell if this is a TV', { error: e }),
  );
  onBackNavigated(restoreFocus);
  if (props.platform.reducedEffects) document.documentElement.classList.add('reduced-effects');

  let scaled = false;
  createRenderEffect(() => {
    const root = document.documentElement.style;
    root.fontSize = `${(BASE_ROOT_VW * textScale()) / 100}vw`;
    root.setProperty('--text-scale', String(textScale() / 100));
    // Big text leaves less room: the Live preview shrinks and its key hints go.
    document.documentElement.classList.toggle('big-text', textScale() >= BIG_TEXT_PERCENT);
    // Lists and the video preview measure in pixels; they re-measure on resize.
    if (scaled) window.dispatchEvent(new Event('resize'));
    scaled = true;
  });

  createRenderEffect(() => {
    const vars = accentVariables(accentColor(accent()), theme());
    for (const name of Object.keys(vars)) document.documentElement.style.setProperty(name, vars[name]);
  });

  createRenderEffect(() => {
    document.documentElement.setAttribute('data-theme', theme());
    const scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute('content', theme());
  });

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
    // Press to the next painted frame: what "the remote feels slow" actually is.
    const latency = perf.span('input.toFrame');
    requestAnimationFrame(() => requestAnimationFrame(() => latency.end()));
    if (dispatchKey(press)) return true;
    switch (press.key) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        focusManager.move(press.key, press.repeat);
        return true; // never let arrows scroll the page
      case 'ok':
        return focusManager.select();
      case 'back':
        if (leaveTextField()) return true;
        if (!goBack()) {
          props.platform.exit?.();
          return !!props.platform.exit;
        }
        return true;
      default:
        return false;
    }
  };

  // Each screen change: from the route changing to the new screen being painted.
  createEffect(
    on(
      () => currentRoute().name,
      (name) => {
        const span = perf.span(`screen.${name}`);
        track(`screen.${name}`);
        requestAnimationFrame(() => requestAnimationFrame(() => span.end()));
      },
    ),
  );

  onMount(() => {
    perf.mark('startup.appMounted');
    startPerfRuntime(props.platform);
    startUsage();
    requestAnimationFrame(() => requestAnimationFrame(() => perf.mark('startup.firstFrame')));
    // Dev builds only: inspect focus state from DevTools (`__ultra.focus.currentId`).
    if (import.meta.env.DEV) (window as unknown as { __ultra: unknown }).__ultra = { focus: focusManager };
    startPlaylists();
    startRemoteAccess();
    startParental();
    const stopKeys = props.platform.keys.start(handleKey);
    // A tap also sends a fake mouse move, so only a device that can hover counts as having a mouse.
    const canHover = window.matchMedia('(hover: hover)').matches;
    focusManager.setTouching(!canHover && window.matchMedia('(pointer: coarse)').matches);
    const onPointer = () => {
      focusManager.pointerMode = true;
      if (canHover) focusManager.setTouching(false);
    };
    const onTouch = () => focusManager.setTouching(true);
    document.addEventListener('mousemove', onPointer);
    document.addEventListener('touchstart', onTouch, { passive: true });
    onCleanup(() => {
      stopKeys();
      document.removeEventListener('mousemove', onPointer);
      document.removeEventListener('touchstart', onTouch);
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
              <SystemUsageReadout />
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
        <LoadingLine />
        <FocusZone id={CONTENT_ZONE}>
          <main class="content">
            <div class="screen-host" style={{ display: currentRoute().name === 'player' ? 'none' : undefined }}>
              <Switch>
                <Match when={screenRoute().name === 'home'}>
                  <HomeScreen />
                </Match>
                <Match when={screenRoute().name === 'live' && screenRoute()} keyed>
                  {(r) => <LiveScreen focusKey={(r as { focusKey?: string }).focusKey} />}
                </Match>
                <Match when={screenRoute().name === 'movies'}>
                  <VodScreen kind="vod" />
                </Match>
                <Match when={screenRoute().name === 'series'}>
                  <VodScreen kind="series" />
                </Match>
                <Match when={screenRoute().name === 'vod-detail' && screenRoute()} keyed>
                  {(r) => <VodDetailScreen id={(r as { id: string }).id} />}
                </Match>
                <Match when={screenRoute().name === 'series-detail' && screenRoute()} keyed>
                  {(r) => <SeriesDetailScreen id={(r as { id: string }).id} />}
                </Match>
                <Match when={screenRoute().name === 'catchup' && screenRoute()} keyed>
                  {(r) => <CatchupScreen channelId={(r as { channelId: string }).channelId} />}
                </Match>
                <Match when={screenRoute().name === 'settings'}>
                  <SettingsScreen />
                </Match>
                <Match when={screenRoute().name === 'hidden-categories' && screenRoute()} keyed>
                  {(r) => <HiddenCategoriesScreen kind={(r as { kind: ContentKind }).kind} />}
                </Match>
                <Match when={screenRoute().name === 'rename-categories'}>
                  <RenameCategoriesScreen />
                </Match>
                <Match when={screenRoute().name === 'playlists'}>
                  <PlaylistsScreen />
                </Match>
                <Match when={screenRoute().name === 'playlist-form' && screenRoute()} keyed>
                  {(r) => <PlaylistFormScreen id={(r as { id?: string }).id} />}
                </Match>
                <Match when={screenRoute().name === 'about'}>
                  <AboutScreen />
                </Match>
                <Match when={screenRoute().name === 'debug'}>
                  <DebugScreen />
                </Match>
                <Match when={true}>
                  <PlaceholderScreen tab={tabOf(screenRoute())} />
                </Match>
              </Switch>
            </div>
            <Show when={currentRoute().name === 'player'}>
              <PlayerScreen />
            </Show>
          </main>
        </FocusZone>
        <VideoLayer />
        <PinHost />
        <Show when={toastText()}>
          <div class="toast" role="status">
            {toastText()}
          </div>
        </Show>
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
