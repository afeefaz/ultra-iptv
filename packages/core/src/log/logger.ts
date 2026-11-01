import type { Redactor } from './redact';
import { LEVELS, type LogEntry, type LogLevel, type LogSink } from './types';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface Timer {
  end(extra?: Record<string, unknown>, level?: LogLevel): number;
}

export class Logger {
  private readonly sinks: LogSink[] = [];
  private readonly listeners = new Set<(entry: LogEntry) => void>();
  private minLevel: LogLevel = 'info';

  constructor(readonly redactor: Redactor) {}

  get level(): LogLevel {
    return this.minLevel;
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  enabled(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[this.minLevel];
  }

  addSink(sink: LogSink): () => void {
    this.sinks.push(sink);
    return () => {
      const i = this.sinks.indexOf(sink);
      if (i >= 0) this.sinks.splice(i, 1);
    };
  }

  /** Live feed of (redacted) entries, e.g. for the debug screen. */
  subscribe(fn: (entry: LogEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  debug(area: string, event: string, data?: unknown): void {
    this.log('debug', area, event, data);
  }
  info(area: string, event: string, data?: unknown): void {
    this.log('info', area, event, data);
  }
  warn(area: string, event: string, data?: unknown): void {
    this.log('warn', area, event, data);
  }
  error(area: string, event: string, data?: unknown): void {
    this.log('error', area, event, data);
  }

  /** Starts a timer; `end()` logs the event with `durMs` and returns the duration. */
  time(area: string, event: string, data?: Record<string, unknown>): Timer {
    const start = now();
    return {
      end: (extra, level = 'info') => {
        const durMs = Math.round(now() - start);
        this.log(level, area, event, extra ? { ...data, ...extra } : data, durMs);
        return durMs;
      },
    };
  }

  log(level: LogLevel, area: string, event: string, data?: unknown, durMs?: number): void {
    if (!this.enabled(level)) return;
    const entry: LogEntry = { ts: new Date().toISOString(), level, area, event: this.redactor.text(event) };
    if (data !== undefined) entry.data = this.redactor.value(data);
    if (durMs !== undefined) entry.durMs = durMs;
    this.emit(entry);
  }

  /**
   * Accepts an entry produced elsewhere (the catalogue worker). It is redacted again here;
   * redaction is idempotent, so this only adds safety.
   */
  ingest(entry: LogEntry): void {
    if (!this.enabled(entry.level)) return;
    const clean: LogEntry = { ts: entry.ts, level: entry.level, area: entry.area, event: this.redactor.text(entry.event) };
    if (entry.data !== undefined) clean.data = this.redactor.value(entry.data);
    if (entry.durMs !== undefined) clean.durMs = entry.durMs;
    this.emit(clean);
  }

  private emit(entry: LogEntry): void {
    for (const sink of this.sinks) {
      try {
        sink.write(entry);
      } catch {
        // a broken sink must never break the app
      }
    }
    this.listeners.forEach((fn) => {
      try {
        fn(entry);
      } catch {
        // same for listeners
      }
    });
  }
}
