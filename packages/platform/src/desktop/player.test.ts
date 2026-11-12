import { describe, expect, it } from 'vitest';
import { CANNOT_CONNECT } from '../errors';
import type { PlayerError, PlayerState } from '../types';
import { MpvPlayer, toTracks, type MpvBridge } from './player';
import type { MpvEvent } from './plugin';

function setup() {
  let send: (e: MpvEvent) => void = () => undefined;
  const calls: string[] = [];
  const bridge: MpvBridge = {
    events: async (fn) => void (send = fn),
    load: async (o) => void calls.push(`load ${o.url} ${o.buffer} ${o.startAt ?? '-'}`),
    pause: async (p) => void calls.push(`pause ${p}`),
    stop: async () => void calls.push('stop'),
    seek: async (s) => void calls.push(`seek ${s}`),
    select: async (k, id) => void calls.push(`select ${k} ${id}`),
    setRect: async (m) => void calls.push(`rect ${m}`),
  };
  const player = new MpvPlayer(bridge);
  const states: PlayerState[] = [];
  const errors: PlayerError[] = [];
  let frames = 0;
  player.on('state', (s) => states.push(s));
  player.on('error', (e) => errors.push(e));
  player.on('firstFrame', () => frames++);
  return { player, send: (e: MpvEvent) => send(e), calls, states, errors, frames: () => frames };
}

const live = { url: 'http://x/live/1.ts', container: 'ts' as const, live: true };
const movie = { url: 'http://x/movie/1.mkv', container: 'progressive' as const, live: false };

describe('MpvPlayer', () => {
  it('goes from loading to playing on the first frame, and buffers after it', async () => {
    const t = setup();
    await t.player.load(live, { buffer: 'balanced' });
    t.send({ t: 'prop', name: 'paused-for-cache', value: true }); // before the first frame: still loading
    t.send({ t: 'restart' });
    t.send({ t: 'prop', name: 'paused-for-cache', value: true });
    t.send({ t: 'prop', name: 'paused-for-cache', value: false });
    expect(t.states).toEqual(['loading', 'playing', 'buffering', 'playing']);
    expect(t.frames()).toBe(1);
    expect(t.calls[0]).toBe('load http://x/live/1.ts balanced -');
  });

  it('keeps live durations at 0 and reports a live stream that ends as an error to reconnect', async () => {
    const t = setup();
    await t.player.load(live, { buffer: 'low' });
    t.send({ t: 'prop', name: 'duration', value: 12.5 });
    t.send({ t: 'prop', name: 'time-pos', value: 3 });
    expect(t.player.position()).toEqual({ current: 3, duration: 0 });
    expect(t.player.lastProgressAt()).toBeGreaterThan(0);
    t.send({ t: 'end', reason: 0, error: '', httpStatus: null, cannotConnect: false });
    expect(t.errors[0]).toMatchObject({ kind: 'network', fatal: true });
  });

  it('ends a movie, and ignores the stop that replacing a file causes', async () => {
    const t = setup();
    await t.player.load(movie, { buffer: 'balanced', startAt: 90 });
    t.send({ t: 'end', reason: 2, error: '', httpStatus: null, cannotConnect: false });
    expect(t.errors).toHaveLength(0);
    t.send({ t: 'restart' });
    t.send({ t: 'end', reason: 0, error: '', httpStatus: null, cannotConnect: false });
    expect(t.states[t.states.length - 1]).toBe('ended');
    expect(t.calls[0]).toBe('load http://x/movie/1.mkv balanced 90');
  });

  it('maps failed opens to the errors the app knows', async () => {
    const t = setup();
    await t.player.load(movie, { buffer: 'balanced' });
    t.send({ t: 'end', reason: 4, error: 'loading failed', httpStatus: 404, cannotConnect: false });
    t.send({ t: 'end', reason: 4, error: 'loading failed', httpStatus: null, cannotConnect: true });
    t.send({ t: 'end', reason: 4, error: 'unrecognized file format', httpStatus: null, cannotConnect: false });
    expect(t.errors.map((e) => [e.kind, e.message, e.httpStatus])).toEqual([
      ['network', 'HTTP 404', 404],
      ['network', CANNOT_CONNECT, undefined],
      ['unsupported', 'unsupported format', undefined],
    ]);
  });

  it('says nothing more once stopped', async () => {
    const t = setup();
    await t.player.load(live, { buffer: 'balanced' });
    t.player.stop();
    t.send({ t: 'restart' });
    expect(t.frames()).toBe(0);
    expect(t.states[t.states.length - 1]).toBe('idle');
  });
});

describe('toTracks', () => {
  it('labels audio with its codec and channels, and leaves video out', () => {
    const tracks = toTracks([
      { id: 1, type: 'video', codec: 'hevc', selected: true },
      { id: 1, type: 'audio', lang: 'eng', title: null, codec: 'ac3', channels: 6, selected: true },
      { id: 2, type: 'audio', lang: 'ara', title: 'Arabic', codec: 'eac3', channels: 2 },
      { id: 3, type: 'audio', codec: 'dts' },
      { id: 4, type: 'audio', title: 'AC-3 5.1', codec: 'ac3', channels: 6 },
      { id: 1, type: 'sub', lang: 'eng', codec: 'subrip' },
    ]);
    expect(tracks.audio.map((a) => [a.id, a.label, a.selected])).toEqual([
      ['1', 'ENG (AC3 5.1)', true],
      ['2', 'Arabic (EAC3)', false],
      ['3', 'Audio 3 (DTS)', false],
      ['4', 'AC-3 5.1', false],
    ]);
    expect(tracks.text).toEqual([{ id: '1', label: 'ENG', lang: 'eng', selected: false }]);
  });
});
