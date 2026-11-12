import { log } from '../log';
import { perf } from '../perf/perf';
import type { ErrorInfo } from '../catalog/model';

export class AppError extends Error {
  constructor(readonly info: ErrorInfo) {
    super(info.message);
    this.name = 'AppError';
  }
}

export function toErrorInfo(e: unknown): ErrorInfo {
  if (e instanceof AppError) return e.info;
  return { code: 'internal', message: e instanceof Error ? e.message : String(e) };
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (url, init) => fetch(url, init);
let fallbackImpl: FetchFn | null = null;
/** Origins that only work through the fallback; they skip the first attempt from then on. */
const fallbackOrigins = new Set<string>();

/** Tests replace the transport here. */
export function setFetch(fn: FetchFn): void {
  fetchImpl = fn;
}

/**
 * Platforms with native HTTP (Android) set it as a fallback: the page's own `fetch` is much faster
 * (streams straight into the worker), so it's tried first, and native HTTP is used for providers
 * that block browser requests (CORS) or when the connection fails.
 */
export function setFallbackFetch(fn: FetchFn | null): void {
  fallbackImpl = fn;
  fallbackOrigins.clear();
}

/** Whether requests to this server already go through native HTTP (the page's `fetch` can't reach it). */
export function usesNativeHttp(url: string): boolean {
  return !!fallbackImpl && fallbackOrigins.has(originOf(url));
}

function originOf(url: string): string {
  const m = /^[a-z]+:\/\/[^/]+/i.exec(url);
  return m ? m[0].toLowerCase() : '';
}

/** Primary transport, then the fallback for failures without an HTTP answer. */
async function send(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const origin = originOf(url);
  if (fallbackImpl && fallbackOrigins.has(origin)) return sendFallback(url, init);
  try {
    return await fetchImpl(url, init);
  } catch (e) {
    if (!fallbackImpl || (init.signal && init.signal.aborted)) throw e;
    log.info('net', 'using native HTTP for this server', { url: origin, timeoutMs });
    fallbackOrigins.add(origin);
    perf.count('net.fallbackUsed');
    return sendFallback(url, init);
  }
}

/** Native HTTP can hit a stale pooled connection ("unexpected end of stream"): retry once. */
async function sendFallback(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fallbackImpl!(url, init);
  } catch (e) {
    if (init.signal && init.signal.aborted) throw e;
    return fallbackImpl!(url, init);
  }
}

export interface GetOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

async function request(url: string, opts: GetOptions): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new AppError({ code: 'timeout', message: `No response after ${Math.round(timeoutMs / 1000)} s` }));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      send(url, { headers: opts.headers, signal: controller?.signal, credentials: 'omit', cache: 'no-store' }, timeoutMs),
      timeout,
    ]);
    if (!res.ok) {
      const code = res.status === 401 || res.status === 403 ? 'auth' : 'http';
      throw new AppError({ code, status: res.status, message: `HTTP ${res.status}` });
    }
    return res;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(classifyFetchFailure(url));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `fetch` rejects with an opaque TypeError for CORS, mixed content and plain network failures.
 * Narrow it down as far as the browser allows (spec §4.5).
 */
function classifyFetchFailure(url: string): ErrorInfo {
  const page = typeof location !== 'undefined' ? location : undefined;
  if (page && page.protocol === 'https:' && /^http:/i.test(url)) {
    return { code: 'cors', message: 'Blocked: an http:// address cannot be loaded from an https:// page (mixed content)' };
  }
  let crossOrigin = false;
  try {
    crossOrigin = !!page && new URL(url).origin !== page.origin;
  } catch {
    // invalid URL: treat as network
  }
  if (crossOrigin) {
    return { code: 'cors', message: 'The provider could not be reached from the browser (CORS or network)' };
  }
  return { code: 'network', message: 'Network error' };
}

/** What a request is for, without anything identifying: the API action, or just "login" / "other". */
function operationOf(url: string): string {
  const action = /[?&]action=([a-z_]+)/.exec(url);
  if (action) return action[1];
  return /player_api\.php/.test(url) ? 'login' : 'other';
}

export function parseJson<T>(url: string, text: string): T {
  try {
    return perf.timedSync(`net.parse.${operationOf(url)}`, () => JSON.parse(text) as T);
  } catch {
    throw new AppError({ code: 'format', message: 'The response was not valid JSON' });
  }
}

export async function getJson<T>(url: string, opts: GetOptions = {}): Promise<T> {
  return parseJson<T>(url, await getText(url, opts));
}

/** A whole response as text, for callers that can skip parsing when nothing changed. */
export async function getText(url: string, opts: GetOptions = {}): Promise<string> {
  const timer = log.time('net', 'GET', { url });
  const op = operationOf(url);
  const total = perf.span(`net.total.${op}`);
  try {
    const firstByte = perf.span(`net.ttfb.${op}`);
    const res = await request(url, opts);
    firstByte.end();
    // Tells us whether the provider compresses; most browsers hide this header cross-origin.
    perf.count(`net.encoding.${res.headers.get('content-encoding') ?? 'hidden'}`);
    const text = await res.text();
    total.end({ status: res.status, chars: text.length });
    perf.count(`net.chars.${op}`, text.length);
    timer.end({ status: res.status, bytes: text.length });
    return text;
  } catch (e) {
    total.end();
    perf.count(`net.failed.${op}`);
    timer.end({ error: toErrorInfo(e) }, 'warn');
    throw e;
  }
}

/** Streams a text body chunk by chunk, so large M3U files are never held as one string. */
export async function getTextStream(
  url: string,
  onChunk: (chunk: string) => boolean | void,
  opts: GetOptions = {},
): Promise<number> {
  const timer = log.time('net', 'GET (stream)', { url });
  const total = perf.span('net.total.stream');
  let bytes = 0;
  try {
    const firstByte = perf.span('net.ttfb.stream');
    const res = await request(url, opts);
    firstByte.end();
    const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
    if (!reader) {
      const text = await res.text();
      bytes = text.length;
      onChunk(text);
    } else {
      const decoder = new TextDecoder('utf-8');
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        // `false` from the callback stops early (e.g. "test" only needs the first entries).
        if (onChunk(decoder.decode(value, { stream: true })) === false) {
          void reader.cancel();
          break;
        }
      }
      onChunk(decoder.decode());
    }
    total.end({ status: res.status, bytes });
    perf.count('net.bytes.stream', bytes);
    timer.end({ status: res.status, bytes });
    return bytes;
  } catch (e) {
    total.end();
    perf.count('net.failed.stream');
    timer.end({ error: toErrorInfo(e), bytes }, 'warn');
    throw e;
  }
}
