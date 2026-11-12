// Dev-only fake live streams built from apps/web/dev/media (scripts/make-test-media.mjs).
//   /live/<u>/<p>/<id>.m3u8   master playlist: video + English/Arabic audio + English/Arabic subtitles
//   /live/<u>/<p>/<id>.ts     one continuous MPEG-TS stream, paced at real time (mpegts.js path)
//   /hls/<look>/<rendition>.m3u8 and /hls/<look>/<rendition>/segNNN.ts|vtt   live window over a 5 min loop
//   /movie|series/<u>/<p>/<id>.mp4|mkv   seekable MP4 (HTTP Range) for movies and episodes
//   /timeshift/<u>/<p>/<min>/<start>/<id>.m3u8|ts   catch-up: finished HLS stream, or the TS file
//   /outage?seconds=N         every stream fails for N seconds (tests auto-reconnect)
import { closeSync, createReadStream, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { MOCK_ACCOUNTS } from '../../../packages/core/src/testing/mock-provider.ts';

const MEDIA = fileURLToPath(new URL('./media/', import.meta.url));
const LOOKS = ['a', 'b', 'c'];
const WINDOW = 6;
const EPOCH = Date.now();

interface MediaInfo {
  seconds: number;
  segment: number;
  segments: number;
}

let info: MediaInfo | null = null;
let outageUntil = 0;
const openStreams = new Set<ServerResponse>();

function mediaInfo(): MediaInfo | null {
  if (!info && existsSync(MEDIA + 'info.json')) info = JSON.parse(readFileSync(MEDIA + 'info.json', 'utf8')) as MediaInfo;
  return info;
}

const pad3 = (n: number) => (n < 10 ? '00' : n < 100 ? '0' : '') + n;

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function master(look: string, sub = '', query = ''): string {
  const base = `/__fixtures/hls/${look}/${sub}`.replace(/\/$/, '');
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",LANGUAGE="en",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="${base}/audio_eng.m3u8${query}"`,
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",LANGUAGE="ar",NAME="العربية",DEFAULT=NO,AUTOSELECT=YES,URI="${base}/audio_ara.m3u8${query}"`,
    `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English",DEFAULT=NO,AUTOSELECT=YES,URI="${base}/subs_eng.m3u8${query}"`,
    `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="ar",NAME="العربية",DEFAULT=NO,AUTOSELECT=YES,URI="${base}/subs_ara.m3u8${query}"`,
    '#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"',
    `${base}/video.m3u8${query}`,
    '',
  ].join('\n');
}

/** A sliding live window over the looped segments, with a discontinuity at every loop. */
function mediaPlaylist(rendition: string, m: MediaInfo): string {
  const seqNow = Math.floor((Date.now() - EPOCH) / (m.segment * 1000)) + WINDOW;
  const first = seqNow - WINDOW + 1;
  const ext = rendition.indexOf('subs_') === 0 ? 'vtt' : 'ts';
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${m.segment}`,
    `#EXT-X-MEDIA-SEQUENCE:${first}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${Math.floor(first / m.segments)}`,
  ];
  for (let s = first; s <= seqNow; s++) {
    const idx = s % m.segments;
    if (idx === 0 && s !== first) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXTINF:${m.segment.toFixed(3)},`, `${rendition}/seg${pad3(idx)}.${ext}`);
  }
  return lines.join('\n') + '\n';
}

function authorised(user: string, pass: string): boolean {
  const acc = MOCK_ACCOUNTS[decodeURIComponent(user)];
  return !!acc && acc.password === decodeURIComponent(pass);
}

/** A finished (VOD) playlist of `count` segments looping over the media, for catch-up. */
function vodMediaPlaylist(rendition: string, m: MediaInfo, count: number): string {
  const ext = rendition.indexOf('subs_') === 0 ? 'vtt' : 'ts';
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${m.segment}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD'];
  for (let s = 0; s < count; s++) {
    const idx = s % m.segments;
    if (idx === 0 && s !== 0) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXTINF:${m.segment.toFixed(3)},`, `${rendition}/seg${pad3(idx)}.${ext}`);
  }
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n') + '\n';
}

/** Static file with HTTP Range support, so the browser can seek in progressive MP4. */
function serveFile(req: IncomingMessage, res: ServerResponse, file: string, type: string): void {
  if (!existsSync(file)) return send(res, 404, 'text/plain', 'missing media; run node scripts/make-test-media.mjs');
  const size = statSync(file).size;
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (!range) {
    res.statusCode = 200;
    res.setHeader('Content-Length', String(size));
    createReadStream(file).pipe(res);
    return;
  }
  let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  let end = range[1] && range[2] ? Number(range[2]) : size - 1;
  if (start >= size) {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${size}`);
    return void res.end();
  }
  end = Math.min(end, size - 1);
  start = Math.min(start, end);
  res.statusCode = 206;
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length', String(end - start + 1));
  createReadStream(file, { start, end }).pipe(res);
}

/** Streams the look's muxed.ts at roughly real-time speed (3 s head start), looping forever. */
function pacedTs(look: string, res: ServerResponse, m: MediaInfo): void {
  const file = `${MEDIA}${look}/muxed.ts`;
  const size = statSync(file).size;
  const perSecond = Math.ceil(size / m.seconds);
  const fd = openSync(file, 'r');
  let pos = 0;
  const write = (bytes: number) => {
    const buf = Buffer.alloc(bytes - (bytes % 188)); // whole TS packets
    let filled = 0;
    while (filled < buf.length) {
      const n = readSync(fd, buf, filled, buf.length - filled, pos);
      if (n === 0) {
        pos = 0; // loop
        continue;
      }
      filled += n;
      pos += n;
    }
    res.write(buf);
  };
  res.statusCode = 200;
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'no-store');
  openStreams.add(res);
  write(perSecond * 3);
  const timer = setInterval(() => write(Math.ceil(perSecond / 4)), 250);
  res.on('close', () => {
    clearInterval(timer);
    closeSync(fd);
    openStreams.delete(res);
  });
}

/** Returns true when the request was handled. */
export function handleMedia(rawPath: string, query: URLSearchParams, req: IncomingMessage, res: ServerResponse): boolean {
  // Xtream stream URLs hang off the server address: /__fixtures/xtream/live/<u>/<p>/<id>.m3u8
  const path = /^\/xtream\/(live|movie|series|timeshift)\//.test(rawPath) ? rawPath.slice('/xtream'.length) : rawPath;
  if (path === '/outage') {
    const seconds = Number(query.get('seconds') ?? '20');
    outageUntil = Date.now() + seconds * 1000;
    openStreams.forEach((s) => s.destroy());
    send(res, 200, 'application/json', JSON.stringify({ outageSeconds: seconds }));
    return true;
  }
  const isMedia = /^\/(live|hls|movie|series|timeshift)\//.test(path);
  if (!isMedia) return false;
  // Vite's dev server allows any localhost origin; real stream servers usually allow none.
  // Cross-origin pages (app on localhost, server on 127.0.0.1) then see what browsers see.
  res.removeHeader('Access-Control-Allow-Origin');
  res.removeHeader('Vary');
  if (Date.now() < outageUntil) {
    res.socket?.destroy(); // looks like a dropped connection, not an HTTP error
    return true;
  }
  const m = mediaInfo();
  if (!m) {
    send(res, 503, 'text/plain', 'No test media. Run: node scripts/make-test-media.mjs');
    return true;
  }

  const live = /^\/live\/([^/]+)\/([^/]+)\/(\d+)\.(m3u8|ts)$/.exec(path);
  if (live) {
    const [, user, pass, id, ext] = live;
    if (!authorised(user, pass)) {
      send(res, 403, 'text/plain', 'forbidden');
      return true;
    }
    const look = LOOKS[Number(id) % LOOKS.length];
    if (ext === 'm3u8') send(res, 200, 'application/vnd.apple.mpegurl', master(look));
    else pacedTs(look, res, m);
    return true;
  }

  const vod = /^\/(movie|series)\/([^/]+)\/([^/]+)\/(\d+)\.(mp4|mkv)$/.exec(path);
  if (vod) {
    if (!authorised(vod[2], vod[3])) return send(res, 403, 'text/plain', 'forbidden'), true;
    // A real MKV (HEVC, AC-3/E-AC-3/DTS, SRT/ASS) when made (make-test-media.mjs --mkv), for players that can.
    const mkv = `${MEDIA}desktop/movie.mkv`;
    if (vod[5] === 'mkv' && existsSync(mkv)) serveFile(req, res, mkv, 'video/x-matroska');
    else serveFile(req, res, `${MEDIA}${LOOKS[Number(vod[4]) % LOOKS.length]}/movie.mp4`, 'video/mp4');
    return true;
  }

  const shift = /^\/timeshift\/([^/]+)\/([^/]+)\/(\d+)\/([0-9-]+:[0-9-]+)\/(\d+)\.(m3u8|ts)$/.exec(path);
  if (shift) {
    const [, user, pass, minutes, , id, ext] = shift;
    if (!authorised(user, pass)) return send(res, 403, 'text/plain', 'forbidden'), true;
    const look = LOOKS[Number(id) % LOOKS.length];
    if (ext === 'ts') serveFile(req, res, `${MEDIA}${look}/muxed.ts`, 'video/mp2t');
    else send(res, 200, 'application/vnd.apple.mpegurl', master(look, `vod/`, `?segs=${Math.max(1, Math.round((Number(minutes) * 60) / m.segment))}`));
    return true;
  }

  const vodPlaylist = /^\/hls\/([abc])\/vod\/(video|audio_eng|audio_ara|subs_eng|subs_ara)\.m3u8$/.exec(path);
  if (vodPlaylist) {
    send(res, 200, 'application/vnd.apple.mpegurl', vodMediaPlaylist(vodPlaylist[2], m, Number(query.get('segs') ?? '30')));
    return true;
  }

  const playlist = /^\/hls\/([abc])\/(video|audio_eng|audio_ara|subs_eng|subs_ara)\.m3u8$/.exec(path);
  if (playlist) {
    send(res, 200, 'application/vnd.apple.mpegurl', mediaPlaylist(playlist[2], m));
    return true;
  }

  const segment = /^\/hls\/([abc])\/(?:vod\/)?(video|audio_eng|audio_ara|subs_eng|subs_ara)\/seg(\d{3})\.(ts|vtt)$/.exec(path);
  if (segment) {
    const [, look, rendition, n, ext] = segment;
    const file =
      ext === 'vtt' ? `${MEDIA}subs/${rendition.slice(5)}/seg${n}.vtt` : `${MEDIA}${look}/${rendition}/seg${n}.ts`;
    if (!existsSync(file)) send(res, 404, 'text/plain', 'no segment');
    else send(res, 200, ext === 'vtt' ? 'text/vtt' : 'video/mp2t', readFileSync(file));
    return true;
  }
  send(res, 404, 'text/plain', 'not found');
  return true;
}
