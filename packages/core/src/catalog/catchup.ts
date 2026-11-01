// Catch-up URLs (spec §5): Xtream timeshift, and the M3U `catchup` modes used by IPTV players.

const pad = (n: number) => (n < 10 ? '0' : '') + n;

/** Xtream wants the programme start as YYYY-MM-DD:HH-MM in the server's time zone. */
export function xtreamStartParam(startMs: number, serverStart?: string): string {
  const m = serverStart ? /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(serverStart) : null;
  if (m) return `${m[1]}:${m[2]}-${m[3]}`;
  const d = new Date(startMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}:${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}`;
}

export function xtreamTimeshiftUrl(
  server: string,
  username: string,
  password: string,
  streamId: string,
  startMs: number,
  durationMin: number,
  ext: 'ts' | 'm3u8',
  serverStart?: string,
): string {
  const u = encodeURIComponent(username);
  const p = encodeURIComponent(password);
  return `${server}/timeshift/${u}/${p}/${Math.max(1, Math.round(durationMin))}/${xtreamStartParam(startMs, serverStart)}/${streamId}.${ext}`;
}

/** Fills catchup-source placeholders: {utc} {start} {utcend} {end} {lutc} {now} {duration[:div]} {offset} {Y}{m}{d}{H}{M}{S}, also as ${…}. */
export function fillCatchupTemplate(template: string, startMs: number, endMs: number, nowMs: number): string {
  const start = Math.floor(startMs / 1000);
  const end = Math.floor(endMs / 1000);
  const now = Math.floor(nowMs / 1000);
  const d = new Date(startMs);
  const values: Record<string, number | string> = {
    utc: start,
    start,
    timestamp: now,
    utcend: end,
    end,
    lutc: now,
    now,
    duration: end - start,
    offset: Math.max(0, now - start),
    Y: d.getUTCFullYear(),
    m: pad(d.getUTCMonth() + 1),
    d: pad(d.getUTCDate()),
    H: pad(d.getUTCHours()),
    M: pad(d.getUTCMinutes()),
    S: pad(d.getUTCSeconds()),
  };
  return template.replace(/\$?\{(\w+)(?::(\d+))?\}/g, (m, name: string, div?: string) => {
    if (!(name in values)) return m;
    const v = values[name];
    return div && typeof v === 'number' ? String(Math.floor(v / Number(div))) : String(v);
  });
}

/**
 * Builds an M3U catch-up URL from the live URL and the playlist's `catchup` attributes.
 * Returns null when the channel has no usable catch-up mode.
 */
export function m3uCatchupUrl(
  liveUrl: string,
  mode: string | undefined,
  source: string | undefined,
  startMs: number,
  endMs: number,
  nowMs: number,
): string | null {
  const m = (mode || (source ? (/^https?:\/\//i.test(source) ? 'default' : 'append') : '')).toLowerCase();
  const start = Math.floor(startMs / 1000);
  const duration = Math.floor((endMs - startMs) / 1000);
  switch (m) {
    case 'default':
      return source ? fillCatchupTemplate(source, startMs, endMs, nowMs) : null;
    case 'append':
      return source ? liveUrl + fillCatchupTemplate(source, startMs, endMs, nowMs) : null;
    case 'shift':
      return `${liveUrl}${liveUrl.indexOf('?') >= 0 ? '&' : '?'}utc=${start}&lutc=${Math.floor(nowMs / 1000)}`;
    case 'flussonic':
    case 'flussonic-hls':
    case 'flussonic-ts':
    case 'fs': {
      const q = liveUrl.indexOf('?');
      const base = q < 0 ? liveUrl : liveUrl.slice(0, q);
      const query = q < 0 ? '' : liveUrl.slice(q);
      const slash = base.lastIndexOf('/');
      const dir = base.slice(0, slash);
      const file = base.slice(slash + 1);
      if (/\.ts$/i.test(file) || m === 'flussonic-ts') return `${dir}/timeshift_abs-${start}.ts${query}`;
      if (/\.m3u8$/i.test(file)) return `${dir}/${file.replace(/\.m3u8$/i, '')}-${start}-${duration}.m3u8${query}`;
      return `${base}/archive-${start}-${duration}.m3u8${query}`;
    }
    case 'xc': {
      // …/live/<u>/<p>/<id>.ext (any path prefix) or <origin>/<u>/<p>/<id>
      const x =
        /^(.*?)\/live\/([^/]+)\/([^/]+)\/(\d+)(\.[a-z0-9]+)?(\?.*)?$/i.exec(liveUrl) ||
        /^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+)\/(\d+)(\.[a-z0-9]+)?(\?.*)?$/i.exec(liveUrl);
      if (!x) return null;
      const [, base, user, pass, id, ext] = x;
      return `${base}/timeshift/${user}/${pass}/${Math.max(1, Math.round(duration / 60))}/${xtreamStartParam(startMs)}/${id}${ext || '.ts'}`;
    }
    default:
      return null;
  }
}
