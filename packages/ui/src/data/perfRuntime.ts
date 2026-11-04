import { perf, type PerfSnapshot } from '@ultra/core';
import type { Platform, SystemUsage } from '@ultra/platform';
import { catalog } from './catalog';
import { clearUsage, usageSummary } from './usage';

const MEMORY_EVERY_MS = 5000;
const FRAME_BUDGET_MS = 1000 / 60;

export interface PerfReport {
  device: ReturnType<Platform['device']>;
  page: PerfSnapshot;
  worker: PerfSnapshot | null;
  usage: ReturnType<typeof usageSummary>;
  system: SystemUsage | null;
}

let platform: Platform | null = null;
let frameTimer = 0;

/** Browser navigation timing, as marks from the start of the page's load. */
function readNavigationMarks(): void {
  const timing = performance.timing;
  if (timing) {
    const start = timing.navigationStart;
    const at = (name: string, value: number) => value > 0 && perf.markAt(name, value - start);
    at('nav.responseEnd', timing.responseEnd);
    at('nav.domInteractive', timing.domInteractive);
    at('nav.domContentLoaded', timing.domContentLoadedEventEnd);
    at('nav.load', timing.loadEventEnd);
  }
  performance.getEntriesByType('paint').forEach((e) => perf.markAt(`nav.${e.name}`, e.startTime));
}

function observe(type: string, fn: (entry: PerformanceEntry) => void): void {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ entryTypes: [type] });
  } catch {
    // this engine doesn't have that entry type (older TVs)
  }
}

/** Measures every frame gap until stopped. Only runs when asked: it keeps the CPU awake. */
function startFrames(): void {
  if (frameTimer) return;
  let last = performance.now();
  const tick = (time: number) => {
    const gap = time - last;
    last = time;
    perf.record('frame.gap', gap);
    if (gap > FRAME_BUDGET_MS * 1.5) perf.count('frame.dropped', Math.round(gap / FRAME_BUDGET_MS) - 1);
    frameTimer = requestAnimationFrame(tick);
  };
  frameTimer = requestAnimationFrame(tick);
}

function stopFrames(): void {
  cancelAnimationFrame(frameTimer);
  frameTimer = 0;
}

async function sampleMemory(): Promise<SystemUsage | null> {
  const usage = (await platform?.systemUsage?.().catch(() => null)) ?? null;
  if (usage?.ramUsed !== undefined) perf.gauge('memory.deviceUsedBytes', usage.ramUsed);
  if (usage?.ramTotal !== undefined) perf.gauge('memory.deviceTotalBytes', usage.ramTotal);
  if (usage?.appUsed !== undefined) perf.gauge('memory.appBytes', usage.appUsed);
  return usage;
}

export async function perfReport(): Promise<PerfReport> {
  readNavigationMarks();
  const system = await sampleMemory();
  const worker = await catalog()
    .call('perfSnapshot')
    .catch(() => null);
  return { device: platform!.device(), page: perf.snapshot(), worker, usage: usageSummary(), system };
}

export function perfReset(): Promise<void> {
  perf.reset();
  return catalog().call('perfReset');
}

export { clearUsage };

/** Starts what's cheap enough to always run, and the hook scripts/perf drives the app through. */
export function startPerfRuntime(p: Platform): void {
  platform = p;
  observe('longtask', (e) => perf.record('main.longTask', e.duration));
  observe('resource', (e) => {
    const r = e as PerformanceResourceTiming;
    if (r.initiatorType === 'img') perf.record('net.image', r.duration);
  });
  // Broken posters and logos: failures don't bubble, so this needs the capture phase.
  document.addEventListener(
    'error',
    (e) => {
      if ((e.target as Element | null)?.tagName === 'IMG') perf.count('net.imageFailed');
    },
    true,
  );
  document.addEventListener('visibilitychange', () => perf.count(document.hidden ? 'app.hidden' : 'app.visible'));
  setInterval(() => void sampleMemory(), MEMORY_EVERY_MS);
  (window as unknown as { __ultraPerf: unknown }).__ultraPerf = { report: perfReport, reset: perfReset, startFrames, stopFrames };
}
