import { normalizeText } from './hash';
import type { ContentKind } from './model';

export interface SearchDoc {
  kind: ContentKind;
  id: string;
  key: string;
  name: string;
  num?: number;
  logo?: string;
  categoryId?: string;
}

export interface SearchResults {
  query: string;
  total: Record<ContentKind, number>;
  hits: Record<ContentKind, SearchDoc[]>;
}

/** In-memory search over one playlist's names; every query word must match (spec §5). */
export class SearchIndex {
  private readonly norms: string[];

  constructor(private readonly docs: SearchDoc[]) {
    this.norms = docs.map((d) => normalizeText(d.name));
  }

  get size(): number {
    return this.docs.length;
  }

  search(query: string, limitPerKind = 100): SearchResults {
    const words = normalizeText(query).split(' ').filter(Boolean);
    const results: SearchResults = {
      query,
      total: { live: 0, vod: 0, series: 0 },
      hits: { live: [], vod: [], series: [] },
    };
    if (words.length === 0) return results;
    const ranked: Record<ContentKind, Array<{ doc: SearchDoc; score: number }>> = { live: [], vod: [], series: [] };
    for (let i = 0; i < this.docs.length; i++) {
      const norm = this.norms[i];
      let ok = true;
      for (const w of words) {
        if (norm.indexOf(w) < 0) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const doc = this.docs[i];
      // Exact > starts with > contains; shorter names first.
      const score = (norm === words.join(' ') ? 0 : norm.indexOf(words[0]) === 0 ? 1 : 2) * 1e4 + norm.length;
      ranked[doc.kind].push({ doc, score });
    }
    for (const kind of ['live', 'vod', 'series'] as const) {
      results.total[kind] = ranked[kind].length;
      results.hits[kind] = ranked[kind]
        .sort((a, b) => a.score - b.score)
        .slice(0, limitPerKind)
        .map((r) => r.doc);
    }
    return results;
  }
}
