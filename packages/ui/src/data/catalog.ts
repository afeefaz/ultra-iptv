import { log, logging } from '@ultra/core';
import type { Platform } from '@ultra/platform';
import { WorkerClient, type WorkerEvent } from '@ultra/worker';
import CatalogWorker from '@ultra/worker/worker?worker';

let client: WorkerClient | null = null;
let platform: Platform | null = null;

/** Must run before the first `catalog()` call so the worker knows whether to use native HTTP. */
export function setCatalogPlatform(p: Platform): void {
  platform = p;
}

/** The catalogue worker (spec §3). Created on first use; shares the log salt so host hashes match. */
export function catalog(): WorkerClient {
  if (!client) {
    client = new WorkerClient(new CatalogWorker());
    const http = platform?.http;
    if (http) client.setHttp(http);
    const keepHosts = ['localhost', '127.0.0.1'];
    if (location.hostname) keepHosts.push(location.hostname);
    client.call('init', { saltHex: logging.saltHex, keepHosts, logLevel: log.level, nativeHttp: !!http }).catch((e) => {
      log.error('worker', 'init failed', { error: e });
    });
  }
  return client;
}

export function onCatalogEvent(fn: (e: WorkerEvent) => void): () => void {
  return catalog().on(fn);
}
