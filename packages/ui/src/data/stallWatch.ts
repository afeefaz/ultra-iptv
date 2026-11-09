/** How long the playback clock may stand still, while the player says it's playing, before it counts as frozen. */
export const FROZEN_AFTER_MS = 20_000;
/** How often the clock is looked at. */
export const WATCH_EVERY_MS = 5000;
/** A line in the log every so often while something plays, so a freeze can be told from a frozen app. */
export const HEARTBEAT_EVERY_MS = 5 * 60_000;

/**
 * Whether a stream has silently stopped: the player reports no error and no buffering, so nothing
 * else would ever notice. `lastProgressAt` is when its clock last moved, in ms, or undefined where
 * the engine can't say (then nothing is ever judged frozen).
 */
export function isFrozen(now: number, lastProgressAt: number | undefined, playing: boolean, reconnecting: boolean): boolean {
  if (!playing || reconnecting || !lastProgressAt) return false;
  return now - lastProgressAt >= FROZEN_AFTER_MS;
}
