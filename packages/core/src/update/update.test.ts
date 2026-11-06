import { describe, expect, it } from 'vitest';
import { LATEST_URL, parseLatest } from './update';

const GOOD = { versionCode: 5, versionName: '0.5.0', url: 'https://github.com/afeefaz/ultra-iptv/releases/download/v0.5.0/UltraIPTV.apk', sha256: 'a'.repeat(64), size: 12_000_000, notes: { en: ['New'], ar: ['جديد'] } };

describe('parseLatest', () => {
  it('reads what we publish', () => {
    expect(parseLatest(JSON.stringify(GOOD))).toEqual(GOOD);
  });

  it('is served from our own website over https', () => {
    expect(LATEST_URL).toMatch(/^https:\/\/.*\/latest\.json$/);
  });

  it('rejects anything else', () => {
    expect(parseLatest('not json')).toBeNull();
    expect(parseLatest('null')).toBeNull();
    expect(parseLatest('<html>')).toBeNull();
    for (const bad of [
      { versionCode: '5' },
      { versionCode: 0 },
      { versionCode: 1.5 },
      { versionName: '' },
      { url: 'http://example.com/a.apk' },
      { sha256: 'abc' },
      { sha256: 'z'.repeat(64) },
      { size: 0 },
      { notes: undefined },
      { notes: { en: ['x'] } },
      { notes: { en: [1], ar: [] } },
    ]) {
      expect(parseLatest(JSON.stringify({ ...GOOD, ...bad }))).toBeNull();
    }
  });
});
