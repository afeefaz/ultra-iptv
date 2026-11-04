/**
 * Local performance tracing (docs/performance.md). Nothing here ever leaves the device: it's read
 * from the debug screen, exported to a file, or pulled by scripts/perf over a debugging connection.
 *
 * Names and attributes must never hold URLs, titles, channel names or logins: only operations,
 * kinds and numbers.
 */

const MAX_EVENTS = 3000;
const MAX_SAMPLES = 512;

type Attrs = Record<string, string | number | boolean | undefined>;

export interface PerfEvent {
  /** Milliseconds since the Unix epoch, comparable between the page and the worker. */
  t: number;
  name: string;
  ms?: number;
  attrs?: Attrs;
}

export interface PerfStat {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
}

export interface PerfSnapshot {
  takenAt: number;
  stats: Record<string, PerfStat>;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  /** First occurrence of each mark, as milliseconds since `originAt`. */
  marks: Record<string, number>;
  originAt: number;
  events: PerfEvent[];
}

interface Series {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  samples: number[];
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export class Perf {
  private events: PerfEvent[] = [];
  private series = new Map<string, Series>();
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private marks = new Map<string, number>();
  /** When this thread's clock started, so spans can be placed on the epoch timeline. */
  private readonly originAt = Date.now() - nowMs();

  /** A one-off moment. Only the first time counts as "the" mark; every time is kept as an event. */
  mark(name: string, attrs?: Attrs): void {
    const at = nowMs();
    if (!this.marks.has(name)) this.marks.set(name, at);
    this.push({ t: this.originAt + at, name, attrs });
  }

  /** Records a mark at a time already known (browser navigation timing). */
  markAt(name: string, sinceOriginMs: number): void {
    if (!this.marks.has(name)) this.marks.set(name, sinceOriginMs);
  }

  span(name: string, attrs?: Attrs): { end: (extra?: Attrs) => number } {
    const start = nowMs();
    let ended = false;
    return {
      end: (extra) => {
        const ms = nowMs() - start;
        if (!ended) {
          ended = true;
          this.record(name, ms, extra ? { ...attrs, ...extra } : attrs, start);
        }
        return ms;
      },
    };
  }

  async timed<T>(name: string, fn: () => Promise<T>, attrs?: Attrs): Promise<T> {
    const span = this.span(name, attrs);
    try {
      return await fn();
    } finally {
      span.end();
    }
  }

  timedSync<T>(name: string, fn: () => T, attrs?: Attrs): T {
    const span = this.span(name, attrs);
    try {
      return fn();
    } finally {
      span.end();
    }
  }

  /** A duration measured elsewhere (long tasks, resource timing). */
  record(name: string, ms: number, attrs?: Attrs, startedAt?: number): void {
    let s = this.series.get(name);
    if (!s) this.series.set(name, (s = { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, samples: [] }));
    s.count++;
    s.totalMs += ms;
    s.minMs = Math.min(s.minMs, ms);
    s.maxMs = Math.max(s.maxMs, ms);
    // Past the cap, a random slot is replaced, so percentiles stay fair over a long session.
    if (s.samples.length < MAX_SAMPLES) s.samples.push(ms);
    else {
      const slot = Math.floor(Math.random() * s.count);
      if (slot < MAX_SAMPLES) s.samples[slot] = ms;
    }
    this.push({ t: this.originAt + (startedAt ?? nowMs() - ms), name, ms, attrs });
  }

  count(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  snapshot(): PerfSnapshot {
    const stats: Record<string, PerfStat> = {};
    this.series.forEach((s, name) => {
      const sorted = s.samples.slice().sort((a, b) => a - b);
      stats[name] = {
        count: s.count,
        totalMs: round(s.totalMs),
        minMs: round(s.minMs),
        maxMs: round(s.maxMs),
        p50Ms: round(percentile(sorted, 0.5)),
        p95Ms: round(percentile(sorted, 0.95)),
      };
    });
    const marks: Record<string, number> = {};
    this.marks.forEach((v, k) => (marks[k] = round(v)));
    return {
      takenAt: Date.now(),
      stats,
      counters: fromMap(this.counters),
      gauges: fromMap(this.gauges),
      marks,
      originAt: this.originAt,
      events: this.events.slice(),
    };
  }

  /** Clears measurements but keeps marks, so startup times survive a reset between test phases. */
  reset(): void {
    this.events = [];
    this.series.clear();
    this.counters.clear();
  }

  private push(event: PerfEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }
}

const round = (n: number) => Math.round(n * 10) / 10;

function fromMap(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  map.forEach((v, k) => (out[k] = v));
  return out;
}

/** One per thread: the page and the catalogue worker each have their own. */
export const perf = new Perf();
