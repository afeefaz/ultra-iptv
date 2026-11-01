import type Hls from 'hls.js';
import { CANNOT_CONNECT } from '../errors';
import type { ErrorData, HlsConfig } from 'hls.js';
import type Mpegts from 'mpegts.js';
import type {
  BufferProfile,
  LoadOptions,
  PlayerAdapter,
  PlayerError,
  PlayerEvents,
  PlayerStats,
  PlayerTracks,
  StreamSource,
  VideoRect,
} from '../types';

type HlsModule = typeof import('hls.js');
type MpegtsModule = typeof import('mpegts.js');

// Engines are loaded on first use, so screens without playback never download them.
let hlsModule: Promise<HlsModule> | null = null;
let mpegtsModule: Promise<MpegtsModule> | null = null;
const loadHls = () => (hlsModule ??= import('hls.js'));
const loadMpegts = () => (mpegtsModule ??= import('mpegts.js'));

const HLS_BUFFER: Record<BufferProfile, Partial<HlsConfig>> = {
  low: { liveSyncDurationCount: 2, maxBufferLength: 10, backBufferLength: 10 },
  balanced: { liveSyncDurationCount: 3, maxBufferLength: 30, backBufferLength: 30 },
  stable: { liveSyncDurationCount: 5, maxBufferLength: 60, backBufferLength: 30 },
};

/**
 * Browser player (spec §4.2): one <video> element for the whole app. HLS goes through hls.js
 * (one instance reused across channels), raw MPEG-TS through mpegts.js, files natively.
 * Neither library may print to the console: URLs must only reach logs through the redactor.
 */
export class WebPlayer implements PlayerAdapter {
  readonly engine = 'web';
  private readonly video: HTMLVideoElement;
  private hls: Hls | null = null;
  private ts: Mpegts.Player | null = null;
  private container: StreamSource['container'] | null = null;
  private loadToken = 0;
  private sawFirstFrame = false;
  private recoveredMedia = false;
  /** hls.js still reports the previous channel's tracks until the new manifest is parsed. */
  private manifestReady = false;
  private readonly listeners = new Map<keyof PlayerEvents, Set<(data: unknown) => void>>();
  /** Chrome 142+ plays HLS itself; its <video> isn't subject to the CORS rules hls.js needs. */
  private readonly nativeHls: boolean;
  /** Origins whose streams hls.js can't read; they go straight to native HLS from then on. */
  private readonly nativeOrigins = new Set<string>();
  private source: StreamSource | null = null;
  private startAt: number | undefined;

  constructor() {
    const v = document.createElement('video');
    v.className = 'video-surface';
    v.playsInline = true;
    v.autoplay = true;
    v.preload = 'auto';
    v.setAttribute('playsinline', '');
    this.video = v;
    this.nativeHls = !!v.canPlayType('application/vnd.apple.mpegurl');
    this.setRect(null);
    v.addEventListener('playing', () => {
      this.emit('state', 'playing');
      if (!this.sawFirstFrame) {
        this.sawFirstFrame = true;
        this.emit('firstFrame', undefined);
      }
    });
    v.addEventListener('waiting', () => this.emit('state', 'buffering'));
    v.addEventListener('pause', () => {
      if (!v.ended && this.container) this.emit('state', 'paused');
    });
    v.addEventListener('ended', () => this.emit('state', 'ended'));
    v.addEventListener('error', () => {
      // hls.js/mpegts.js report their own errors; this is for native playback.
      if (this.hls || this.ts || !this.container) return;
      const err = v.error;
      const message = err?.message || 'Playback error';
      const failure: PlayerError = { kind: err && err.code === 4 ? 'unsupported' : 'media', fatal: true, message };
      // Before anything loaded, Chrome reports "format error" even when it never reached the
      // server (refused connection, forced HTTPS). Ask the network which one it was.
      const source = this.source;
      if (!source || this.sawFirstFrame || v.readyState > 0) return this.fail(failure);
      const token = this.loadToken;
      void reachable(source.url).then((ok) => {
        if (token !== this.loadToken) return;
        this.fail(ok ? failure : { kind: 'network', fatal: true, message: CANNOT_CONNECT, blocked: true });
      });
    });
    v.addEventListener('loadedmetadata', () => this.emitTracks());
    v.textTracks.addEventListener?.('addtrack', () => this.emitTracks());
  }

  attach(layer: HTMLElement): void {
    if (this.video.parentElement !== layer) layer.appendChild(this.video);
  }

  setRect(rect: VideoRect): void {
    const s = this.video.style;
    if (!rect) {
      s.display = 'none';
      return;
    }
    s.display = 'block';
    if (rect === 'fullscreen') {
      s.left = '0';
      s.top = '0';
      s.width = '100%';
      s.height = '100%';
    } else {
      s.left = `${rect.left}px`;
      s.top = `${rect.top}px`;
      s.width = `${rect.width}px`;
      s.height = `${rect.height}px`;
    }
  }

  async load(source: StreamSource, options: LoadOptions): Promise<void> {
    const token = ++this.loadToken;
    this.sawFirstFrame = false;
    this.recoveredMedia = false;
    this.manifestReady = false;
    this.emit('state', 'loading');
    this.source = source;
    this.startAt = options.startAt;
    const v = this.video;

    if (source.container === 'hls' && this.nativeHls && (!this.mseAvailable() || this.nativeOrigins.has(originOf(source.url)))) {
      this.teardown(null);
      this.setNativeSource(source.url, options.startAt);
    } else if (source.container === 'hls') {
      const { default: HlsClass } = await loadHls();
      if (token !== this.loadToken) return;
      if (!HlsClass.isSupported()) return this.fail({ kind: 'unsupported', fatal: true, message: 'HLS is not supported here' });
      this.teardown('hls');
      if (!this.hls) {
        // Reused for every channel; only the source changes (fast zapping).
        this.hls = new HlsClass({ debug: false, enableWorker: true, lowLatencyMode: false, ...HLS_BUFFER[options.buffer] });
        this.hls.attachMedia(v);
        this.wireHls(HlsClass, this.hls);
      } else {
        this.hls.stopLoad();
      }
      this.hls.config.liveSyncDurationCount = HLS_BUFFER[options.buffer].liveSyncDurationCount!;
      this.hls.config.maxBufferLength = HLS_BUFFER[options.buffer].maxBufferLength!;
      this.hls.loadSource(source.url);
      if (options.startAt) this.hls.startLoad(options.startAt);
    } else if (source.container === 'ts') {
      const { default: mpegts } = await loadMpegts();
      if (token !== this.loadToken) return;
      if (!mpegts.isSupported()) return this.fail({ kind: 'unsupported', fatal: true, message: 'MPEG-TS playback is not supported here' });
      this.teardown('ts');
      mpegts.LoggingControl.enableAll = false;
      // mpegts.js players are single-use; a new one per source is cheap compared to the network.
      const player = mpegts.createPlayer(
        { type: 'mpegts', isLive: source.live, url: source.url },
        {
          enableWorker: true,
          liveBufferLatencyChasing: options.buffer === 'low',
          liveSync: options.buffer !== 'stable',
          liveSyncMaxLatency: options.buffer === 'low' ? 3 : 8,
          lazyLoad: !source.live,
        },
      );
      player.on(mpegts.Events.ERROR, (type: string, detail: string, info?: { code?: number; msg?: string }) => {
        const network = type === mpegts.ErrorTypes.NETWORK_ERROR;
        const status = info?.code && info.code >= 100 ? info.code : undefined;
        this.fail({
          kind: network ? 'network' : 'media',
          fatal: true,
          message: `${detail}${info?.msg ? ': ' + info.msg : ''}`,
          httpStatus: status,
          blocked: network && !status && !this.sawFirstFrame,
        });
      });
      player.attachMediaElement(v);
      player.load();
      this.ts = player;
      this.play();
    } else {
      this.teardown(null);
      this.setNativeSource(source.url, options.startAt);
    }
    this.container = source.container;
  }

  play(): void {
    const p = this.ts ? this.ts.play() : this.video.play();
    if (p && typeof (p as Promise<void>).catch === 'function') {
      (p as Promise<void>).catch((e: { name?: string; message?: string }) => {
        // Autoplay policy: needs a user gesture (OK on the remote counts).
        if (e && e.name === 'NotAllowedError') this.fail({ kind: 'autoplay', fatal: false, message: 'Playback needs a key press' });
      });
    }
  }

  pause(): void {
    if (this.ts) this.ts.pause();
    else this.video.pause();
  }

  stop(): void {
    this.loadToken++;
    this.teardown(null);
    this.hls?.stopLoad();
    this.video.removeAttribute('src');
    this.video.load();
    this.container = null;
    this.emit('state', 'idle');
  }

  seek(seconds: number): void {
    this.video.currentTime = seconds;
  }

  position(): { current: number; duration: number } {
    const d = this.video.duration;
    return { current: this.video.currentTime || 0, duration: isFinite(d) && d > 0 ? d : 0 };
  }

  tracks(): PlayerTracks {
    if (this.hls) {
      const hls = this.hls;
      if (!this.manifestReady) return { audio: [], text: [] };
      return {
        audio: hls.audioTracks.map((t, i) => ({
          id: String(i),
          label: t.name || t.lang || `Audio ${i + 1}`,
          lang: t.lang,
          selected: i === hls.audioTrack,
        })),
        text: hls.subtitleTracks.map((t, i) => ({
          id: String(i),
          label: t.name || t.lang || `Subtitles ${i + 1}`,
          lang: t.lang,
          selected: hls.subtitleDisplay && i === hls.subtitleTrack,
        })),
      };
    }
    const text = Array.prototype.slice
      .call(this.video.textTracks)
      .filter((t: TextTrack) => t.kind === 'subtitles' || t.kind === 'captions')
      .map((t: TextTrack, i: number) => ({ id: String(i), label: t.label || t.language || `Subtitles ${i + 1}`, lang: t.language, selected: t.mode === 'showing' }));
    return { audio: [], text };
  }

  selectAudio(id: string): void {
    if (this.hls) this.hls.audioTrack = Number(id);
    this.emitTracks();
  }

  selectText(id: string | null): void {
    if (this.hls) {
      this.hls.subtitleDisplay = id !== null;
      this.hls.subtitleTrack = id === null ? -1 : Number(id);
    } else {
      const tracks = Array.prototype.slice.call(this.video.textTracks).filter((t: TextTrack) => t.kind === 'subtitles' || t.kind === 'captions');
      tracks.forEach((t: TextTrack, i: number) => (t.mode = String(i) === id ? 'showing' : 'disabled'));
    }
    this.emitTracks();
  }

  stats(): PlayerStats {
    const v = this.video;
    let bufferSec: number | undefined;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime) bufferSec = v.buffered.end(i) - v.currentTime;
    }
    const quality = typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null;
    let bitrateKbps: number | undefined;
    if (this.hls && this.hls.currentLevel >= 0 && this.hls.levels[this.hls.currentLevel]) {
      bitrateKbps = Math.round(this.hls.levels[this.hls.currentLevel].bitrate / 1000);
    } else if (this.ts) {
      const info = this.ts.statisticsInfo as { speed?: number } | undefined;
      if (info && info.speed) bitrateKbps = Math.round(info.speed * 8);
    }
    return {
      engine: this.hls ? 'hls.js' : this.ts ? 'mpegts.js' : 'native',
      width: v.videoWidth || undefined,
      height: v.videoHeight || undefined,
      bitrateKbps,
      bufferSec: bufferSec !== undefined ? Math.round(bufferSec * 10) / 10 : undefined,
      droppedFrames: quality ? quality.droppedVideoFrames : undefined,
    };
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

  private emitTracks(): void {
    this.emit('tracks', this.tracks());
  }

  private fail(error: PlayerError): void {
    if (error.fatal) this.emit('state', 'error');
    this.emit('error', error);
  }

  private mseAvailable(): boolean {
    return typeof window !== 'undefined' && !!(window as { MediaSource?: unknown }).MediaSource;
  }

  private setNativeSource(url: string, startAt?: number): void {
    const v = this.video;
    v.src = url;
    if (startAt) v.addEventListener('loadedmetadata', () => (v.currentTime = startAt), { once: true });
    this.play();
  }

  /** Releases whatever engine is not needed for the next source. hls.js is kept for reuse. */
  private teardown(keep: 'hls' | 'ts' | null): void {
    if (this.ts) {
      this.ts.pause();
      this.ts.unload();
      this.ts.detachMediaElement();
      this.ts.destroy();
      this.ts = null;
    }
    if (this.hls && keep !== 'hls') {
      this.hls.destroy();
      this.hls = null;
    }
  }

  private wireHls(HlsClass: HlsModule['default'], hls: Hls): void {
    const E = HlsClass.Events;
    hls.on(E.MANIFEST_PARSED, () => {
      this.manifestReady = true;
      this.play();
      this.emitTracks();
    });
    hls.on(E.AUDIO_TRACKS_UPDATED, () => this.emitTracks());
    hls.on(E.SUBTITLE_TRACKS_UPDATED, () => this.emitTracks());
    hls.on(E.AUDIO_TRACK_SWITCHED, () => this.emitTracks());
    hls.on(E.SUBTITLE_TRACK_SWITCH, () => this.emitTracks());
    hls.on(E.ERROR, (_event: string, data: ErrorData) => {
      if (!data.fatal) return;
      // One in-place recovery for decoder hiccups before reporting a fatal error.
      if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && !this.recoveredMedia) {
        this.recoveredMedia = true;
        hls.recoverMediaError();
        return;
      }
      const status = data.response && typeof data.response.code === 'number' ? data.response.code : undefined;
      const network = data.type === HlsClass.ErrorTypes.NETWORK_ERROR;
      // Status 0 before anything played: almost always a provider that doesn't allow browsers
      // to read its streams. Chrome's own HLS player isn't bound by that, so switch to it.
      if (network && !status && !this.sawFirstFrame && this.nativeHls && this.source) {
        this.nativeOrigins.add(originOf(this.source.url));
        this.teardown(null);
        this.setNativeSource(this.source.url, this.startAt);
        this.fail({ kind: 'network', fatal: false, message: 'hls.js blocked; using the browser HLS player', blocked: true });
        return;
      }
      this.fail({
        kind: data.type === HlsClass.ErrorTypes.NETWORK_ERROR ? 'network' : 'media',
        fatal: true,
        message: data.details + (status ? ` (HTTP ${status})` : ''),
        httpStatus: status,
        blocked: network && !status && !this.sawFirstFrame,
      });
    });
  }
}

function originOf(url: string): string {
  const m = /^[a-z]+:\/\/[^/]+/i.exec(url);
  return m ? m[0].toLowerCase() : '';
}

/**
 * Whether the browser can reach a URL at all (any HTTP answer counts). `no-cors` needs no
 * permission from the server; the body is never read and the request is dropped at once.
 */
function reachable(url: string): Promise<boolean> {
  if (typeof fetch !== 'function' || typeof AbortController === 'undefined') return Promise.resolve(true);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  return fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
    .then(
      () => {
        ctrl.abort();
        return true;
      },
      () => false,
    )
    .then((ok) => {
      clearTimeout(timer);
      return ok;
    });
}
