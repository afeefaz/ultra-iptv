import { LATEST_URL, log, parseLatest, perf, type LatestRelease } from '@ultra/core';
import type { Platform } from '@ultra/platform';
import { track } from './usage';

export type CheckResult = { kind: 'available'; latest: LatestRelease } | { kind: 'current' } | { kind: 'offline' };

/** Only when someone presses the button. */
export async function checkForUpdate(platform: Platform): Promise<CheckResult> {
  track('update.check');
  if (!platform.updater || !platform.http) return { kind: 'current' };
  const { updater, http } = platform;
  try {
    return await perf.timed('update.check', async () => {
      const [info, response] = await Promise.all([updater.info(), http({ url: LATEST_URL, headers: {}, timeoutMs: 15_000 })]);
      const latest = response.status === 200 ? parseLatest(response.body) : null;
      if (!latest) return { kind: 'offline' as const };
      return latest.versionCode > info.versionCode ? { kind: 'available' as const, latest } : { kind: 'current' as const };
    });
  } catch (e) {
    log.debug('update', 'check failed', { error: e });
    return { kind: 'offline' };
  }
}
