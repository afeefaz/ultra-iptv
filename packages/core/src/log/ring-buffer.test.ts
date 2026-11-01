import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IdbRingBuffer, toNdjson } from './ring-buffer';
import type { LogEntry } from './types';

let dbCounter = 0;
const newBuffer = (opts: ConstructorParameters<typeof IdbRingBuffer>[0] = {}) =>
  new IdbRingBuffer({ dbName: `test-logs-${dbCounter++}`, flushMs: 60_000, ...opts });

const entry = (i: number, data?: unknown): LogEntry => ({
  ts: new Date(2026, 0, 1, 0, 0, i).toISOString(),
  level: 'info',
  area: 'test',
  event: `e${i}`,
  data,
});

describe('IdbRingBuffer', () => {
  it('keeps only the newest maxEntries', async () => {
    const buf = newBuffer({ maxEntries: 10 });
    for (let i = 0; i < 30; i++) buf.write(entry(i));
    const all = await buf.getAll();
    expect(all.map((e) => e.event)).toEqual(Array.from({ length: 10 }, (_, k) => `e${20 + k}`));
  });

  it('trims by total size', async () => {
    const buf = newBuffer({ maxBytes: 2000 });
    for (let i = 0; i < 50; i++) buf.write(entry(i, { pad: 'x'.repeat(100) }));
    const all = await buf.getAll();
    expect(all.length).toBeLessThan(50);
    expect(JSON.stringify(all).length).toBeLessThanOrEqual(2000 + all.length * 10);
    expect(all[all.length - 1].event).toBe('e49');
  });

  it('truncates oversized entries instead of dropping them', async () => {
    const buf = newBuffer({ maxEntryBytes: 500 });
    buf.write(entry(1, { big: 'y'.repeat(5000) }));
    const [stored] = await buf.getAll();
    expect(stored.data).toMatchObject({ truncated: true });
    expect(JSON.stringify(stored).length).toBeLessThan(1500);
  });

  it('persists across instances and clears', async () => {
    const name = `test-logs-${dbCounter++}`;
    const a = new IdbRingBuffer({ dbName: name, flushMs: 60_000 });
    a.write(entry(1));
    await a.flush();
    const b = new IdbRingBuffer({ dbName: name });
    expect(await b.count()).toBe(1);
    await b.clear();
    expect(await b.getAll()).toEqual([]);
  });

  it('exports NDJSON', () => {
    const text = toNdjson([entry(1), entry(2)]);
    expect(text.trim().split('\n').map((l) => JSON.parse(l).event)).toEqual(['e1', 'e2']);
  });
});
