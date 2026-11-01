import {
  favoriteKeys,
  listCategories,
  listItems,
  log,
  UNCATEGORIZED,
  type CategoryRow,
  type ProgressRow,
  type SeriesRow,
  type VodRow,
} from '@ultra/core';
import { createEffect, createMemo, createSignal, on, onCleanup, Show, type JSX } from 'solid-js';
import { CategoryRail } from '../components/CategoryRail';
import { FocusButton } from '../components/FocusButton';
import { TextField } from '../components/TextField';
import { makeMatcher, normalizeText } from '../data/categories';
import { PickerDialog } from '../components/PickerDialog';
import { PosterTile } from '../components/PosterTile';
import { VirtualGrid, type VirtualGridApi } from '../components/VirtualGrid';
import { catalog } from '../data/catalog';
import { ensureUnlocked, isCategoryLocked, lockedCategories, unlocked } from '../data/parental';
import { progressRatio, useProgress } from '../data/media';
import { activePlaylist, refreshing, versionOf } from '../data/playlists';
import { setVodSort, vodSort, type SortBy } from '../data/settings';
import { FocusZone } from '../focus';
import { statusText } from '../format';
import { formatNumber, locale, t } from '../i18n';
import { useKeys } from '../keys';
import { navigate } from '../nav';

type Kind = 'vod' | 'series';
type Row = VodRow | SeriesRow;
interface RailItem {
  id: string;
  name: string;
  count: number;
  locked: boolean;
}

const VIRTUAL = ['continue', 'fav', 'all'];
const COLUMNS = 6;
const CATEGORY_FOCUS_DELAY_MS = 250;
const SORTS: SortBy[] = ['added', 'name', 'rating', 'year'];
const lastCategory = new Map<string, string>();
// Grid position per playlist+kind, so Back from a detail page lands on the same poster.
const lastGridIndex = new Map<string, number | null>();

/** Movies and Series (spec §5): category rail | poster grid, sortable, with "Continue watching". */
export function VodScreen(props: { kind: Kind }): JSX.Element {
  const playlistId = () => activePlaylist()?.id ?? null;
  const [cats, setCats] = createSignal<CategoryRow[]>([]);
  const [all, setAll] = createSignal<Row[]>([]);
  const [favKeys, setFavKeys] = createSignal<string[]>([]);
  const [category, setCategory] = createSignal('all');
  const [loading, setLoading] = createSignal(true);
  const [sortOpen, setSortOpen] = createSignal(false);
  const [focused, setFocused] = createSignal<Row | null>(null);
  const [query, setQuery] = createSignal('');
  const progress = useProgress();
  let grid: VirtualGridApi | undefined;
  let seq = 0;

  const memoryKey = () => `${playlistId()}|${props.kind}`;
  const favSet = createMemo(() => new Set(favKeys()));
  const byKey = createMemo(() => new Map(all().map((r) => [r.key, r] as [string, Row])));

  /** Movies by their own progress; series by the most recent episode watched. */
  const continueRows = createMemo<Row[]>(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    const rows: ProgressRow[] = [];
    progress().forEach((p) => rows.push(p));
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    for (const p of rows) {
      const key = props.kind === 'vod' ? (p.kind === 'vod' && !p.watched ? p.key : null) : p.kind === 'episode' ? p.seriesKey : null;
      const row = key ? byKey().get(key) : undefined;
      if (row && !seen.has(row.key)) {
        seen.add(row.key);
        out.push(row);
      }
    }
    return out;
  });

  const hidden = () => !VIRTUAL.includes(category()) && isCategoryLocked(category()) && !unlocked();

  const inCategory = createMemo<Row[]>(() => {
    const id = category();
    if (id === 'continue') return continueRows();
    if (id === 'fav') return favKeys().map((k) => byKey().get(k)).filter((r): r is Row => !!r);
    if (hidden()) return [];
    const list = id === 'all' ? all().slice() : all().filter((r) => r.categoryIds.indexOf(id) >= 0);
    return sortRows(list, vodSort(), locale());
  });

  const normNames = createMemo(() => new Map(all().map((r) => [r.key, normalizeText(r.name)] as [string, string])));
  const items = createMemo<Row[]>(() => {
    const match = makeMatcher(query());
    const list = inCategory();
    if (!match) return list;
    const names = normNames();
    return list.filter((r) => match(names.get(r.key) ?? ''));
  });

  const railItems = createMemo<RailItem[]>(() => {
    const locked = lockedCategories();
    return [
      { id: 'continue', name: t('vod.continue'), count: continueRows().length, locked: false },
      { id: 'fav', name: t('live.favorites'), count: favKeys().length, locked: false },
      { id: 'all', name: props.kind === 'vod' ? t('vod.allMovies') : t('vod.allSeries'), count: all().length, locked: false },
      ...cats().map((c) => ({
        id: c.id,
        name: c.id === UNCATEGORIZED ? t('live.uncategorized') : c.name,
        count: c.count,
        locked: locked.has(c.id),
      })),
    ];
  });

  createEffect(
    on([playlistId, () => versionOf(playlistId())], async ([id]) => {
      const mine = ++seq;
      if (!id) return setLoading(false);
      setLoading(true);
      try {
        const [c, rows, favs] = await Promise.all([listCategories(id, props.kind), listItems(id, props.kind, null), favoriteKeys(id, props.kind)]);
        if (mine !== seq) return;
        setCats(c);
        setAll(rows as Row[]);
        setFavKeys(favs);
        setCategory(lastCategory.get(memoryKey()) ?? 'all');
        const index = lastGridIndex.get(memoryKey());
        if (index != null) setTimeout(() => grid?.focusIndex(index), 0);
      } catch (e) {
        log.error('vod', 'could not load', { kind: props.kind, error: e });
      } finally {
        if (mine === seq) setLoading(false);
      }
    }),
  );

  let categoryTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(categoryTimer));
  const chooseCategory = (id: string) => {
    clearTimeout(categoryTimer);
    if (id === category()) return;
    setCategory(id);
    setQuery('');
    lastCategory.set(memoryKey(), id);
    lastGridIndex.set(memoryKey(), null);
    grid?.scrollToIndex(0);
  };

  const open = (row: Row) => {
    if (props.kind === 'vod') navigate({ name: 'vod-detail', id: row.id });
    else navigate({ name: 'series-detail', id: row.id });
  };

  const toggleFavorite = async (row: Row | null) => {
    const pid = playlistId();
    if (!row || !pid) return;
    const added = await catalog().call('toggleFavorite', { playlistId: pid, kind: props.kind, key: row.key, name: row.name });
    setFavKeys((keys) => (added ? keys.concat(row.key) : keys.filter((k) => k !== row.key)));
  };

  useKeys((press) => {
    if (press.key === 'yellow') {
      void toggleFavorite(focused());
      return true;
    }
    return false;
  });

  const progressOf = (row: Row) => (props.kind === 'vod' ? progressRatio(progress().get(`vod|${row.key}`)) : 0);
  const subOf = (row: Row) => [row.year, row.rating ? `★ ${row.rating}` : ''].filter(Boolean).join(' · ');
  const isRefreshing = () => !!(playlistId() && refreshing()[playlistId()!]);

  return (
    <div class="screen vod">
      <Show
        when={activePlaylist()}
        fallback={
          <div class="empty-state">
            <p>{t('vod.noPlaylist')}</p>
            <FocusZone id="vod-empty">
              <FocusButton id="vod-add" class="btn-primary" autofocus onSelect={() => navigate({ name: 'playlist-form' })}>
                {t('home.addPlaylist')}
              </FocusButton>
            </FocusZone>
          </div>
        }
      >
        {(p) => (
          <>
            <div class="live-header">
              <span class="live-title">
                <bdi>{p().name}</bdi> · <bdi>{railItems().filter((c) => c.id === category())[0]?.name ?? ''}</bdi> ({formatNumber(items().length)})
              </span>
              <span class="hint">{statusText(p(), isRefreshing())}</span>
            </div>
            <div class="panes">
              <FocusZone id="vod-categories" remember>
                <CategoryRail
                  kind={props.kind}
                  id="vcat"
                  label={t(props.kind === 'vod' ? 'tab.movies' : 'tab.series')}
                  fixed={railItems().slice(0, VIRTUAL.length)}
                  categories={railItems().slice(VIRTUAL.length)}
                  selected={category()}
                  onFocusRow={(c) => {
                    lastGridIndex.set(memoryKey(), null);
                    clearTimeout(categoryTimer);
                    if (!c.locked || unlocked()) categoryTimer = setTimeout(() => chooseCategory(c.id), CATEGORY_FOCUS_DELAY_MS);
                  }}
                  onOpen={async (c) => {
                    if (c.locked && !(await ensureUnlocked())) return;
                    chooseCategory(c.id);
                    setTimeout(() => grid?.focusIndex(0), 0);
                  }}
                />
              </FocusZone>
              <FocusZone id="vod-grid" remember>
                <div class="pane pane-grid">
                  <div class="pane-tools">
                    <TextField
                      id="vgrid-search"
                      compact
                      label={t('search.inCategory', { name: railItems().filter((c) => c.id === category())[0]?.name ?? '' })}
                      value={query()}
                      onChange={setQuery}
                    />
                    <FocusButton id="vod-sort" class="chip-button sort-chip" onSelect={() => setSortOpen(true)}>
                      {t('vod.sort', { by: t(`sort.${vodSort()}`) })}
                    </FocusButton>
                  </div>
                  <VirtualGrid
                    id="vgrid"
                    label={t(props.kind === 'vod' ? 'tab.movies' : 'tab.series')}
                    items={items()}
                    columns={COLUMNS}
                    rowHeight={20}
                    ref={(api) => (grid = api)}
                    onFocusItem={(row, index) => {
                      setFocused(row);
                      lastGridIndex.set(memoryKey(), index);
                    }}
                    onSelect={open}
                    empty={
                      <p class="hint pane-empty">
                        {loading() || isRefreshing()
                          ? t('vod.loading')
                          : hidden()
                            ? t('live.lockedCategory')
                            : category() === 'fav'
                              ? t('vod.emptyFav')
                              : category() === 'continue'
                                ? t('vod.emptyContinue')
                                : t('vod.empty')}
                      </p>
                    }
                    renderItem={(row) => (
                      <PosterTile title={row.name} poster={row.logo} sub={subOf(row)} progress={progressOf(row)} favorite={favSet().has(row.key)} />
                    )}
                  />
                </div>
              </FocusZone>
            </div>
          </>
        )}
      </Show>
      <Show when={sortOpen()}>
        <PickerDialog
          id="vod-sort-picker"
          title={t('vod.sortTitle')}
          options={SORTS.map((s) => ({ id: s, label: t(`sort.${s}`) }))}
          selected={vodSort()}
          onCancel={() => setSortOpen(false)}
          onPick={(id) => {
            setSortOpen(false);
            setVodSort(id as SortBy);
            grid?.scrollToIndex(0);
          }}
        />
      </Show>
    </div>
  );
}

function sortRows(rows: Row[], by: SortBy, loc: string): Row[] {
  const collator = new Intl.Collator(loc); // much faster than localeCompare over 20k titles
  const name = (a: Row, b: Row) => collator.compare(a.name, b.name);
  switch (by) {
    case 'name':
      return rows.sort(name);
    case 'rating':
      return rows.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || name(a, b));
    case 'year':
      return rows.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || name(a, b));
    default:
      return rows.sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
  }
}
