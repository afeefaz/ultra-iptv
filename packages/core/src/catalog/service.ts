import { log, logging } from '../log';
import { createLimiter } from '../net/limit';
import { AppError, getTextStream, toErrorInfo } from '../net/http';
import { checkPin, hashPin, isValidPin, type PinHash } from '../secure/pin';
import { SecretBox } from '../secure/secret-box';
import { M3uParser, type M3uEntry } from '../sources/m3u';
import { normalizeServer, parseXtreamUrl, XtreamApi, type XtreamCreds } from '../sources/xtream';
import { buildM3u, buildXtreamLive, buildXtreamSeries, buildXtreamVod, type Built } from './build';
import { openUltraDb, playlistRange } from './db';
import { parseSeriesInfo, parseVodInfo } from './details';
import { parseShortEpg } from './epg';
import { hash64 } from './hash';
import {
  CONTENT_KINDS,
  maskUser,
  pinsKey,
  type AccountInfo,
  type ContentKind,
  type EpgEntry,
  type LockType,
  type MediaRef,
  type ProgressKind,
  type ProgressRow,
  type SeriesInfo,
  type VodInfo,
  type ErrorInfo,
  type FavoriteRow,
  type PlaylistInput,
  type PlaylistRecord,
  type PlaylistSecret,
  type PlaylistType,
  type StreamFormat,
  type StreamRef,
} from './model';
import { SearchIndex, type SearchDoc, type SearchResults } from './search';
import { deletePlaylistData, writeKind, type WriteStats } from './store';
import { dominantPair } from './stream-creds';
import { resolveLiveStream, resolveMedia, type ResolvedStream } from './stream-url';

export interface TestResult {
  type: PlaylistType;
  host: string;
  account?: AccountInfo;
  /** M3U: entries seen in the first part of the file. */
  sampleEntries?: number;
}

export interface RefreshProgress {
  playlistId: string;
  kind: ContentKind;
  count: number;
  stats?: WriteStats;
}

export interface RefreshResult {
  playlistId: string;
  ok: boolean;
  counts: Partial<Record<ContentKind, number>>;
  error?: ErrorInfo;
  /** Kinds that failed while others loaded. */
  partial?: ContentKind[];
}

export interface ServiceHooks {
  changed(playlistId: string | null, kinds: ContentKind[]): void;
  progress(p: RefreshProgress): void;
  /** Credentials and hosts to register with the main thread's redactor. */
  secrets(secrets: string[], hosts: string[]): void;
}

interface Normalized {
  type: PlaylistType;
  host: string;
  secret: PlaylistSecret;
}

const DEFAULT_REFRESH_HOURS = 12;
const M3U_TEST_ENTRIES = 25;
/** The form's Test step should fail fast; refreshes keep the longer default. */
const TEST_TIMEOUT_MS = 15_000;
const EPG_MAX_AGE_MS = 30 * 60_000;
const EPG_KEEP_MS = 7 * 24 * 3600_000;
const MAX_RECENT = 30;
const PIN_KEY = 'parental.pin';
const DETAIL_MAX_AGE_MS: Record<'vod' | 'series' | 'catchup', number> = {
  vod: 24 * 3600_000,
  series: 6 * 3600_000,
  catchup: 15 * 60_000,
};

/** All catalogue writes happen here, inside the worker (spec §3). */
export class PlaylistService {
  private readonly box = new SecretBox(openUltraDb);
  private readonly running = new Map<string, Promise<RefreshResult>>();
  private readonly searchCache = new Map<string, SearchIndex>();
  private readonly epgInflight = new Map<string, Promise<EpgEntry[]>>();
  private readonly epgLimit = createLimiter(3);
  private lastRecentAt = 0;

  constructor(private readonly hooks: ServiceHooks) {}

  /** Registers every saved playlist's credentials with the redactors. */
  async init(): Promise<void> {
    const db = await openUltraDb();
    void this.pruneEpg();
    for (const record of await db.getAll('playlists')) {
      try {
        this.registerSecrets(record, await this.secret(record.id));
      } catch (e) {
        log.warn('playlist', 'could not read saved credentials', { playlist: record.id, error: toErrorInfo(e) });
      }
    }
  }

  normalize(input: PlaylistInput): Normalized {
    let type = input.type;
    const m3uUrl = (input.m3uUrl || '').trim();
    let xtream: XtreamCreds | null;
    if (type === 'm3u') {
      if (!m3uUrl) throw new AppError({ code: 'invalid-input', message: 'Playlist URL is empty' });
      xtream = parseXtreamUrl(m3uUrl);
      if (xtream) type = 'xtream'; // get.php / player_api.php / /playlist/u/p are Xtream (spec §2)
    } else {
      const pasted = input.server ? parseXtreamUrl(input.server) : null;
      xtream = {
        server: pasted ? pasted.server : normalizeServer(input.server || ''),
        username: (input.username || pasted?.username || '').trim(),
        password: input.password || pasted?.password || '',
      };
      if (!xtream.username) throw new AppError({ code: 'invalid-input', message: 'Username is empty' });
    }
    if (type === 'xtream' && xtream) {
      return { type, host: new URL(xtream.server).host, secret: { ...xtream } };
    }
    let host: string;
    try {
      host = new URL(m3uUrl).host;
    } catch {
      throw new AppError({ code: 'invalid-input', message: 'Playlist URL is not a valid URL' });
    }
    return { type: 'm3u', host, secret: { m3uUrl } };
  }

  async test(input: PlaylistInput): Promise<TestResult> {
    const n = await this.withSavedPassword(input);
    this.registerSecrets({ host: n.host }, n.secret);
    if (n.type === 'xtream') {
      const account = await this.xtream(n.secret, input.userAgent).login(TEST_TIMEOUT_MS);
      log.info('playlist', 'test ok', { type: 'xtream', status: account.status });
      return { type: 'xtream', host: n.host, account };
    }
    let count = 0;
    const parser = new M3uParser(() => count++);
    await getTextStream(
      n.secret.m3uUrl!,
      (chunk) => {
        parser.push(chunk);
        return count < M3U_TEST_ENTRIES;
      },
      { headers: headersFor(input.userAgent), timeoutMs: TEST_TIMEOUT_MS },
    );
    if (!parser.sawHeader && count === 0) {
      throw new AppError({ code: 'format', message: 'This address did not return an M3U playlist' });
    }
    log.info('playlist', 'test ok', { type: 'm3u', entries: count });
    return { type: 'm3u', host: n.host, sampleEntries: count };
  }

  async save(input: PlaylistInput): Promise<PlaylistRecord> {
    const n = await this.withSavedPassword(input);
    const db = await openUltraDb();
    const now = Date.now();
    const existing = input.id ? await db.get('playlists', input.id) : undefined;
    const all = await db.getAll('playlists');
    const record: PlaylistRecord = {
      ...(existing ?? { createdAt: now, order: all.length }),
      id: existing?.id ?? newId(),
      name: input.name.trim() || n.host,
      type: n.type,
      host: n.host,
      userHint: n.secret.username ? maskUser(n.secret.username) : undefined,
      updatedAt: now,
      refreshHours: input.refreshHours ?? existing?.refreshHours ?? DEFAULT_REFRESH_HOURS,
      userAgent: input.userAgent?.trim() || undefined,
      epgOffsetHours: input.epgOffsetHours ?? existing?.epgOffsetHours ?? 0,
    } as PlaylistRecord;
    // Keep stream-URL credentials found by a previous refresh.
    const previous = existing ? await this.secret(existing.id).catch(() => ({}) as PlaylistSecret) : {};
    const secret: PlaylistSecret = { ...n.secret, streamUser: previous.streamUser, streamPass: previous.streamPass };
    const sealed = await this.box.seal(secret);
    const tx = db.transaction(['playlists', 'secrets'], 'readwrite');
    await tx.objectStore('playlists').put(record);
    await tx.objectStore('secrets').put(sealed, record.id);
    await tx.done;
    this.registerSecrets(record, secret);
    log.info('playlist', existing ? 'updated' : 'added', { playlist: record.id, type: record.type });
    this.hooks.changed(record.id, []);
    return record;
  }

  /** Form values for editing; the password is never sent back (an empty field keeps it). */
  async editData(id: string): Promise<PlaylistInput> {
    const record = await (await openUltraDb()).get('playlists', id);
    if (!record) throw new AppError({ code: 'not-found', message: 'Playlist not found' });
    const secret = await this.secret(id);
    return {
      id,
      name: record.name,
      type: record.type,
      server: secret.server,
      username: secret.username,
      m3uUrl: secret.m3uUrl,
      userAgent: record.userAgent,
      refreshHours: record.refreshHours,
      epgOffsetHours: record.epgOffsetHours ?? 0,
    };
  }

  async remove(id: string): Promise<void> {
    await deletePlaylistData(await openUltraDb(), id);
    this.searchCache.delete(id);
    log.info('playlist', 'deleted', { playlist: id });
    this.hooks.changed(id, CONTENT_KINDS);
  }

  async move(id: string, delta: number): Promise<void> {
    const db = await openUltraDb();
    const list = (await db.getAll('playlists')).sort((a, b) => a.order - b.order);
    const from = list.findIndex((p) => p.id === id);
    const to = Math.max(0, Math.min(list.length - 1, from + delta));
    if (from < 0 || from === to) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    const tx = db.transaction('playlists', 'readwrite');
    for (let i = 0; i < list.length; i++) await tx.store.put({ ...list[i], order: i });
    await tx.done;
    this.hooks.changed(null, []);
  }

  refresh(id: string): Promise<RefreshResult> {
    // One refresh per playlist at a time; callers share the running one.
    let running = this.running.get(id);
    if (!running) {
      // No Promise#finally: the worker bundle has no polyfills and Chrome 53 lacks it.
      const done = () => this.running.delete(id);
      running = this.doRefresh(id).then(
        (r) => {
          done();
          return r;
        },
        (e) => {
          done();
          throw e;
        },
      );
      this.running.set(id, running);
    }
    return running;
  }

  isRefreshing(id: string): boolean {
    return this.running.has(id);
  }

  async toggleFavorite(fav: Omit<FavoriteRow, 'addedAt'>): Promise<boolean> {
    const db = await openUltraDb();
    const key: [string, ContentKind, string] = [fav.playlistId, fav.kind, fav.key];
    const exists = await db.get('favorites', key);
    if (exists) await db.delete('favorites', key);
    else await db.put('favorites', { ...fav, addedAt: Date.now() });
    log.info('favorites', exists ? 'removed' : 'added', { playlist: fav.playlistId, kind: fav.kind });
    this.hooks.changed(fav.playlistId, []);
    return !exists;
  }

  async search(playlistId: string, query: string, limitPerKind?: number): Promise<SearchResults> {
    let index = this.searchCache.get(playlistId);
    if (!index) {
      const timer = log.time('search', 'index built');
      const db = await openUltraDb();
      const docs: SearchDoc[] = [];
      for (const kind of CONTENT_KINDS) {
        const rows = (await db.getAll(kind, playlistRange(playlistId))) as Array<{
          id: string;
          key: string;
          name: string;
          num?: number;
          logo?: string;
          categoryIds: string[];
        }>;
        for (const r of rows) {
          docs.push({ kind, id: r.id, key: r.key, name: r.name, num: r.num, logo: r.logo, categoryId: r.categoryIds[0] });
        }
      }
      index = new SearchIndex(docs);
      this.searchCache.set(playlistId, index);
      timer.end({ docs: docs.length }, 'debug');
    }
    return index.search(query, limitPerKind);
  }

  /** Playable URL for a live channel; credentials only ever leave the worker inside this URL. */
  async streamUrl(playlistId: string, ref: StreamRef, format: StreamFormat, preferHls: boolean): Promise<ResolvedStream> {
    const record = await (await openUltraDb()).get('playlists', playlistId);
    if (!record) throw new AppError({ code: 'not-found', message: 'Playlist not found' });
    return resolveLiveStream(ref, await this.secret(playlistId), format, preferHls, record.account);
  }

  /**
   * Xtream short EPG for one channel, cached in IndexedDB until the current programme ends
   * (at most 30 min, spec §7). Concurrent requests for the same channel share one fetch.
   */
  async shortEpg(playlistId: string, streamId: string): Promise<EpgEntry[]> {
    const db = await openUltraDb();
    const cached = await db.get('epg', [playlistId, streamId]);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < EPG_MAX_AGE_MS && !(cached.items.length && now >= cached.items[0].stop)) {
      return cached.items;
    }
    const key = playlistId + '|' + streamId;
    let pending = this.epgInflight.get(key);
    if (!pending) {
      const done = () => this.epgInflight.delete(key);
      pending = this.epgLimit(async () => {
        const record = await db.get('playlists', playlistId);
        if (!record || record.type !== 'xtream') return [];
        const items = parseShortEpg(await this.xtream(await this.secret(playlistId), record.userAgent).shortEpg(streamId));
        await db.put('epg', { playlistId, streamId, fetchedAt: Date.now(), items });
        return items;
      }).then(
        (items) => {
          done();
          return items;
        },
        (e) => {
          done();
          // Keep showing stale data rather than nothing.
          if (cached) return cached.items;
          throw e;
        },
      );
      this.epgInflight.set(key, pending);
    }
    return pending;
  }

  /** URL for a movie, episode, M3U VOD item or catch-up programme. */
  async mediaUrl(playlistId: string, ref: MediaRef, preferHls: boolean): Promise<ResolvedStream> {
    return resolveMedia(ref, await this.secret(playlistId), preferHls, Date.now());
  }

  vodInfo(playlistId: string, vodId: string): Promise<VodInfo & { ext?: string }> {
    return this.cachedDetail(playlistId, 'vod', vodId, async (api) => parseVodInfo(await api.vodInfo(vodId)));
  }

  seriesInfo(playlistId: string, seriesId: string): Promise<SeriesInfo> {
    return this.cachedDetail(playlistId, 'series', seriesId, async (api) => parseSeriesInfo(await api.seriesInfo(seriesId)));
  }

  /** Past programmes the server can replay (Xtream `get_simple_data_table`), newest first. */
  catchupListings(playlistId: string, streamId: string, days: number): Promise<EpgEntry[]> {
    return this.cachedDetail(playlistId, 'catchup', streamId, async (api) => {
      const now = Date.now();
      const since = now - days * 24 * 3600_000;
      return parseShortEpg(await api.archive(streamId))
        .filter((e) => e.hasArchive !== false && e.stop <= now && e.start >= since)
        .reverse();
    });
  }

  /** Pins or unpins a category (shown first in its rail); returns whether it is now pinned. */
  async togglePin(playlistId: string, kind: ContentKind, categoryId: string): Promise<boolean> {
    const db = await openUltraDb();
    const key = pinsKey(playlistId, kind);
    const current = await db.get('settings', key);
    const pins = Array.isArray(current) ? (current as string[]) : [];
    const pinned = pins.indexOf(categoryId) < 0;
    await db.put('settings', pinned ? pins.concat(categoryId) : pins.filter((id) => id !== categoryId), key);
    return pinned;
  }

  async saveProgress(row: ProgressRow): Promise<void> {
    await (await openUltraDb()).put('progress', row);
  }

  async clearProgress(playlistId: string, kind: ProgressKind, key: string): Promise<void> {
    await (await openUltraDb()).delete('progress', [playlistId, kind, key]);
  }

  private async cachedDetail<T>(
    playlistId: string,
    kind: 'vod' | 'series' | 'catchup',
    id: string,
    load: (api: XtreamApi) => Promise<T>,
  ): Promise<T> {
    const db = await openUltraDb();
    const cached = await db.get('details', [playlistId, kind, id]);
    if (cached && Date.now() - cached.fetchedAt < DETAIL_MAX_AGE_MS[kind]) return cached.data as T;
    const record = await db.get('playlists', playlistId);
    if (!record || record.type !== 'xtream') {
      throw new AppError({ code: 'not-found', message: 'Details are only available for Xtream playlists' });
    }
    try {
      const data = await load(this.xtream(await this.secret(playlistId), record.userAgent));
      await db.put('details', { playlistId, kind, id, fetchedAt: Date.now(), data });
      return data;
    } catch (e) {
      if (cached) return cached.data as T; // stale beats nothing
      throw e;
    }
  }

  async addRecent(playlistId: string, kind: ContentKind, key: string, name: string): Promise<void> {
    const db = await openUltraDb();
    // Strictly increasing, so plays within the same millisecond still keep their order.
    const playedAt = (this.lastRecentAt = Math.max(Date.now(), this.lastRecentAt + 1));
    await db.put('recent', { playlistId, kind, key, name, playedAt });
    const all = await db.getAllFromIndex('recent', 'byPlaylistKind', [playlistId, kind]);
    if (all.length > MAX_RECENT) {
      const old = all.sort((a, b) => b.playedAt - a.playedAt).slice(MAX_RECENT);
      for (const r of old) await db.delete('recent', [r.playlistId, r.kind, r.key]);
    }
  }

  async toggleLock(playlistId: string, type: LockType, id: string): Promise<boolean> {
    const db = await openUltraDb();
    const key: [string, LockType, string] = [playlistId, type, id];
    const exists = await db.get('locks', key);
    if (exists) await db.delete('locks', key);
    else await db.put('locks', { playlistId, type, id });
    log.info('parental', exists ? 'unlocked' : 'locked', { playlist: playlistId, type });
    return !exists;
  }

  async pinStatus(): Promise<{ set: boolean }> {
    return { set: !!(await (await openUltraDb()).get('settings', PIN_KEY)) };
  }

  async verifyPin(pin: string): Promise<boolean> {
    const stored = await this.storedPin();
    const ok = !!stored && (await checkPin(pin, stored));
    log.info('parental', ok ? 'pin accepted' : 'pin rejected');
    return ok;
  }

  /** Sets or changes the PIN; changing requires the current one. */
  async setPin(current: string | null, next: string): Promise<void> {
    if (!isValidPin(next)) throw new AppError({ code: 'invalid-input', message: 'The PIN must be 4 digits' });
    const stored = await this.storedPin();
    if (stored && !(current && (await checkPin(current, stored)))) {
      throw new AppError({ code: 'auth', message: 'Wrong PIN' });
    }
    await (await openUltraDb()).put('settings', await this.box.seal(await hashPin(next)), PIN_KEY);
    log.info('parental', stored ? 'pin changed' : 'pin set');
  }

  async clearPin(current: string): Promise<void> {
    const stored = await this.storedPin();
    if (!stored) return;
    if (!(await checkPin(current, stored))) throw new AppError({ code: 'auth', message: 'Wrong PIN' });
    await (await openUltraDb()).delete('settings', PIN_KEY);
    log.info('parental', 'pin removed');
  }

  private async storedPin(): Promise<PinHash | null> {
    const blob = await (await openUltraDb()).get('settings', PIN_KEY);
    return blob ? this.box.open<PinHash>(blob as Parameters<SecretBox['open']>[0]) : null;
  }

  private async pruneEpg(): Promise<void> {
    try {
      const db = await openUltraDb();
      const tx = db.transaction('epg', 'readwrite');
      let cursor = await tx.store.openCursor();
      let removed = 0;
      while (cursor) {
        if (Date.now() - cursor.value.fetchedAt > EPG_KEEP_MS) {
          await cursor.delete();
          removed++;
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      if (removed) log.debug('epg', 'pruned old entries', { removed });
    } catch (e) {
      log.warn('epg', 'prune failed', { error: e });
    }
  }

  private async doRefresh(id: string): Promise<RefreshResult> {
    const db = await openUltraDb();
    const record = await db.get('playlists', id);
    if (!record) throw new AppError({ code: 'not-found', message: 'Playlist not found' });
    const timer = log.time('playlist', 'refresh', { playlist: id, type: record.type });
    await db.put('playlists', { ...record, lastAttempt: Date.now() });
    const counts: Partial<Record<ContentKind, number>> = {};
    const partial: ContentKind[] = [];
    let account: AccountInfo | undefined = record.account;
    let error: ErrorInfo | undefined;
    try {
      const secret = await this.secret(id);
      const write = async <K extends ContentKind>(kind: K, built: Built<K>) => {
        const stats = await writeKind(db, id, kind, built);
        counts[kind] = built.items.length;
        this.searchCache.delete(id);
        this.hooks.progress({ playlistId: id, kind, count: built.items.length, stats });
        this.hooks.changed(id, [kind]);
        log.info('playlist', `${kind} saved`, { playlist: id, items: built.items.length, ...flatStats(stats) });
      };
      if (record.type === 'xtream') {
        account = await this.refreshXtream(id, secret, record.userAgent, write, partial);
      } else {
        await this.refreshM3u(id, secret, record.userAgent, write);
      }
    } catch (e) {
      error = toErrorInfo(e);
    }
    const latest = (await db.get('playlists', id)) ?? record;
    const ok = !error;
    await db.put('playlists', {
      ...latest,
      lastSync: ok ? Date.now() : latest.lastSync,
      lastError: error ?? (partial.length ? { code: 'http', message: `Some sections failed: ${partial.join(', ')}` } : undefined),
      counts: ok ? { ...latest.counts, ...counts } : latest.counts,
      account,
    });
    this.hooks.changed(id, []);
    timer.end({ ok, counts, partial: partial.length ? partial : undefined, error }, ok ? 'info' : 'warn');
    return { playlistId: id, ok, counts, error, partial: partial.length ? partial : undefined };
  }

  /**
   * The six catalogue calls (plus login) run in parallel, max 3 at a time per host (spec §6),
   * queued so Live comes first and the Live screen fills before VOD finishes.
   */
  private async refreshXtream(
    id: string,
    secret: PlaylistSecret,
    userAgent: string | undefined,
    write: <K extends ContentKind>(kind: K, built: Built<K>) => Promise<void>,
    partial: ContentKind[],
  ): Promise<AccountInfo> {
    const api = this.xtream(secret, userAgent);
    const limit = createLimiter(3);
    const login = limit(() => api.login());
    const liveCats = limit(api.liveCategories);
    const live = limit(api.liveStreams);
    const vodCats = limit(api.vodCategories);
    const vod = limit(api.vodStreams);
    const seriesCats = limit(api.seriesCategories);
    const series = limit(api.series);
    // Avoid unhandled rejections for requests still queued when login fails.
    for (const p of [liveCats, live, vodCats, vod, seriesCats, series]) p.catch(() => undefined);

    const account = await login;
    await write('live', buildXtreamLive(id, await liveCats, await live));
    const rest = async <K extends ContentKind>(kind: K, run: () => Promise<Built<K>>) => {
      try {
        await write(kind, await run());
      } catch (e) {
        partial.push(kind);
        log.warn('playlist', `${kind} failed`, { playlist: id, error: toErrorInfo(e) });
      }
    };
    await Promise.all([
      rest('vod', async () => buildXtreamVod(id, await vodCats, await vod)),
      rest('series', async () => buildXtreamSeries(id, await seriesCats, await series)),
    ]);
    return account;
  }

  private async refreshM3u(
    id: string,
    secret: PlaylistSecret,
    userAgent: string | undefined,
    write: <K extends ContentKind>(kind: K, built: Built<K>) => Promise<void>,
  ): Promise<void> {
    const entries: M3uEntry[] = [];
    const parser = new M3uParser((e) => entries.push(e));
    await getTextStream(secret.m3uUrl!, (chunk) => parser.push(chunk), {
      headers: headersFor(userAgent),
      timeoutMs: 120_000,
    });
    parser.end();
    if (!parser.sawHeader && entries.length === 0) {
      throw new AppError({ code: 'format', message: 'This address did not return an M3U playlist' });
    }
    const pair = dominantPair(entries.map((e) => e.url));
    if (pair && (pair.u !== secret.streamUser || pair.p !== secret.streamPass)) {
      const db = await openUltraDb();
      await db.put('secrets', await this.box.seal({ ...secret, streamUser: pair.u, streamPass: pair.p }), id);
      logging.redactor.addSecret(pair.u);
      logging.redactor.addSecret(pair.p);
      this.hooks.secrets([pair.u, pair.p], []);
    }
    const built = buildM3u(id, entries, pair);
    await write('live', built.live);
    await write('vod', built.vod);
    await write('series', built.series);
  }

  private xtream(secret: PlaylistSecret, userAgent?: string): XtreamApi {
    return new XtreamApi(
      { server: secret.server!, username: secret.username!, password: secret.password! },
      { headers: headersFor(userAgent) },
    );
  }

  private async secret(id: string): Promise<PlaylistSecret> {
    const blob = await (await openUltraDb()).get('secrets', id);
    if (!blob) throw new AppError({ code: 'not-found', message: 'Saved credentials are missing' });
    return this.box.open<PlaylistSecret>(blob);
  }

  /** Editing with an empty password keeps the saved one. */
  private async withSavedPassword(input: PlaylistInput): Promise<Normalized> {
    if (input.id && input.type === 'xtream' && !input.password) {
      const saved = await this.secret(input.id).catch(() => null);
      if (saved?.password) return this.normalize({ ...input, password: saved.password });
    }
    return this.normalize(input);
  }

  private registerSecrets(record: { host: string }, secret: PlaylistSecret): void {
    const secrets = [secret.username, secret.password, secret.streamUser, secret.streamPass].filter(
      (s): s is string => !!s,
    );
    const hosts: string[] = [];
    for (const url of [secret.server, secret.m3uUrl]) {
      try {
        if (url) hosts.push(new URL(url).hostname);
      } catch {
        // ignore
      }
    }
    if (!hosts.length && record.host) hosts.push(record.host.replace(/:\d+$/, ''));
    secrets.forEach((s) => logging.redactor.addSecret(s));
    hosts.forEach((h) => logging.redactor.addHost(h));
    this.hooks.secrets(secrets, hosts);
  }
}

function headersFor(userAgent?: string): Record<string, string> | undefined {
  // Browsers ignore a custom User-Agent; native HTTP (Android) honours it.
  return userAgent ? { 'User-Agent': userAgent } : undefined;
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return 'pl_' + hash64(Array.prototype.join.call(bytes, ',') + Date.now()).slice(0, 12);
}

function flatStats(s: WriteStats) {
  return { added: s.added, updated: s.updated, removed: s.removed, unchanged: s.unchanged, favMoved: s.favorites.moved, favLost: s.favorites.lost };
}
