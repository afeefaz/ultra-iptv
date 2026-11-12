import { RELAY_URL } from '../pair/pair';

/** A static file on our website, so checking costs nothing on the relay's free plan. */
export const LATEST_URL = `${RELAY_URL}/latest.json`;
/** The Mac app's: the same format, for its own downloads (the app replaces itself through Tauri's updater). */
export const DESKTOP_LATEST_URL = `${RELAY_URL}/desktop/latest.json`;

/** What scripts/release-manifest.mjs publishes with each release. */
export interface LatestRelease {
  versionCode: number;
  versionName: string;
  url: string;
  sha256: string;
  size: number;
  notes: { en: string[]; ar: string[] };
}

/** Null if it isn't what we publish. It decides what gets installed, so nothing is assumed. */
export function parseLatest(text: string): LatestRelease | null {
  let value: Partial<LatestRelease>;
  try {
    value = JSON.parse(text) as Partial<LatestRelease>;
  } catch {
    return null;
  }
  const isList = (list: unknown) => Array.isArray(list) && list.every((item) => typeof item === 'string');
  if (typeof value?.versionCode !== 'number' || !Number.isInteger(value.versionCode) || value.versionCode < 1) return null;
  if (typeof value.versionName !== 'string' || !value.versionName) return null;
  if (typeof value.url !== 'string' || value.url.indexOf('https://') !== 0) return null;
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(value.sha256)) return null;
  if (typeof value.size !== 'number' || value.size < 1) return null;
  if (!value.notes || !isList(value.notes.en) || !isList(value.notes.ar)) return null;
  return value as LatestRelease;
}
