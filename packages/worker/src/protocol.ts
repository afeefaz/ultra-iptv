import type {
  ContentKind,
  EpgEntry,
  LockType,
  MediaRef,
  ProgressKind,
  ProgressRow,
  SeriesInfo,
  VodInfo,
  VodRow,
  ResolvedStream,
  StreamFormat,
  StreamRef,
  ErrorInfo,
  PerfSnapshot,
  FavoriteRow,
  LogEntry,
  LogLevel,
  PlaylistInput,
  PlaylistRecord,
  RefreshProgress,
  RefreshResult,
  SearchResults,
  ApplyResult,
  FetchResult,
  HiddenRule,
  LinkResult,
  PushResult,
  RemoteIdentity,
  SyncStatus,
  SpeedTargets,
  TickResult,
  TestResult,
} from '@ultra/core';

/** Methods the catalogue worker exposes. Every write to the catalogue goes through here. */
export interface WorkerApi {
  /** `nativeHttp`: send network requests to the main thread (platform native HTTP) instead of `fetch`. */
  /** `catalogFiles`: the page can keep the catalogue in files (Samsung), outside the small web database. */
  init(args: { saltHex: string; keepHosts: string[]; logLevel: LogLevel; nativeHttp?: boolean; catalogFiles?: boolean; sectionWorkerUrl?: string; sectionWorkerModule?: boolean;
    /** The encryption key's bytes, where the platform keeps it itself (the Mac app); else IndexedDB's. */
    secretKey?: number[] }): Promise<void>;
  setLogLevel(level: LogLevel): Promise<void>;
  testPlaylist(input: PlaylistInput): Promise<TestResult>;
  savePlaylist(input: PlaylistInput): Promise<PlaylistRecord>;
  editData(id: string): Promise<PlaylistInput>;
  deletePlaylist(id: string): Promise<void>;
  movePlaylist(id: string, delta: number): Promise<void>;
  refresh(id: string): Promise<RefreshResult>;
  toggleFavorite(fav: Omit<FavoriteRow, 'addedAt'>): Promise<boolean>;
  search(playlistId: string, query: string, limitPerKind?: number): Promise<SearchResults>;
  streamUrl(playlistId: string, ref: StreamRef, format: StreamFormat, preferHls: boolean): Promise<ResolvedStream>;
  shortEpg(playlistId: string, streamId: string): Promise<EpgEntry[]>;
  addRecent(playlistId: string, kind: ContentKind, key: string, name: string): Promise<void>;
  toggleLock(playlistId: string, type: LockType, id: string): Promise<boolean>;
  pinStatus(): Promise<{ set: boolean }>;
  verifyPin(pin: string): Promise<boolean>;
  setPin(current: string | null, next: string): Promise<void>;
  clearPin(current: string): Promise<void>;
  mediaUrl(playlistId: string, ref: MediaRef, preferHls: boolean): Promise<ResolvedStream>;
  vodInfo(playlistId: string, vodId: string): Promise<VodInfo & { ext?: string }>;
  vodVersions(playlistId: string, id: string): Promise<Array<{ row: VodRow; category: string }>>;
  vodMore(playlistId: string, id: string): Promise<{ category: string; more: VodRow[] }>;
  seriesInfo(playlistId: string, seriesId: string): Promise<SeriesInfo>;
  catchupListings(playlistId: string, streamId: string, days: number): Promise<EpgEntry[]>;
  togglePin(playlistId: string, kind: ContentKind, categoryId: string): Promise<boolean>;
  setHiddenCategories(playlistId: string, kind: ContentKind, categoryIds: string[], rule: HiddenRule): Promise<void>;
  renameCategory(playlistId: string, kind: ContentKind, categoryId: string, name: string | null): Promise<Record<string, string>>;
  speedTargets(playlistId: string): Promise<SpeedTargets>;
  ensureSnapshot(playlistId: string, kind: ContentKind): Promise<void>;
  remoteEnable(): Promise<RemoteIdentity>;
  remoteLocalSaved(id: string): Promise<void>;
  remoteLocalDeleted(id: string): Promise<void>;
  remoteTick(): Promise<TickResult>;
  syncStatus(): Promise<SyncStatus>;
  syncPush(settings: Record<string, string>, activeId: string | null): Promise<PushResult>;
  syncFetch(): Promise<FetchResult>;
  syncApply(): Promise<ApplyResult | null>;
  syncLink(id: string, key: string): Promise<LinkResult>;
  syncUnlink(): Promise<boolean>;
  perfSnapshot(): Promise<PerfSnapshot>;
  perfReset(): Promise<void>;
  saveProgress(row: ProgressRow): Promise<void>;
  clearProgress(playlistId: string, kind: ProgressKind, key: string): Promise<void>;
}

export type Method = keyof WorkerApi;

export interface RequestMessage {
  id: number;
  method: Method;
  args: unknown[];
}

export type ResponseMessage =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: ErrorInfo };

export type WorkerEvent =
  | { event: 'log'; entry: LogEntry }
  | { event: 'changed'; playlistId: string | null; kinds: ContentKind[] }
  | { event: 'progress'; progress: RefreshProgress }
  | { event: 'secrets'; secrets: string[]; hosts: string[] }
  | { event: 'http'; reqId: number; url: string; headers?: Record<string, string>; timeoutMs: number }
  | { event: 'file'; reqId: number; op: FileOp; path: string; text?: string; start?: boolean; offset?: number; count?: number };

/** What the worker asks the main thread to do with the app's own files (Samsung's file API is only there). */
export type FileOp = 'write' | 'append' | 'read' | 'readSlice' | 'removeDir' | 'freeBytes';

/** Main thread's answer to a `file` event. */
export interface FileReplyMessage {
  fileReply: number;
  text?: string | null;
  bytes?: number;
  error?: string;
}

/** Main thread's answer to an `http` event. */
export interface HttpReplyMessage {
  httpReply: number;
  status?: number;
  body?: string;
  /** Set when the request never got an HTTP answer. */
  error?: string;
}

export type ToWorker = RequestMessage | HttpReplyMessage | FileReplyMessage;
export type FromWorker = ResponseMessage | WorkerEvent;
