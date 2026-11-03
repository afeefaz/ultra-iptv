import type {
  LoadOptions,
  PlayerAdapter,
  PlayerError,
  PlayerEvents,
  PlayerState,
  PlayerStats,
  PlayerTracks,
  StreamSource,
  VideoRect,
} from '../types';
import { UltraPlayer } from './plugin';

/** Class on <html> while video plays full screen under the page (the page must be transparent). */
export const VIDEO_BEHIND_CLASS = 'video-behind';

const STATES: PlayerState[] = ['idle', 'loading', 'playing', 'paused', 'buffering', 'ended', 'error'];

/**
 * Media3 ExoPlayer through the UltraPlayer Capacitor plugin (spec §4.2). Plays TS, HLS and files
 * natively, so there is no CORS or forced-HTTPS problem. Position, tracks and stats arrive as
 * events and are cached, because the adapter interface is synchronous.
 */
export class NativePlayer implements PlayerAdapter {
  readonly engine = 'exoplayer';
  private readonly listeners = new Map<keyof PlayerEvents, Set<(data: unknown) => void>>();
  private trackCache: PlayerTracks = { audio: [], text: [] };
  private pos = { current: 0, duration: 0 };
  private statsCache: PlayerStats = { engine: 'exoplayer' };

  constructor() {
    void UltraPlayer.addListener('state', (e) => {
      const state = STATES.indexOf(e.state as PlayerState) >= 0 ? (e.state as PlayerState) : 'idle';
      this.emit('state', state);
    });
    void UltraPlayer.addListener('error', (e) =>
      this.emit('error', { kind: e.kind as PlayerError['kind'], fatal: e.fatal, message: e.message, httpStatus: e.httpStatus }),
    );
    void UltraPlayer.addListener('tracks', (e) => {
      this.trackCache = { audio: e.audio, text: e.text };
      this.emit('tracks', this.trackCache);
    });
    void UltraPlayer.addListener('firstFrame', () => this.emit('firstFrame', undefined));
    void UltraPlayer.addListener('progress', (e) => {
      this.pos = { current: e.current, duration: e.duration };
      this.statsCache = {
        engine: 'exoplayer',
        width: e.width,
        height: e.height,
        bitrateKbps: e.bitrateKbps,
        bufferSec: e.bufferSec,
        droppedFrames: e.droppedFrames,
      };
    });
  }

  attach(): void {
    // The native view lives beside the WebView; nothing to attach in the page.
  }

  setRect(rect: VideoRect): void {
    const root = document.documentElement;
    if (rect === 'fullscreen') root.classList.add(VIDEO_BEHIND_CLASS);
    else root.classList.remove(VIDEO_BEHIND_CLASS);
    if (!rect) void UltraPlayer.setRect({ mode: 'hidden' });
    else if (rect === 'fullscreen') void UltraPlayer.setRect({ mode: 'behind' });
    else void UltraPlayer.setRect({ mode: 'overlay', left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }

  async load(source: StreamSource, options: LoadOptions): Promise<void> {
    this.trackCache = { audio: [], text: [] };
    this.pos = { current: options.startAt ?? 0, duration: 0 };
    this.emit('state', 'loading');
    await UltraPlayer.load({
      url: source.url,
      container: source.container,
      live: source.live,
      startAt: options.startAt,
      buffer: options.buffer,
      userAgent: source.headers?.userAgent,
      referrer: source.headers?.referrer,
    });
  }

  play(): void {
    void UltraPlayer.play();
  }

  pause(): void {
    void UltraPlayer.pause();
  }

  stop(): void {
    void UltraPlayer.stop();
    this.trackCache = { audio: [], text: [] };
    this.pos = { current: 0, duration: 0 };
    this.emit('state', 'idle');
  }

  seek(seconds: number): void {
    this.pos = { current: seconds, duration: this.pos.duration };
    void UltraPlayer.seek({ seconds });
  }

  position(): { current: number; duration: number } {
    return this.pos;
  }

  tracks(): PlayerTracks {
    return this.trackCache;
  }

  selectAudio(id: string): void {
    void UltraPlayer.selectAudio({ id });
  }

  selectText(id: string | null): void {
    void UltraPlayer.selectText({ id });
  }

  stats(): PlayerStats {
    return this.statsCache;
  }

  on<E extends keyof PlayerEvents>(event: E, fn: (data: PlayerEvents[E]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    const listener = fn as (data: unknown) => void;
    set.add(listener);
    return () => set.delete(listener);
  }

  private emit<E extends keyof PlayerEvents>(event: E, data: PlayerEvents[E]): void {
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }
}
