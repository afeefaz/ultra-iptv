import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (e: Record<string, unknown>) => void;
const listeners = new Map<string, Listener>();

vi.mock('./plugin', () => ({
  UltraPlayer: {
    addListener: async (event: string, fn: Listener) => void listeners.set(event, fn),
    load: async () => undefined,
    play: async () => undefined,
    pause: async () => undefined,
    stop: async () => undefined,
    seek: async () => undefined,
  },
}));

const { NativePlayer } = await import('./player');

const live = { url: 'http://x/live/1.ts', container: 'ts' as const, live: true };
const send = (event: string, e: Record<string, unknown>) => listeners.get(event)?.(e);
const progress = (current: number, renderedFrames?: number) => send('progress', { current, duration: 0, renderedFrames });

describe('NativePlayer freeze clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('knows nothing until the clock first moves', async () => {
    const p = new NativePlayer();
    await p.load(live, { buffer: 'balanced' });
    expect(p.lastProgressAt()).toBeUndefined();
    progress(1, 25);
    expect(p.lastProgressAt()).toBe(1_000_000);
  });

  it('stops counting when the clock stands still', async () => {
    const p = new NativePlayer();
    await p.load(live, { buffer: 'balanced' });
    progress(1, 25);
    vi.setSystemTime(1_030_000);
    progress(1, 25);
    expect(p.lastProgressAt()).toBe(1_000_000);
  });

  it('stops counting when a moving picture stops while the clock runs on', async () => {
    const p = new NativePlayer();
    await p.load(live, { buffer: 'balanced' });
    progress(10, 250);
    vi.setSystemTime(1_005_000);
    progress(15, 250);
    expect(p.lastProgressAt()).toBe(1_000_000);
  });

  it('counts a still image (radio) and sound-only streams by the clock alone', async () => {
    const p = new NativePlayer();
    await p.load(live, { buffer: 'balanced' });
    progress(1, 1);
    vi.setSystemTime(1_005_000);
    progress(6, 1);
    expect(p.lastProgressAt()).toBe(1_005_000);
    vi.setSystemTime(1_010_000);
    progress(11);
    expect(p.lastProgressAt()).toBe(1_010_000);
  });

  it('counts a freeze from when it plays again after a pause', async () => {
    const p = new NativePlayer();
    await p.load(live, { buffer: 'balanced' });
    progress(1, 25);
    vi.setSystemTime(1_060_000);
    send('state', { state: 'playing' });
    expect(p.lastProgressAt()).toBe(1_060_000);
  });

  it('starts afresh for each stream', async () => {
    const p = new NativePlayer();
    await p.load(live, { buffer: 'balanced' });
    progress(1, 25);
    await p.load(live, { buffer: 'balanced' });
    expect(p.lastProgressAt()).toBeUndefined();
  });
});
