import { log, RELAY_URL } from '@ultra/core';
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { t } from '../i18n';
import { useKeyBarrier, useKeys } from '../keys';
import { Icon } from './Icon';

/** YouTube's player states (its iframe API): 1 playing, 2 paused, 0 ended. */
const PLAYING = 1;
const SKIP_SECONDS = 10;
const FAST_SKIP_SECONDS = 30;

/**
 * Where the YouTube player is loaded from: a page on our website (apps/relay/page/public/trailer.html),
 * because YouTube won't play inside the apps' own pages (error 153). A local copy can stand in while
 * testing, never another site.
 */
function trailerPage(): string {
  try {
    const local = localStorage.getItem('ultra.trailerPage');
    if (local && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(local)) return local;
  } catch {
    // no storage: the website's page
  }
  return `${RELAY_URL}/trailer.html`;
}

/**
 * A movie's or series' trailer from YouTube, in a large popup over the page (so it's clear the app
 * is still there). Contacted only when someone presses Trailer. The remote stays with the app: OK
 * pauses, Left/Right jump, Back closes; the player is told through its iframe API.
 */
export function TrailerDialog(props: {
  /** The provider's trailer, if it sent one. */
  providerId: string | null;
  /** YouTube's first result for the title, year and kind (when there's none, or it won't play). */
  search: () => Promise<string | null>;
  title: string;
  onClose: () => void;
}): JSX.Element {
  useKeyBarrier();
  const [videoId, setVideoId] = createSignal<string | null>(props.providerId);
  const [state, setState] = createSignal<number | null>(null);
  const [failed, setFailed] = createSignal(false);
  const [finding, setFinding] = createSignal(false);
  let searched = false;
  let frame: HTMLIFrameElement | undefined;
  let time = 0;

  const find = async () => {
    searched = true;
    setFinding(true);
    const tried = videoId();
    const id = await props.search().catch((e) => {
      log.warn('trailer', 'search failed', { error: e instanceof Error ? e.message : String(e) });
      return null;
    });
    setFinding(false);
    if (id && id !== tried) {
      setState(null);
      setFailed(false);
      setVideoId(id);
    } else {
      setFailed(true);
    }
  };

  const command = (func: string, args: unknown[] = []) => {
    frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' }), '*');
  };
  const seek = (by: number) => {
    time = Math.max(0, time + by);
    command('seekTo', [time, true]);
  };

  const onMessage = (e: MessageEvent) => {
    if (!frame || e.source !== frame.contentWindow) return;
    let data: { event?: string; info?: unknown } | null;
    try {
      data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (!data) return;
    if (data.event === 'onError') {
      log.warn('trailer', 'not playable', { code: data.info, fromProvider: !searched });
      // The provider's trailer was removed or can't be embedded: look for another.
      if (!searched) void find();
      else setFailed(true);
    } else if (data.event === 'onReady') {
      setState(-1);
    } else if (data.event === 'infoDelivery' && data.info && typeof data.info === 'object') {
      const info = data.info as { playerState?: number; currentTime?: number };
      if (typeof info.playerState === 'number') setState(info.playerState);
      if (typeof info.currentTime === 'number') time = info.currentTime;
    }
  };

  // Clicking YouTube's own controls moves the keyboard into its frame, where Back wouldn't reach
  // the app: the focus comes straight back (the click itself still lands).
  const onBlur = () => setTimeout(() => window.focus(), 0);

  onMount(() => {
    window.addEventListener('message', onMessage);
    window.addEventListener('blur', onBlur);
    log.info('trailer', 'open', { fromProvider: !!props.providerId });
    if (!props.providerId) void find();
  });
  onCleanup(() => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('blur', onBlur);
  });

  useKeys((press) => {
    switch (press.key) {
      case 'back':
      case 'stop':
        props.onClose();
        return true;
      case 'ok':
      case 'playPause':
      case 'play':
      case 'pause':
        command(state() === PLAYING ? 'pauseVideo' : 'playVideo');
        return true;
      case 'left':
        seek(-SKIP_SECONDS);
        return true;
      case 'right':
        seek(SKIP_SECONDS);
        return true;
      case 'rew':
        seek(-FAST_SKIP_SECONDS);
        return true;
      case 'ff':
        seek(FAST_SKIP_SECONDS);
        return true;
      default:
        return true; // nothing behind the popup moves while it's open
    }
  });

  return (
    <div class="dialog-backdrop trailer-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="trailer-dialog" role="dialog" aria-modal="true" aria-label={t('trailer.title', { name: props.title })}>
        <div class="trailer-head">
          <span class="trailer-title">
            <bdi>{props.title}</bdi>
          </span>
          <span class="trailer-hint">{t('trailer.hint')}</span>
          <div class="icon-button trailer-close" role="button" aria-label={t('common.close')} title={t('common.close')} onClick={() => props.onClose()}>
            <Icon name="close" />
          </div>
        </div>
        <div class="trailer-frame">
          <Show
            when={!failed()}
            fallback={
              <div class="trailer-message" role="status">
                {t('trailer.unavailable')}
              </div>
            }
          >
            <Show when={!finding() && videoId()} keyed>
              {(id) => (
                <iframe
                  ref={(el) => (frame = el)}
                  src={`${trailerPage()}#v=${id}`}
                  allow="autoplay; encrypted-media; fullscreen"
                  tabIndex={-1}
                  title={t('trailer.title', { name: props.title })}
                />
              )}
            </Show>
            <Show when={finding() || state() === null}>
              <div class="trailer-message">{t(finding() ? 'trailer.finding' : 'trailer.loading')}</div>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}
