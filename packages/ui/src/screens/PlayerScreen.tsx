import { log } from '@ultra/core';
import type { Key, Platform } from '@ultra/platform';
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { ChannelLogo } from '../components/ChannelLogo';
import { Icon, type IconName } from '../components/Icon';
import { TrackSheet } from '../components/TrackSheet';
import { VirtualList } from '../components/VirtualList';
import { catalog } from '../data/catalog';
import { clock, formatClock, useNowNext } from '../data/epg';
import { isChannelLocked } from '../data/parental';
import {
  claimSurface,
  lastZapMs,
  playbackPosition,
  playbackSession,
  playbackStatus,
  playerState,
  playerStats,
  playingChannel,
  playingMedia,
  releaseSurface,
  retryNow,
  seekBy,
  openInExternalPlayer,
  seekTo,
  togglePause,
  zap,
  videoResolution,
  zapTo,
} from '../data/playback';
import { formatDuration } from '../format';
import { formatNumber, t } from '../i18n';
import { useKeys } from '../keys';
import { usePlatform } from '../platform-context';
import { goBack } from '../nav';

const OVERLAY_MS = 5000;
const ZAP_DELAY_MS = 1500;

const SEEK_SECONDS = 10;
const SKIP_SECONDS = 30;
const PLAY_PAUSE_CONTROL = 2;

/** Full screen: the live player, or the movie/episode/catch-up player. */
export function PlayerScreen(): JSX.Element {
  return (
    <Show when={playingMedia()} fallback={<LivePlayer />}>
      <MediaPlayer />
    </Show>
  );
}

/**
 * Full-screen live player (spec §5): minimal overlay, zapping with CH±/Up/Down and numbers,
 * OK opens a mini channel list, Green the audio/subtitle sheet, Info the stats.
 */
function LivePlayer(): JSX.Element {
  const [overlay, setOverlay] = createSignal(true);
  const [miniList, setMiniList] = createSignal(false);
  const [sheet, setSheet] = createSignal(false);
  const [stats, setStats] = createSignal(false);
  const [digits, setDigits] = createSignal('');
  const [toast, setToast] = createSignal('');
  const platform = usePlatform();
  const controls: PlayerControl[] = [
    { label: () => t('common.back'), icon: () => 'back', run: () => goBack() },
    { label: () => t('player.prevChannel'), icon: () => 'up', run: () => void zap(-1) },
    { label: () => t('player.nextChannel'), icon: () => 'down', run: () => void zap(1) },
    { label: () => t('player.channelList'), icon: () => 'list', run: () => setMiniList(true) },
    { label: () => t('player.audioSubs'), icon: () => 'subtitles', text: true, run: () => setSheet(true) },
    ...externalControl(platform),
  ];
  /** Index of the button the remote is on; null means the arrows zap as usual. */
  const [control, setControl] = createSignal<number | null>(null);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let zapTimer: ReturnType<typeof setTimeout> | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const channel = playingChannel;
  const nowNext = useNowNext(() => (channel()?.stream.t === 'x' ? channel()!.id : null), true);

  const showOverlay = () => {
    setOverlay(true);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      setOverlay(false);
      setControl(null);
    }, OVERLAY_MS);
  };

  onMount(() => {
    if (!channel()) {
      goBack();
      return;
    }
    claimSurface('fullscreen', 'fullscreen');
    showOverlay();
  });
  onCleanup(() => {
    clearTimeout(hideTimer);
    clearTimeout(zapTimer);
    clearTimeout(toastTimer);
    releaseSurface('fullscreen');
  });

  const showToast = (text: string) => {
    setToast(text);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(''), 2500);
  };

  const commitZap = () => {
    clearTimeout(zapTimer);
    const n = Number(digits());
    setDigits('');
    const list = playbackSession()?.list ?? [];
    const index = list.findIndex((c) => c.num === n);
    if (index >= 0) void zapTo(index);
    else if (n) showToast(t('live.notFound', { n: formatNumber(n) }));
  };

  const toggleFavorite = async () => {
    const c = channel();
    const s = playbackSession();
    if (!c || !s) return;
    const added = await catalog().call('toggleFavorite', { playlistId: s.playlistId, kind: 'live', key: c.key, name: c.name, tvgId: c.tvgId });
    showToast(added ? t('live.addFav') + ' ✓' : t('live.removeFav') + ' ✓');
  };

  useKeys((press) => {
    showOverlay();
    if (sheet() || miniList()) {
      if (press.key === 'back') {
        setSheet(false);
        setMiniList(false);
        return true;
      }
      return false; // let the list/sheet handle navigation and OK
    }
    if (moveInControls(press.key, controls, control, setControl)) return true;
    if (press.key.indexOf('digit') === 0) {
      setDigits((d) => (d + press.key.slice(5)).slice(-5));
      clearTimeout(zapTimer);
      zapTimer = setTimeout(commitZap, ZAP_DELAY_MS);
      return true;
    }
    switch (press.key) {
      case 'up':
      case 'chDown':
        void zap(-1);
        return true;
      case 'down':
      case 'chUp':
        void zap(1);
        return true;
      case 'ok':
        if (digits()) commitZap();
        else if (playbackStatus()?.kind === 'failed' || playbackStatus()?.kind === 'needs-gesture') retryNow();
        else setMiniList(true);
        return true;
      case 'green':
      case 'menu':
        setSheet(true);
        return true;
      case 'info':
      case 'blue':
        setStats(!stats());
        return true;
      case 'yellow':
        void toggleFavorite();
        return true;
      case 'playPause':
      case 'play':
      case 'pause':
        togglePause();
        return true;
      case 'left':
        setControl(controls.length - 1);
        return true;
      case 'right':
        setControl(0);
        return true;
      case 'back':
        if (digits()) {
          setDigits('');
          return true;
        }
        goBack();
        return true;
      default:
        return false;
    }
  });

  return (
    <div class="player-screen" onMouseMove={showOverlay}>
      <Show when={overlay() && channel()}>
        {(c) => (
          <>
            <div class="player-top">
              <span class="player-num">{c().num}</span>
              <div class="player-title">
                <div class="player-name">
                  <bdi>{c().name}</bdi>
                  <Show when={isChannelLocked(c())}>
                    <span class="lock-icon">
                      <Icon name="lock" />
                    </span>
                  </Show>
                </div>
              </div>
              <div class="player-end">
                <span class="player-clock" dir="ltr">
                  {formatClock(clock())}
                </span>
                <span class="pill pill-live">{t('player.live')}</span>
                <Show when={videoResolution()}>{(r) => <span class="pill pill-resolution">{r()}</span>}</Show>
              </div>
            </div>
            <div class="player-bottom">
              <Show when={nowNext().now}>
                {(now) => (
                  <div class="player-card">
                    <div class="player-prog">
                      <div class="player-prog-title">
                        <h2>
                          <bdi>{now().title}</bdi>
                        </h2>
                        <span class="time" dir="ltr">
                          {formatClock(now().start)} – {formatClock(now().stop)}
                        </span>
                      </div>
                      <Show when={now().description}>
                        <p class="desc">
                          <bdi>{now().description}</bdi>
                        </p>
                      </Show>
                      <span class="progress progress-accent">
                        <span class="progress-fill" style={{ width: `${Math.round((nowNext().progress ?? 0) * 100)}%` }} />
                      </span>
                    </div>
                    <Show when={nowNext().next}>
                      {(next) => (
                        <div class="up-next">
                          <div class="up-next-label">
                            {t('player.upNext')} <span dir="ltr">({formatClock(next().start)})</span>
                          </div>
                          <div class="up-next-title">
                            <bdi>{next().title}</bdi>
                          </div>
                        </div>
                      )}
                    </Show>
                  </div>
                )}
              </Show>
              <PlayerControls controls={controls} focused={control()} />
              <Show when={stats()}>
                <p class="player-stats" dir="ltr">
                  {statsText()}
                </p>
              </Show>
              <p class="player-hint">{t('player.hint')}</p>
            </div>
          </>
        )}
      </Show>
      <Show when={playerState() === 'paused'}>
        <PausedPill />
      </Show>
      <Show when={miniList()}>
        <div
          class="sheet-backdrop"
          onClick={(e) => {
            e.stopPropagation();
            setMiniList(false);
          }}
        />
        <MiniChannelList onPick={() => setMiniList(false)} />
      </Show>
      <Show when={sheet()}>
        <TrackSheet onClose={() => setSheet(false)} />
      </Show>
      <Show when={digits()}>
        <div class="zap-overlay" dir="ltr">
          {digits()}
        </div>
      </Show>
      <Show when={toast()}>
        <div class="toast" role="status">
          {toast()}
        </div>
      </Show>
    </div>
  );
}

function MiniChannelList(props: { onPick: () => void }): JSX.Element {
  const list = () => playbackSession()?.list ?? [];
  const startIndex = playbackSession()?.index ?? 0;
  return (
    <div class="mini-list">
      <VirtualList
        id="mini"
        items={list()}
        rowHeight={3.2}
        wrap
        autofocusIndex={startIndex}
        ref={(api) => setTimeout(() => api.focusIndex(startIndex), 0)}
        rowClass={(c) => (c.key === playingChannel()?.key ? 'list-item channel-row is-selected' : 'list-item channel-row')}
        onSelect={(_, index) => {
          log.debug('player', 'mini list pick', { index });
          void zapTo(index);
          props.onPick();
        }}
        renderRow={(c) => (
          <>
            <span class="list-number">{c.num}</span>
            <ChannelLogo src={c.logo} name={c.name} />
            <span class="list-label">
              <bdi>{c.name}</bdi>
            </span>
          </>
        )}
      />
    </div>
  );
}

function statsText(): string {
  const s = playerStats();
  if (!s) return '';
  return [
    s.engine,
    s.width ? `${s.width}×${s.height}` : '',
    s.bitrateKbps ? `${formatNumber(s.bitrateKbps)} kbps` : '',
    s.bufferSec !== undefined ? `buffer ${s.bufferSec}s` : '',
    s.droppedFrames !== undefined ? `dropped ${s.droppedFrames}` : '',
    lastZapMs() !== null ? `zap ${lastZapMs()} ms` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Movies, episodes and catch-up (spec §4.2): seek bar, Left/Right ±10 s, FF/REW ±30 s,
 * OK pauses, Green audio & subtitles. Progress is saved by the playback controller.
 */
function MediaPlayer(): JSX.Element {
  const [overlay, setOverlay] = createSignal(true);
  const [sheet, setSheet] = createSignal(false);
  const [stats, setStats] = createSignal(false);
  const platform = usePlatform();
  const controls: PlayerControl[] = [
    { label: () => t('common.back'), icon: () => 'back', run: () => goBack() },
    { label: () => t('player.back10'), icon: () => 'replay10', run: () => seekBy(-SEEK_SECONDS) },
    {
      label: () => (playerState() === 'paused' ? t('player.play') : t('player.pause')),
      icon: () => (playerState() === 'paused' ? 'play' : 'pause'),
      wide: true,
      run: () => togglePause(),
    },
    { label: () => t('player.forward10'), icon: () => 'forward10', run: () => seekBy(SEEK_SECONDS) },
    { label: () => t('player.audioSubs'), icon: () => 'subtitles', text: true, run: () => setSheet(true) },
    ...externalControl(platform),
  ];
  /** Index of the button the remote is on; null means Left/Right seek and OK pauses. */
  const [control, setControl] = createSignal<number | null>(null);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const showOverlay = () => {
    setOverlay(true);
    clearTimeout(hideTimer);
    // Paused media keeps the overlay up so the position stays visible.
    hideTimer = setTimeout(() => {
      if (playerState() === 'paused') return;
      setOverlay(false);
      setControl(null);
    }, OVERLAY_MS);
  };

  onMount(() => {
    claimSurface('fullscreen', 'fullscreen');
    showOverlay();
  });
  onCleanup(() => {
    clearTimeout(hideTimer);
    releaseSurface('fullscreen');
  });

  useKeys((press) => {
    showOverlay();
    if (sheet()) {
      if (press.key !== 'back') return false;
      setSheet(false);
      return true;
    }
    if (moveInControls(press.key, controls, control, setControl)) return true;
    const status = playbackStatus()?.kind;
    switch (press.key) {
      case 'left':
        seekBy(-SEEK_SECONDS);
        return true;
      case 'right':
        seekBy(SEEK_SECONDS);
        return true;
      case 'rew':
        seekBy(-SKIP_SECONDS);
        return true;
      case 'ff':
        seekBy(SKIP_SECONDS);
        return true;
      case 'ok':
      case 'playPause':
      case 'play':
      case 'pause':
        if (status === 'failed' || status === 'needs-gesture') retryNow();
        else togglePause();
        return true;
      case 'green':
      case 'menu':
        setSheet(true);
        return true;
      case 'info':
      case 'blue':
        setStats(!stats());
        return true;
      case 'down':
        setControl(PLAY_PAUSE_CONTROL);
        return true;
      case 'up':
        return true; // just shows the overlay
      case 'back':
      case 'stop':
        goBack();
        return true;
      default:
        return false;
    }
  });

  /** Position under the finger/mouse while dragging the seek bar (seconds), else null. */
  const [dragAt, setDragAt] = createSignal<number | null>(null);
  const shownTime = () => dragAt() ?? playbackPosition().current;
  const ratio = () => {
    const p = playbackPosition();
    return p.duration ? Math.min(1, shownTime() / p.duration) : 0;
  };

  // Touch and mouse events (Chrome 53 has no pointer events). Seeks once, on release.
  let bar: HTMLSpanElement | undefined;
  const timeAt = (clientX: number) => {
    const d = playbackPosition().duration;
    if (!bar || !d) return null;
    const r = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * d;
  };
  const dragStart = (clientX: number) => {
    showOverlay();
    setDragAt(timeAt(clientX));
  };
  const dragMove = (clientX: number) => {
    if (dragAt() === null) return;
    showOverlay();
    setDragAt(timeAt(clientX));
  };
  const dragEnd = () => {
    const at = dragAt();
    setDragAt(null);
    if (at !== null) seekTo(at);
  };
  const onMouseMove = (e: MouseEvent) => dragMove(e.clientX);
  const onMouseUp = () => dragAt() !== null && dragEnd();
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  onCleanup(() => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  });

  return (
    <div
      class="player-screen"
      onMouseMove={showOverlay}
      onClick={(e) => {
        // Clicking the picture (not a control) pauses/resumes, like most web players.
        if (e.target === e.currentTarget) {
          togglePause();
          showOverlay();
        }
      }}
    >
      <Show when={overlay() && playingMedia()}>
        {(m) => (
          <>
            <div class="player-top">
              <div class="player-title">
                <div class="player-name">
                  <bdi>{m().title}</bdi>
                </div>
                <Show when={m().subtitle}>
                  <span class="player-subtitle">
                    <bdi>{m().subtitle}</bdi>
                  </span>
                </Show>
              </div>
              <div class="player-end">
                <span class="player-clock" dir="ltr">
                  {formatClock(clock())}
                </span>
              </div>
            </div>
            <div class="player-bottom">
              <div class="seek-panel" dir="ltr">
                <div class="seek-head">
                  <span>
                    <span class="seek-now">{formatDuration(shownTime())}</span>
                    <span class="seek-total">/ {playbackPosition().duration ? formatDuration(playbackPosition().duration) : '--:--'}</span>
                    <Show when={playbackPosition().duration}>
                      <span class="pill">{t('player.watchedPct', { n: formatNumber(Math.round(ratio() * 100)) })}</span>
                    </Show>
                  </span>
                  <Show when={playbackPosition().duration}>
                    <span class="seek-remaining">−{formatDuration(playbackPosition().duration - shownTime())}</span>
                  </Show>
                </div>
                <div class="seek-row">
                  <span
                    class="progress seek-bar"
                    classList={{ dragging: dragAt() !== null }}
                    ref={(el) => (bar = el)}
                    role="slider"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(playbackPosition().duration)}
                    aria-valuenow={Math.round(shownTime())}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      dragStart(e.clientX);
                    }}
                    onTouchStart={(e) => dragStart(e.touches[0].clientX)}
                    onTouchMove={(e) => {
                      e.preventDefault();
                      dragMove(e.touches[0].clientX);
                    }}
                    onTouchEnd={() => dragEnd()}
                    onTouchCancel={() => setDragAt(null)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span class="progress-fill" style={{ width: `${Math.round(ratio() * 1000) / 10}%` }}>
                      <span class="seek-handle" />
                    </span>
                  </span>
                </div>
              </div>
              <Show when={stats()}>
                <p class="player-stats" dir="ltr">
                  {statsText()}
                </p>
              </Show>
              <PlayerControls controls={controls} focused={control()} />
              <p class="player-hint">{t('player.mediaHint')}</p>
            </div>
          </>
        )}
      </Show>
      <Show when={playerState() === 'paused'}>
        <PausedPill />
      </Show>
      <Show when={sheet()}>
        <TrackSheet onClose={() => setSheet(false)} />
      </Show>
    </div>
  );
}

interface PlayerControl {
  label: () => string;
  icon: () => IconName;
  /** Shows the label beside the icon. */
  text?: boolean;
  wide?: boolean;
  run: () => void;
}

/**
 * While the remote is on a button: Left/Right move along the row, OK presses it, Up/Down leave it.
 * Back isn't handled here, so it always leaves the player.
 */
function moveInControls(key: Key, controls: PlayerControl[], control: () => number | null, setControl: (index: number | null) => void): boolean {
  const at = control();
  if (at === null) return false;
  switch (key) {
    case 'left':
      setControl(Math.max(0, at - 1));
      return true;
    case 'right':
      setControl(Math.min(controls.length - 1, at + 1));
      return true;
    case 'ok':
      controls[at].run();
      return true;
    case 'up':
    case 'down':
      setControl(null);
      return true;
    default:
      return false;
  }
}

/** The player's buttons, for touch and mouse and (through moveInControls) the remote. */
function PlayerControls(props: { controls: PlayerControl[]; focused: number | null }): JSX.Element {
  return (
    <div class="player-controls" dir="ltr">
      <For each={props.controls}>
        {(c, i) => (
          <div
            class="player-button"
            classList={{ wide: !!c.wide, 'is-focused': props.focused === i() }}
            role="button"
            title={c.label()}
            aria-label={c.label()}
            onClick={(e) => {
              e.stopPropagation();
              c.run();
            }}
          >
            <Icon name={c.icon()} />
            <Show when={c.text}>
              <span>{c.label()}</span>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

function PausedPill(): JSX.Element {
  return (
    <div class="player-paused">
      <Icon name="pause" />
      <div>
        <div class="player-paused-title">{t('player.paused')}</div>
        <div class="player-paused-sub">{t('player.pressOkResume')}</div>
      </div>
    </div>
  );
}

/** "Open in another player": only where the platform supports it (Android). */
function externalControl(platform: Platform): PlayerControl[] {
  if (!platform.openExternal) return [];
  return [{ label: () => t('player.external'), icon: () => 'forward', text: true, run: () => void openInExternalPlayer() }];
}
