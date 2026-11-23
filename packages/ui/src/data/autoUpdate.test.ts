import { describe, expect, it, vi } from 'vitest';

vi.mock('./catalog', () => ({ catalog: () => ({ call: async () => undefined }) }));
vi.mock('./playlists', () => ({ activePlaylist: () => null }));

const { CHECK_EVERY_MS, checkDue, LAST_CHECK_KEY } = await import('./autoUpdate');
const { isSyncedSetting } = await import('./syncAccess');

const NOW = 1_800_000_000_000;

describe('checkDue', () => {
  it('checks the first time', () => {
    expect(checkDue(NOW, null)).toBe(true);
  });

  it('waits 12 hours after a check', () => {
    expect(checkDue(NOW, NOW - 60_000)).toBe(false);
    expect(checkDue(NOW, NOW - CHECK_EVERY_MS + 1)).toBe(false);
    expect(checkDue(NOW, NOW - CHECK_EVERY_MS)).toBe(true);
  });

  it('checks when the clock went back, so a wrong date never stops it', () => {
    expect(checkDue(NOW, NOW + 60_000)).toBe(true);
  });

  it('checks when the stored time is unreadable', () => {
    expect(checkDue(NOW, Number.NaN)).toBe(true);
  });
});

describe('the last check time', () => {
  it('stays on this device', () => {
    expect(isSyncedSetting(LAST_CHECK_KEY)).toBe(false);
  });
});
