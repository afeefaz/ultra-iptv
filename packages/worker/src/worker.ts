/// <reference lib="webworker" />
// Catalogue worker (spec §3): fetches and parses playlists, diffs and writes IndexedDB, searches.
// Built as a classic (non-module) worker without polyfills: keep to Chrome 53 built-ins here.
import { log, logging, perf, setCatalogFiles, setSecretKeySource, setFallbackFetch, setSectionWorkers, toErrorInfo, type CatalogFileStore, type SectionWorkerLike } from '@ultra/core';
import { PlaylistService } from '@ultra/core/service';
import type { FileOp, FileReplyMessage, FromWorker, HttpReplyMessage, Method, ToWorker, WorkerApi } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: FromWorker) => self.postMessage(msg);

// Logs are forwarded to the main thread, which prints and stores them.
logging.detachConsole();
log.addSink({ write: (entry) => post({ event: 'log', entry }) });

const service = new PlaylistService({
  changed: (playlistId, kinds) => post({ event: 'changed', playlistId, kinds }),
  progress: (progress) => post({ event: 'progress', progress }),
  secrets: (secrets, hosts) => post({ event: 'secrets', secrets, hosts }),
});

// Native HTTP (Android): requests go to the main thread, which uses the platform's HTTP client.
const NATIVE_TIMEOUT_MS = 60_000;
const httpWaiters = new Map<number, { resolve: (r: HttpReplyMessage) => void }>();
let nextHttpId = 1;

function nativeFetch(url: string, init?: RequestInit): Promise<Response> {
  return new Promise<HttpReplyMessage>((resolve) => {
    const reqId = nextHttpId++;
    httpWaiters.set(reqId, { resolve });
    post({ event: 'http', reqId, url, headers: init?.headers as Record<string, string> | undefined, timeoutMs: NATIVE_TIMEOUT_MS });
  }).then((reply) => {
    if (reply.error !== undefined || reply.status === undefined) {
      // Plain Error: the HTTP layer classifies it (and retries once) like a fetch failure.
      throw new Error(reply.error || 'Network error');
    }
    return new Response(reply.body ?? '', { status: reply.status });
  });
}

// The app's own files (Samsung): only the page has the TV's file API, so each call goes there.
const fileWaiters = new Map<number, (r: FileReplyMessage) => void>();
let nextFileId = 1;

function fileCall(op: FileOp, path: string, text?: string, extra: { start?: boolean; offset?: number; count?: number } = {}): Promise<FileReplyMessage> {
  return new Promise<FileReplyMessage>((resolve) => {
    const reqId = nextFileId++;
    fileWaiters.set(reqId, resolve);
    post({ event: 'file', reqId, op, path, text, start: extra.start, offset: extra.offset, count: extra.count });
  }).then((reply) => {
    if (reply.error !== undefined) throw new Error(reply.error);
    return reply;
  });
}

const pageFiles: CatalogFileStore = {
  write: (path, text) => fileCall('write', path, text).then(() => undefined),
  read: (path) => fileCall('read', path).then((r) => (r.text === undefined ? null : r.text)),
  append: (path, text, start) => fileCall('append', path, text, { start }).then(() => undefined),
  readSlice: (path, offset, count) => fileCall('readSlice', path, undefined, { offset, count }).then((r) => (r.text === undefined ? null : r.text)),
  removeDir: (path) => fileCall('removeDir', path).then(() => undefined),
  freeBytes: () => fileCall('freeBytes', '').then((r) => r.bytes),
};

// Nothing is decrypted before init says where the key comes from (the Mac app keeps it in a file).
let giveSecretKey: (key: Uint8Array | null) => void = () => undefined;
setSecretKeySource(new Promise<Uint8Array | null>((resolve) => (giveSecretKey = resolve)));

const api: WorkerApi = {
  async init({ saltHex, keepHosts, logLevel, nativeHttp, catalogFiles, sectionWorkerUrl, sectionWorkerModule, secretKey }) {
    giveSecretKey(secretKey && secretKey.length === 32 ? new Uint8Array(secretKey) : null);
    logging.configureWorker(saltHex, keepHosts);
    log.setLevel(logLevel);
    if (nativeHttp) setFallbackFetch(nativeFetch);
    setCatalogFiles(catalogFiles ? pageFiles : null);
    // A second worker for the biggest section, on another core (TVs keep the catalogue in files).
    // Older engines can't start a worker from a worker: then everything stays in this one.
    // The page knows where the section worker's script is (the build names it); it says so in init.
    const url = sectionWorkerUrl;
    setSectionWorkers(catalogFiles && url && typeof Worker !== 'undefined' ? () => (sectionWorkerModule ? new Worker(url, { type: 'module' }) : new Worker(url)) as unknown as SectionWorkerLike : null);
    await service.init();
  },
  async setLogLevel(level) {
    log.setLevel(level);
  },
  testPlaylist: (input) => service.test(input),
  savePlaylist: (input) => service.save(input),
  editData: (id) => service.editData(id),
  deletePlaylist: (id) => service.remove(id),
  movePlaylist: (id, delta) => service.move(id, delta),
  refresh: (id) => service.refresh(id),
  toggleFavorite: (fav) => service.toggleFavorite(fav),
  search: (playlistId, query, limit) => service.search(playlistId, query, limit),
  streamUrl: (playlistId, ref, format, preferHls) => service.streamUrl(playlistId, ref, format, preferHls),
  shortEpg: (playlistId, streamId) => service.shortEpg(playlistId, streamId),
  addRecent: (playlistId, kind, key, name) => service.addRecent(playlistId, kind, key, name),
  toggleLock: (playlistId, type, id) => service.toggleLock(playlistId, type, id),
  pinStatus: () => service.pinStatus(),
  verifyPin: (pin) => service.verifyPin(pin),
  setPin: (current, next) => service.setPin(current, next),
  clearPin: (current) => service.clearPin(current),
  mediaUrl: (playlistId, ref, preferHls) => service.mediaUrl(playlistId, ref, preferHls),
  vodInfo: (playlistId, vodId) => service.vodInfo(playlistId, vodId),
  vodVersions: (playlistId, id) => service.vodVersions(playlistId, id),
  vodMore: (playlistId, id) => service.vodMore(playlistId, id),
  seriesInfo: (playlistId, seriesId) => service.seriesInfo(playlistId, seriesId),
  catchupListings: (playlistId, streamId, days) => service.catchupListings(playlistId, streamId, days),
  togglePin: (playlistId, kind, categoryId) => service.togglePin(playlistId, kind, categoryId),
  setHiddenCategories: (playlistId, kind, categoryIds, rule) => service.setHiddenCategories(playlistId, kind, categoryIds, rule),
  renameCategory: (playlistId, kind, categoryId, name) => service.renameCategory(playlistId, kind, categoryId, name),
  speedTargets: (playlistId) => service.speedTargets(playlistId),
  ensureSnapshot: (playlistId, kind) => service.ensureSnapshot(playlistId, kind),
  remoteEnable: () => service.remote.enable(),
  remoteLocalSaved: (id) => service.remote.localSaved(id),
  remoteLocalDeleted: (id) => service.remote.localDeleted(id),
  remoteTick: () => service.remote.tick(),
  syncStatus: () => service.sync.status(),
  syncPush: (settings, activeId) => service.sync.push(settings, activeId),
  syncFetch: () => service.sync.fetch(),
  syncApply: () => service.sync.apply(),
  syncLink: (id, key) => service.sync.link(id, key),
  syncUnlink: () => service.sync.unlink(),
  perfSnapshot: async () => perf.snapshot(),
  perfReset: async () => perf.reset(),
  saveProgress: (row) => service.saveProgress(row),
  clearProgress: (playlistId, kind, key) => service.clearProgress(playlistId, kind, key),
};

self.onmessage = (e: MessageEvent<ToWorker>) => {
  if ('fileReply' in e.data) {
    const reply = e.data;
    const waiter = fileWaiters.get(reply.fileReply);
    fileWaiters.delete(reply.fileReply);
    if (waiter) waiter(reply);
    return;
  }
  if ('httpReply' in e.data) {
    const reply = e.data;
    const waiter = httpWaiters.get(reply.httpReply);
    httpWaiters.delete(reply.httpReply);
    waiter?.resolve(reply);
    return;
  }
  const { id, method, args } = e.data;
  const fn = api[method as Method] as (...a: unknown[]) => Promise<unknown>;
  if (!fn) {
    post({ id, ok: false, error: { code: 'internal', message: `Unknown method ${String(method)}` } });
    return;
  }
  const span = perf.span(`worker.${String(method)}`);
  fn.apply(api, args).then(
    (result) => {
      span.end();
      post({ id, ok: true, result });
    },
    (err) => {
      span.end();
      const error = toErrorInfo(err);
      if (error.code === 'internal') log.error('worker', `${method} failed`, { error: err });
      post({ id, ok: false, error });
    },
  );
};

self.addEventListener('unhandledrejection', (e) => log.error('worker', 'unhandled rejection', { reason: e.reason }));
