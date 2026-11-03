import { log } from '@ultra/core';
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { ChannelLogo } from '../components/ChannelLogo';
import { Icon } from '../components/Icon';
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
  seekTo,
  togglePause,
  zap,
  zapTo,
} from '../data/playback';
import { formatDuration } from '../format';
import { formatNumber, t } from '../i18n';
import { useKeys } from '../keys';
import { goBack } from '../nav';

const OVERLAY_MS = 5000;
const ZAP_DELAY_MS = 1500;

const SEEK_SECONDS = 10;
const SKIP_SECONDS = 30;

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
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let zapTimer: ReturnType<typeof setTimeout> | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const channel = playingChannel;
  const nowNext = useNowNext(() => (channel()?.stream.t === 'x' ? channel()!.id : null), true);

  const showOverlay = () => {
    setOverlay(true);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => setOverlay(false), OVERLAY_MS);
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
      case 'right':
        return true; // just shows the overlay for live
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
              <div class="player-controls">
                <PlayerButton label={t('common.back')} onClick={() => goBack()}>
                  <Icon name="back" />
                </PlayerButton>
                <PlayerButton label={t('player.prevChannel')} onClick={() => void zap(-1)}>
                  <Icon name="up" />
                </PlayerButton>
                <PlayerButton label={t('player.nextChannel')} onClick={() => void zap(1)}>
                  <Icon name="down" />
                </PlayerButton>
                <PlayerButton label={t('player.channelList')} onClick={() => setMiniList(true)}>
                  <Icon name="list" />
                </PlayerButton>
                <PlayerButton label={t('player.audioSubs')} onClick={() => setSheet(true)}>
                  <Icon name="subtitles" />
                  <span>{t('player.audioSubs')}</span>
                </PlayerButton>
              </div>
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
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const showOverlay = () => {
    setOverlay(true);
    clearTimeout(hideTimer);
    // Paused media keeps the overlay up so the position stays visible.
    hideTimer = setTimeout(() => playerState() !== 'paused' && setOverlay(false), OVERLAY_MS);
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
      case 'up':
      case 'down':
        return true; // just shows the overlay
      case 'back':
      case 'stop':
        goBack();
        return true;
      default:
        return false;
    }
  });

  const ratio = () => {
    const p = playbackPosition();
    return p.duration ? Math.min(1, p.current / p.duration) : 0;
  };

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
                    <span class="seek-now">{formatDuration(playbackPosition().current)}</span>
                    <span class="seek-total">/ {playbackPosition().duration ? formatDuration(playbackPosition().duration) : '--:--'}</span>
                    <Show when={playbackPosition().duration}>
                      <span class="pill">{t('player.watchedPct', { n: formatNumber(Math.round(ratio() * 100)) })}</span>
                    </Show>
                  </span>
                  <Show when={playbackPosition().duration}>
                    <span class="seek-remaining">−{formatDuration(playbackPosition().duration - playbackPosition().current)}</span>
                  </Show>
                </div>
                <div class="seek-row">
                  <span
                    class="progress seek-bar"
                    role="slider"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(playbackPosition().duration)}
                    aria-valuenow={Math.round(playbackPosition().current)}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      const d = playbackPosition().duration;
                      if (d && r.width) seekTo(((e.clientX - r.left) / r.width) * d);
                    }}
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
              <div class="player-controls" dir="ltr">
                <PlayerButton label={t('common.back')} onClick={() => goBack()}>
                  <Icon name="back" />
                </PlayerButton>
                <PlayerButton label={t('player.back10')} onClick={() => seekBy(-SEEK_SECONDS)}>
                  <Icon name="replay10" />
                </PlayerButton>
                <PlayerButton label={playerState() === 'paused' ? t('player.play') : t('player.pause')} wide onClick={() => togglePause()}>
                  <Icon name={playerState() === 'paused' ? 'play' : 'pause'} />
                </PlayerButton>
                <PlayerButton label={t('player.forward10')} onClick={() => seekBy(SEEK_SECONDS)}>
                  <Icon name="forward10" />
                </PlayerButton>
                <PlayerButton label={t('player.audioSubs')} onClick={() => setSheet(true)}>
                  <Icon name="subtitles" />
                  <span>{t('player.audioSubs')}</span>
                </PlayerButton>
              </div>
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

/** Mouse/touch control in the player overlay. Remote keys never focus these; they act directly. */
function PlayerButton(props: { label: string; wide?: boolean; onClick: () => void; children: JSX.Element }): JSX.Element {
  return (
    <div
      class="player-button"
      classList={{ wide: !!props.wide }}
      role="button"
      title={props.label}
      aria-label={props.label}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
    >
      {props.children}
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
