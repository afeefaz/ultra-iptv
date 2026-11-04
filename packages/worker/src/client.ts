import { AppError, log, logging, perf } from '@ultra/core';
import type { FromWorker, HttpReplyMessage, Method, RequestMessage, WorkerApi, WorkerEvent } from './protocol';

export type { WorkerApi, WorkerEvent } from './protocol';

type Listener = (event: WorkerEvent) => void;
type HttpHandler = (request: { url: string; headers?: Record<string, string>; timeoutMs: number }) => Promise<{ status: number; body: string }>;

/** Main-thread side of the catalogue worker: promise-based calls plus an event stream. */
export class WorkerClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; method: Method }>();
  private readonly listeners = new Set<Listener>();
  private http: HttpHandler | null = null;

  constructor(private readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    worker.onerror = (e) => log.error('worker', 'worker error', { message: e.message, line: e.lineno });
  }

  call<M extends Method>(method: M, ...args: Parameters<WorkerApi[M]>): ReturnType<WorkerApi[M]> {
    const id = this.nextId++;
    const message: RequestMessage = { id, method, args };
    // Round trip as the page sees it; the difference from `worker.<method>` is queueing and copying.
    const span = perf.span(`rpc.${method}`);
    return new Promise((resolve, reject) => {
      const settle = <T,>(fn: (v: T) => void) => (v: T) => {
        span.end();
        fn(v);
      };
      this.pending.set(id, { resolve: settle(resolve as (v: unknown) => void), reject: settle(reject), method });
      this.worker.postMessage(message);
    }) as ReturnType<WorkerApi[M]>;
  }

  /** Answers the worker's network requests with native HTTP (see `init({ nativeHttp })`). */
  setHttp(handler: HttpHandler): void {
    this.http = handler;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private receive(msg: FromWorker): void {
    if ('event' in msg) {
      if (msg.event === 'http') return this.answerHttp(msg);
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

  private answerHttp(msg: { reqId: number; url: string; headers?: Record<string, string>; timeoutMs: number }): void {
    const reply = (r: Omit<HttpReplyMessage, 'httpReply'>) => this.worker.postMessage({ httpReply: msg.reqId, ...r } as HttpReplyMessage);
    if (!this.http) return reply({ error: 'No native HTTP on this platform' });
    this.http({ url: msg.url, headers: msg.headers, timeoutMs: msg.timeoutMs }).then(
      (r) => reply({ status: r.status, body: r.body }),
      (e: unknown) => reply({ error: e instanceof Error ? e.message : String(e) }),
    );
  }
}
