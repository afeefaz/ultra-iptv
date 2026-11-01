import { AppError } from '../net/http';
import { m3uCatchupUrl, xtreamTimeshiftUrl } from './catchup';
import type { AccountInfo, MediaRef, PlaylistSecret, StreamFormat, StreamRef } from './model';
import { fillUrl } from './stream-creds';

export type Container = 'hls' | 'ts' | 'progressive';

export interface ResolvedStream {
  url: string;
  container: Container;
  /** The other container to try once when live playback keeps failing (Xtream only). */
  fallback?: { url: string; container: Container };
}

export function containerOf(url: string): Container {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (/\.m3u8?$/.test(path)) return 'hls';
  if (/\.(mp4|mkv|webm|mov|m4v|avi)$/.test(path)) return 'progressive';
  return 'ts';
}

/**
 * Builds a live stream URL (spec §4.2). Xtream: `{server}/live/{u}/{p}/{id}.{ts|m3u8}`.
 * `auto` prefers HLS where the platform plays it best (browsers) and the account allows it.
 */
export function resolveLiveStream(
  ref: StreamRef,
  secret: PlaylistSecret,
  format: StreamFormat,
  preferHls: boolean,
  account?: AccountInfo,
): ResolvedStream {
  if (ref.t === 'u') {
    const pair = secret.streamUser && secret.streamPass ? { u: secret.streamUser, p: secret.streamPass } : null;
    const url = fillUrl(ref.url, pair);
    return { url, container: containerOf(url) };
  }
  const allowed = account?.outputFormats;
  const hlsAllowed = !allowed || allowed.length === 0 || allowed.indexOf('m3u8') >= 0;
  const tsAllowed = !allowed || allowed.length === 0 || allowed.indexOf('ts') >= 0;
  let primary: 'hls' | 'ts' = format === 'hls' ? 'hls' : format === 'ts' ? 'ts' : preferHls && hlsAllowed ? 'hls' : 'ts';
  if (primary === 'hls' && !hlsAllowed && tsAllowed) primary = 'ts';
  if (primary === 'ts' && !tsAllowed && hlsAllowed) primary = 'hls';
  const build = (c: 'hls' | 'ts') =>
    `${secret.server}/live/${encodeURIComponent(secret.username!)}/${encodeURIComponent(secret.password!)}/${ref.id}.${c === 'hls' ? 'm3u8' : 'ts'}`;
  const other: 'hls' | 'ts' = primary === 'hls' ? 'ts' : 'hls';
  const otherAllowed = other === 'hls' ? hlsAllowed : tsAllowed;
  return {
    url: build(primary),
    container: primary,
    fallback: otherAllowed ? { url: build(other), container: other } : undefined,
  };
}

/**
 * URLs for movies, episodes, M3U VOD items and catch-up (spec §4.2, §5). Xtream catch-up prefers
 * HLS where the platform does, with TS as the fallback.
 */
export function resolveMedia(ref: MediaRef, secret: PlaylistSecret, preferHls: boolean, nowMs: number): ResolvedStream {
  const pair = secret.streamUser && secret.streamPass ? { u: secret.streamUser, p: secret.streamPass } : null;
  const creds = () => `${encodeURIComponent(secret.username!)}/${encodeURIComponent(secret.password!)}`;
  switch (ref.t) {
    case 'movie':
    case 'episode': {
      const url = `${secret.server}/${ref.t === 'movie' ? 'movie' : 'series'}/${creds()}/${ref.id}.${ref.ext || 'mp4'}`;
      return { url, container: containerOf(url) };
    }
    case 'url': {
      const url = fillUrl(ref.url, pair);
      return { url, container: containerOf(url) };
    }
    case 'catchup': {
      const endMs = ref.start + ref.durationMin * 60_000;
      if (ref.stream.t === 'x') {
        const streamId = ref.stream.id;
        const build = (ext: 'ts' | 'm3u8') =>
          xtreamTimeshiftUrl(secret.server!, secret.username!, secret.password!, streamId, ref.start, ref.durationMin, ext, ref.serverStart);
        const [first, second]: Array<'ts' | 'm3u8'> = preferHls ? ['m3u8', 'ts'] : ['ts', 'm3u8'];
        return {
          url: build(first),
          container: first === 'm3u8' ? 'hls' : 'ts',
          fallback: { url: build(second), container: second === 'm3u8' ? 'hls' : 'ts' },
        };
      }
      const live = fillUrl(ref.stream.url, pair);
      const url = m3uCatchupUrl(live, ref.catchup?.mode, ref.catchup?.source, ref.start, endMs, nowMs);
      if (!url) throw new AppError({ code: 'invalid-input', message: 'This channel has no catch-up' });
      return { url, container: containerOf(url) };
    }
  }
}
