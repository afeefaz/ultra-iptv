import { log, logging } from '@ultra/core';
import { WorkerClient, type WorkerEvent } from '@ultra/worker';
import CatalogWorker from '@ultra/worker/worker?worker';

let client: WorkerClient | null = null;

/** The catalogue worker (spec §3). Created on first use; shares the log salt so host hashes match. */
export function catalog(): WorkerClient {
  if (!client) {
    client = new WorkerClient(new CatalogWorker());
    const keepHosts = ['localhost', '127.0.0.1'];
    if (location.hostname) keepHosts.push(location.hostname);
    client.call('init', { saltHex: logging.saltHex, keepHosts, logLevel: log.level }).catch((e) => {
      log.error('worker', 'init failed', { error: e });
    });
  }
  return client;
}

export function onCatalogEvent(fn: (e: WorkerEvent) => void): () => void {
  return catalog().on(fn);
}
