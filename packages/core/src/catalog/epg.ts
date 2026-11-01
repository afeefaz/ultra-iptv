import { toNumber, type XtreamEpgListing } from '../sources/xtream';
import type { EpgEntry } from './model';

/** Xtream sends titles/descriptions base64-encoded UTF-8; some panels send plain text. */
export function decodeEpgText(value: string | undefined): string {
  if (!value) return '';
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return value;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
}

/**
 * Normalises short-EPG listings to UTC milliseconds. `start_timestamp`/`stop_timestamp` are UTC
 * unix seconds; the "YYYY-MM-DD HH:MM:SS" strings are in the panel's own zone, so only used as a
 * fallback (read as UTC; the per-playlist offset corrects them).
 */
export function parseShortEpg(listings: XtreamEpgListing[]): EpgEntry[] {
  const entries: EpgEntry[] = [];
  for (const l of listings) {
    const start = toNumber(l.start_timestamp) ? toNumber(l.start_timestamp)! * 1000 : parseLocal(l.start);
    const stop = toNumber(l.stop_timestamp) ? toNumber(l.stop_timestamp)! * 1000 : parseLocal(l.end);
    if (!start || !stop || stop <= start) continue;
    const entry: EpgEntry = { start, stop, title: decodeEpgText(l.title) || '—', description: decodeEpgText(l.description) || undefined };
    if (l.start) entry.serverStart = l.start;
    if (l.has_archive !== undefined) entry.hasArchive = String(l.has_archive) === '1';
    entries.push(entry);
  }
  return entries.sort((a, b) => a.start - b.start);
}

function parseLocal(s: string | undefined): number {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s) : null;
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : 0;
}

export interface NowNext {
  now?: EpgEntry;
  next?: EpgEntry;
  /** 0..1 progress through `now`. */
  progress?: number;
}

/** Picks the current and next programme at `at`, after shifting by `offsetHours`. */
export function nowNext(items: EpgEntry[], at: number, offsetHours = 0): NowNext {
  const shift = offsetHours * 3600_000;
  for (let i = 0; i < items.length; i++) {
    const start = items[i].start + shift;
    const stop = items[i].stop + shift;
    if (at >= start && at < stop) {
      const now = { ...items[i], start, stop };
      const nextItem = items[i + 1];
      return {
        now,
        next: nextItem ? { ...nextItem, start: nextItem.start + shift, stop: nextItem.stop + shift } : undefined,
        progress: (at - start) / (stop - start),
      };
    }
    if (start > at) return { next: { ...items[i], start, stop } };
  }
  return {};
}
