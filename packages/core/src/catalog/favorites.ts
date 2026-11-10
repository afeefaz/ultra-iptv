import { normalizeText } from './hash';
import type { FavoriteRow } from './model';

export interface MatchTarget {
  key: string;
  name: string;
  tvgId?: string;
}

export interface Rematch {
  moved: Array<{ from: FavoriteRow; to: FavoriteRow }>;
  lost: FavoriteRow[];
}

/**
 * After a refresh, favourites whose stable key disappeared (channel moved to another group,
 * duplicate order changed) are re-attached by EPG id + name, then by a unique name (spec §6).
 */
export function rematchFavorites(favorites: FavoriteRow[], items: MatchTarget[]): Rematch {
  if (!favorites.length) return { moved: [], lost: [] };
  const keys = new Set<string>();
  for (const item of items) keys.add(item.key);
  // Usually every favourite is still there: then no names need comparing (seconds for a big list on a TV).
  if (favorites.every((f) => keys.has(f.key))) return { moved: [], lost: [] };
  const byIdAndName = new Map<string, MatchTarget>();
  const byName = new Map<string, MatchTarget | null>();
  for (const item of items) {
    const name = normalizeText(item.name);
    if (item.tvgId) byIdAndName.set(item.tvgId.toLowerCase() + '|' + name, item);
    byName.set(name, byName.has(name) ? null : item); // null = ambiguous
  }
  const moved: Rematch['moved'] = [];
  const lost: FavoriteRow[] = [];
  const taken = new Set<string>();
  for (const fav of favorites) {
    if (keys.has(fav.key)) {
      taken.add(fav.key);
      continue;
    }
    const name = normalizeText(fav.name);
    const target = (fav.tvgId && byIdAndName.get(fav.tvgId.toLowerCase() + '|' + name)) || byName.get(name) || null;
    if (target && !taken.has(target.key)) {
      taken.add(target.key);
      moved.push({ from: fav, to: { ...fav, key: target.key, name: target.name, tvgId: target.tvgId } });
    } else {
      lost.push(fav);
    }
  }
  return { moved, lost };
}
