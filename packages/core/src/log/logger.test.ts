import { describe, expect, it } from 'vitest';
import { formatLine } from './console-sink';
import { createHostHasher } from './host-hash';
import { Logger } from './logger';
import { Redactor } from './redact';
import type { LogEntry } from './types';

function makeLogger() {
  const logger = new Logger(new Redactor({ hashHost: createHostHasher(new Uint8Array(16)).hash }));
  const entries: LogEntry[] = [];
  logger.addSink({ write: (e) => entries.push(e) });
  return { logger, entries };
}

describe('Logger', () => {
  it('drops entries below the current level', () => {
    const { logger, entries } = makeLogger();
    logger.debug('a', 'hidden');
    logger.info('a', 'shown');
    logger.setLevel('debug');
    logger.debug('a', 'now shown');
    expect(entries.map((e) => e.event)).toEqual(['shown', 'now shown']);
  });

  it('redacts event text and data before sinks see them', () => {
    const { logger, entries } = makeLogger();
    logger.info('net', 'GET http://prov.example.com/live/u1x/p2y/1.ts', { password: 'p2y', url: 'http://u1x:p2y@prov.example.com/' });
    const json = JSON.stringify(entries[0]);
    expect(json).not.toContain('prov.example.com');
    expect(json).not.toContain('p2y');
    expect(json).not.toContain('u1x');
  });

  it('keeps going when a sink throws', () => {
    const { logger, entries } = makeLogger();
    logger.addSink({
      write: () => {
        throw new Error('boom');
      },
    });
    expect(() => logger.error('a', 'x')).not.toThrow();
    expect(entries).toHaveLength(1);
  });

  it('times operations', async () => {
    const { logger, entries } = makeLogger();
    const t = logger.time('net', 'load', { step: 1 });
    await new Promise((r) => setTimeout(r, 15));
    const ms = t.end({ status: 200 });
    expect(ms).toBeGreaterThanOrEqual(10);
    expect(entries[0]).toMatchObject({ event: 'load', data: { step: 1, status: 200 }, durMs: ms });
  });

  it('notifies subscribers with the redacted entry', () => {
    const { logger } = makeLogger();
    const seen: LogEntry[] = [];
    const off = logger.subscribe((e) => seen.push(e));
    logger.warn('player', 'reconnect', { attempt: 2 });
    off();
    logger.warn('player', 'reconnect', { attempt: 3 });
    expect(seen).toHaveLength(1);
  });
});

describe('formatLine', () => {
  it('produces one greppable line', () => {
    const line = formatLine({
      ts: '2026-10-31T00:00:00.000Z',
      level: 'info',
      area: 'player',
      event: 'first-frame',
      durMs: 812,
      data: { engine: 'avplay', note: 'two words' },
    });
    expect(line).toBe('[UltraIPTV] info  player first-frame 812ms engine=avplay note="two words"');
  });
});
