export type PlaylistType = 'xtream' | 'm3u';
export type ContentKind = 'live' | 'vod' | 'series';
export const CONTENT_KINDS: ContentKind[] = ['live', 'vod', 'series'];

export interface ErrorInfo {
  code: ErrorCode;
  message: string;
  status?: number;
}

export type ErrorCode =
  | 'auth'
  | 'cors'
  | 'network'
  | 'timeout'
  | 'http'
  | 'format'
  | 'invalid-input'
  | 'secure-storage'
  | 'not-found'
  | 'internal';

export interface AccountInfo {
  status?: string;
  expiresAt?: number;
  maxConnections?: number;
  activeConnections?: number;
  trial?: boolean;
  /** Xtream `allowed_output_formats`, e.g. ["m3u8", "ts"]. */
  outputFormats?: string[];
}

/** Stored per playlist. Credentials live encrypted in `secrets`, never here. */
export interface PlaylistRecord {
  id: string;
  name: string;
  type: PlaylistType;
  /** Display host (hostname[:port]). */
  host: string;
  /** Masked username for display, e.g. "al•••77". */
  userHint?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  refreshHours: number;
  userAgent?: string;
  /** Corrects providers whose guide times are off by whole hours (spec §7). */
  epgOffsetHours?: number;
  lastSync?: number;
  lastAttempt?: number;
  lastError?: ErrorInfo;
  counts?: Partial<Record<ContentKind, number>>;
  account?: AccountInfo;
}

/** Decrypted credentials. Only exists in memory. */
export interface PlaylistSecret {
  server?: string;
  username?: string;
  password?: string;
  m3uUrl?: string;
  /** Credentials found inside M3U stream URLs, replaced by {u}/{p} placeholders in stored rows. */
  streamUser?: string;
  streamPass?: string;
}

/** What the playlist form submits. */
export interface PlaylistInput {
  id?: string;
  name: string;
  type: PlaylistType;
  server?: string;
  username?: string;
  /** Empty when editing means "keep the saved password". */
  password?: string;
  m3uUrl?: string;
  userAgent?: string;
  refreshHours?: number;
  epgOffsetHours?: number;
}

export interface CategoryRow {
  playlistId: string;
  kind: ContentKind;
  id: string;
  name: string;
  order: number;
  count: number;
}

/** Xtream stream id, or a URL (possibly with {u}/{p} credential placeholders). */
export type StreamRef = { t: 'x'; id: string; ext?: string } | { t: 'u'; url: string };

export interface CatalogItem {
  playlistId: string;
  /** Provider id (Xtream stream_id) or generated id for M3U. */
  id: string;
  /** Stable key used by favourites/progress; survives provider renumbering (spec §6). */
  key: string;
  name: string;
  logo?: string;
  categoryIds: string[];
  /** `${playlistId}|${categoryId}` per category, for the multiEntry index. */
  catKeys: string[];
  added?: number;
  /** Content signature for diffing; changes when any stored field changes. */
  sig: string;
}

export interface ChannelRow extends CatalogItem {
  num: number;
  tvgId?: string;
  catchupDays?: number;
  catchup?: { mode?: string; source?: string };
  stream: StreamRef;
  headers?: { userAgent?: string; referrer?: string };
}

export interface VodRow extends CatalogItem {
  stream: StreamRef;
  rating?: number;
  year?: number;
}

export interface SeriesRow extends CatalogItem {
  seriesId: string;
  /** M3U only: episodes grouped from "Name S01 E02" entries (Xtream fetches them on demand). */
  episodes?: Array<{ season: number; episode: number; title: string; url: string }>;
  rating?: number;
  year?: number;
}

export interface KindRows {
  live: ChannelRow;
  vod: VodRow;
  series: SeriesRow;
}

export interface FavoriteRow {
  playlistId: string;
  kind: ContentKind;
  key: string;
  name: string;
  tvgId?: string;
  addedAt: number;
}

/** One guide entry; times are UTC milliseconds before the playlist's offset is applied. */
export interface EpgEntry {
  start: number;
  stop: number;
  title: string;
  description?: string;
  /** Xtream's own "YYYY-MM-DD HH:MM:SS" (server time zone), used to build timeshift URLs. */
  serverStart?: string;
  /** Archive listings: whether the server can replay this programme. */
  hasArchive?: boolean;
}

export interface EpgRow {
  playlistId: string;
  streamId: string;
  fetchedAt: number;
  items: EpgEntry[];
}

export interface RecentRow {
  playlistId: string;
  kind: ContentKind;
  key: string;
  name: string;
  playedAt: number;
}

export type LockType = 'category' | 'channel';

export interface LockRow {
  playlistId: string;
  type: LockType;
  /** Category id, or the channel's stable key. */
  id: string;
}

/** Output container for live streams; `auto` picks per platform and account. */
export type StreamFormat = 'auto' | 'hls' | 'ts';

/** Movie details from `get_vod_info` (spec §5 detail page). */
export interface VodInfo {
  plot?: string;
  genre?: string;
  director?: string;
  cast?: string;
  releaseDate?: string;
  durationSecs?: number;
  rating?: number;
  poster?: string;
  backdrop?: string;
  trailer?: string;
}

export interface Episode {
  id: string;
  season: number;
  episode: number;
  title: string;
  ext?: string;
  durationSecs?: number;
  plot?: string;
  image?: string;
}

export interface SeriesInfo extends VodInfo {
  seasons: number[];
  episodes: Episode[];
}

/** Something playable that isn't a live channel (spec §4.2). */
export type MediaRef =
  | { t: 'movie'; id: string; ext?: string }
  | { t: 'episode'; id: string; ext?: string }
  | { t: 'url'; url: string }
  | {
      t: 'catchup';
      stream: StreamRef;
      /** UTC ms. */
      start: number;
      durationMin: number;
      serverStart?: string;
      catchup?: { mode?: string; source?: string };
    };

export type ProgressKind = 'vod' | 'episode';

/** Resume position (spec §4.2: saved every 10 s; resume above 2 min; watched above 92 %). */
export interface ProgressRow {
  playlistId: string;
  kind: ProgressKind;
  key: string;
  position: number;
  duration: number;
  updatedAt: number;
  watched: boolean;
  title: string;
  subtitle?: string;
  poster?: string;
  /** Enough to play it again from "Continue watching". */
  ref: MediaRef;
  /** Episodes: the series' stable key and id, for opening the series page. */
  seriesKey?: string;
  seriesId?: string;
}

export interface DetailRow {
  playlistId: string;
  kind: 'vod' | 'series' | 'catchup';
  id: string;
  fetchedAt: number;
  data: unknown;
}

/** Settings-store key holding a playlist's pinned category ids for one content kind. */
export const pinsKey = (playlistId: string, kind: ContentKind) => `catpins|${playlistId}|${kind}`;
export const hiddenCategoriesKey = (playlistId: string, kind: ContentKind) => `cathidden|${playlistId}|${kind}`;

export const RESUME_MIN_SECONDS = 120;
export const WATCHED_RATIO = 0.92;

export interface EncryptedBlob {
  iv: Uint8Array;
  data: ArrayBuffer;
}

export const catKey = (playlistId: string, categoryId: string) => `${playlistId}|${categoryId}`;

export function maskUser(username: string): string {
  if (username.length <= 3) return username.charAt(0) + '•••';
  if (username.length <= 6) return username.slice(0, 2) + '•••';
  return username.slice(0, 2) + '•••' + username.slice(-2);
}
