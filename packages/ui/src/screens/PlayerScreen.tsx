import { log } from '@ultra/core';
import type { Key, Platform } from '@ultra/platform';
import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { ChannelLogo } from '../components/ChannelLogo';
import { Icon, type IconName } from '../components/Icon';
import { TrackSheet } from '../components/TrackSheet';
import { VirtualList } from '../components/VirtualList';
import { catalog } from '../data/catalog';
import { clock, formatClock, useNowNext } from '../data/epg';
import { isChannelLocked } from '../data/parental';
import {
  cancelNextEpisode,
  claimSurface,
  nextEpisode,
  nextEpisodeIn,
  playEpisode,
  previousEpisode,
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
import { seekSeconds, showPictureSkip } from '../data/settings';
import { formatDuration } from '../format';
import { formatNumber, t } from '../i18n';
import { useKeyBarrier, useKeys } from '../keys';
import { usePlatform } from '../platform-context';
import { goBack } from '../nav';

const OVERLAY_MS = 5000;
const ZAP_DELAY_MS = 1500;

const SKIP_SECONDS = 30;
/** Presses closer together than this count as holding the key. */
const SCRUB_HOLD_MS = 400;
const SCRUB_STEPS = [
  { after: 0, seconds: 10 },
  { after: 6, seconds: 30 },
  { after: 16, seconds: 60 },
  { after: 30, seconds: 300 },
];

/** Full screen: the live player, or the movie/episode/catch-up player. */
export function PlayerScreen(): JSX.Element {
  useKeyBarrier();
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
              <PlayerControls controls={controls} focused={control()} onUse={showOverlay} />
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
  const back: PlayerControl = { label: () => t('common.back'), icon: () => 'back', run: () => goBack() };
  const skipBack: PlayerControl = { label: () => t('player.backBy', { n: seekSeconds() }), icon: () => 'replay', seek: -1, run: () => seekBy(-seekSeconds()) };
  const playPause: PlayerControl = {
    label: () => (playerState() === 'paused' ? t('player.play') : t('player.pause')),
    icon: () => (playerState() === 'paused' ? 'play' : 'pause'),
    wide: true,
    run: () => togglePause(),
  };
  const skipForward: PlayerControl = { label: () => t('player.forwardBy', { n: seekSeconds() }), icon: () => 'replay', seek: 1, run: () => seekBy(seekSeconds()) };
  // Always there for an episode, and dimmed at either end, so the row doesn't shift under the remote.
  const prevEp: PlayerControl = { label: () => t('player.prevEpisode'), icon: () => 'skipPrevious', disabled: () => !previousEpisode(), run: () => void playEpisode(-1) };
  const nextEp: PlayerControl = { label: () => t('player.nextEpisode'), icon: () => 'skipNext', disabled: () => !nextEpisode(), run: () => void playEpisode(1) };
  const audioSubs: PlayerControl = { label: () => t('player.audioSubs'), icon: () => 'subtitles', text: true, run: () => setSheet(true) };
  const external = externalControl(platform);
  const isEpisode = () => playingMedia()?.kind === 'episode';
  const controls = createMemo<PlayerControl[]>(() =>
    isEpisode()
      ? [back, prevEp, skipBack, playPause, skipForward, nextEp, audioSubs, ...external]
      : [back, skipBack, playPause, skipForward, audioSubs, ...external],
  );
  /** Which button of the next-episode card the remote is on: 0 plays now, 1 cancels. */
  const [nextChoice, setNextChoice] = createSignal(0);
  const counting = () => nextEpisodeIn() !== null;
  const playNextNow = () => {
    setNextChoice(0);
    void playEpisode(1);
  };
  const cancelNext = () => {
    setNextChoice(0);
    cancelNextEpisode();
  };
  /** Index of the button the remote is on; null means Left/Right seek and OK pauses. */
  const [control, setControl] = createSignal<number | null>(null);
  /** The remote is on the timeline's dot: Left/Right pick a time and OK jumps there. */
  const [onTimeline, setOnTimeline] = createSignal(false);
  /** Position under the finger, mouse or remote while choosing a time (seconds), else null. */
  const [dragAt, setDragAt] = createSignal<number | null>(null);
  let lastScrubAt = 0;
  let scrubRun = 0;

  /** Single presses move 10 s for precision; holding the key speeds up to minutes at a time. */
  const scrub = (direction: number) => {
    const { current, duration } = playbackPosition();
    if (!duration) return;
    const time = Date.now();
    scrubRun = time - lastScrubAt < SCRUB_HOLD_MS ? scrubRun + 1 : 0;
    lastScrubAt = time;
    const step = Math.max(seekSeconds(), SCRUB_STEPS.filter((s) => scrubRun >= s.after).pop()!.seconds);
    setDragAt(Math.max(0, Math.min(duration, (dragAt() ?? current) + direction * step)));
  };
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const showOverlay = () => {
    setOverlay(true);
    clearTimeout(hideTimer);
    // Paused media keeps the overlay up so the position stays visible.
    hideTimer = setTimeout(() => {
      // Paused, or choosing a time: the position has to stay visible.
      if (playerState() === 'paused' || dragAt() !== null) return;
      setOverlay(false);
      setControl(null);
      setOnTimeline(false);
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
    if (counting()) {
      switch (press.key) {
        case 'left':
        case 'right':
          setNextChoice((c) => 1 - c);
          return true;
        case 'ok':
          if (nextChoice() === 0) playNextNow();
          else cancelNext();
          return true;
        case 'back':
        case 'stop':
          goBack();
          return true;
        default:
          return true; // nothing to seek or pause: the episode has ended
      }
    }
    if (control() !== null && press.key === 'up') {
      setControl(null);
      setOnTimeline(true);
      return true;
    }
    if (moveInControls(press.key, controls(), control, setControl)) return true;
    if (onTimeline() && playbackPosition().duration) {
      const at = dragAt();
      switch (press.key) {
        case 'left':
          scrub(-1);
          return true;
        case 'right':
          scrub(1);
          return true;
        case 'ok':
          if (at === null) break; // nothing chosen yet: OK pauses as usual
          setDragAt(null);
          seekTo(at);
          return true;
        case 'up':
          setDragAt(null);
          setOnTimeline(false);
          return true;
        case 'down':
          setDragAt(null);
          setOnTimeline(false);
          setControl(controls().indexOf(playPause));
          return true;
        case 'back':
          if (at === null) break;
          setDragAt(null); // back to where it's playing, still on the timeline
          return true;
        default:
          break;
      }
    }
    const status = playbackStatus()?.kind;
    switch (press.key) {
      case 'left':
        seekBy(-seekSeconds());
        return true;
      case 'right':
        seekBy(seekSeconds());
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
        setControl(controls().indexOf(playPause));
        return true;
      case 'chUp':
        if (!isEpisode()) return false;
        void playEpisode(1);
        return true;
      case 'chDown':
        if (!isEpisode()) return false;
        void playEpisode(-1);
        return true;
      case 'up':
        if (playbackPosition().duration) setOnTimeline(true);
        return true;
      case 'back':
      case 'stop':
        goBack();
        return true;
      default:
        return false;
    }
  });

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
        if (e.target === e.currentTarget && !counting()) {
          togglePause();
          showOverlay();
        }
      }}
    >
      <Show when={overlay() && !counting() && playingMedia()}>
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
            <Show when={playbackPosition().duration && showPictureSkip()}>
              <PictureSkipButtons back={skipBack} forward={skipForward} onUse={showOverlay} />
            </Show>
            <div class="player-bottom">
              <div class="seek-panel" classList={{ 'is-focused': onTimeline() }} dir="ltr">
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
                    classList={{ dragging: dragAt() !== null, 'is-focused': onTimeline() }}
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
              <PlayerControls controls={controls()} focused={control()} onUse={showOverlay} />
              <p class="player-hint">
                {t('player.mediaHint', { n: seekSeconds() })}
                {isEpisode() ? ` · ${t('player.episodeHint')}` : ''}
              </p>
            </div>
          </>
        )}
      </Show>
      <Show when={playerState() === 'paused'}>
        <PausedPill />
      </Show>
      <Show when={counting()}>
        <div class="next-card" role="status">
          <div class="next-card-title">{t('player.nextIn', { n: formatNumber(nextEpisodeIn() ?? 0) })}</div>
          <Show when={nextEpisode()?.subtitle}>
            {(subtitle) => (
              <div class="next-card-name">
                <bdi>{subtitle()}</bdi>
              </div>
            )}
          </Show>
          <div class="next-card-buttons" dir="ltr">
            <div
              class="player-button"
              classList={{ 'is-focused': nextChoice() === 0 }}
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                playNextNow();
              }}
            >
              <Icon name="skipNext" />
              <span>{t('player.playNow')}</span>
            </div>
            <div
              class="player-button"
              classList={{ 'is-focused': nextChoice() === 1 }}
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                cancelNext();
              }}
            >
              <span>{t('player.cancelNext')}</span>
            </div>
          </div>
        </div>
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
  /** A skip button: the icon points this way, with the number of seconds in it. */
  seek?: -1 | 1;
  wide?: boolean;
  /** Dimmed: the remote steps over it, and pressing it does nothing. */
  disabled?: () => boolean;
  run: () => void;
}

/**
 * While the remote is on a button: Left/Right move along the row, OK presses it, Up/Down leave it.
 * Back isn't handled here, so it always leaves the player.
 */
function moveInControls(key: Key, controls: PlayerControl[], control: () => number | null, setControl: (index: number | null) => void): boolean {
  const at = control();
  if (at === null) return false;
  const step = (direction: number) => {
    let i = at + direction;
    while (controls[i]?.disabled?.()) i += direction;
    return controls[i] ? i : at;
  };
  switch (key) {
    case 'left':
      setControl(step(-1));
      return true;
    case 'right':
      setControl(step(1));
      return true;
    case 'ok':
      if (!controls[at].disabled?.()) controls[at].run();
      return true;
    case 'up':
    case 'down':
      setControl(null);
      return true;
    default:
      return false;
  }
}

/** A circular arrow with the seconds inside, which is set in Settings. */
function SeekIcon(props: { direction: -1 | 1 }): JSX.Element {
  return (
    <span class="seek-icon" classList={{ forward: props.direction > 0 }}>
      <Icon name="replay" />
      <span class="seek-icon-number" dir="ltr">
        {seekSeconds()}
      </span>
    </span>
  );
}

/** Big skip buttons on the picture, for touch and mouse; the remote uses Left and Right. */
function PictureSkipButtons(props: { back: PlayerControl; forward: PlayerControl; onUse: () => void }): JSX.Element {
  return (
    <For each={[props.back, props.forward]}>
      {(c) => (
        <div
          class="picture-skip"
          classList={{ forward: c.seek === 1 }}
          role="button"
          title={c.label()}
          aria-label={c.label()}
          onClick={(e) => {
            e.stopPropagation();
            props.onUse();
            c.run();
          }}
        >
          <SeekIcon direction={c.seek!} />
        </div>
      )}
    </For>
  );
}

/** The player's buttons, for touch and mouse and (through moveInControls) the remote. */
function PlayerControls(props: { controls: PlayerControl[]; focused: number | null; onUse: () => void }): JSX.Element {
  return (
    <div class="player-controls" dir="ltr">
      <For each={props.controls}>
        {(c, i) => (
          <div
            class="player-button"
            classList={{ wide: !!c.wide, 'is-focused': props.focused === i(), 'is-disabled': !!c.disabled?.() }}
            role="button"
            title={c.label()}
            aria-label={c.label()}
            aria-disabled={c.disabled?.() ? 'true' : undefined}
            onClick={(e) => {
              e.stopPropagation();
              props.onUse();
              if (!c.disabled?.()) c.run();
            }}
          >
            <Show when={c.seek} fallback={<Icon name={c.icon()} />}>
              <SeekIcon direction={c.seek!} />
            </Show>
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
  const own: PlayerControl[] = [];
  if (platform.openExternal) own.push({ label: () => t('player.external'), icon: () => 'forward', text: true, run: () => void openInExternalPlayer() });
  return own.concat(fullscreenControl(platform));
}

const [windowFull, setWindowFull] = createSignal(false);

/** The app window filling the screen, where it's a window (the Mac). F11 does the same. */
function fullscreenControl(platform: Platform): PlayerControl[] {
  const win = platform.windowFullscreen;
  if (!win) return [];
  void win.get().then(setWindowFull, () => undefined);
  return [
    {
      label: () => (windowFull() ? t('player.exitFullscreen') : t('player.fullscreen')),
      icon: () => (windowFull() ? 'fullscreenExit' : 'fullscreen'),
      run: () => {
        const next = !windowFull();
        setWindowFull(next);
        void win.set(next);
      },
    },
  ];
}
