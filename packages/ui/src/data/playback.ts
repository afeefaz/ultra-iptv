import { getProgress, log, perf, RESUME_MIN_SECONDS, WATCHED_RATIO, type ChannelRow, type MediaRef, type ProgressRow, type ResolvedStream } from '@ultra/core';
import { CANNOT_CONNECT, type Platform, type PlayerAdapter, type PlayerError, type PlayerState, type PlayerStats, type PlayerTracks, type Track, type VideoRect } from '@ultra/platform';
import { createSignal } from 'solid-js';
import { resolutionLabel } from '../format';
import { catalog } from './catalog';
import { HEARTBEAT_EVERY_MS, isFrozen, isStuttering, steadyAgain, WATCH_EVERY_MS } from './stallWatch';
import { track } from './usage';
import { ensureUnlocked, isChannelLocked } from './parental';
import { autoPlayNext, bufferProfile, preferredAudio, preferredText, setPreferredAudio, setPreferredText, streamFormat } from './settings';

/** Reconnect schedule (spec §4.2): 0.5 s → 8 s, at most 6 attempts; switch container once. */
const MAX_ATTEMPTS = 6;
const SWITCH_CONTAINER_AT = 3;
const STALL_MS = 15_000;
const RESOLUTION_POLL_MS = 2000;
const URL_CACHE_SIZE = 50;
/** Progress is saved every 10 s and on pause/exit (spec §4.2). */
const SAVE_EVERY_MS = 10_000;
/** How long the next episode waits, so it can be cancelled. */
const NEXT_EPISODE_SECONDS = 10;

export type PlaybackStatus =
  | { kind: 'reconnecting'; attempt: number }
  | { kind: 'offline' }
  | { kind: 'failed'; message: string }
  | { kind: 'needs-gesture' }
  | { kind: 'ended' }
  | null;

export interface Session {
  playlistId: string;
  list: ChannelRow[];
  index: number;
}

/** A movie, episode or catch-up programme (everything that isn't a live channel). */
export interface MediaItem {
  playlistId: string;
  kind: 'vod' | 'episode' | 'catchup';
  /** Progress key: the movie's stable key, or `${seriesKey}|${season}x${episode}`. */
  key: string;
  title: string;
  subtitle?: string;
  poster?: string;
  ref: MediaRef;
  startAt?: number;
  seriesKey?: string;
  seriesId?: string;
  /** The episodes either side of this one. */
  prev?: MediaItem;
  next?: MediaItem;
}

const [current, setCurrent] = createSignal<ChannelRow | null>(null);
const [media, setMedia] = createSignal<MediaItem | null>(null);
const [state, setState] = createSignal<PlayerState>('idle');
const [status, setStatus] = createSignal<PlaybackStatus>(null);
const [tracks, setTracks] = createSignal<PlayerTracks>({ audio: [], text: [] });
const [rect, setRectSignal] = createSignal<VideoRect>(null);
const [session, setSession] = createSignal<Session | null>(null);
const [position, setPosition] = createSignal({ current: 0, duration: 0 });
/** Bumped when a channel starts playing, so "Recent" lists can reload. */
const [recentVersion, setRecentVersion] = createSignal(0);
/** Bumped after progress is saved, so "Continue watching" and detail pages can reload. */
const [progressVersion, setProgressVersion] = createSignal(0);
const [lastZapMs, setLastZapMs] = createSignal<number | null>(null);
/**
 * Apart from `media`, because loading a stream gives up if `media` changes, and Continue watching
 * only finds out the neighbours after it has started.
 */
const [neighbours, setNeighbours] = createSignal<{ prev?: MediaItem; next?: MediaItem }>({});
/** Seconds until the next episode starts, or null when nothing is counting down. */
const [nextEpisodeIn, setNextEpisodeIn] = createSignal<number | null>(null);

export {
  current as playingChannel,
  lastZapMs,
  media as playingMedia,
  nextEpisodeIn,
  position as playbackPosition,
  progressVersion,
  recentVersion,
  rect as videoRect,
  session as playbackSession,
  state as playerState,
  status as playbackStatus,
  tracks as playerTracks,
};

/** Playlist of whatever is playing (live or media). */
export const previousEpisode = (): MediaItem | undefined => neighbours().prev;
export const nextEpisode = (): MediaItem | undefined => neighbours().next;

/** Position worth offering "Resume" for (spec §4.2: more than 2 minutes in, not finished). */
export function resumePosition(row: ProgressRow | undefined): number {
  return row && !row.watched && row.position >= RESUME_MIN_SECONDS ? row.position : 0;
}

export const playingPlaylistId = (): string | null => session()?.playlistId ?? media()?.playlistId ?? null;

let player: PlayerAdapter | null = null;
let platform: Platform | null = null;
let resolved: ResolvedStream | null = null;
let usingFallback = false;
let attempt = 0;
/** When the stream came back during the current reconnect attempts (0 if it hasn't). */
let recoveredAt = 0;
/** A reconnect is waiting to start: until it does, the old stream's events say nothing. */
let retryPending = false;
/** When the live stream last paused to buffer (newest last), to notice one that keeps stuttering. */
let pauses: number[] = [];
let pausedAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let stallTimer: ReturnType<typeof setTimeout> | undefined;
let tickTimer: ReturnType<typeof setInterval> | undefined;
let nextEpisodeTimer: ReturnType<typeof setInterval> | undefined;
let zapStart = 0;
let surfaceOwner: 'preview' | 'fullscreen' | null = null;
/** Where media resumes after a reconnect. */
let resumeAt = 0;
let lastSavedAt = 0;
/** True once the current media item rendered a frame; before that the player's position belongs to the previous item. */
let mediaStarted = false;
/** Most recent fatal error, shown when playback gives up. */
let lastError = '';
const urlCache = new Map<string, ResolvedStream>();

const isActive = () => !!(current() || media());

let bufferingSpan: { end: () => number } | null = null;
const [videoSize, setVideoSize] = createSignal<{ width: number; height: number } | null>(null);
/** The playing picture's resolution ("1080p"), once the player knows it. */
export const videoResolution = (): string | null => {
  const size = videoSize();
  return size ? resolutionLabel(size.width, size.height) : null;
};

function readVideoSize(): void {
  if (state() !== 'playing' || !player) return;
  const { width, height } = player.stats();
  const size = videoSize();
  if (width && height && (size?.width !== width || size?.height !== height)) {
    setVideoSize({ width, height });
    perf.count(`player.resolution.${resolutionLabel(width, height)}`);
  }
}

let playingSince = 0;
let lastHeartbeat = 0;

/**
 * Catches a stream that stops without telling anyone. The reconnect logic only reacts to an error or
 * to buffering, and a provider that holds the connection open while sending nothing gives neither:
 * the picture just freezes. The player's own clock gives it away.
 */
function watchProgress(): void {
  if (!player || !isActive() || state() !== 'playing' || (typeof document !== 'undefined' && document.hidden)) {
    playingSince = 0;
    return;
  }
  const now = Date.now();
  if (!playingSince) {
    playingSince = now;
    lastHeartbeat = now;
  }
  const at = player.lastProgressAt?.();
  if (isFrozen(now, at, true, status()?.kind === 'reconnecting')) {
    perf.count('player.frozen');
    log.warn('player', 'frozen', { quietSeconds: Math.round((now - (at ?? now)) / 1000), afterMinutes: Math.round((now - playingSince) / 60_000) });
    playingSince = 0;
    scheduleReconnect();
    return;
  }
  if (now - lastHeartbeat >= HEARTBEAT_EVERY_MS) {
    lastHeartbeat = now;
    log.info('player', 'heartbeat', { playingMinutes: Math.round((now - playingSince) / 60_000), quietSeconds: at ? Math.round((now - at) / 1000) : undefined });
  }
}

export function initPlayback(p: Platform, layer: HTMLElement): void {
  if (player) {
    player.attach(layer); // the layer was re-created (hot reload in development)
    return;
  }
  platform = p;
  player = p.createPlayer();
  player.attach(layer);
  player.on('state', onState);
  player.on('error', onError);
  player.on('tracks', onTracks);
  player.on('firstFrame', onFirstFrame);
  setInterval(readVideoSize, RESOLUTION_POLL_MS);
  setInterval(watchProgress, WATCH_EVERY_MS);
  window.addEventListener('offline', () => {
    if (isActive()) setStatus({ kind: 'offline' });
    log.warn('player', 'network offline');
  });
  window.addEventListener('online', () => {
    log.info('player', 'network online');
    if (isActive()) {
      resetAttempts();
      void loadCurrent();
    }
  });
}

/** Which screen shows the video: the Live preview box or full screen (spec §5). */
export function claimSurface(owner: 'preview' | 'fullscreen', r: VideoRect): void {
  surfaceOwner = owner;
  setRect(r);
}

export function updateSurface(owner: 'preview' | 'fullscreen', r: VideoRect): void {
  if (surfaceOwner === owner) setRect(r);
}

/** Stops playback when no screen shows video any more (e.g. leaving Live). */
export function releaseSurface(owner: 'preview' | 'fullscreen'): void {
  if (surfaceOwner !== owner) return;
  surfaceOwner = null;
  setRect(null);
  setTimeout(() => {
    if (!surfaceOwner) stopPlayback();
  }, 0);
}

function setRect(r: VideoRect): void {
  // The preview box re-measures itself often; native players pay for every update.
  if (sameRect(r, rect())) return;
  setRectSignal(r);
  player?.setRect(r);
}

function sameRect(a: VideoRect, b: VideoRect): boolean {
  if (a === b) return true;
  if (!a || !b || a === 'fullscreen' || b === 'fullscreen') return false;
  return Math.round(a.left) === Math.round(b.left) && Math.round(a.top) === Math.round(b.top) && Math.round(a.width) === Math.round(b.width) && Math.round(a.height) === Math.round(b.height);
}

/** Plays a channel; `list` is the channel list it was picked from (used for zapping). */
export async function playChannel(row: ChannelRow, list: ChannelRow[], playlistId: string): Promise<boolean> {
  if (!player) return false;
  if (isChannelLocked(row) && !(await ensureUnlocked())) return false;
  finishMedia();
  const index = Math.max(0, list.findIndex((c) => c.key === row.key));
  setSession({ playlistId, list, index });
  setCurrent(row);
  resetAttempts();
  usingFallback = false;
  zapStart = now();
  setStatus(null);
  clearTimeout(retryTimer);
  await loadCurrent();
  prefetchNeighbours();
  return true;
}

/** Plays a movie, episode or catch-up programme full screen, resuming at `item.startAt`. */
export async function playMedia(item: MediaItem): Promise<void> {
  if (!player) return;
  // Save the previous item but don't clear it: the player screen stays mounted between episodes.
  const previous = media();
  if (previous) saveProgress(previous);
  mediaStarted = false;
  stopNextEpisodeCountdown();
  setCurrent(null);
  setSession(null);
  setMedia(item);
  setNeighbours({ prev: item.prev, next: item.next });
  setPosition({ current: item.startAt ?? 0, duration: 0 });
  resetAttempts();
  usingFallback = false;
  resumeAt = item.startAt ?? 0;
  lastSavedAt = Date.now();
  zapStart = now();
  setStatus(null);
  clearTimeout(retryTimer);
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
  await loadCurrent();
}

/** Previous or next episode, from where it was left if it's unfinished. Does nothing at either end. */
export async function playEpisode(direction: -1 | 1): Promise<void> {
  const from = media();
  const target = direction < 0 ? neighbours().prev : neighbours().next;
  if (!from || !target) return;
  stopNextEpisodeCountdown();
  track('player.changeEpisode');
  const saved = await getProgress(target.playlistId, 'episode', target.key).catch(() => undefined);
  if (media() !== from) return; // left the player, or pressed again, meanwhile
  await playMedia({ ...target, startAt: resumePosition(saved) });
}

/** Stays on the finished episode. Its next-episode button still works. */
export function cancelNextEpisode(): void {
  stopNextEpisodeCountdown();
  if (media()) setStatus({ kind: 'ended' });
}

function startNextEpisodeCountdown(): void {
  setNextEpisodeIn(NEXT_EPISODE_SECONDS);
  nextEpisodeTimer = setInterval(() => {
    const left = (nextEpisodeIn() ?? 0) - 1;
    if (left > 0) {
      setNextEpisodeIn(left);
      return;
    }
    log.info('player', 'next episode');
    void playEpisode(1);
  }, 1000);
}

function stopNextEpisodeCountdown(): void {
  clearInterval(nextEpisodeTimer);
  setNextEpisodeIn(null);
}

/** Tells the player the neighbours of an item that started without them. */
export function setEpisodeNeighbours(item: MediaItem, prev: MediaItem | undefined, next: MediaItem | undefined): void {
  if (media() === item) setNeighbours({ prev, next });
}

/** Next/previous channel in the current list, wrapping around (fast zapping, spec §4.2). */
export async function zap(delta: number): Promise<void> {
  const s = session();
  if (!s || s.list.length === 0) return;
  const n = s.list.length;
  await zapTo(((s.index + delta) % n + n) % n);
}

export async function zapTo(index: number): Promise<void> {
  const s = session();
  if (!s || !s.list[index]) return;
  log.debug('player', 'zap', { from: s.index, to: index });
  await playChannel(s.list[index], s.list, s.playlistId);
}

export function stopPlayback(): void {
  clearTimeout(retryTimer);
  clearTimeout(stallTimer);
  retryPending = false;
  finishMedia();
  if (current()) log.info('player', 'stopped');
  setCurrent(null);
  setSession(null);
  setStatus(null);
  setTracks({ audio: [], text: [] });
  resolved = null;
  player?.stop();
}

/** Saves progress and clears the media item (when switching away or stopping). */
function finishMedia(): void {
  clearInterval(tickTimer);
  stopNextEpisodeCountdown();
  const m = media();
  if (!m) return;
  saveProgress(m);
  log.info('player', 'media stopped', { kind: m.kind });
  mediaStarted = false;
  setMedia(null);
  setNeighbours({});
}

export function togglePause(): void {
  if (!player || !isActive()) return;
  if (state() === 'paused') player.play();
  else {
    player.pause();
    const m = media();
    if (m) saveProgress(m);
  }
}

/** Relative seek for media (Left/Right, FF/REW). Live streams ignore it. */
export function seekBy(seconds: number): void {
  if (!player || !media()) return;
  const { current: pos, duration } = player.position();
  const target = Math.max(0, duration ? Math.min(duration - 1, pos + seconds) : pos + seconds);
  player.seek(target);
  setPosition({ current: target, duration });
}

/**
 * Hands what's playing to another installed player (Android "Open with…", spec §4.2) and
 * pauses ours. False when the platform can't, or nothing is playing.
 */
export async function openInExternalPlayer(): Promise<boolean> {
  const source = resolved && (usingFallback && resolved.fallback ? resolved.fallback : resolved);
  const title = media()?.title ?? current()?.name ?? '';
  if (!platform?.openExternal || !source) return false;
  player?.pause();
  log.info('player', 'open in external player');
  await platform.openExternal(source.url, title);
  return true;
}

/** Absolute seek (clicking the seek bar). */
export function seekTo(seconds: number): void {
  if (!player || !media()) return;
  const { duration } = player.position();
  const target = Math.max(0, duration ? Math.min(duration - 1, seconds) : seconds);
  player.seek(target);
  setPosition({ current: target, duration });
}

/** Retries after an autoplay block or a final failure (user pressed OK). */
export function retryNow(): void {
  if (!isActive()) return;
  resetAttempts();
  setStatus(null);
  zapStart = now();
  void loadCurrent();
}

export function selectAudio(track: Track): void {
  player?.selectAudio(track.id);
  setPreferredAudio(track.lang || track.label);
  log.info('player', 'audio track chosen', { lang: track.lang, label: track.label });
}

export function selectText(track: Track | null): void {
  player?.selectText(track ? track.id : null);
  setPreferredText(track ? track.lang || track.label : 'off');
  log.info('player', 'subtitles chosen', { lang: track ? track.lang : 'off' });
}

export function playerStats(): PlayerStats | null {
  return player ? player.stats() : null;
}

async function resolve(row: ChannelRow, playlistId: string): Promise<ResolvedStream> {
  const key = `${playlistId}|${row.key}|${streamFormat()}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const r = await catalog().call('streamUrl', playlistId, row.stream, streamFormat(), !!platform?.prefersHls);
  urlCache.set(key, r);
  if (urlCache.size > URL_CACHE_SIZE) urlCache.delete(urlCache.keys().next().value as string);
  return r;
}

function prefetchNeighbours(): void {
  const s = session();
  if (!s || s.list.length < 2) return;
  const n = s.list.length;
  for (const d of [1, -1]) {
    const row = s.list[((s.index + d) % n + n) % n];
    resolve(row, s.playlistId).catch(() => undefined);
  }
}

async function loadCurrent(): Promise<void> {
  if (!player) return;
  const row = current();
  const s = session();
  const m = media();
  try {
    if (row && s) {
      resolved = await resolve(row, s.playlistId);
      if (current() !== row) return; // zapped again meanwhile
      const source = usingFallback && resolved.fallback ? resolved.fallback : resolved;
      log.info('player', 'load', { channel: row.num, container: source.container, attempt, url: source.url });
      await player.load({ url: source.url, container: source.container, live: true, headers: row.headers }, { buffer: bufferProfile() });
    } else if (m) {
      resolved = await catalog().call('mediaUrl', m.playlistId, m.ref, !!platform?.prefersHls);
      if (media() !== m) return;
      const source = usingFallback && resolved.fallback ? resolved.fallback : resolved;
      log.info('player', 'load media', { kind: m.kind, container: source.container, attempt, startAt: Math.round(resumeAt), url: source.url });
      await player.load({ url: source.url, container: source.container, live: false }, { buffer: bufferProfile(), startAt: resumeAt || undefined });
    }
  } catch (e) {
    log.error('player', 'could not start', { error: e });
    setStatus({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
  }
}

/** Once a second while media plays: position for the UI, progress every 10 s. */
function tick(): void {
  const m = media();
  if (!m || !player || !mediaStarted) return;
  const pos = player.position();
  if (state() === 'playing' && pos.current > 0) resumeAt = pos.current;
  setPosition(pos);
  if (state() === 'playing' && Date.now() - lastSavedAt >= SAVE_EVERY_MS) saveProgress(m);
}

/** Movies and episodes only; catch-up has no "continue watching". */
function saveProgress(m: MediaItem): void {
  if (!player || m.kind === 'catchup' || !mediaStarted || media() !== m) return;
  const { current: pos, duration } = player.position();
  if (!duration || pos < 5) return;
  lastSavedAt = Date.now();
  const watched = pos / duration >= WATCHED_RATIO;
  catalog()
    .call('saveProgress', {
      playlistId: m.playlistId,
      kind: m.kind === 'vod' ? 'vod' : 'episode',
      key: m.key,
      position: watched ? 0 : Math.floor(pos),
      duration: Math.floor(duration),
      updatedAt: Date.now(),
      watched,
      title: m.title,
      subtitle: m.subtitle,
      poster: m.poster,
      ref: m.ref,
      seriesKey: m.seriesKey,
      seriesId: m.seriesId,
    })
    .then(() => setProgressVersion((v) => v + 1))
    .catch((e) => log.warn('player', 'progress not saved', { error: e }));
}

function onState(s: PlayerState): void {
  if (s === 'buffering' && state() !== 'buffering') {
    bufferingSpan = perf.span('player.buffering');
    perf.count('player.bufferingEvents');
    pausedAt = Date.now();
  } else if (s !== 'buffering' && bufferingSpan) {
    bufferingSpan.end();
    bufferingSpan = null;
    if (pausedAt && s === 'playing') log.info('player', 'buffered', { ms: Date.now() - pausedAt });
    pausedAt = 0;
  }
  if (s === 'loading') pauses = [];
  setState(s);
  if (s === 'loading') setVideoSize(null);
  clearTimeout(stallTimer);
  if (s === 'playing') {
    if (retryPending) return;
    // The attempts only start afresh once it has kept playing for a while (settleAttempts).
    if (attempt > 0 && !recoveredAt) {
      recoveredAt = Date.now();
      log.info('player', 'reconnected', { attempts: attempt });
    }
    setStatus(null);
  } else if (s === 'buffering' && isActive()) {
    if (current() && !retryPending) {
      const at = Date.now();
      pauses = pauses.concat(at).slice(-8);
      if (isStuttering(pauses, at)) {
        log.warn('player', 'stuttering', { pauses: pauses.length });
        perf.count('player.stuttering');
        pauses = [];
        scheduleReconnect();
        return;
      }
    }
    // A stream stuck buffering is treated like a dropped connection.
    stallTimer = setTimeout(() => {
      if (state() === 'buffering' && isActive()) {
        log.warn('player', 'stalled', { seconds: STALL_MS / 1000 });
        scheduleReconnect();
      }
    }, STALL_MS);
  } else if (s === 'ended') {
    const m = media();
    if (!m) return;
    saveProgress(m);
    if (neighbours().next && autoPlayNext()) startNextEpisodeCountdown();
    else setStatus({ kind: 'ended' });
  }
}

function onError(e: PlayerError): void {
  if (!isActive()) return;
  perf.count(`player.error.${e.kind}`);
  if (e.kind === 'autoplay') {
    setStatus({ kind: 'needs-gesture' });
    log.info('player', 'autoplay blocked');
    return;
  }
  log.warn('player', 'error', { kind: e.kind, fatal: e.fatal, message: e.message, status: e.httpStatus });
  if (!e.fatal) return;
  settleAttempts();
  const cannotConnect = e.message === CANNOT_CONNECT;
  lastError = e.httpStatus ? `HTTP ${e.httpStatus}` : cannotConnect ? 'connect' : e.blocked ? 'blocked' : e.message;
  // Unreachable twice in a row: say so now instead of retrying for half a minute.
  if (cannotConnect && attempt >= 1) {
    log.error('player', 'server unreachable', { attempts: attempt + 1 });
    setStatus({ kind: 'failed', message: 'connect' });
    return;
  }
  if (e.kind === 'unsupported') {
    setStatus({ kind: 'failed', message: e.message });
    return;
  }
  // The provider won't let the browser read this stream; the HLS version may still play
  // (natively in Chrome), so try it straight away instead of after three retries.
  if (e.blocked && resolved?.fallback?.container === 'hls' && !usingFallback) {
    usingFallback = true;
    log.info('player', 'switching container', { to: 'hls', reason: 'blocked' });
    void loadCurrent();
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus({ kind: 'offline' });
    return; // the 'online' event restarts playback
  }
  scheduleReconnect();
}

function resetAttempts(): void {
  attempt = 0;
  recoveredAt = 0;
  retryPending = false;
  pauses = [];
}

/** A drop after the stream had come back: a new outage if it played steadily since, else the same one. */
function settleAttempts(): void {
  if (!recoveredAt) return;
  if (steadyAgain(recoveredAt, Date.now())) attempt = 0;
  else log.warn('player', 'dropped again soon after reconnecting', { attempts: attempt, playedSeconds: Math.round((Date.now() - recoveredAt) / 1000) });
  recoveredAt = 0;
}

function scheduleReconnect(): void {
  perf.count('player.reconnects');
  clearTimeout(retryTimer);
  settleAttempts();
  attempt++;
  if (attempt > MAX_ATTEMPTS) {
    log.error('player', 'gave up reconnecting', { attempts: MAX_ATTEMPTS, lastError });
    setStatus({ kind: 'failed', message: lastError || 'reconnect' });
    return;
  }
  if (attempt === SWITCH_CONTAINER_AT + 1 && resolved?.fallback && !usingFallback) {
    usingFallback = true;
    log.info('player', 'switching container', { to: resolved.fallback.container });
  }
  const delayMs = Math.min(8000, 500 * Math.pow(2, attempt - 1));
  setStatus({ kind: 'reconnecting', attempt });
  log.warn('player', 'reconnect', { attempt, delayMs });
  retryPending = true;
  retryTimer = setTimeout(() => {
    retryPending = false;
    void loadCurrent();
  }, delayMs);
}

function onTracks(t: PlayerTracks): void {
  setTracks(t);
  if (!player || (t.audio.length === 0 && t.text.length === 0)) return;
  // Enforce the remembered choices on every track update (spec §4.2): engines may reset to the
  // stream's defaults after a channel change. A manual pick updates the preference, so this
  // never fights the user.
  const audioPref = preferredAudio();
  if (audioPref) {
    const match = t.audio.filter((a) => a.lang === audioPref || a.label === audioPref)[0];
    if (match && !match.selected) player.selectAudio(match.id);
  }
  const textPref = preferredText();
  if (textPref === 'off') {
    if (t.text.some((x) => x.selected)) player.selectText(null);
  } else if (textPref) {
    const match = t.text.filter((x) => x.lang === textPref || x.label === textPref)[0];
    if (match && !match.selected) player.selectText(match.id);
  }
}

function onFirstFrame(): void {
  readVideoSize();
  const zapMs = Math.round(now() - zapStart);
  perf.record(media() ? 'player.startMedia' : 'player.zap', zapMs);
  track(media() ? 'play.media' : 'play.live');
  setLastZapMs(zapMs);
  const m = media();
  if (m) {
    mediaStarted = true;
    log.info('player', 'first-frame', { zapMs, kind: m.kind, engine: player?.stats().engine });
    return;
  }
  const row = current();
  const s = session();
  if (!row || !s) return;
  log.info('player', 'first-frame', { zapMs, channel: row.num, engine: player?.stats().engine });
  catalog()
    .call('addRecent', s.playlistId, 'live', row.key, row.name)
    .then(() => setRecentVersion((v) => v + 1))
    .catch(() => undefined);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
