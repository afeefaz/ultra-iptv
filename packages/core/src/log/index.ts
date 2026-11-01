import { consoleSink } from './console-sink';
import { createHostHasher, loadSalt, type HostHasher } from './host-hash';
import { Logger } from './logger';
import { Redactor } from './redact';
import { IdbRingBuffer } from './ring-buffer';
import { fromHex, toHex } from './sha256';
import { LEVELS, type LogLevel } from './types';

export { formatLine, LOG_TAG } from './console-sink';
export type { HostHasher } from './host-hash';
export { Logger, type Timer } from './logger';
export { MASK, Redactor } from './redact';
export { IdbRingBuffer, toNdjson } from './ring-buffer';
export { LEVELS, type LogEntry, type LogLevel, type LogSink } from './types';

const LEVEL_KEY = 'ultraiptv.log.level';

export interface Logging {
  log: Logger;
  redactor: Redactor;
  readonly hosts: HostHasher;
  /** Hex salt for host hashing, handed to the worker so both threads hash hosts identically. */
  readonly saltHex: string;
  buffer: IdbRingBuffer | null;
  /** Starts persisting entries in IndexedDB and flushing them when the app is hidden. */
  attachRingBuffer(): IdbRingBuffer | null;
  setLevel(level: LogLevel): void;
  /** Worker setup: adopt the main thread's salt; the worker forwards entries instead of printing. */
  configureWorker(saltHex: string, keepHosts: string[]): void;
  detachConsole(): void;
}

export interface LoggingOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  keepHosts?: string[];
  console?: boolean;
}

export function createLogging(opts: LoggingOptions = {}): Logging {
  let salt = loadSalt(opts.storage);
  let hosts = createHostHasher(salt);
  const redactor = new Redactor({ hashHost: (h) => hosts.hash(h), keepHosts: opts.keepHosts });
  const log = new Logger(redactor);
  const saved = readItem(opts.storage, LEVEL_KEY);
  if (saved && saved in LEVELS) log.setLevel(saved as LogLevel);
  let removeConsole = opts.console !== false ? log.addSink(consoleSink) : () => undefined;

  const logging: Logging = {
    log,
    redactor,
    get hosts() {
      return hosts;
    },
    get saltHex() {
      return toHex(salt);
    },
    buffer: null,
    configureWorker(saltHex, keepHosts) {
      salt = fromHex(saltHex);
      hosts = createHostHasher(salt);
      keepHosts.forEach((h) => redactor.addKeepHost(h));
    },
    detachConsole() {
      removeConsole();
      removeConsole = () => undefined;
    },
    attachRingBuffer() {
      if (logging.buffer) return logging.buffer;
      if (typeof indexedDB === 'undefined') return null;
      const buffer = new IdbRingBuffer();
      log.addSink(buffer);
      logging.buffer = buffer;
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') void buffer.flush();
        });
        window.addEventListener('pagehide', () => void buffer.flush());
      }
      return buffer;
    },
    setLevel(level) {
      log.setLevel(level);
      try {
        opts.storage?.setItem(LEVEL_KEY, level);
      } catch {
        // ignore
      }
    },
  };
  return logging;
}

function readItem(storage: LoggingOptions['storage'], key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

function ownHosts(): string[] {
  const hosts = ['localhost', '127.0.0.1'];
  if (typeof location !== 'undefined' && location.hostname) hosts.push(location.hostname);
  return hosts;
}

/** App-wide logging. Import `log` anywhere; the app calls `logging.attachRingBuffer()` at startup. */
export const logging = createLogging({ storage: browserStorage(), keepHosts: ownHosts() });
export const log = logging.log;
