import { log, type LatestRelease } from '@ultra/core';
import type { Platform } from '@ultra/platform';
import { createSignal } from 'solid-js';
import { checkForUpdate } from './appUpdate';

/** How often the app looks for a new version by itself, on its own and while it stays open. */
export const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
/** Not on the way to the first screen. */
export const FIRST_CHECK_AFTER_MS = 8_000;
/** How often an open app asks itself whether the 12 hours are up. Cheap: no network. */
const TICK_MS = 15 * 60 * 1000;
/** Belongs to this device, so Push and Pull leave it alone (see syncAccess). */
export const LAST_CHECK_KEY = 'ultraiptv.update.lastCheck';

/**
 * Whether it's time to look again. A clock that went backwards (a TV that lost the date, then got
 * it back) counts as due, so a wrong date can't stop the checks for good.
 */
export function checkDue(now: number, lastCheck: number | null): boolean {
  if (lastCheck === null || !Number.isFinite(lastCheck)) return true;
  if (lastCheck > now) return true;
  return now - lastCheck >= CHECK_EVERY_MS;
}

function readLastCheck(): number | null {
  try {
    const value = localStorage.getItem(LAST_CHECK_KEY);
    return value ? Number(value) : null;
  } catch {
    return null;
  }
}

function writeLastCheck(at: number): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(at));
  } catch {
    // Without storage it checks on each start, which is still at most every 12 hours while open.
  }
}

const [offered, setOffered] = createSignal<LatestRelease | null>(null);
/** A newer version the automatic check found, until the popup is answered. */
export { offered as offeredUpdate };

/** Remind me later: quiet until the next check, 12 hours on. */
export function dismissOfferedUpdate(): void {
  setOffered(null);
}

let started = false;

/** Phones, Android TV, Mac and Windows: the places the app can update itself. */
export function startAutoUpdate(platform: Platform): void {
  if (started || !platform.updater || !platform.http) return;
  started = true;
  let busy = false;
  const tick = async () => {
    if (busy || offered() || !checkDue(Date.now(), readLastCheck())) return;
    busy = true;
    try {
      const result = await checkForUpdate(platform, 'auto');
      // Offline: no record, so the next tick tries again instead of waiting 12 hours.
      if (result.kind === 'offline') return;
      writeLastCheck(Date.now());
      if (result.kind === 'available') {
        log.info('update', 'new version found', { version: result.latest.versionName });
        setOffered(result.latest);
      }
    } finally {
      busy = false;
    }
  };
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), TICK_MS);
  }, FIRST_CHECK_AFTER_MS);
  // A phone or a computer left asleep for a day doesn't run timers; look as soon as it's back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tick();
  });
}
