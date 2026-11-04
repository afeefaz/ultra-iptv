import { describe, expect, it } from 'vitest';
import { Perf } from './perf';

describe('Perf', () => {
  it('summarises spans into counts and percentiles', () => {
    const p = new Perf();
    for (let i = 1; i <= 100; i++) p.record('a', i);
    const { stats } = p.snapshot();
    expect(stats.a).toMatchObject({ count: 100, minMs: 1, maxMs: 100, totalMs: 5050, p50Ms: 51, p95Ms: 96 });
  });

  it('counts a span once, even if ended twice', () => {
    const p = new Perf();
    const span = p.span('s');
    span.end();
    span.end();
    expect(p.snapshot().stats.s.count).toBe(1);
  });

  it('keeps the first time of a mark, and marks survive a reset', () => {
    const p = new Perf();
    p.markAt('m', 5);
    p.markAt('m', 9);
    p.count('c');
    p.record('s', 1);
    p.reset();
    const snap = p.snapshot();
    expect(snap.marks.m).toBe(5);
    expect(snap.counters).toEqual({});
    expect(snap.stats).toEqual({});
  });

  it('times async work and still records when it fails', async () => {
    const p = new Perf();
    await expect(p.timed('t', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(p.snapshot().stats.t.count).toBe(1);
  });

  it('caps stored events and samples on a long session', () => {
    const p = new Perf();
    for (let i = 0; i < 5000; i++) p.record('a', 1);
    const snap = p.snapshot();
    expect(snap.events.length).toBe(3000);
    expect(snap.stats.a.count).toBe(5000);
  });
});
