import type { LogEntry, LogSink } from './types';

export const LOG_TAG = '[UltraIPTV]';

/** One greppable line per entry: `[UltraIPTV] info  net GET … 200 812ms k=v`. */
export function formatLine(entry: LogEntry): string {
  let line = `${LOG_TAG} ${pad(entry.level, 5)} ${entry.area} ${entry.event}`;
  if (entry.durMs !== undefined) line += ` ${entry.durMs}ms`;
  if (entry.data !== undefined) line += ' ' + formatData(entry.data);
  return line;
}

function formatData(data: unknown): string {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    return Object.keys(record)
      .map((k) => `${k}=${formatValue(record[k])}`)
      .join(' ');
  }
  return formatValue(data);
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return /[\s"=]/.test(v) ? JSON.stringify(v) : v;
  if (v === undefined) return 'undefined';
  return JSON.stringify(v);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/** Console output, readable with adb logcat, sdb dlog and ares-inspect (docs/debugging.md). */
export const consoleSink: LogSink = {
  write(entry) {
    const line = formatLine(entry);
    if (entry.level === 'error') console.error(line);
    else if (entry.level === 'warn') console.warn(line);
    else console.log(line);
  },
};
