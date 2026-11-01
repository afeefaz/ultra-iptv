import { log } from '../log';
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

/** Platforms with native HTTP (Android, phase 4) and tests replace the transport here. */
export function setFetch(fn: FetchFn): void {
  fetchImpl = fn;
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
      fetchImpl(url, { headers: opts.headers, signal: controller?.signal, credentials: 'omit', cache: 'no-store' }),
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

export async function getJson<T>(url: string, opts: GetOptions = {}): Promise<T> {
  const timer = log.time('net', 'GET', { url });
  try {
    const res = await request(url, opts);
    const text = await res.text();
    timer.end({ status: res.status, bytes: text.length });
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AppError({ code: 'format', message: 'The response was not valid JSON' });
    }
  } catch (e) {
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
  let bytes = 0;
  try {
    const res = await request(url, opts);
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
    timer.end({ status: res.status, bytes });
    return bytes;
  } catch (e) {
    timer.end({ error: toErrorInfo(e), bytes }, 'warn');
    throw e;
  }
}
