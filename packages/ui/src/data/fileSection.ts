import { categoriesOfKeys, log, sectionNames, type ContentKind } from '@ultra/core';
import { createEffect, createSignal, on, onCleanup, type Accessor } from 'solid-js';
import { makeMatcher, normalizeText } from './categories';
import { withCategories, type Library } from './libraryCache';

type Row = { key: string; name: string; categoryIds: string[] };

/** Matches read in for a search across a whole section, at most. */
const SEARCH_RESULTS = 200;
const SEARCH_DELAY_MS = 300;
const normalized = new WeakMap<object, string[]>();

/**
 * A section kept in files (Samsung): reads in what the screen shows, the open category, the
 * favourites, recents or continue-watching items, and the matches of a search in "All", and
 * nothing else. Does nothing for a section in the database.
 */
export function useFileSection<R extends Row>(opts: {
  kind: ContentKind;
  playlistId: Accessor<string | null>;
  library: Accessor<Library<R> | undefined>;
  setLibrary: (next: Library<R>) => void;
  /** Real category ids being shown. */
  categories: Accessor<string[]>;
  /** Items shown by key, outside a category. */
  keys: Accessor<string[]>;
  /** A search across the whole section, or '' . */
  search: Accessor<string>;
}): void {
  const [found, setFound] = createSignal<string[]>([]);
  let seq = 0;

  createEffect(
    on([opts.library, opts.categories, opts.keys, found], ([lib, cats, keys, matches]) => {
      const pid = opts.playlistId();
      if (!lib || !lib.files || !pid) return;
      const mine = ++seq;
      void (async () => {
        const wanted = cats.concat(await categoriesOfKeys(pid, opts.kind, keys.concat(matches)));
        if (mine !== seq || !wanted.length) return;
        const next = await withCategories(lib, pid, opts.kind, wanted);
        const current = opts.library();
        if (next && current && current.version === next.version) opts.setLibrary(next);
      })().catch((e) => log.warn('library', 'could not read a category', { kind: opts.kind, error: e }));
    }),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on([opts.library, opts.search], ([lib, query]) => {
      if (timer) clearTimeout(timer);
      const pid = opts.playlistId();
      const match = makeMatcher(query);
      if (!lib || !lib.files || !pid || !match) {
        if (found().length) setFound([]);
        return;
      }
      timer = setTimeout(() => {
        void sectionNames(pid, opts.kind).then((entries) => {
          if (!entries) return;
          let names = normalized.get(entries);
          if (!names) {
            names = entries.map((e) => normalizeText(e[1]));
            normalized.set(entries, names);
          }
          const keys: string[] = [];
          for (let i = 0; i < entries.length && keys.length < SEARCH_RESULTS; i++) if (match(names[i])) keys.push(entries[i][0]);
          setFound(keys);
        });
      }, SEARCH_DELAY_MS);
    }),
  );
  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });
}
