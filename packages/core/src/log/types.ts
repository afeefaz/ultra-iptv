export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** One log line. Everything in here has already been through the redactor. */
export interface LogEntry {
  ts: string;
  level: LogLevel;
  area: string;
  event: string;
  data?: unknown;
  durMs?: number;
}

export interface LogSink {
  write(entry: LogEntry): void;
}
