import { createMemo, onMount, Show, type JSX } from 'solid-js';
import { initPlayback, playbackStatus, playerState, playingChannel, playingMedia, videoRect } from '../data/playback';
import { subtitleSize } from '../data/settings';
import { formatNumber, t } from '../i18n';
import { usePlatform } from '../platform-context';

/**
 * The app's single video surface (spec §4.2), positioned over the Live preview box or the
 * whole screen. On TVs the native player draws below the page instead; the adapter hides that.
 */
export function VideoLayer(): JSX.Element {
  const platform = usePlatform();
  let layer: HTMLDivElement | undefined;
  onMount(() => layer && initPlayback(platform, layer));

  const message = createMemo(() => {
    if (!playingChannel() && !playingMedia()) return '';
    const s = playbackStatus();
    if (s?.kind === 'reconnecting') return t('player.reconnecting', { n: formatNumber(s.attempt) });
    if (s?.kind === 'offline') return t('player.offline');
    if (s?.kind === 'failed') return (playingMedia() ? t('player.mediaFailed') : t('player.failed')) + failureReason(s.message);
    if (s?.kind === 'ended') return t('player.ended');
    if (s?.kind === 'needs-gesture') return t('player.pressOk');
    const st = playerState();
    if (st === 'loading' || st === 'buffering') return t('player.loading');
    // Full screen draws its own pause icon.
    if (st === 'paused') return videoRect() === 'fullscreen' ? '' : t('player.paused');
    return '';
  });

  const box = createMemo((): JSX.CSSProperties | null => {
    const r = videoRect();
    if (!r) return null;
    if (r === 'fullscreen') return { left: '0', top: '0', width: '100%', height: '100%' };
    return { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` };
  });

  return (
    <>
      <div class={`video-layer subs-${subtitleSize()}`} ref={(el) => (layer = el)} />
      <Show when={box() && message()}>
        <div class="video-status" style={box()!} role="status" aria-live="polite">
          <span class="video-status-text" classList={{ 'is-busy': playerState() === 'loading' || playerState() === 'buffering' }}>
            {message()}
          </span>
        </div>
      </Show>
    </>
  );
}

/** Why it failed, in words a viewer can act on (spec §4.5). */
function failureReason(message: string): string {
  if (message === 'blocked') return '\n' + t('player.reasonBlocked');
  if (message === 'connect') return '\n' + t('player.reasonConnect');
  const status = /HTTP (\d{3})/.exec(message);
  if (status && (status[1] === '401' || status[1] === '403')) return '\n' + t('player.reasonDenied');
  if (status && status[1] === '404') return '\n' + t('player.reasonMissing');
  if (/unsupported|not supported|SRC_NOT_SUPPORTED|DEMUXER/i.test(message)) return '\n' + t('player.reasonFormat');
  return message && message !== 'reconnect' ? `\n(${message})` : '';
}
