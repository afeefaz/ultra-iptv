import { log, logging } from '../log';
import { createLimiter } from '../net/limit';
import { perf } from '../perf/perf';
import type { SpeedTargets } from '../net/speed';
import { AppError, getTextStream, toErrorInfo } from '../net/http';
import { checkPin, hashPin, isValidPin, type PinHash } from '../secure/pin';
import { SecretBox } from '../secure/secret-box';
import { M3uParser, type M3uEntry } from '../sources/m3u';
import { normalizeServer, parseXtreamUrl, XtreamApi, type XtreamCreds } from '../sources/xtream';
import { buildM3u, buildXtreamLive, buildXtreamSeries, buildXtreamVod, unsigned, type Built } from './build';
import { openUltraDb, playlistRange } from './db';
import { catalogFiles, sectionWorkers, type SectionWorkerLike } from './files';
import {
  checkRoom,
  commitSection,
  fileIndexKey,
  NAMES_FILE,
  newSectionFolder,
  pipeWriter,
  readCategoryFile,
  readFileIndex,
  readNames,
  removePlaylistFiles,
  rowByIdFromFiles,
  writeKindToFiles,
  type EncodedSection,
} from './fileStore';
import type { SectionJob, SectionMessage, SectionReply } from './sectionJob';
import { parseSeriesInfo, parseVodInfo, versionKey } from './details';
import { RemoteAccess } from './remote';
import { SyncAccess } from './sync';
import { applyHiddenRule, type HiddenRule } from './groups';
import { categoryNames, hiddenCategories, hiddenRule, listCategories, listItems } from './queries';
import { epgIsFresh, parseShortEpg } from './epg';
import { hash64 } from './hash';
import {
  catKey,
  CONTENT_KINDS,
  maskUser,
  hiddenCategoriesKey,
  hiddenRuleKey,
  categoryNamesKey,
  MAX_CATEGORY_NAME,
  listHashKey,
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
  type VodRow,
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
import { deletePlaylistData, readSnapshot, writeKind, writeSnapshot, type WriteStats } from './store';
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
  /** Weighted steps finished out of `total` (downloads and saves), for a percentage. */
  done: number;
  total: number;
  /** What just finished: a download, or a section saved (`kind` + `count`). */
  step: 'download' | 'saved';
  kind?: ContentKind;
  count?: number;
  stats?: WriteStats;
}

/** Step weights: big lists take longer to download and save than logins and category lists. */
const SPEED_MOVIES = 3;
/** Raise when parsing or building rows changes, so the next refresh rebuilds everything. */
const LIST_HASH_VERSION = 1;
const MAX_VERSIONS = 12;
const MAX_MORE = 16;
const W = { small: 1, list: 4, save: 3 };
const XTREAM_TOTAL = W.small * 4 + W.list * 3 + W.save * 3;
const M3U_TOTAL = W.list * 3 + W.save * 3;

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
  private readonly versionIndexes = new Map<string, Promise<Map<string, string[]>>>();
  private readonly epgInflight = new Map<string, Promise<EpgEntry[]>>();
  private readonly epgLimit = createLimiter(3);
  private lastRecentAt = 0;

  /** Managing this device from another one; silent until the user pairs. */
  readonly remote = new RemoteAccess(
    {
      editData: (id) => this.editData(id),
      save: (input) => this.save(input),
      remove: (id) => this.remove(id),
      secretsFound: (secrets) => this.hooks.secrets(secrets, []),
    },
    this.box,
  );

  /** On-demand sync between devices. */
  readonly sync = new SyncAccess(
    {
      relay: () => this.remote.relay,
      identity: () => this.remote.enable(),
      editData: (id) => this.editData(id),
      save: (input) => this.save(input),
      remove: (id) => this.remove(id),
      readPin: () => this.storedPin(),
      writePin: async (pin) => {
        const db = await openUltraDb();
        if (pin) await db.put('settings', await this.box.seal(pin), PIN_KEY);
        else await db.delete('settings', PIN_KEY);
      },
      playlistsReplaced: () => this.remote.publishAll(),
    },
    this.box,
  );

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
      // A playlist from the website keeps the id it was given there.
      id: existing?.id ?? input.id ?? newId(),
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
      // Shown in the edit form as plain text (the user's choice: IPTV logins aren't treated as secrets in the UI).
      password: secret.password,
      m3uUrl: secret.m3uUrl,
      userAgent: record.userAgent,
      refreshHours: record.refreshHours,
      epgOffsetHours: record.epgOffsetHours ?? 0,
    };
  }

  async remove(id: string): Promise<void> {
    await deletePlaylistData(await openUltraDb(), id);
    const files = catalogFiles();
    if (files) await removePlaylistFiles(files, id).catch((e) => log.warn('playlist', 'could not delete its files', { error: e }));
    this.searchCache.delete(id);
    this.versionIndexes.delete(id);
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
    if (cached && epgIsFresh(cached.items, cached.fetchedAt, now)) {
      perf.count('cache.epg.hit');
      return cached.items;
    }
    perf.count('cache.epg.miss');
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

  /** Writes the fast copy of a section if it's missing (first launch after an update). */
  async ensureSnapshot(playlistId: string, kind: ContentKind): Promise<void> {
    // Stored in files: there is no database copy to make, and no room for one.
    if (catalogFiles() || (await (await openUltraDb()).get('settings', fileIndexKey(playlistId, kind)))) return;
    if (!(await readSnapshot(await openUltraDb(), playlistId, kind))) await this.saveSnapshot(playlistId, kind);
  }

  private async saveSnapshot(playlistId: string, kind: ContentKind): Promise<void> {
    const [cats, rows] = await Promise.all([listCategories(playlistId, kind), listItems(playlistId, kind, null)]);
    await writeSnapshot(await openUltraDb(), playlistId, kind, cats, rows);
  }

  /** Same title in other categories. The first call reads every movie, here off the main thread. */
  async vodVersions(playlistId: string, id: string): Promise<Array<{ row: VodRow; category: string }>> {
    const row = await this.vodRow(playlistId, id);
    if (!row) return [];
    const index = await this.versionIndexFor(playlistId);
    const ids = (index.get(versionKey(row.name)) ?? []).filter((other) => other !== id).slice(0, MAX_VERSIONS);
    if (!ids.length) return [];
    const names = await this.categoryNames(playlistId);
    const rows = await Promise.all(ids.map((other) => this.vodRow(playlistId, other)));
    return rows
      .filter((r): r is VodRow => !!r)
      .map((r) => ({ row: r, category: r.categoryIds.map((c) => names.get(c) ?? '').join(' · ') }));
  }

  /** Other movies from the same category: only that category is read. */
  async vodMore(playlistId: string, id: string): Promise<{ category: string; more: VodRow[] }> {
    const db = await openUltraDb();
    const row = await this.vodRow(playlistId, id);
    const categoryId = row?.categoryIds[0];
    if (!row || !categoryId) return { category: '', more: [] };
    const files = catalogFiles();
    const fromFile = files ? await readCategoryFile(db, files, playlistId, 'vod', categoryId) : null;
    const rows = fromFile ? fromFile.slice(0, MAX_MORE + MAX_VERSIONS) : await db.getAllFromIndex('vod', 'byCat', catKey(playlistId, categoryId), MAX_MORE + MAX_VERSIONS);
    const vk = versionKey(row.name);
    return {
      category: (await this.categoryNames(playlistId)).get(categoryId) ?? '',
      more: rows.filter((o) => o.key !== row.key && versionKey(o.name) !== vk).slice(0, MAX_MORE),
    };
  }

  /** A movie by id, from the database or, on a Samsung with the catalogue in files, from its file. */
  private async vodRow(playlistId: string, id: string): Promise<VodRow | undefined> {
    const db = await openUltraDb();
    const files = catalogFiles();
    if (files) {
      const row = await rowByIdFromFiles(db, files, playlistId, 'vod', id);
      if (row !== null) return row;
    }
    return db.get('vod', [playlistId, id]);
  }

  private async categoryNames(playlistId: string): Promise<Map<string, string>> {
    const cats = await listCategories(playlistId, 'vod');
    return new Map(cats.map((c) => [c.id, c.name] as [string, string]));
  }

  private versionIndexFor(playlistId: string): Promise<Map<string, string[]>> {
    let index = this.versionIndexes.get(playlistId);
    if (!index) {
      index = perf.timed('worker.versionIndex', async () => {
        const files = catalogFiles();
        const lookup = files ? await readNames(await openUltraDb(), files, playlistId, 'vod') : null;
        if (lookup) {
          // In files: the names list is enough; no movie needs reading.
          const byName = new Map<string, string[]>();
          for (const e of lookup.entries) {
            const vk = versionKey(e[1]);
            const list = byName.get(vk);
            if (list) list.push(e[3]);
            else byName.set(vk, [e[3]]);
          }
          return byName;
        }
        const rows = await (await openUltraDb()).getAll('vod', playlistRange(playlistId));
        const out = new Map<string, string[]>();
        for (const r of rows) {
          const vk = versionKey(r.name);
          const ids = out.get(vk);
          if (ids) ids.push(r.id);
          else out.set(vk, [r.id]);
        }
        return out;
      });
      this.versionIndexes.set(playlistId, index);
      index.catch(() => this.versionIndexes.delete(playlistId));
    }
    return index;
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

  async setHiddenCategories(playlistId: string, kind: ContentKind, categoryIds: string[], rule: HiddenRule): Promise<void> {
    const db = await openUltraDb();
    await db.put('settings', categoryIds, hiddenCategoriesKey(playlistId, kind));
    await db.put('settings', rule, hiddenRuleKey(playlistId, kind));
  }

  /** Gives a category a name of the user's choosing; an empty name or null goes back to the provider's. */
  async renameCategory(playlistId: string, kind: ContentKind, categoryId: string, name: string | null): Promise<Record<string, string>> {
    const names = { ...(await categoryNames(playlistId, kind)) };
    const clean = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CATEGORY_NAME);
    if (clean) names[categoryId] = clean;
    else delete names[categoryId];
    const db = await openUltraDb();
    if (Object.keys(names).length) await db.put('settings', names, categoryNamesKey(playlistId, kind));
    else await db.delete('settings', categoryNamesKey(playlistId, kind));
    return names;
  }

  /** A category the provider just added to a hidden group stays hidden. */
  private async applyHiddenGroups(playlistId: string, kind: ContentKind): Promise<void> {
    const rule = await hiddenRule(playlistId, kind);
    if (!rule.labels.length && !rule.tags?.length) return;
    const ids = await hiddenCategories(playlistId, kind);
    const next = applyHiddenRule(await listCategories(playlistId, kind), ids, rule);
    if (next.length !== ids.length) await (await openUltraDb()).put('settings', next, hiddenCategoriesKey(playlistId, kind));
  }

  /** What the speed test downloads: a few of the provider's video files, then its big lists. */
  async speedTargets(playlistId: string): Promise<SpeedTargets> {
    const db = await openUltraDb();
    const record = await db.get('playlists', playlistId);
    if (!record) throw new AppError({ code: 'not-found', message: 'Playlist not found' });
    const secret = await this.secret(playlistId);
    const range = IDBKeyRange.bound([playlistId, ''], [playlistId, '\uffff']);
    let movies = await db.getAll('vod', range, SPEED_MOVIES);
    const files = catalogFiles();
    const index = files && !movies.length ? await readFileIndex(db, playlistId, 'vod') : undefined;
    if (files && index) {
      const first = Object.keys(index.files)[0];
      movies = first ? ((await readCategoryFile(db, files, playlistId, 'vod', first)) ?? []).slice(0, SPEED_MOVIES) : [];
    }
    const downloads: SpeedTargets['downloads'] = [];
    for (const movie of movies) {
      const ref: MediaRef = movie.stream.t === 'x' ? { t: 'movie', id: movie.stream.id, ext: movie.stream.ext } : { t: 'url', url: movie.stream.url };
      downloads.push({ url: (await this.mediaUrl(playlistId, ref, false)).url, kind: 'media' });
    }
    if (record.type === 'xtream') {
      const api = this.xtream(secret, record.userAgent);
      downloads.push({ url: api.url('get_vod_streams'), kind: 'catalog' }, { url: api.url('get_live_streams'), kind: 'catalog' });
      return { ping: api.url(), downloads };
    }
    downloads.push({ url: secret.m3uUrl!, kind: 'catalog' });
    return { ping: secret.m3uUrl!, downloads };
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
    const refreshSpan = perf.span('refresh.total');
    const timer = log.time('playlist', 'refresh', { playlist: id, type: record.type });
    await db.put('playlists', { ...record, lastAttempt: Date.now() });
    const counts: Partial<Record<ContentKind, number>> = {};
    const partial: ContentKind[] = [];
    let account: AccountInfo | undefined = record.account;
    let error: ErrorInfo | undefined;
    const total = record.type === 'xtream' ? XTREAM_TOTAL : M3U_TOTAL;
    let done = 0;
    const step = (weight: number) => {
      done += weight;
      this.hooks.progress({ playlistId: id, done: Math.min(done, total), total, step: 'download' });
    };
    try {
      const secret = await this.secret(id);
      /** A section is saved: counts, hidden groups, caches, and telling the screens. */
      const finish = async (kind: ContentKind, count: number, stats: WriteStats) => {
        counts[kind] = count;
        await this.applyHiddenGroups(id, kind);
        this.searchCache.delete(id);
        if (kind === 'vod') this.versionIndexes.delete(id);
        done += W.save;
        this.hooks.progress({ playlistId: id, done: Math.min(done, total), total, step: 'saved', kind, count, stats });
        this.hooks.changed(id, [kind]);
        log.info('playlist', `${kind} saved`, { playlist: id, items: count, ...flatStats(stats) });
      };
      const write = async <K extends ContentKind>(kind: K, built: Built<K>) => {
        // Samsung: the database is too small for a big catalogue, so it goes to files, one per category.
        const files = catalogFiles();
        const stats = files
          ? await perf.timed(`refresh.files.${kind}`, () => writeKindToFiles(db, files, id, kind, built), { items: built.items.length })
          : await perf.timed(`refresh.write.${kind}`, () => writeKind(db, id, kind, built), { items: built.items.length });
        if (!files) await perf.timed(`refresh.snapshot.${kind}`, () => this.saveSnapshot(id, kind));
        await finish(kind, built.items.length, stats);
      };
      const unchanged = (kind: ContentKind) => {
        void this.ensureSnapshot(id, kind);
        done += W.save;
        this.hooks.progress({ playlistId: id, done: Math.min(done, total), total, step: 'saved', kind, count: record.counts?.[kind] ?? 0 });
      };
      if (record.type === 'xtream') {
        account = await this.refreshXtream(id, secret, record.userAgent, write, finish, unchanged, partial, step);
      } else {
        await this.refreshM3u(id, secret, record.userAgent, write, step);
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
    refreshSpan.end({ ok });
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
    finish: (kind: ContentKind, count: number, stats: WriteStats) => Promise<void>,
    unchanged: (kind: ContentKind) => void,
    partial: ContentKind[],
    step: (weight: number) => void,
  ): Promise<AccountInfo> {
    const api = this.xtream(secret, userAgent);
    const db = await openUltraDb();
    const limit = createLimiter(3);
    const fetched = (weight: number, action: string) => {
      const p = limit(() => api.rawList(action)).then((text) => (step(weight), text));
      // Avoid unhandled rejections for requests still queued when login fails.
      p.catch(() => undefined);
      return p;
    };
    // Catalogue in files (a TV with little memory): Live comes first and alone, and Movies and Series
    // download while it is processed; they are then processed one at a time.
    const inFiles = !!catalogFiles();
    const after = (before: Promise<unknown>, weight: number, action: string) => {
      const p = before.then(
        () => fetched(weight, action),
        () => fetched(weight, action),
      );
      p.catch(() => undefined);
      return p;
    };
    const login = limit(() => api.login()).then((v) => (step(W.small), v));
    const liveCats = fetched(W.small, 'get_live_categories');
    const vodCats = fetched(W.small, 'get_vod_categories');
    const seriesCats = fetched(W.small, 'get_series_categories');
    // Each big list is handed over once and then forgotten here, so its text can be freed as
    // soon as it's processed rather than when the whole refresh ends.
    const lists: Partial<Record<ContentKind, Promise<string>>> = {};
    lists.live = fetched(W.list, 'get_live_streams');
    // With a second worker (TVs), Movies is downloaded and processed there, on another core.
    const sections = inFiles ? sectionWorkers() : null;
    if (!sections) lists.vod = inFiles ? after(lists.live, W.list, 'get_vod_streams') : fetched(W.list, 'get_vod_streams');
    // Series starts with Movies: on its own it took longer to arrive than Movies takes to process.
    lists.series = inFiles ? after(lists.live, W.list, 'get_series') : fetched(W.list, 'get_series');
    const take = (kind: ContentKind): Promise<string> => {
      const p = lists[kind] as Promise<string>;
      delete lists[kind];
      return p;
    };

    /** A list identical to the last refresh skips parsing and saving, and keeps what's in memory. */
    const apply = async <K extends ContentKind>(
      kind: K,
      cats: Promise<string>,
      items: Promise<string>,
      build: (catsText: string, itemsText: string) => Built<K>,
    ) => {
      const [catsText, itemsText] = [await cats, await items];
      const key = listHashKey(id, kind);
      const previous = await db.get('settings', key);
      const make = () => perf.timedSync(`refresh.build.${kind}`, () => (inFiles ? unsigned(() => build(catsText, itemsText)) : build(catsText, itemsText)));
      // A first load into files has nothing to compare with: no seconds spent on the check.
      if (inFiles && previous === undefined && !(await db.get('settings', fileIndexKey(id, kind)))) {
        await write(kind, make());
        return;
      }
      const hash = perf.timedSync(`refresh.hash.${kind}`, () => `${LIST_HASH_VERSION}|${hash64(catsText)}|${hash64(itemsText)}`);
      if (previous === hash) {
        perf.count(`refresh.unchanged.${kind}`);
        unchanged(kind);
        return;
      }
      await write(kind, make());
      await db.put('settings', hash, key);
    };

    const account = await login;
    // Started once Live's list has arrived (as the download would be here), with the category list
    // already fetched: never more connections at once than without the second worker.
    const remoteVod = sections
      ? Promise.all([vodCats, lists.live.then(() => 0, () => 0)]).then(([catsText]) => this.remoteSection(id, 'vod', secret, userAgent, catsText, sections, finish, unchanged, step))
      : null;
    if (remoteVod) remoteVod.catch(() => undefined);
    await apply('live', liveCats, take('live'), (c, i) =>
      buildXtreamLive(id, api.parseList('get_live_categories', c), api.parseList('get_live_streams', i)),
    );
    const rest = async (kind: ContentKind, run: () => Promise<void>) => {
      try {
        await run();
      } catch (e) {
        partial.push(kind);
        log.warn('playlist', `${kind} failed`, { playlist: id, error: toErrorInfo(e) });
      }
    };
    const doVod = () =>
      rest('vod', () =>
        apply('vod', vodCats, take('vod'), (c, i) => buildXtreamVod(id, api.parseList('get_vod_categories', c), api.parseList('get_vod_streams', i))),
      );
    const doSeries = () =>
      rest('series', () =>
        apply('series', seriesCats, take('series'), (c, i) => buildXtreamSeries(id, api.parseList('get_series_categories', c), api.parseList('get_series', i))),
      );
    if (remoteVod) {
      // Movies in the section worker, Series here: two cores at once.
      await Promise.all([rest('vod', () => remoteVod), doSeries()]);
    } else if (inFiles) {
      // One at a time: only one big list's rows in memory.
      await doVod();
      await doSeries();
    } else {
      await Promise.all([doVod(), doSeries()]);
    }
    return account;
  }

  /** One section done by a section worker (see sectionJob.ts): it sends file text, this writes and commits it. */
  private async remoteSection(
    id: string,
    kind: 'vod' | 'series',
    secret: PlaylistSecret,
    userAgent: string | undefined,
    catsText: string,
    start: () => SectionWorkerLike,
    finish: (kind: ContentKind, count: number, stats: WriteStats) => Promise<void>,
    unchanged: (kind: ContentKind) => void,
    step: (weight: number) => void,
  ): Promise<void> {
    const db = await openUltraDb();
    const files = catalogFiles();
    if (!files) throw new AppError({ code: 'internal', message: 'No file storage' });
    const key = listHashKey(id, kind);
    const previousHash = (await db.get('settings', key)) as string | undefined;
    const previous = await readFileIndex(db, id, kind);
    const favorites = await db.getAllFromIndex('favorites', 'byPlaylistKind', [id, kind]);
    const { gen, dir, data } = newSectionFolder(id, kind);
    const writer = pipeWriter(files, data);
    const span = perf.span(`refresh.files.${kind}`);
    const worker = start();
    try {
      const result = await new Promise<{ encoded: EncodedSection; hash?: string; ms: Record<string, number> } | null>((resolve, reject) => {
        worker.onmessage = (e) => {
          const m = e.data as SectionMessage;
          if (m.type === 'downloaded') step(W.list);
          else if (m.type === 'estimate')
            checkRoom(files, m.bytes).then(
              () => worker.postMessage({ type: 'go' } as SectionReply),
              (err: unknown) => worker.postMessage({ type: 'stop', error: toErrorInfo(err) } as SectionReply),
            );
          else if (m.type === 'batch') writer.send(m.text, m.start).then(() => worker.postMessage({ type: 'ack' } as SectionReply), reject);
          else if (m.type === 'unchanged') resolve(null);
          else if (m.type === 'done') resolve({ encoded: m.encoded, hash: m.hash, ms: m.ms });
          else if (m.type === 'error') reject(new AppError(m.error));
        };
        worker.onerror = (ev) => reject(new AppError({ code: 'internal', message: `Section worker failed: ${ev.message || ''}` }));
        const job: SectionJob = {
          playlistId: id,
          kind,
          creds: { server: secret.server!, username: secret.username!, password: secret.password! },
          headers: headersFor(userAgent),
          catsText,
          // The same rule as here: a first load into files has nothing to compare with.
          previousHash: previousHash !== undefined || previous ? (previousHash ?? '') : undefined,
          hashVersion: LIST_HASH_VERSION,
          favorites,
        };
        worker.postMessage({ type: 'job', job } as SectionReply);
      });
      if (!result) {
        perf.count(`refresh.unchanged.${kind}`);
        unchanged(kind);
        await files.removeDir(dir).catch(() => undefined);
        return;
      }
      for (const name of Object.keys(result.ms)) perf.count(`section.${kind}.${name}Ms`, result.ms[name]);
      await writer.done();
      await perf.timed(`files.namesWrite.${kind}`, () => files.write(`${dir}/${NAMES_FILE}`, result.encoded.namesText));
      const stats = await commitSection(db, files, id, kind, gen, result.encoded, previous);
      if (result.hash) await db.put('settings', result.hash, key);
      span.end({ items: result.encoded.items });
      await finish(kind, result.encoded.items, stats);
    } catch (e) {
      span.end();
      await writer.done().catch(() => undefined);
      await files.removeDir(dir).catch(() => undefined);
      throw e;
    } finally {
      worker.terminate();
    }
  }

  private async refreshM3u(
    id: string,
    secret: PlaylistSecret,
    userAgent: string | undefined,
    write: <K extends ContentKind>(kind: K, built: Built<K>) => Promise<void>,
    step: (weight: number) => void,
  ): Promise<void> {
    const entries: M3uEntry[] = [];
    const parser = new M3uParser((e) => entries.push(e));
    await getTextStream(secret.m3uUrl!, (chunk) => parser.push(chunk), {
      headers: headersFor(userAgent),
      timeoutMs: 120_000,
    });
    parser.end();
    step(W.list * 3);
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
