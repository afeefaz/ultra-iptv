import { describe, expect, it } from 'vitest';
import { FROZEN_AFTER_MS, isFrozen } from './stallWatch';

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
