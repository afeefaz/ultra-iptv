import { getText } from '../net/http';
import { versionKey } from './details';

/**
 * Finding a trailer on YouTube when the provider didn't send one: its search page, read like a
 * browser would, first video. Only when someone presses Trailer; what's sent is the title, the
 * year and whether it's a series. YouTube's search API would need a key with a tiny free quota.
 */

/** "TOP: The Pit (2026) 4K" as a series → "the pit 2026 series trailer". */
export function trailerQuery(name: string, year: number | undefined, kind: 'vod' | 'series'): string {
  const inName = /\b(19\d{2}|20\d{2})\b/.exec(name);
  const title = versionKey(name)
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const when = year || (inName ? Number(inName[1]) : undefined);
  return [title, when, kind === 'series' ? 'series' : '', 'trailer'].filter(Boolean).join(' ');
}

/** The first video in a YouTube results page (its embedded data), or null. */
export function firstVideoId(html: string): string | null {
  const m = /"videoRenderer":\{"videoId":"([\w-]{11})"/.exec(html) ?? /"videoId":"([\w-]{11})"/.exec(html);
  return m ? m[1] : null;
}

const found = new Map<string, string | null>();

export async function findTrailer(name: string, year: number | undefined, kind: 'vod' | 'series'): Promise<string | null> {
  const query = trailerQuery(name, year, kind);
  if (!query.replace(/\b(trailer|series)\b/g, '').trim()) return null;
  if (found.has(query)) return found.get(query) ?? null;
  // sp=EgIQAQ%3D%3D: videos only (no channels or playlists first). The cookie skips the consent page
  // shown in some countries; only native HTTP can send it, a page's fetch leaves it out.
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  const html = await getText(url, { timeoutMs: 12_000, headers: { 'Accept-Language': 'en', Cookie: 'SOCS=CAI' } });
  const id = firstVideoId(html);
  found.set(query, id);
  return id;
}
