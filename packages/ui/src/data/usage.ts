import { perf } from '@ultra/core';

const KEY = 'ultraiptv.usage';
const SAVE_EVERY_MS = 30_000;

interface Usage {
  firstSeen: number;
  sessions: number;
  activeSeconds: number;
  counts: Record<string, number>;
}

function load(): Usage {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Usage;
  } catch {
    // starts fresh
  }
  return { firstSeen: Date.now(), sessions: 0, activeSeconds: 0, counts: {} };
}

let usage = load();
let activeSince = Date.now();

function save(): void {
  usage.activeSeconds += Math.round((Date.now() - activeSince) / 1000);
  activeSince = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(usage));
  } catch {
    // only loses a few counts
  }
}

/**
 * Which features get used, kept on this device only and never sent anywhere. Pass a feature name
 * ("search.channels", "play.movie"), never a title, channel name or anything the user typed.
 */
export function track(event: string): void {
  usage.counts[event] = (usage.counts[event] ?? 0) + 1;
  perf.count(`usage.${event}`);
}

export function startUsage(): void {
  usage.sessions++;
  save();
  setInterval(save, SAVE_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
    else activeSince = Date.now();
  });
}

export function usageSummary(): Usage {
  save();
  return usage;
}

export function clearUsage(): void {
  usage = { firstSeen: Date.now(), sessions: 1, activeSeconds: 0, counts: {} };
  save();
}
