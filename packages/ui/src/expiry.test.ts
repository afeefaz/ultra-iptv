import type { PlaylistRecord } from '@ultra/core';
import { describe, expect, it } from 'vitest';
import { expiryText } from './format';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 12, 12);
const playlist = (expiresAt?: number, withAccount = true) =>
  ({ id: 'p', name: 'P', type: 'xtream', host: 'h', order: 0, createdAt: 0, updatedAt: 0, refreshHours: 12, account: withAccount ? { expiresAt } : undefined }) as PlaylistRecord;

describe('expiryText', () => {
  it('says nothing when the provider never said (M3U, or not loaded yet)', () => {
    expect(expiryText(playlist(undefined, false), now)).toBeNull();
  });

  it('tells the end date, and warns in the last two weeks and after it', () => {
    expect(expiryText(playlist(now + 90 * DAY), now)).toMatchObject({ level: 'ok' });
    expect(expiryText(playlist(now + 5 * DAY), now)).toMatchObject({ level: 'soon' });
    expect(expiryText(playlist(now + 5 * DAY), now)!.text).toMatch(/5/);
    expect(expiryText(playlist(now + 12 * 60 * 60 * 1000), now)).toMatchObject({ level: 'soon' });
    expect(expiryText(playlist(now - DAY), now)).toMatchObject({ level: 'expired' });
  });

  it('says so when the account has no end date', () => {
    expect(expiryText(playlist(undefined), now)).toMatchObject({ level: 'ok' });
  });
});
