import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LogEntry, LogSink } from './types';

interface StoredEntry extends LogEntry {
  size: number;
}

interface LogDb extends DBSchema {
  logs: { key: number; value: StoredEntry };
  meta: { key: string; value: number };
}

export interface RingBufferOptions {
  dbName?: string;
  maxEntries?: number;
  maxBytes?: number;
  maxEntryBytes?: number;
  flushMs?: number;
}

/**
 * Recent log entries persisted in IndexedDB (spec §10): the last 5,000 entries or 2 MB,
 * whichever is hit first. Writes are batched so logging never blocks the UI.
 */
export class IdbRingBuffer implements LogSink {
  private pending: StoredEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dbPromise: Promise<IDBPDatabase<LogDb>> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private readonly opts: Required<RingBufferOptions>;

  constructor(opts: RingBufferOptions = {}) {
    this.opts = {
      dbName: 'ultraiptv-logs',
      maxEntries: 5000,
      maxBytes: 2 * 1024 * 1024,
      maxEntryBytes: 4 * 1024,
      flushMs: 2000,
      ...opts,
    };
  }

  write(entry: LogEntry): void {
    let stored: LogEntry = entry;
    let json = JSON.stringify(entry);
    if (json.length > this.opts.maxEntryBytes) {
      stored = { ...entry, data: { truncated: true, preview: JSON.stringify(entry.data).slice(0, 1000) } };
      json = JSON.stringify(stored);
    }
    this.pending.push({ ...stored, size: json.length });
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.opts.flushMs);
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.chain = this.chain.then(() => this.writePending()).catch(() => undefined);
    return this.chain;
  }

  async getAll(): Promise<LogEntry[]> {
    await this.flush();
    try {
      const rows = await (await this.db()).getAll('logs');
      return rows.map(stripSize);
    } catch {
      return [];
    }
  }

  async count(): Promise<number> {
    try {
      return await (await this.db()).count('logs');
    } catch {
      return 0;
    }
  }

  async clear(): Promise<void> {
    this.pending = [];
    await this.flush();
    const db = await this.db();
    const tx = db.transaction(['logs', 'meta'], 'readwrite');
    await tx.objectStore('logs').clear();
    await tx.objectStore('meta').put(0, 'bytes');
    await tx.done;
  }

  private db(): Promise<IDBPDatabase<LogDb>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<LogDb>(this.opts.dbName, 1, {
        upgrade(db) {
          db.createObjectStore('logs', { autoIncrement: true });
          db.createObjectStore('meta');
        },
      });
      this.dbPromise.catch(() => (this.dbPromise = null));
    }
    return this.dbPromise;
  }

  private async writePending(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    const db = await this.db();
    const tx = db.transaction(['logs', 'meta'], 'readwrite');
    const logs = tx.objectStore('logs');
    const meta = tx.objectStore('meta');
    let bytes = (await meta.get('bytes')) ?? 0;
    let count = await logs.count();
    for (const entry of batch) {
      await logs.add(entry);
      bytes += entry.size;
      count++;
    }
    let cursor = await logs.openCursor();
    while (cursor && (count > this.opts.maxEntries || bytes > this.opts.maxBytes)) {
      bytes -= cursor.value.size;
      count--;
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await meta.put(Math.max(0, bytes), 'bytes');
    await tx.done;
  }
}

function stripSize(row: StoredEntry): LogEntry {
  const entry: Partial<StoredEntry> = { ...row };
  delete entry.size;
  return entry as LogEntry;
}

export function toNdjson(entries: LogEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
}
