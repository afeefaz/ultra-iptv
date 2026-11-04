import type { AccountInfo } from '../catalog/model';
import { AppError, getJson, getText, parseJson, type GetOptions } from '../net/http';

export interface XtreamCreds {
  server: string;
  username: string;
  password: string;
}

const API_FILES = /\/(player_api|get|xmltv|panel_api)\.php$/i;

/** `host:8080`, `http://host:8080/`, `http://host/player_api.php` → `http://host:8080` (no trailing slash). */
export function normalizeServer(input: string): string {
  let raw = input.trim();
  if (!raw) throw new AppError({ code: 'invalid-input', message: 'Server address is empty' });
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'http://' + raw;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AppError({ code: 'invalid-input', message: 'Server address is not a valid URL' });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new AppError({ code: 'invalid-input', message: 'Server address must start with http:// or https://' });
  }
  const path = u.pathname.replace(API_FILES, '').replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

/**
 * Recognises full Xtream URLs pasted into the form (spec §2): `get.php?username&password…`,
 * `player_api.php?username&password`, and `/playlist/<u>/<p>/…`. Parameters are read by name.
 */
export function parseXtreamUrl(input: string): XtreamCreds | null {
  let u: URL;
  try {
    const raw = input.trim();
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'http://' + raw);
  } catch {
    return null;
  }
  const username = u.searchParams.get('username');
  const password = u.searchParams.get('password');
  if (username && password && API_FILES.test(u.pathname)) {
    return { server: normalizeServer(u.href), username, password };
  }
  const m = /^(.*?)\/playlist\/([^/]+)\/([^/]+)(\/|$)/.exec(u.pathname);
  if (m) {
    return {
      server: `${u.protocol}//${u.host}${m[1]}`,
      username: decodeURIComponent(m[2]),
      password: decodeURIComponent(m[3]),
    };
  }
  return null;
}

export interface XtreamCategory {
  category_id: string | number;
  category_name: string;
  parent_id?: number | string;
}

export interface XtreamLiveStream {
  num?: number | string;
  name: string;
  stream_id: number | string;
  stream_icon?: string;
  epg_channel_id?: string | null;
  added?: string | number;
  category_id?: string | number | null;
  category_ids?: Array<string | number>;
  tv_archive?: number | string;
  tv_archive_duration?: number | string;
}

export interface XtreamVodStream {
  num?: number | string;
  name: string;
  stream_id: number | string;
  stream_icon?: string;
  added?: string | number;
  category_id?: string | number | null;
  category_ids?: Array<string | number>;
  container_extension?: string;
  rating?: string | number;
  year?: string | number;
}

export interface XtreamSeries {
  num?: number | string;
  name: string;
  series_id: number | string;
  cover?: string;
  last_modified?: string | number;
  category_id?: string | number | null;
  category_ids?: Array<string | number>;
  rating?: string | number;
  year?: string | number;
  releaseDate?: string;
}

export interface XtreamEpgListing {
  title?: string;
  description?: string;
  start?: string;
  end?: string;
  start_timestamp?: string | number;
  stop_timestamp?: string | number;
  has_archive?: string | number;
}

interface XtreamLogin {
  user_info?: {
    auth?: number | string;
    status?: string;
    exp_date?: string | number | null;
    max_connections?: string | number;
    active_cons?: string | number;
    is_trial?: string | number;
    allowed_output_formats?: string[];
  };
}

export class XtreamApi {
  constructor(
    private readonly creds: XtreamCreds,
    private readonly opts: GetOptions = {},
  ) {}

  url(action?: string): string {
    const { server, username, password } = this.creds;
    const base = `${server}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    return action ? `${base}&action=${action}` : base;
  }

  async login(timeoutMs?: number): Promise<AccountInfo> {
    const res = await getJson<XtreamLogin>(this.url(), timeoutMs ? { ...this.opts, timeoutMs } : this.opts);
    const info = res && res.user_info;
    if (!info || String(info.auth) !== '1') {
      throw new AppError({ code: 'auth', message: 'The server rejected the username or password' });
    }
    const exp = Number(info.exp_date);
    return {
      status: info.status,
      expiresAt: exp > 0 ? exp * 1000 : undefined,
      maxConnections: toNumber(info.max_connections),
      activeConnections: toNumber(info.active_cons),
      trial: String(info.is_trial) === '1',
      outputFormats: Array.isArray(info.allowed_output_formats) ? info.allowed_output_formats.map(String) : undefined,
    };
  }

  liveCategories = () => this.list<XtreamCategory>('get_live_categories');
  liveStreams = () => this.list<XtreamLiveStream>('get_live_streams');
  vodCategories = () => this.list<XtreamCategory>('get_vod_categories');
  vodStreams = () => this.list<XtreamVodStream>('get_vod_streams');
  seriesCategories = () => this.list<XtreamCategory>('get_series_categories');
  series = () => this.list<XtreamSeries>('get_series');

  vodInfo = (vodId: string) => getJson<unknown>(this.url(`get_vod_info&vod_id=${encodeURIComponent(vodId)}`), this.opts);
  seriesInfo = (seriesId: string) =>
    getJson<unknown>(this.url(`get_series_info&series_id=${encodeURIComponent(seriesId)}`), this.opts);

  /** Full archive listings for catch-up (spec §5); same base64 format as the short EPG. */
  async archive(streamId: string): Promise<XtreamEpgListing[]> {
    const res = await getJson<{ epg_listings?: XtreamEpgListing[] }>(
      this.url(`get_simple_data_table&stream_id=${encodeURIComponent(streamId)}`),
      { ...this.opts, timeoutMs: 20_000 },
    );
    return res && Array.isArray(res.epg_listings) ? res.epg_listings : [];
  }

  /** Now/next for one channel (spec §7); titles and descriptions arrive base64-encoded. */
  async shortEpg(streamId: string, limit = 4): Promise<XtreamEpgListing[]> {
    const res = await getJson<{ epg_listings?: XtreamEpgListing[] }>(
      this.url(`get_short_epg&stream_id=${encodeURIComponent(streamId)}&limit=${limit}`),
      { ...this.opts, timeoutMs: 15_000 },
    );
    if (res && 'user_info' in (res as object)) throw new AppError({ code: 'auth', message: 'The server rejected the username or password' });
    return (res && Array.isArray(res.epg_listings) ? res.epg_listings : []);
  }

  private async list<T>(action: string): Promise<T[]> {
    return this.parseList<T>(action, await this.rawList(action));
  }

  /** A list as the server sent it, so a refresh can tell it hasn't changed before parsing it. */
  rawList(action: string): Promise<string> {
    return getText(this.url(action), this.opts);
  }

  parseList<T>(action: string, text: string): T[] {
    const res = parseJson<unknown>(this.url(action), text);
    if (Array.isArray(res)) return res as T[];
    if (res && typeof res === 'object') {
      // Rejected logins come back as a user_info object instead of a list.
      if ('user_info' in res) throw new AppError({ code: 'auth', message: 'The server rejected the username or password' });
      // Some panels send {} for an empty list.
      if (Object.keys(res).length === 0) return [];
    }
    throw new AppError({ code: 'format', message: `Unexpected response for ${action}` });
  }
}

export function toNumber(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return isFinite(n) ? n : undefined;
}
