/// <reference lib="webworker" />
// Catalogue worker (spec §3): fetches and parses playlists, diffs and writes IndexedDB, searches.
// Built as a classic (non-module) worker without polyfills: keep to Chrome 53 built-ins here.
import { log, logging, setFallbackFetch, toErrorInfo } from '@ultra/core';
import { PlaylistService } from '@ultra/core/service';
import type { FromWorker, HttpReplyMessage, Method, ToWorker, WorkerApi } from './protocol';

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

const api: WorkerApi = {
  async init({ saltHex, keepHosts, logLevel, nativeHttp }) {
    logging.configureWorker(saltHex, keepHosts);
    log.setLevel(logLevel);
    if (nativeHttp) setFallbackFetch(nativeFetch);
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
  seriesInfo: (playlistId, seriesId) => service.seriesInfo(playlistId, seriesId),
  catchupListings: (playlistId, streamId, days) => service.catchupListings(playlistId, streamId, days),
  togglePin: (playlistId, kind, categoryId) => service.togglePin(playlistId, kind, categoryId),
  saveProgress: (row) => service.saveProgress(row),
  clearProgress: (playlistId, kind, key) => service.clearProgress(playlistId, kind, key),
};

self.onmessage = (e: MessageEvent<ToWorker>) => {
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
  fn.apply(api, args).then(
    (result) => post({ id, ok: true, result }),
    (err) => {
      const error = toErrorInfo(err);
      if (error.code === 'internal') log.error('worker', `${method} failed`, { error: err });
      post({ id, ok: false, error });
    },
  );
};

self.addEventListener('unhandledrejection', (e) => log.error('worker', 'unhandled rejection', { reason: e.reason }));
