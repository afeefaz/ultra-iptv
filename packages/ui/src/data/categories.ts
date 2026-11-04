import { categoryPins, hiddenCategories, log, normalizeText, type ContentKind } from '@ultra/core';
import { createEffect, createRoot, createSignal, on, type Accessor } from 'solid-js';
import { catalog } from './catalog';
import { activePlaylist } from './playlists';
import {
  liveCatSort,
  seriesCatSort,
  setLiveCatSort,
  setSeriesCatSort,
  setVodCatSort,
  vodCatSort,
  type CategorySort,
} from './settings';

export const CATEGORY_SORTS: CategorySort[] = ['default', 'az', 'za', 'count'];

export function categorySort(kind: ContentKind): [Accessor<CategorySort>, (v: CategorySort) => void] {
  if (kind === 'vod') return [vodCatSort, setVodCatSort];
  if (kind === 'series') return [seriesCatSort, setSeriesCatSort];
  return [liveCatSort, setLiveCatSort];
}

// Pins are shared state per section: the category list and the pin button stay in sync.
const pinStores: Partial<Record<ContentKind, { pins: Accessor<string[]>; set: (v: string[] | ((p: string[]) => string[])) => void }>> = {};

function pinStore(kind: ContentKind) {
  let store = pinStores[kind];
  if (store) return store;
  store = createRoot(() => {
    const [pins, set] = createSignal<string[]>([]);
    createEffect(
      on(
        () => activePlaylist()?.id,
        (id) => {
          if (!id) return set([]);
          categoryPins(id, kind).then(set, (e) => log.warn('categories', 'could not load pins', { error: e }));
        },
      ),
    );
    return { pins, set };
  });
  pinStores[kind] = store;
  return store;
}

/** Pinned category ids of the active playlist for one section, plus a toggle. */
export function usePins(kind: ContentKind): { pins: Accessor<string[]>; toggle: (categoryId: string) => Promise<boolean> } {
  const store = pinStore(kind);
  const toggle = async (categoryId: string) => {
    const id = activePlaylist()?.id;
    if (!id) return false;
    const pinned = await catalog().call('togglePin', id, kind, categoryId);
    store.set((p) => (pinned ? p.concat(categoryId) : p.filter((c) => c !== categoryId)));
    log.debug('categories', pinned ? 'pinned' : 'unpinned', { kind });
    return pinned;
  };
  return { pins: store.pins, toggle };
}

// Hidden categories, shared like pins: Settings and the libraries stay in sync.
const hiddenStores: Partial<Record<ContentKind, { hidden: Accessor<string[]>; set: (v: string[]) => void }>> = {};

function hiddenStore(kind: ContentKind) {
  let store = hiddenStores[kind];
  if (store) return store;
  store = createRoot(() => {
    const [hidden, set] = createSignal<string[]>([]);
    createEffect(
      on(
        () => activePlaylist()?.id,
        (id) => {
          if (!id) return set([]);
          hiddenCategories(id, kind).then(set, (e) => log.warn('categories', 'could not load hidden', { error: e }));
        },
      ),
    );
    return { hidden, set: (v: string[]) => void set(v) };
  });
  hiddenStores[kind] = store;
  return store;
}

/** Categories hidden in Settings for the active playlist and one section. */
export function useHiddenCategories(kind: ContentKind): { hidden: Accessor<string[]>; setHidden: (ids: string[]) => void } {
  const store = hiddenStore(kind);
  const setHidden = (ids: string[]) => {
    store.set(ids);
    const id = activePlaylist()?.id;
    if (id) void catalog().call('setHiddenCategories', id, kind, ids);
  };
  return { hidden: store.hidden, setHidden };
}

/** Items left once hidden categories are gone: one still listed elsewhere stays. */
export function withoutHidden<T extends { categoryIds: string[] }>(rows: T[], hidden: string[]): T[] {
  if (!hidden.length) return rows;
  const set = new Set(hidden);
  return rows.filter((r) => !r.categoryIds.length || r.categoryIds.some((id) => !set.has(id)));
}

/** Pinned categories first (in pin order), then the rest in the chosen order. */
export function arrangeCategories<T extends { id: string; name: string; count: number }>(
  cats: T[],
  sort: CategorySort,
  pins: string[],
  locale: string,
): T[] {
  const pinned = pins.map((id) => cats.filter((c) => c.id === id)[0]).filter((c): c is T => !!c);
  const rest = cats.filter((c) => pins.indexOf(c.id) < 0);
  const collator = new Intl.Collator(locale);
  if (sort === 'az') rest.sort((a, b) => collator.compare(a.name, b.name));
  else if (sort === 'za') rest.sort((a, b) => collator.compare(b.name, a.name));
  else if (sort === 'count') rest.sort((a, b) => b.count - a.count);
  return pinned.concat(rest);
}

/** Every word of the query appears in the (normalized) name, like the old global search. */
export function makeMatcher(query: string): ((normalizedName: string) => boolean) | null {
  const words = normalizeText(query).split(' ').filter(Boolean);
  if (!words.length) return null;
  return (name) => words.every((w) => name.indexOf(w) >= 0);
}

export { normalizeText };
