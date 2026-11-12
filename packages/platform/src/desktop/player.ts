import { CANNOT_CONNECT } from '../errors';
import { createHoleFrame, placeBox, VIDEO_BEHIND_CLASS, VIDEO_HOLE_CLASS } from '../surface';
import type { LoadOptions, PlayerAdapter, PlayerEvents, PlayerState, PlayerStats, PlayerTracks, StreamSource, Track, VideoRect } from '../types';
import type { MpvEvent, MpvTrack } from './plugin';

/** What the player needs from the native side; the real one is `native.mpv`, tests pass a fake. */
export interface MpvBridge {
  events(onEvent: (e: MpvEvent) => void): Promise<void>;
  load(o: { url: string; startAt?: number; buffer: string; userAgent?: string; referrer?: string }): Promise<void>;
  pause(paused: boolean): Promise<void>;
  stop(): Promise<void>;
  seek(seconds: number): Promise<void>;
  select(kind: 'audio' | 'text', id: string | null): Promise<void>;
  setRect(mode: 'hidden' | 'behind' | 'box', x?: number, y?: number, w?: number, h?: number): Promise<void>;
  /** Keeps the display awake while something plays. */
  keepAwake?(on: boolean): Promise<void>;
}

// mpv's end-file reasons.
const END_EOF = 0;
const END_ERROR = 4;

/**
 * mpv on the Mac (spec §4.2): plays TS, HLS and files natively (MKV, AC-3/E-AC-3/DTS, HEVC), so
 * there is no CORS or codec limit. Drawn by a native view under the page, like ExoPlayer on Android:
 * the page turns transparent for full screen and keeps a hole for the Live preview.
 */
export class MpvPlayer implements PlayerAdapter {
  readonly engine = 'mpv';
  private readonly listeners = new Map<keyof PlayerEvents, Set<(data: unknown) => void>>();
  private trackCache: PlayerTracks = { audio: [], text: [] };
  private pos = { current: 0, duration: 0 };
  private statsCache: PlayerStats = { engine: 'mpv' };
  private holeEl: HTMLElement | null = null;
  private live = false;
  private started = false;
  private paused = false;
  private waiting = false;
  private active = false;
  private progressAt: number | undefined;
  private lastTime = -1;
  private hw = '';
  private awake = false;
  private readonly drops: Record<string, number> = { 'frame-drop-count': 0, 'decoder-frame-drop-count': 0 };

  constructor(private readonly mpv: MpvBridge) {
    void mpv.events((e) => this.onEvent(e));
  }

  attach(): void {
    // The native view lives beside the page; nothing to attach in it.
  }

  setRect(rect: VideoRect): void {
    const root = document.documentElement.classList;
    root.toggle(VIDEO_BEHIND_CLASS, rect === 'fullscreen');
    root.toggle(VIDEO_HOLE_CLASS, !!rect && rect !== 'fullscreen');
    if (!this.holeEl) this.holeEl = createHoleFrame();
    this.holeEl.style.display = rect && rect !== 'fullscreen' ? '' : 'none';
    if (rect && rect !== 'fullscreen') placeBox(this.holeEl, rect);
    if (!rect) void this.mpv.setRect('hidden');
    else if (rect === 'fullscreen') void this.mpv.setRect('behind');
    else void this.mpv.setRect('box', rect.left, rect.top, rect.width, rect.height);
  }

  async load(source: StreamSource, options: LoadOptions): Promise<void> {
    this.live = source.live;
    this.started = false;
    this.paused = false;
    this.waiting = false;
    this.active = true;
    this.lastTime = -1;
    this.progressAt = undefined;
    this.trackCache = { audio: [], text: [] };
    this.pos = { current: options.startAt ?? 0, duration: 0 };
    this.emit('state', 'loading');
    await this.mpv.load({
      url: source.url,
      startAt: options.startAt,
      buffer: options.buffer,
      userAgent: source.headers?.userAgent,
      referrer: source.headers?.referrer,
    });
  }

  play(): void {
    this.paused = false;
    void this.mpv.pause(false);
  }

  pause(): void {
    this.paused = true;
    void this.mpv.pause(true);
    if (this.started) this.emit('state', 'paused');
  }

  stop(): void {
    this.active = false;
    void this.mpv.stop();
    this.trackCache = { audio: [], text: [] };
    this.pos = { current: 0, duration: 0 };
    this.emit('state', 'idle');
  }

  seek(seconds: number): void {
    this.pos = { current: seconds, duration: this.pos.duration };
    void this.mpv.seek(seconds);
  }

  position(): { current: number; duration: number } {
    return this.pos;
  }

  lastProgressAt(): number | undefined {
    return this.progressAt;
  }

  tracks(): PlayerTracks {
    return this.trackCache;
  }

  selectAudio(id: string): void {
    void this.mpv.select('audio', id);
  }

  selectText(id: string | null): void {
    void this.mpv.select('text', id);
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
    if (event === 'state') {
      const awake = data === 'playing' || data === 'buffering' || data === 'loading';
      if (awake !== this.awake) {
        this.awake = awake;
        void this.mpv.keepAwake?.(awake);
      }
    }
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }

  private state(): PlayerState {
    if (!this.started) return 'loading';
    if (this.paused) return 'paused';
    return this.waiting ? 'buffering' : 'playing';
  }

  private onEvent(e: MpvEvent): void {
    if (!this.active) return;
    if (e.t === 'restart') {
      // After the first frame, a restart ends a seek or a cache refill.
      if (!this.started) {
        this.started = true;
        this.emit('firstFrame', undefined);
      }
      this.waiting = false;
      this.emit('state', this.state());
      return;
    }
    if (e.t === 'end') return this.onEnd(e);
    if (e.t !== 'prop') return;
    const v = e.value;
    switch (e.name) {
      case 'time-pos':
        if (typeof v === 'number') {
          if (v !== this.lastTime) this.progressAt = Date.now();
          this.lastTime = v;
          this.pos = { current: v, duration: this.pos.duration };
        }
        break;
      case 'duration':
        this.pos = { current: this.pos.current, duration: this.live || typeof v !== 'number' ? 0 : v };
        break;
      case 'pause':
        this.paused = v === true;
        if (this.started) this.emit('state', this.state());
        break;
      case 'paused-for-cache':
      case 'seeking':
        if (!this.started) break;
        this.waiting = v === true;
        this.emit('state', this.state());
        break;
      case 'track-list':
        this.trackCache = toTracks(Array.isArray(v) ? (v as MpvTrack[]) : []);
        this.emit('tracks', this.trackCache);
        break;
      case 'hwdec-current':
        this.hw = typeof v === 'string' && v !== 'no' ? v : '';
        this.statsCache = { ...this.statsCache, engine: this.hw ? `mpv · ${this.hw}` : 'mpv' };
        break;
      case 'video-params/w':
        this.statsCache = { ...this.statsCache, width: typeof v === 'number' ? v : undefined };
        break;
      case 'video-params/h':
        this.statsCache = { ...this.statsCache, height: typeof v === 'number' ? v : undefined };
        break;
      case 'video-bitrate':
        this.statsCache = { ...this.statsCache, bitrateKbps: typeof v === 'number' ? Math.round(v / 1000) : undefined };
        break;
      case 'demuxer-cache-duration':
        this.statsCache = { ...this.statsCache, bufferSec: typeof v === 'number' ? v : undefined };
        break;
      case 'frame-drop-count':
      case 'decoder-frame-drop-count':
        this.drops[e.name] = typeof v === 'number' ? v : 0;
        this.statsCache = { ...this.statsCache, droppedFrames: this.drops['frame-drop-count'] + this.drops['decoder-frame-drop-count'] };
        break;
    }
  }


  private onEnd(e: Extract<MpvEvent, { t: 'end' }>): void {
    if (e.reason === END_EOF) {
      // A live stream that "ends" has dropped: report it so the app reconnects.
      if (this.live) this.emit('error', { kind: 'network', fatal: true, message: 'stream ended' });
      else this.emit('state', 'ended');
      return;
    }
    // Stopped, replaced by the next channel, or redirected: nothing to report.
    if (e.reason !== END_ERROR) return;
    if (e.httpStatus) {
      this.emit('error', { kind: 'network', fatal: true, message: `HTTP ${e.httpStatus}`, httpStatus: e.httpStatus });
    } else if (e.cannotConnect) {
      this.emit('error', { kind: 'network', fatal: true, message: CANNOT_CONNECT });
    } else if (/unrecognized|unknown format|no video or audio|nothing to play/i.test(e.error)) {
      this.emit('error', { kind: 'unsupported', fatal: true, message: 'unsupported format' });
    } else {
      this.emit('error', { kind: 'network', fatal: true, message: e.error || 'loading failed' });
    }
  }
}

const upper = (s?: string | null) => (s ? s.toUpperCase() : '');

/** mpv's track list as the app's tracks, labelled like the TV and Android ones. */
export function toTracks(list: MpvTrack[]): PlayerTracks {
  const audio: Track[] = [];
  const text: Track[] = [];
  for (const t of list) {
    const into = t.type === 'audio' ? audio : t.type === 'sub' ? text : null;
    if (!into) continue;
    const base = t.title || upper(t.lang) || (t.type === 'audio' ? `Audio ${into.length + 1}` : `Subtitles ${into.length + 1}`);
    const codec = (t.codec || '').toUpperCase();
    // A title that already names the codec ("AC-3 5.1") gets nothing added.
    const named = !!codec && base.toUpperCase().replace(/[^A-Z0-9]/g, '').indexOf(codec.replace(/[^A-Z0-9]/g, '')) >= 0;
    const layout = t.channels && t.channels > 2 ? ` ${t.channels === 6 ? '5.1' : t.channels === 8 ? '7.1' : `${t.channels}ch`}` : '';
    const extra = t.type === 'audio' && codec && !named ? ` (${codec}${layout})` : '';
    into.push({ id: String(t.id), label: base + extra, lang: t.lang ?? undefined, selected: !!t.selected });
  }
  return { audio, text };
}
