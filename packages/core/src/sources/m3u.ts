export interface M3uEntry {
  name: string;
  url: string;
  attrs: Record<string, string>;
  duration?: number;
  /** From #EXTGRP when group-title is missing. */
  group?: string;
  userAgent?: string;
  referrer?: string;
}

/**
 * Streaming extended-M3U parser (spec §2): feed it chunks as they arrive; it never needs the
 * whole file in memory. Handles BOM, CRLF, quoted attributes containing commas, #EXTGRP and
 * #EXTVLCOPT (user agent / referrer). #KODIPROP and unknown tags are ignored.
 */
export class M3uParser {
  header: Record<string, string> = {};
  sawHeader = false;
  private buffer = '';
  private first = true;
  private pending: Omit<M3uEntry, 'url'> | null = null;
  private group: string | undefined;
  private userAgent: string | undefined;
  private referrer: string | undefined;

  constructor(private readonly onEntry: (entry: M3uEntry) => void) {}

  push(chunk: string): void {
    const text = this.buffer + chunk;
    let start = 0;
    for (;;) {
      const nl = text.indexOf('\n', start);
      if (nl < 0) break;
      this.line(text.slice(start, nl));
      start = nl + 1;
    }
    this.buffer = text.slice(start);
  }

  end(): void {
    if (this.buffer) this.line(this.buffer);
    this.buffer = '';
  }

  private line(raw: string): void {
    let line = raw.replace(/\r$/, '');
    if (this.first) {
      line = line.replace(/^\uFEFF/, '');
      this.first = false;
    }
    line = line.trim();
    if (!line) return;
    if (line.charAt(0) !== '#') {
      this.emit(line);
      return;
    }
    const upper = line.slice(0, 12).toUpperCase();
    if (upper.indexOf('#EXTM3U') === 0) {
      this.sawHeader = true;
      this.header = parseAttributes(line.slice(7)).attrs;
    } else if (upper.indexOf('#EXTINF:') === 0) {
      const { duration, attrs, title } = parseExtinf(line.slice(8));
      this.pending = { name: title || attrs['tvg-name'] || '', attrs, duration };
    } else if (upper.indexOf('#EXTGRP:') === 0) {
      this.group = line.slice(8).trim();
    } else if (upper.indexOf('#EXTVLCOPT:') === 0) {
      const opt = line.slice(11);
      const eq = opt.indexOf('=');
      const key = opt.slice(0, eq).trim().toLowerCase();
      const value = opt.slice(eq + 1).trim();
      if (key === 'http-user-agent') this.userAgent = value;
      else if (key === 'http-referrer' || key === 'http-referer') this.referrer = value;
    }
  }

  private emit(url: string): void {
    const base = this.pending ?? { name: '', attrs: {} };
    const entry: M3uEntry = { ...base, url, name: base.name || nameFromUrl(url) };
    if (this.group) entry.group = this.group;
    if (this.userAgent) entry.userAgent = this.userAgent;
    if (this.referrer) entry.referrer = this.referrer;
    this.pending = null;
    this.group = undefined;
    this.userAgent = undefined;
    this.referrer = undefined;
    this.onEntry(entry);
  }
}

export function parseExtinf(rest: string): { duration?: number; attrs: Record<string, string>; title: string } {
  const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(rest);
  const duration = m ? Number(m[1]) : undefined;
  const { attrs, end } = parseAttributes(m ? rest.slice(m[0].length) : rest, true);
  return { duration, attrs, title: end };
}

/**
 * Parses `key="value" key2='v' key3=v` pairs. With `untilComma`, stops at the first comma outside
 * quotes and returns the remainder (the EXTINF title) in `end`.
 */
function parseAttributes(text: string, untilComma = false): { attrs: Record<string, string>; end: string } {
  const attrs: Record<string, string> = {};
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charAt(i);
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === ',' && untilComma) return { attrs, end: text.slice(i + 1).trim() };
    const keyMatch = /^[A-Za-z0-9_:.-]+/.exec(text.slice(i));
    if (!keyMatch) {
      i++;
      continue;
    }
    const key = keyMatch[0].toLowerCase();
    i += keyMatch[0].length;
    if (text.charAt(i) !== '=') continue;
    i++;
    const q = text.charAt(i);
    let value: string;
    if (q === '"' || q === "'") {
      const close = text.indexOf(q, i + 1);
      value = close < 0 ? text.slice(i + 1) : text.slice(i + 1, close);
      i = close < 0 ? n : close + 1;
    } else {
      const m = /^[^\s,]*/.exec(text.slice(i));
      value = m ? m[0] : '';
      i += value.length;
    }
    attrs[key] = value.trim();
  }
  return { attrs, end: '' };
}

function nameFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0];
  const last = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(last) || url;
  } catch {
    return last || url;
  }
}
