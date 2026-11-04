import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerError, PlayerState, PlayerTracks } from '../types';
import type { AvPlay, AvPlayListener, AvPlayTrack } from './api';
import { AvPlayPlayer } from './player';

const SOURCE = { url: 'http://example.test/1.ts', container: 'ts' as const, live: true };

function fakeAv() {
  const calls: string[] = [];
  const state = {
    listener: {} as AvPlayListener,
    prepared: [] as { ok: () => void; fail: (e: unknown) => void }[],
    tracks: [] as AvPlayTrack[],
    current: [] as AvPlayTrack[],
    duration: 0,
  };
  const log =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(args.length ? `${name}(${args.filter((a) => typeof a !== 'function').join(',')})` : name);
    };
  const av: AvPlay = {
    open: log('open'),
    close: log('close'),
    prepareAsync: (ok, fail) => void state.prepared.push({ ok, fail }),
    play: log('play'),
    pause: log('pause'),
    stop: log('stop'),
    seekTo: (ms, ok) => {
      calls.push(`seekTo(${ms})`);
      ok?.();
    },
    suspend: log('suspend'),
    restore: log('restore'),
    getCurrentTime: () => 0,
    getDuration: () => state.duration,
    setListener: (l) => void (state.listener = l),
    setDisplayRect: log('rect'),
    setDisplayMethod: log('method'),
    setBufferingParam: log('buffer'),
    setStreamingProperty: log('property'),
    getTotalTrackInfo: () => state.tracks,
    getCurrentStreamInfo: () => state.current,
    setSelectTrack: log('select'),
    setSilentSubtitle: log('silent'),
  };
  return { av, calls, state };
}

function setup() {
  const fake = fakeAv();
  const player = new AvPlayPlayer(fake.av);
  const states: PlayerState[] = [];
  const errors: PlayerError[] = [];
  const tracks: PlayerTracks[] = [];
  let frames = 0;
  player.on('state', (s) => states.push(s));
  player.on('error', (e) => errors.push(e));
  player.on('tracks', (t) => tracks.push(t));
  player.on('firstFrame', () => frames++);
  return { ...fake, player, states, errors, tracks, frames: () => frames };
}

describe('AvPlayPlayer', () => {
  let classes: Set<string>;

  beforeEach(() => {
    classes = new Set();
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: vi.fn(),
      documentElement: {
        classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
      },
    });
    vi.stubGlobal('window', { innerWidth: 960, innerHeight: 540 });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('opens, prepares and plays, then reports the first frame once', async () => {
    const t = setup();
    const loading = t.player.load(SOURCE, { buffer: 'balanced' });
    expect(t.states).toEqual(['loading']);
    expect(t.calls).toContain('open(http://example.test/1.ts)');
    expect(t.calls).not.toContain('play');
    t.state.prepared[0].ok();
    await loading;
    expect(t.calls).toContain('play');
    expect(t.frames()).toBe(0);
    t.state.listener.oncurrentplaytime!(1000);
    t.state.listener.oncurrentplaytime!(2000);
    expect(t.frames()).toBe(1);
    expect(t.states[t.states.length - 1]).toBe('playing');
    expect(t.player.position().current).toBe(2);
  });

  it('ignores buffering events from before playback started', async () => {
    const t = setup();
    const loading = t.player.load(SOURCE, { buffer: 'low' });
    t.state.listener.onbufferingstart!();
    t.state.listener.onbufferingcomplete!();
    expect(t.states).toEqual(['loading']);
    t.state.prepared[0].ok();
    await loading;
  });

  it('a quick channel change drops the older stream', async () => {
    const t = setup();
    const first = t.player.load(SOURCE, { buffer: 'balanced' });
    const firstListener = t.state.listener;
    const second = t.player.load({ ...SOURCE, url: 'http://example.test/2.ts' }, { buffer: 'balanced' });
    expect(t.calls).toContain('close');
    t.state.prepared[0].ok();
    await first;
    expect(t.calls).not.toContain('play');
    firstListener.onerror!('PLAYER_ERROR_CONNECTION_FAILED');
    expect(t.errors).toEqual([]);
    t.state.prepared[1].ok();
    await second;
    expect(t.calls).toContain('play');
  });

  it('seeks to the resume point before playing', async () => {
    const t = setup();
    t.state.duration = 600000;
    const loading = t.player.load({ ...SOURCE, live: false }, { buffer: 'balanced', startAt: 90 });
    t.state.prepared[0].ok();
    await loading;
    expect(t.calls.indexOf('seekTo(90000)')).toBeLessThan(t.calls.indexOf('play'));
    expect(t.player.position()).toEqual({ current: 90, duration: 600 });
  });

  it('reports no duration for live streams', async () => {
    const t = setup();
    t.state.duration = 12345;
    const loading = t.player.load(SOURCE, { buffer: 'balanced' });
    t.state.prepared[0].ok();
    await loading;
    expect(t.player.position().duration).toBe(0);
  });

  it('maps errors to the kinds the retry logic understands', async () => {
    const t = setup();
    const loading = t.player.load(SOURCE, { buffer: 'balanced' });
    t.state.listener.onerror!('PLAYER_ERROR_CONNECTION_FAILED');
    expect(t.errors[0]).toMatchObject({ kind: 'network', fatal: true });
    t.state.listener.onerror!('PLAYER_ERROR_NOT_SUPPORTED_FILE');
    expect(t.errors[1]).toMatchObject({ kind: 'unsupported', fatal: true });
    expect(t.errors[1].message).toMatch(/not supported/);
    t.state.prepared[0].fail(new Error('PLAYER_ERROR_INVALID_OPERATION'));
    await loading;
    expect(t.errors[2]).toMatchObject({ kind: 'media', fatal: true });
    expect(t.states).toContain('error');
  });

  it('survives AVPlay throwing during open', async () => {
    const t = setup();
    t.av.open = () => {
      throw new Error('PLAYER_ERROR_INVALID_URI');
    };
    await t.player.load(SOURCE, { buffer: 'balanced' });
    expect(t.errors[0]).toMatchObject({ kind: 'network', fatal: true });
  });

  it('scales the preview box to the 1920-wide video plane', async () => {
    const t = setup();
    const loading = t.player.load(SOURCE, { buffer: 'balanced' });
    t.player.setRect({ left: 100, top: 50, width: 400, height: 225 });
    expect(t.calls).toContain('rect(200,100,800,450)');
    expect(classes.has('video-hole')).toBe(true);
    expect(classes.has('video-behind')).toBe(false);
    t.player.setRect('fullscreen');
    expect(t.calls).toContain('rect(0,0,1920,1080)');
    expect(classes.has('video-hole')).toBe(false);
    expect(classes.has('video-behind')).toBe(true);
    t.player.setRect(null);
    expect(classes.size).toBe(0);
    t.state.prepared[0].ok();
    await loading;
  });

  it('lists tracks and switches them', async () => {
    const t = setup();
    t.state.tracks = [
      { type: 'VIDEO', index: 0, extra_info: '{"Width":"1920","Height":"1080","Bit_rate":"4000000"}' },
      { type: 'AUDIO', index: 1, extra_info: '{"language":"eng"}' },
      { type: 'AUDIO', index: 2, extra_info: 'not json' },
      { type: 'TEXT', index: 3, extra_info: '{"track_lang":"ara"}' },
    ];
    t.state.current = [t.state.tracks[0], t.state.tracks[1]];
    const loading = t.player.load(SOURCE, { buffer: 'balanced' });
    t.state.prepared[0].ok();
    await loading;
    const listed = t.player.tracks();
    expect(listed.audio).toEqual([
      { id: '1', label: 'ENG', lang: 'eng', selected: true },
      { id: '2', label: 'Audio 2', lang: undefined, selected: false },
    ]);
    expect(listed.text).toEqual([{ id: '3', label: 'ARA', lang: 'ara', selected: false }]);
    expect(t.calls).toContain('silent(true)');
    t.player.selectAudio('2');
    expect(t.calls).toContain('select(AUDIO,2)');
    expect(t.player.tracks().audio[1].selected).toBe(true);
    t.player.selectText('3');
    expect(t.calls).toContain('select(TEXT,3)');
    expect(t.calls).toContain('silent(false)');
    expect(t.player.stats()).toMatchObject({ width: 1920, height: 1080, bitrateKbps: 4000 });
  });

  it('ends and stops cleanly', async () => {
    const t = setup();
    const loading = t.player.load(SOURCE, { buffer: 'balanced' });
    t.state.prepared[0].ok();
    await loading;
    t.state.listener.onstreamcompleted!();
    expect(t.states[t.states.length - 1]).toBe('ended');
    t.player.stop();
    expect(t.calls).toContain('stop');
    expect(t.calls).toContain('close');
    expect(t.states[t.states.length - 1]).toBe('idle');
    expect(t.player.position()).toEqual({ current: 0, duration: 0 });
  });
});
