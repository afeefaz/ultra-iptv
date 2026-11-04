import { describe, expect, it } from 'vitest';
import { epgIsFresh } from './epg';

const HOUR = 3600_000;

describe('epgIsFresh', () => {
  const items = [{ stop: 1 * HOUR }, { stop: 2 * HOUR }, { stop: 3 * HOUR }, { stop: 4 * HOUR }];

  it('stays fresh while now and next are covered', () => {
    expect(epgIsFresh(items, 0, 2.5 * HOUR)).toBe(true);
    expect(epgIsFresh(items, 0, 3.1 * HOUR)).toBe(false);
  });

  it('keeps an empty guide for hours, so channels without one cost no requests', () => {
    expect(epgIsFresh([], 0, 5 * HOUR)).toBe(true);
    expect(epgIsFresh([], 0, 7 * HOUR)).toBe(false);
  });

  it('refetches old data even if it claims to cover now', () => {
    expect(epgIsFresh([{ stop: 100 * HOUR }, { stop: 200 * HOUR }], 0, 6 * HOUR)).toBe(false);
  });
});
