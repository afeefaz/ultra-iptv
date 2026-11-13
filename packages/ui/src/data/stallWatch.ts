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

/** How long a reconnected stream must keep playing before its next drop starts the retries afresh. */
export const STEADY_AFTER_MS = 60_000;

/**
 * Whether a stream that came back during reconnecting (at `recoveredAt`, 0 if it hasn't) has played
 * long enough for the next drop to count as a new outage. One that plays for a second and stops
 * again is the same outage: the retries keep counting, so they reach the other container and in
 * the end say so, instead of starting over at attempt 1 forever.
 */
export function steadyAgain(recoveredAt: number, now: number): boolean {
  return recoveredAt > 0 && now - recoveredAt >= STEADY_AFTER_MS;
}

/** Pauses to buffer that, this close together, mean a live stream is starving. */
export const STUTTER_PAUSES = 4;
export const STUTTER_WINDOW_MS = 60_000;

/**
 * Whether a live stream keeps pausing to buffer: each pause is too short to count as stalled, but a
 * connection that delivers slower than the picture plays never recovers by itself, and a fresh
 * one often does. `pauses` are when each pause started, oldest first.
 */
export function isStuttering(pauses: number[], now: number): boolean {
  return pauses.filter((at) => now - at < STUTTER_WINDOW_MS).length >= STUTTER_PAUSES;
}
