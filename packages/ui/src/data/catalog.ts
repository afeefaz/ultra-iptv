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
  rememberMode();
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
    void keyReady
      .then((key) =>
        worker.call('init', { saltHex: logging.saltHex, keepHosts, logLevel: log.level, nativeHttp: !!http, catalogFiles: !!files, sectionWorkerUrl: files ? new URL(sectionWorkerPath, location.href).href : undefined,
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

const STORAGE_KEY = 'ultraiptv.playlists.storage';
const RELOAD_ALL_KEY = 'ultraiptv.playlists.reloadAll';

/**
 * Where the catalogue is kept (Settings → Playlists → Loading), on devices with file storage
 * (Samsung): Fast keeps it in files, one per section; Classic keeps it in the web database, as
 * before files. Elsewhere it's always the database.
 */
export type StorageMode = 'classic' | 'fast';

export function storageMode(): StorageMode {
  // Samsung starts on Fast; Android, where the database has room, starts on Classic.
  const fallback: StorageMode = platform && platform.catalogFilesByDefault === false ? 'classic' : 'fast';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'classic' || saved === 'fast' ? saved : fallback;
  } catch {
    return fallback;
  }
}

function filesWanted(): boolean {
  return storageMode() === 'fast';
}

/** Whether this device can keep the catalogue in files, so the choice is offered. */
export function fastStorageAvailable(): boolean {
  return !!platform?.catalogFiles;
}

/**
 * Switches mode: every playlist is loaded again in full, after the app restarts (the worker is set
 * up for one mode). Leaving Fast deletes the files, which nothing would read any more.
 */
export async function changeStorageMode(mode: StorageMode): Promise<void> {
  if (mode === storageMode()) return;
  await forgetSavedLists();
  const files = platform?.catalogFiles;
  if (mode === 'classic' && files) {
    for (const p of await listPlaylists()) await files.removeDir(p.id).catch(() => undefined);
  }
  try {
    localStorage.setItem(STORAGE_KEY, mode);
    localStorage.setItem(RELOAD_ALL_KEY, '1');
  } catch {
    // nothing to remember it in: stays as it was
  }
  log.info('playlist', 'loading mode changed', { mode });
  location.reload();
}

/**
 * A device that never chose takes this platform's default, and keeps it from then on, so a later
 * change of default doesn't move it silently. A Mac on 0.9.0 ran Classic without choosing; Fast is
 * its default now, so its playlists load again into files, as when Loading is changed by hand.
 */
function rememberMode(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY) !== null) return;
    const mode = storageMode();
    localStorage.setItem(STORAGE_KEY, mode);
    if (mode === 'fast' && platform?.catalogFilesByDefault === true) localStorage.setItem(DEFAULT_CHANGED_KEY, '1');
  } catch {
    // nothing to remember it in
  }
}

const DEFAULT_CHANGED_KEY = 'ultraiptv.playlists.defaultFast';

/**
 * True once, on the first launch with Fast as the default: playlists saved in Classic before that
 * are loaded again into files (an install that had none has nothing to do).
 */
export async function takeDefaultChange(): Promise<boolean> {
  try {
    if (localStorage.getItem(DEFAULT_CHANGED_KEY) !== '1') return false;
    localStorage.removeItem(DEFAULT_CHANGED_KEY);
  } catch {
    return false;
  }
  if (!(await listPlaylists()).length) return false;
  await forgetSavedLists();
  log.info('playlist', 'loading mode is now the default', { mode: 'fast' });
  return true;
}

/** True once after a mode change: every playlist should be loaded again. */
export function takeReloadAll(): boolean {
  try {
    const wanted = localStorage.getItem(RELOAD_ALL_KEY) === '1';
    localStorage.removeItem(RELOAD_ALL_KEY);
    return wanted;
  } catch {
    return false;
  }
}

export function onCatalogEvent(fn: (e: WorkerEvent) => void): () => void {
  return catalog().on(fn);
}
