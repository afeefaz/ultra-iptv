import { AppError, log, logging } from '@ultra/core';
import type { FromWorker, Method, RequestMessage, WorkerApi, WorkerEvent } from './protocol';

export type { WorkerApi, WorkerEvent } from './protocol';

type Listener = (event: WorkerEvent) => void;

/** Main-thread side of the catalogue worker: promise-based calls plus an event stream. */
export class WorkerClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; method: Method }>();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    worker.onerror = (e) => log.error('worker', 'worker error', { message: e.message, line: e.lineno });
  }

  call<M extends Method>(method: M, ...args: Parameters<WorkerApi[M]>): ReturnType<WorkerApi[M]> {
    const id = this.nextId++;
    const message: RequestMessage = { id, method, args };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method });
      this.worker.postMessage(message);
    }) as ReturnType<WorkerApi[M]>;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private receive(msg: FromWorker): void {
    if ('event' in msg) {
      if (msg.event === 'log') log.ingest(msg.entry);
      else if (msg.event === 'secrets') {
        msg.secrets.forEach((s) => logging.redactor.addSecret(s));
        msg.hosts.forEach((h) => logging.redactor.addHost(h));
      }
      this.listeners.forEach((fn) => fn(msg));
      return;
    }
    const waiter = this.pending.get(msg.id);
    if (!waiter) return;
    this.pending.delete(msg.id);
    if (msg.ok) waiter.resolve(msg.result);
    else waiter.reject(new AppError(msg.error));
  }
}
