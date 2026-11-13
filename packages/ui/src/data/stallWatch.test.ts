import { describe, expect, it } from 'vitest';
import { FROZEN_AFTER_MS, isFrozen, isStuttering, STEADY_AFTER_MS, steadyAgain, STUTTER_PAUSES, STUTTER_WINDOW_MS } from './stallWatch';

const NOW = 1_000_000;

describe('isFrozen', () => {
  it('is not frozen while the clock moves', () => {
    expect(isFrozen(NOW, NOW - 1000, true, false)).toBe(false);
  });

  it('is frozen once the clock has stood still long enough', () => {
    expect(isFrozen(NOW, NOW - FROZEN_AFTER_MS, true, false)).toBe(true);
    expect(isFrozen(NOW, NOW - FROZEN_AFTER_MS + 1, true, false)).toBe(false);
  });

  it('leaves paused, buffering and reconnecting streams to the code that knows about them', () => {
    expect(isFrozen(NOW, NOW - 60_000, false, false)).toBe(false);
    expect(isFrozen(NOW, NOW - 60_000, true, true)).toBe(false);
  });

  it('never judges an engine that does not report its clock', () => {
    expect(isFrozen(NOW, undefined, true, false)).toBe(false);
  });
});

describe('steadyAgain', () => {
  it('is false when the stream never came back', () => {
    expect(steadyAgain(0, NOW)).toBe(false);
  });

  it('keeps counting when the stream came back only briefly', () => {
    expect(steadyAgain(NOW - 1000, NOW)).toBe(false);
    expect(steadyAgain(NOW - STEADY_AFTER_MS + 1, NOW)).toBe(false);
  });

  it('starts afresh once the stream played long enough', () => {
    expect(steadyAgain(NOW - STEADY_AFTER_MS, NOW)).toBe(true);
  });
});

describe('isStuttering', () => {
  const every = (ms: number, n: number) => Array.from({ length: n }, (_, i) => NOW - ms * (n - i));

  it('ignores the odd pause', () => {
    expect(isStuttering(every(10_000, STUTTER_PAUSES - 1), NOW)).toBe(false);
  });

  it('notices pauses close together', () => {
    expect(isStuttering(every(10_000, STUTTER_PAUSES), NOW)).toBe(true);
  });

  it('forgets pauses older than the window', () => {
    expect(isStuttering(every(STUTTER_WINDOW_MS / 2, STUTTER_PAUSES), NOW)).toBe(false);
  });
});
