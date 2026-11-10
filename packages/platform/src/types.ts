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

/** Text files under one folder of the app's own storage. Paths are relative, `/`-separated. */
export interface CatalogFiles {
  write(path: string, text: string): Promise<void>;
  /** Adds to the end of a file; `start` empties it first. */
  append(path: string, text: string, start: boolean): Promise<void>;
  /**
   * `count` characters (code points: an emoji is one) from `byteOffset` (UTF-8 bytes), or null
   * when the file doesn't exist.
   */
  readSlice(path: string, byteOffset: number, count: number): Promise<string | null>;
  /** Null when the file doesn't exist. */
  read(path: string): Promise<string | null>;
  /** Removes a folder and everything in it; nothing happens if it's missing. */
  removeDir(path: string): Promise<void>;
  /** Free space on the device, in bytes, when the platform can tell. */
  freeBytes(): Promise<number | undefined>;
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
  /** Used from across the room with a remote, so some defaults differ from a phone's. */
  isTv?: () => boolean | Promise<boolean>;
  /** Slow graphics: leave out animations, which repaint a whole poster or panel per frame. */
  reducedEffects?: boolean;
  /** Whether `auto` stream format should pick HLS (browsers) over raw TS (TVs play TS natively). */
  prefersHls: boolean;
  /**
   * Native HTTP without browser limits (CORS, forced HTTPS). When present, the catalogue worker's
   * requests are sent through it instead of the page's `fetch`.
   */
  http?: (request: HttpRequest) => Promise<HttpResponse>;
  /**
   * Files in the app's own folder, outside the browser's storage limit (a Samsung TV gives the web
   * database 80 MB). Missing where the database has room enough.
   */
  catalogFiles?: CatalogFiles;
  /** Device and app memory, for the optional readout next to the playlist. */
  systemUsage?: () => Promise<SystemUsage>;
  /** Reads a URL natively without keeping the data (speed test). Others read it with `fetch`. */
  download?: (url: string, options: DownloadOptions) => Promise<DownloadResult>;
  /** Hands a stream to another installed player app (Android). */
  openExternal?: (url: string, title: string) => Promise<void>;
  /** Installs a new version from inside the app. Missing where a platform can't (Samsung, web). */
  updater?: AppUpdater;
  /** Called at exit from the root screen (Back on Home); platforms without an exit ignore it. */
  exit?: () => void;
}

export type UpdateProblem = 'network' | 'corrupt' | 'storage' | 'refused' | 'install';

export interface AppUpdater {
  info(): Promise<{ versionCode: number; canInstall: boolean }>;
  /** False if this device has no screen for it. */
  openInstallPermission(): Promise<boolean>;
  install(
    update: { url: string; sha256: string },
    events: {
      onProgress: (percent: number) => void;
      /** The system has it. The app closes when it's done, or the system asks to confirm first. */
      onInstalling: () => void;
      onCancelled: () => void;
      onProblem: (problem: UpdateProblem) => void;
    },
  ): Promise<void>;
}

/** All in bytes. A field is missing when this device can't report it. */
export interface SystemUsage {
  ramUsed?: number;
  ramTotal?: number;
  /** This app's own memory, as far as the platform can see it. */
  appUsed?: number;
}

export interface DownloadOptions {
  seconds: number;
  onProgress?: (bytes: number, ms: number) => void;
  isCancelled?: () => boolean;
}

export interface DownloadResult {
  status: number;
  ttfbMs: number;
  bytes: number;
  ms: number;
  compressed: boolean;
}

export interface HttpRequest {
  url: string;
  headers?: Record<string, string>;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  body: string;
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
  /**
   * When the engine's clock last moved, in ms since the epoch, or undefined if it doesn't report
   * one. A stream that stops without an error or a buffering event shows up here and nowhere else.
   */
  lastProgressAt?(): number | undefined;
  tracks(): PlayerTracks;
  selectAudio(id: string): void;
  selectText(id: string | null): void;
  stats(): PlayerStats;
  on<E extends keyof PlayerEvents>(event: E, fn: (data: PlayerEvents[E]) => void): () => void;
}
