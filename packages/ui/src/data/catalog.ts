import { forgetSavedLists, listPlaylists, log, logging, perf, setCatalogFiles } from '@ultra/core';
import type { Platform } from '@ultra/platform';
import { WorkerClient, type WorkerEvent } from '@ultra/worker';
import CatalogWorker from '@ultra/worker/worker?worker';
import sectionWorkerPath from '@ultra/worker/section?worker&url';

let client: WorkerClient | null = null;
let platform: Platform | null = null;

/** Must run before the first `catalog()` call so the worker knows whether to use native HTTP. */
export function setCatalogPlatform(p: Platform): void {
  platform = p;
  leaveClassic();
  // The page reads the catalogue's files itself (opening a category); the worker writes them.
  setCatalogFiles(filesWanted() ? (p.catalogFiles ?? null) : null);
}

/** The catalogue worker (spec §3). Created on first use; shares the log salt so host hashes match. */
export function catalog(): WorkerClient {
  if (!client) {
    client = new WorkerClient(new CatalogWorker());
    const http = platform?.http;
    if (http) client.setHttp(http);
    const files = filesWanted() ? platform?.catalogFiles : undefined;
    if (files) client.setFiles(files);
    const keepHosts = ['localhost', '127.0.0.1'];
    if (location.hostname) keepHosts.push(location.hostname);
    const keyReady: Promise<Uint8Array | null> = platform?.secretKey ? platform.secretKey().catch(() => null) : Promise.resolve(null);
    const worker = client;
    const sectionUrl = files ? sectionWorkerUrl() : Promise.resolve(undefined);
    void Promise.all([keyReady, sectionUrl])
      .then(([key, sectionWorker]) =>
        worker.call('init', { saltHex: logging.saltHex, keepHosts, logLevel: log.level, nativeHttp: !!http, catalogFiles: !!files, sectionWorkerUrl: sectionWorker,
          // The dev server serves workers as modules; builds make classic scripts.
          sectionWorkerModule: import.meta.env.DEV,
          secretKey: key ? Array.prototype.slice.call(key) : undefined }),
      )
      .then(() => perf.mark('startup.workerReady'), (e) => {
        log.error('worker', 'init failed', { error: e });
      });
  }
  return client;
}

/**
 * Where the catalogue worker starts its second worker from. On Windows, WebView2 doesn't serve the
 * app's files to a worker started inside a worker (it failed to load: "Section worker failed"), so
 * the page reads the script and hands over an in-memory copy, which any worker can start.
 */
async function sectionWorkerUrl(): Promise<string | undefined> {
  const url = new URL(sectionWorkerPath, location.href).href;
  if (platform?.id !== 'windows') return url;
  try {
    const script = await (await fetch(url)).blob();
    return URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
  } catch (e) {
    log.warn('worker', 'could not load the section worker script', { error: e });
    return url;
  }
}

/** Marks a device whose catalogue is in files; before 0.9.8 it said which mode was chosen. */
const STORAGE_KEY = 'ultraiptv.playlists.storage';
const MOVE_TO_FILES_KEY = 'ultraiptv.playlists.defaultFast';

/** The catalogue is kept in files wherever the device has them; the browser keeps the database. */
function filesWanted(): boolean {
  return !!platform?.catalogFiles;
}

/**
 * Classic (the catalogue in the web database) was removed in 0.9.8. A device that used it, by
 * choice or because it was Android's default, loads its playlists again once, into files; the old
 * rows go from the database as each section is saved.
 */
function leaveClassic(): void {
  if (!platform?.catalogFiles) return;
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'fast') return;
    localStorage.setItem(STORAGE_KEY, 'fast');
    localStorage.setItem(MOVE_TO_FILES_KEY, '1');
  } catch {
    // nothing to remember it in: it loads into files when it next refreshes
  }
}

/**
 * True once, on the first launch after Classic went: playlists saved in the database are loaded
 * again into files (an install that had none has nothing to do).
 */
export async function takeMoveToFiles(): Promise<boolean> {
  try {
    if (localStorage.getItem(MOVE_TO_FILES_KEY) !== '1') return false;
    localStorage.removeItem(MOVE_TO_FILES_KEY);
  } catch {
    return false;
  }
  if (!(await listPlaylists()).length) return false;
  await forgetSavedLists();
  log.info('playlist', 'catalogue moved to files');
  return true;
}

export function onCatalogEvent(fn: (e: WorkerEvent) => void): () => void {
  return catalog().on(fn);
}
