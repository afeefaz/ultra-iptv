import { AUTO_COVERAGE, categoryNames, categoryPins, detectGroups, EMPTY_RULE, hiddenCategories, hiddenRule, log, normalizeText, type ContentKind, type GroupedCategories, type HiddenRule } from '@ultra/core';
import { createEffect, createRoot, createSignal, on, type Accessor } from 'solid-js';
import { catalog } from './catalog';
import { categoryGrouping } from './settings';
import { track } from './usage';
import { activePlaylist, versionOf } from './playlists';
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
    track(`pin.${kind}`);
    return pinned;
  };
  return { pins: store.pins, toggle };
}

// Hidden categories, shared like pins: Settings and the libraries stay in sync.
interface HiddenStore {
  hidden: Accessor<string[]>;
  rule: Accessor<HiddenRule>;
  set: (ids: string[], rule: HiddenRule) => void;
}

const hiddenStores: Partial<Record<ContentKind, HiddenStore>> = {};

function hiddenStore(kind: ContentKind): HiddenStore {
  let store = hiddenStores[kind];
  if (store) return store;
  store = createRoot(() => {
    const [hidden, setHiddenIds] = createSignal<string[]>([]);
    const [rule, setRule] = createSignal<HiddenRule>(EMPTY_RULE);
    createEffect(
      // Again after a refresh: a category the provider added to a hidden group joins the hidden ones.
      on([() => activePlaylist()?.id, () => versionOf(activePlaylist()?.id)], ([id]) => {
        if (!id) {
          setHiddenIds([]);
          setRule(EMPTY_RULE);
          return;
        }
        hiddenCategories(id, kind).then(setHiddenIds, (e) => log.warn('categories', 'could not load hidden', { error: e }));
        hiddenRule(id, kind).then(setRule, (e) => log.warn('categories', 'could not load hidden groups', { error: e }));
      }),
    );
    return {
      hidden,
      rule,
      set: (ids: string[], next: HiddenRule) => {
        setHiddenIds(ids);
        setRule(next);
      },
    };
  });
  hiddenStores[kind] = store;
  return store;
}

/** The groups to show, or none when grouping is off, or on Auto and the names don't clearly follow a pattern. */
export function groupsFor<T extends { name: string }>(items: T[]): GroupedCategories<T> | null {
  const mode = categoryGrouping();
  if (mode === 'off') return null;
  return detectGroups(items, mode === 'auto' ? AUTO_COVERAGE : undefined);
}

/** Categories hidden in Settings for the active playlist and one section. */
export function useHiddenCategories(kind: ContentKind): {
  hidden: Accessor<string[]>;
  rule: Accessor<HiddenRule>;
  setHidden: (ids: string[], rule: HiddenRule) => void;
  /** Hides one category. Showing it again is in the Hidden list. */
  hide: (categoryId: string) => void;
} {
  const store = hiddenStore(kind);
  const setHidden = (ids: string[], rule: HiddenRule) => {
    store.set(ids, rule);
    track(`hideCategories.${kind}`);
    const id = activePlaylist()?.id;
    if (id) void catalog().call('setHiddenCategories', id, kind, ids, rule);
  };
  const hide = (categoryId: string) => {
    if (store.hidden().indexOf(categoryId) >= 0) return;
    const rule = store.rule();
    setHidden(store.hidden().concat(categoryId), { ...rule, shown: rule.shown.filter((id) => id !== categoryId) });
  };
  return { hidden: store.hidden, rule: store.rule, setHidden, hide };
}

// Names given to categories, shared like pins: Settings and the libraries stay in step.
interface NamesStore {
  names: Accessor<Record<string, string>>;
  set: (names: Record<string, string>) => void;
}

const nameStores: Partial<Record<ContentKind, NamesStore>> = {};

function namesStore(kind: ContentKind): NamesStore {
  let store = nameStores[kind];
  if (store) return store;
  store = createRoot(() => {
    const [names, setNames] = createSignal<Record<string, string>>({});
    createEffect(
      on(
        () => activePlaylist()?.id,
        (id) => {
          if (!id) return setNames({});
          categoryNames(id, kind).then(setNames, (e) => log.warn('categories', 'could not load names', { error: e }));
        },
      ),
    );
    return { names, set: setNames };
  });
  nameStores[kind] = store;
  return store;
}

/** Names the user gave categories of the active playlist, by id, and a way to change one (null goes back to the provider's). */
export function useCategoryNames(kind: ContentKind): { names: Accessor<Record<string, string>>; rename: (categoryId: string, name: string | null) => Promise<void> } {
  const store = namesStore(kind);
  const rename = async (categoryId: string, name: string | null) => {
    const id = activePlaylist()?.id;
    if (!id) return;
    store.set(await catalog().call('renameCategory', id, kind, categoryId, name));
    track(`renameCategory.${kind}`);
  };
  return { names: store.names, rename };
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
