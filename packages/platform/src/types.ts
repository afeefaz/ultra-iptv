export type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Remote keys normalised across Tizen, webOS, Android and the web (spec §4.1). */
export type Key =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'ok'
  | 'back'
  | 'menu'
  | 'info'
  | 'playPause'
  | 'play'
  | 'pause'
  | 'stop'
  | 'ff'
  | 'rew'
  | 'chUp'
  | 'chDown'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | `digit${Digit}`;

export interface KeyPress {
  key: Key;
  /** Raw `key` name or keyCode, for the debug screen. */
  raw: string | number;
  repeat: boolean;
}

/** Return `true` when the press was handled, so the platform can suppress its default. */
export type KeyHandler = (press: KeyPress) => boolean;

export interface KeysAdapter {
  start(handler: KeyHandler): () => void;
}

export interface FileExportAdapter {
  exportText(filename: string, mimeType: string, text: string): Promise<void>;
}

export type PlatformId = 'web' | 'tizen' | 'webos' | 'android';

export interface DeviceInfo {
  platform: PlatformId;
  engine: string;
  userAgent: string;
  screen: { width: number; height: number; pixelRatio: number };
  language: string;
  model?: string;
  osVersion?: string;
}

export interface Platform {
  id: PlatformId;
  keys: KeysAdapter;
  fileExport: FileExportAdapter;
  device(): DeviceInfo;
  /** `osk`: the app's on-screen keyboard (TVs); `native`: the system keyboard (phones, desktop). */
  textInput: 'osk' | 'native';
  /** One player per app, reused for every channel (spec §4.2). */
  createPlayer(): PlayerAdapter;
  /** Whether `auto` stream format should pick HLS (browsers) over raw TS (TVs play TS natively). */
  prefersHls: boolean;
}

// ---- Player (spec §4.2) ----

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';
export type StreamContainer = 'hls' | 'ts' | 'progressive';
export type BufferProfile = 'low' | 'balanced' | 'stable';

export interface StreamSource {
  url: string;
  container: StreamContainer;
  live: boolean;
  headers?: { userAgent?: string; referrer?: string };
}

export interface LoadOptions {
  startAt?: number;
  buffer: BufferProfile;
}

export interface Track {
  id: string;
  label: string;
  lang?: string;
  selected: boolean;
}

export interface PlayerTracks {
  audio: Track[];
  text: Track[];
}

export interface PlayerStats {
  engine: string;
  width?: number;
  height?: number;
  bitrateKbps?: number;
  bufferSec?: number;
  droppedFrames?: number;
}

export interface PlayerError {
  kind: 'network' | 'media' | 'unsupported' | 'autoplay' | 'unknown';
  fatal: boolean;
  message: string;
  httpStatus?: number;
  /** The request never got an answer the page may read (typically a provider blocking browsers). */
  blocked?: boolean;
}

/** A rectangle in CSS pixels relative to the viewport, or the whole screen, or hidden. */
export type VideoRect = { left: number; top: number; width: number; height: number } | 'fullscreen' | null;

export interface PlayerEvents {
  state: PlayerState;
  error: PlayerError;
  tracks: PlayerTracks;
  /** First frame rendered after `load()`. */
  firstFrame: undefined;
}

export interface PlayerAdapter {
  readonly engine: string;
  /** Puts the video surface in the app's video layer. */
  attach(layer: HTMLElement): void;
  setRect(rect: VideoRect): void;
  load(source: StreamSource, options: LoadOptions): Promise<void>;
  play(): void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  /** Seconds; duration is 0 for live or unknown. */
  position(): { current: number; duration: number };
  tracks(): PlayerTracks;
  selectAudio(id: string): void;
  selectText(id: string | null): void;
  stats(): PlayerStats;
  on<E extends keyof PlayerEvents>(event: E, fn: (data: PlayerEvents[E]) => void): () => void;
}
