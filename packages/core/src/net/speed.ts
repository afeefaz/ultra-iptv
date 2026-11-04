/**
 * Network speed test against the playlist's own provider: the app has no servers of its own and
 * talks to no third parties, and the provider's connection is the one streams depend on anyway.
 */

export interface DownloadOptions {
  /** How long to keep reading; 0 stops at the first response (measures response time). */
  seconds: number;
  onProgress?: (bytes: number, ms: number) => void;
  isCancelled?: () => boolean;
}

export interface DownloadResult {
  status: number;
  /** Time until the response started. */
  ttfbMs: number;
  /** Body bytes read, and the time spent reading them (ttfb excluded). */
  bytes: number;
  ms: number;
  /** The body was compressed in transit, so `bytes` overstates what really crossed the network. */
  compressed: boolean;
}

export type DownloadFn = (url: string, options: DownloadOptions) => Promise<DownloadResult>;

export interface SpeedTargets {
  /** A small request, for response time. */
  ping: string;
  /** Best first. `media` is a video file (incompressible); `catalog` is a big list as a fallback. */
  downloads: Array<{ url: string; kind: 'media' | 'catalog' }>;
}

export interface SpeedProgress {
  phase: 'ping' | 'download';
  /** 0–1 over the whole test. */
  fraction: number;
  mbps?: number;
}

export interface SpeedResult {
  mbps: number;
  peakMbps: number;
  pingMs: number;
  bytes: number;
  /** Less reliable: too little data, or compressed lists rather than a video file. */
  estimate: boolean;
}

export class SpeedTestCancelled extends Error {}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const HEADERS_TIMEOUT_MS = 15_000;
const PINGS = 3;
const MIN_MEDIA_BYTES = 256 * 1024;
const MIN_RELIABLE_BYTES = 2 * 1024 * 1024;
const PEAK_WINDOW_MS = 1000;
const TIME_USED_UP = 0.9;
/** A slow server spends most of the time before sending anything; don't wait forever for it. */
const MAX_WAIT_FACTOR = 3;

export const toMbps = (bytes: number, ms: number): number => (ms > 0 ? (bytes * 8) / 1000 / ms : 0);

/** Reads a response in the page and throws the data away, so a whole film never sits in memory. */
export const fetchDownload: DownloadFn = async (url, { seconds, onProgress, isCancelled }) => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const start = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error('No response from the server'));
    }, HEADERS_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([fetch(url, { credentials: 'omit', cache: 'no-store', signal: controller?.signal }), timeout]);
    clearTimeout(timer);
    const ttfbMs = now() - start;
    const encoding = res.headers.get('content-encoding');
    const compressed = !!encoding && encoding !== 'identity';
    const result = { status: res.status, ttfbMs, compressed };
    const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
    if (!res.ok || seconds === 0) {
      void reader?.cancel().catch(() => undefined);
      controller?.abort();
      return { ...result, bytes: 0, ms: 0 };
    }
    if (!reader) {
      // No streaming here: the whole body arrives at once, and the time still says how long it took.
      const body = await res.arrayBuffer();
      return { ...result, bytes: body.byteLength, ms: now() - start - ttfbMs };
    }
    const began = now();
    let bytes = 0;
    for (;;) {
      if (isCancelled?.()) throw new SpeedTestCancelled();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      const ms = now() - began;
      onProgress?.(bytes, ms);
      if (ms >= seconds * 1000) break;
    }
    const ms = now() - began;
    void reader.cancel().catch(() => undefined);
    controller?.abort();
    return { ...result, bytes, ms };
  } finally {
    clearTimeout(timer);
  }
};

/** Response time first, then as much data as fits in `seconds`, moving to the next target when one ends. */
export async function runSpeedTest(
  targets: SpeedTargets,
  download: DownloadFn,
  options: { seconds: number; onProgress?: (p: SpeedProgress) => void; isCancelled?: () => boolean },
): Promise<SpeedResult> {
  const { seconds, onProgress, isCancelled } = options;
  const checkCancelled = () => {
    if (isCancelled?.()) throw new SpeedTestCancelled();
  };
  const pingShare = 0.1;

  const pings: number[] = [];
  let pingError: unknown;
  for (let i = 0; i < PINGS; i++) {
    checkCancelled();
    onProgress?.({ phase: 'ping', fraction: (pingShare * i) / PINGS });
    try {
      const r = await download(targets.ping, { seconds: 0, isCancelled });
      if (r.status < 400) pings.push(r.ttfbMs);
    } catch (e) {
      if (e instanceof SpeedTestCancelled) throw e;
      pingError = e;
    }
  }

  let bytes = 0;
  let ms = 0;
  let peak = 0;
  let usedCatalog = false;
  let compressed = false;
  let lastError: unknown = pingError;
  let window = { bytes: 0, ms: 0 };

  const began = now();
  for (let t = 0; t < targets.downloads.length && ms < seconds * 1000 && now() - began < seconds * 1000 * MAX_WAIT_FACTOR; ) {
    checkCancelled();
    const target = targets.downloads[t];
    const baseBytes = bytes;
    const baseMs = ms;
    const allowedMs = seconds * 1000 - ms;
    let result: DownloadResult;
    try {
      result = await download(target.url, {
        seconds: allowedMs / 1000,
        isCancelled,
        onProgress: (b, m) => {
          const totalBytes = baseBytes + b;
          const totalMs = baseMs + m;
          if (totalMs - window.ms >= PEAK_WINDOW_MS) {
            peak = Math.max(peak, toMbps(totalBytes - window.bytes, totalMs - window.ms));
            window = { bytes: totalBytes, ms: totalMs };
          }
          onProgress?.({
            phase: 'download',
            fraction: Math.min(1, pingShare + ((1 - pingShare) * totalMs) / (seconds * 1000)),
            mbps: toMbps(totalBytes, totalMs),
          });
        },
      });
    } catch (e) {
      if (e instanceof SpeedTestCancelled) throw e;
      lastError = e;
      t++;
      continue;
    }
    // A "video" that is an error page or ends after almost nothing says nothing; try the next
    // target. (The time running out mid-file isn't that: it's the normal way a read ends.)
    const endedEarly = result.ms < allowedMs * TIME_USED_UP;
    if (result.status >= 400 || (target.kind === 'media' && endedEarly && result.bytes < MIN_MEDIA_BYTES)) {
      if (result.status >= 400) lastError = new Error(`HTTP ${result.status}`);
      t++;
      continue;
    }
    bytes += result.bytes;
    ms += result.ms;
    if (target.kind === 'catalog') usedCatalog = true;
    if (result.compressed) compressed = true;
    if (result.bytes === 0) t++;
  }

  if (!bytes || !ms) throw lastError instanceof Error ? lastError : new Error('The provider sent no data');
  const mbps = toMbps(bytes, ms);
  return {
    mbps,
    peakMbps: Math.max(peak, mbps),
    pingMs: pings.length ? Math.min(...pings) : 0,
    bytes,
    estimate: compressed || usedCatalog || bytes < MIN_RELIABLE_BYTES,
  };
}
