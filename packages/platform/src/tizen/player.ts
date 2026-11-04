import { perf } from '@ultra/core';
import { VIDEO_BEHIND_CLASS } from '../surface';
import type {
  BufferProfile,
  LoadOptions,
  PlayerAdapter,
  PlayerError,
  PlayerEvents,
  PlayerStats,
  PlayerTracks,
  StreamSource,
  Track,
  VideoRect,
} from '../types';
import { tizenGlobals, type AvPlay, type AvPlayTrack } from './api';

/** Class on <html> while the Live preview shows video through a hole in the page. */
export const VIDEO_HOLE_CLASS = 'video-hole';

/** AVPlay's display rectangle is always in this space, whatever the page's size. */
const PLANE_WIDTH = 1920;

const BUFFER_SECONDS: Record<BufferProfile, number> = { low: 2, balanced: 4, stable: 8 };

function parseExtra(track: AvPlayTrack): Record<string, unknown> {
  try {
    return JSON.parse(track.extra_info) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toError(type: string): PlayerError {
  if (/NOT_SUPPORTED|UNSUPPORTED|CODEC|FORMAT/i.test(type)) return { kind: 'unsupported', fatal: true, message: `not supported (${type})` };
  if (/CONNECTION|NETWORK|TIMEOUT|INVALID_URI|DNS/i.test(type)) return { kind: 'network', fatal: true, message: type };
  return { kind: 'media', fatal: true, message: type };
}

/**
 * Samsung's AVPlay (spec §4.2). It draws on a hardware plane under the page and plays TS, HLS and
 * files without CORS limits. One instance exists per app, and every call can throw when AVPlay
 * is in the wrong state, so calls that may race with a channel change are guarded.
 */
export class AvPlayPlayer implements PlayerAdapter {
  readonly engine = 'avplay';
  private readonly listeners = new Map<keyof PlayerEvents, Set<(data: unknown) => void>>();
  private rect: VideoRect = null;
  private objectEl: HTMLElement | null = null;
  private subsEl: HTMLElement | null = null;
  private holeEl: HTMLElement | null = null;
  private subsTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by every load and stop; callbacks from an older one are ignored. */
  private seq = 0;
  private opened = false;
  private playing = false;
  private started = false;
  private live = false;
  private textTrack: string | null = null;
  private trackCache: PlayerTracks = { audio: [], text: [] };
  private pos = { current: 0, duration: 0 };

  constructor(private readonly av: AvPlay = tizenGlobals().webapis!.avplay!) {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  attach(layer: HTMLElement): void {
    this.objectEl?.remove();
    this.subsEl?.remove();
    const object = document.createElement('object');
    object.type = 'application/avplayer';
    object.className = 'video-object';
    object.style.display = 'none';
    layer.appendChild(object);
    this.objectEl = object;
    const subs = document.createElement('div');
    subs.className = 'video-subs';
    subs.style.display = 'none';
    layer.appendChild(subs);
    this.subsEl = subs;
    if (!this.holeEl) {
      this.holeEl = document.createElement('div');
      this.holeEl.className = 'video-hole-frame';
      this.holeEl.style.display = 'none';
      document.body.appendChild(this.holeEl);
    }
    this.setRect(this.rect);
  }

  setRect(rect: VideoRect): void {
    this.rect = rect;
    const root = document.documentElement.classList;
    root.toggle(VIDEO_BEHIND_CLASS, rect === 'fullscreen');
    root.toggle(VIDEO_HOLE_CLASS, !!rect && rect !== 'fullscreen');
    const box = rect === 'fullscreen' ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight } : rect;
    if (this.objectEl && box) place(this.objectEl, box);
    // Subtitles stay inside the picture; their distance from its edges comes from the stylesheet.
    if (this.subsEl && box) {
      this.subsEl.style.left = `${box.left + box.width * 0.05}px`;
      this.subsEl.style.width = `${box.width * 0.9}px`;
      this.subsEl.style.top = `${box.top + box.height * 0.8}px`;
    }
    if (this.objectEl) this.objectEl.style.display = box ? '' : 'none';
    if (this.holeEl) {
      this.holeEl.style.display = rect && rect !== 'fullscreen' ? '' : 'none';
      if (rect && rect !== 'fullscreen') place(this.holeEl, rect);
    }
    this.applyDisplayRect();
  }

  async load(source: StreamSource, options: LoadOptions): Promise<void> {
    const mine = ++this.seq;
    this.close();
    this.live = source.live;
    this.pos = { current: options.startAt ?? 0, duration: 0 };
    this.emit('state', 'loading');
    try {
      this.av.open(source.url);
      this.opened = true;
      this.av.setListener({
        onbufferingstart: () => {
          if (mine === this.seq && this.started && this.playing) this.emit('state', 'buffering');
        },
        onbufferingcomplete: () => {
          if (mine === this.seq && this.playing) this.markPlaying();
        },
        oncurrentplaytime: (ms) => {
          if (mine !== this.seq) return;
          this.pos = { current: ms / 1000, duration: this.pos.duration };
          if (this.playing) this.markPlaying();
        },
        onstreamcompleted: () => {
          if (mine !== this.seq) return;
          this.playing = false;
          this.emit('state', 'ended');
        },
        onerror: (type) => {
          if (mine === this.seq) this.fail(toError(String(type)));
        },
        onsubtitlechange: (durationMs, text) => {
          if (mine === this.seq) this.showSubtitle(text, durationMs);
        },
      });
      const seconds = BUFFER_SECONDS[options.buffer];
      this.av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', seconds);
      this.av.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', seconds);
      if (source.headers?.userAgent) this.av.setStreamingProperty('USER_AGENT', source.headers.userAgent);
      this.av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      this.applyDisplayRect();
    } catch (e) {
      this.fail(toError(errorName(e)));
      return;
    }
    const prepare = perf.span('player.prepare');
    await new Promise<void>((resolve) => {
      this.av.prepareAsync(
        () => {
          prepare.end();
          if (mine === this.seq) this.onPrepared(options.startAt);
          resolve();
        },
        (e) => {
          if (mine === this.seq) this.fail(toError(errorName(e)));
          resolve();
        },
      );
    });
  }

  play(): void {
    if (!this.opened) return;
    this.guard(() => this.av.play());
    this.playing = true;
    this.emit('state', 'playing');
  }

  pause(): void {
    if (!this.opened) return;
    this.guard(() => this.av.pause());
    this.playing = false;
    this.emit('state', 'paused');
  }

  stop(): void {
    this.seq++;
    this.close();
    this.pos = { current: 0, duration: 0 };
    this.emit('state', 'idle');
  }

  seek(seconds: number): void {
    if (!this.opened) return;
    this.pos = { current: seconds, duration: this.pos.duration };
    this.guard(() => this.av.seekTo(Math.round(seconds * 1000)));
  }

  position(): { current: number; duration: number } {
    return this.pos;
  }

  tracks(): PlayerTracks {
    return this.trackCache;
  }

  selectAudio(id: string): void {
    this.guard(() => this.av.setSelectTrack('AUDIO', Number(id)));
    this.trackCache = { ...this.trackCache, audio: this.trackCache.audio.map((t) => ({ ...t, selected: t.id === id })) };
    this.emit('tracks', this.trackCache);
  }

  selectText(id: string | null): void {
    this.textTrack = id;
    this.guard(() => {
      if (id !== null) this.av.setSelectTrack('TEXT', Number(id));
      this.av.setSilentSubtitle(id === null);
    });
    if (id === null) this.showSubtitle('', 0);
    this.trackCache = { ...this.trackCache, text: this.trackCache.text.map((t) => ({ ...t, selected: t.id === id })) };
    this.emit('tracks', this.trackCache);
  }

  stats(): PlayerStats {
    const stats: PlayerStats = { engine: 'avplay' };
    if (!this.opened) return stats;
    this.guard(() => {
      const video = this.av.getCurrentStreamInfo().filter((t) => t.type === 'VIDEO')[0];
      if (!video) return;
      const extra = parseExtra(video);
      stats.width = Number(extra.Width) || undefined;
      stats.height = Number(extra.Height) || undefined;
      stats.bitrateKbps = Number(extra.Bit_rate) ? Math.round(Number(extra.Bit_rate) / 1000) : undefined;
    });
    return stats;
  }

  on<E extends keyof PlayerEvents>(event: E, fn: (data: PlayerEvents[E]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    const listener = fn as (data: unknown) => void;
    set.add(listener);
    return () => set.delete(listener);
  }

  private onPrepared(startAt: number | undefined): void {
    this.guard(() => {
      const ms = this.av.getDuration();
      this.pos = { current: this.pos.current, duration: this.live || !(ms > 0) ? 0 : ms / 1000 };
    });
    this.readTracks();
    // Subtitles stay off until one is chosen.
    this.guard(() => this.av.setSilentSubtitle(true));
    const start = () => {
      this.playing = true;
      this.guard(() => this.av.play());
    };
    if (startAt) {
      const mine = this.seq;
      const next = () => {
        if (mine === this.seq) start();
      };
      try {
        this.av.seekTo(Math.round(startAt * 1000), next, next);
      } catch {
        start();
      }
    } else {
      start();
    }
  }

  private markPlaying(): void {
    const first = !this.started;
    this.started = true;
    this.emit('state', 'playing');
    if (first) this.emit('firstFrame', undefined);
  }

  private readTracks(): void {
    const audio: Track[] = [];
    const text: Track[] = [];
    this.guard(() => {
      const current = this.av.getCurrentStreamInfo().filter((t) => t.type === 'AUDIO')[0];
      for (const track of this.av.getTotalTrackInfo()) {
        const extra = parseExtra(track);
        const lang = (extra.language ?? extra.track_lang) as string | undefined;
        if (track.type === 'AUDIO') {
          audio.push({ id: String(track.index), label: lang ? lang.toUpperCase() : `Audio ${audio.length + 1}`, lang, selected: !!current && current.index === track.index });
        } else if (track.type === 'TEXT') {
          text.push({ id: String(track.index), label: lang ? lang.toUpperCase() : `Subtitle ${text.length + 1}`, lang, selected: false });
        }
      }
    });
    this.textTrack = null;
    this.trackCache = { audio, text };
    this.emit('tracks', this.trackCache);
  }

  private showSubtitle(text: string, durationMs: number): void {
    clearTimeout(this.subsTimer);
    const el = this.subsEl;
    if (!el) return;
    if (!text || this.textTrack === null) {
      el.style.display = 'none';
      return;
    }
    const line = document.createElement('span');
    line.textContent = text;
    el.textContent = '';
    el.appendChild(line);
    el.style.display = '';
    this.subsTimer = setTimeout(() => (el.style.display = 'none'), durationMs || 3000);
  }

  private applyDisplayRect(): void {
    const rect = this.rect;
    if (!this.opened || !rect) return;
    const scale = PLANE_WIDTH / window.innerWidth;
    this.guard(() => {
      if (rect === 'fullscreen') this.av.setDisplayRect(0, 0, PLANE_WIDTH, Math.round(window.innerHeight * scale));
      else this.av.setDisplayRect(Math.round(rect.left * scale), Math.round(rect.top * scale), Math.round(rect.width * scale), Math.round(rect.height * scale));
    });
  }

  private close(): void {
    this.playing = false;
    this.started = false;
    this.textTrack = null;
    this.trackCache = { audio: [], text: [] };
    this.showSubtitle('', 0);
    if (!this.opened) return;
    this.opened = false;
    // close() also stops, and every call into AVPlay blocks the page.
    perf.timedSync('player.close', () => this.guard(() => this.av.close()));
  }

  /** AVPlay throws when called in the wrong state; a racing channel change must not break the app. */
  private guard(fn: () => void): void {
    try {
      fn();
    } catch {
      // Nothing to do: the next load starts from a clean close().
    }
  }

  private fail(error: PlayerError): void {
    this.playing = false;
    if (error.fatal) this.emit('state', 'error');
    this.emit('error', error);
  }

  /** The TV needs the player released while the app is in the background (spec §4). */
  private readonly onVisibility = (): void => {
    if (!this.opened) return;
    if (document.hidden) {
      this.guard(() => this.av.suspend());
      return;
    }
    try {
      this.av.restore();
      this.applyDisplayRect();
    } catch (e) {
      // Reported as a dropped connection, so the normal retry reloads the stream.
      this.fail({ kind: 'network', fatal: true, message: errorName(e) });
    }
  };

  private emit<E extends keyof PlayerEvents>(event: E, data: PlayerEvents[E]): void {
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }
}

function place(el: HTMLElement, box: { left: number; top: number; width: number; height: number }): void {
  el.style.left = `${box.left}px`;
  el.style.top = `${box.top}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
}

function errorName(e: unknown): string {
  const err = e as { name?: string; message?: string } | undefined;
  return err?.message || err?.name || String(e);
}
