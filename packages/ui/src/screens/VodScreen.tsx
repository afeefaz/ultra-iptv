import {
  favoriteKeys,
  log,
  perf,
  UNCATEGORIZED,
  type CategoryRow,
  type ProgressRow,
  type SeriesRow,
  type VodRow,
} from '@ultra/core';
import { createEffect, createMemo, createSignal, on, Show, type JSX } from 'solid-js';
import { LargeBrowse, LargeLegend, LargeTools, type LargeBrowseApi, type LegendKey } from '../components/LargeBrowse';
import { CategoryRail } from '../components/CategoryRail';
import { FocusButton } from '../components/FocusButton';
import { RemoteQrPanel } from '../components/RemoteQrPanel';
import { PinButton } from '../components/PinButton';
import { Icon, type IconName } from '../components/Icon';
import { TextField } from '../components/TextField';
import { showToast } from '../data/toast';
import { track } from '../data/usage';
import { arrangeCategories, CATEGORY_SORTS, categorySort, makeMatcher, normalizeText, useHiddenCategories, usePins, withoutHidden } from '../data/categories';
import { cachedLibrary, loadLibrary, type Library } from '../data/libraryCache';
import { enterLibrary, rememberedSearch, rememberSearch } from '../data/libraryMemory';
import { PickerDialog } from '../components/PickerDialog';
import { PosterTile } from '../components/PosterTile';
import { VirtualGrid, type VirtualGridApi } from '../components/VirtualGrid';
import { catalog } from '../data/catalog';
import { ensureUnlocked, isCategoryLocked, lockedCategories, unlocked } from '../data/parental';
import { progressRatio, useProgress } from '../data/media';
import { activePlaylist, refreshing, versionOf } from '../data/playlists';
import { detailMode, keepTitleOpen, moviesLayout, seriesLayout, setVodSort, textScale, vodSort, type SortBy } from '../data/settings';
import { focusManager, FocusZone } from '../focus';
import { formatLeft, statusText } from '../format';
import { formatNumber, locale, t } from '../i18n';
import { useKeys } from '../keys';
import { justWentBack, navigate } from '../nav';
import { SeriesDetailScreen } from './SeriesDetailScreen';
import { VodDetailScreen } from './VodDetailScreen';

type Kind = 'vod' | 'series';
type Row = VodRow | SeriesRow;
interface RailItem {
  id: string;
  name: string;
  count: number;
  locked: boolean;
  icon?: IconName;
}

const VIRTUAL = ['continue', 'fav', 'all', 'hidden'];
const NO_ROWS: Row[] = [];
const NO_CATEGORIES: CategoryRow[] = [];
const NO_KEYS = new Map<string, Row>();
const COLUMNS = 6;
const MIN_COLUMNS = 3;
const MAX_COLUMNS = 8;
const SORTS: SortBy[] = ['added', 'name', 'rating', 'year'];
const lastCategory = new Map<string, string>();
// Grid position per playlist+kind, so Back from a detail page lands on the same poster.
const lastGridIndex = new Map<string, number | null>();
// The Boxes layout was on the posters when a title was opened, so Back returns there.
const lastLargeStep = new Map<string, 'categories' | 'items'>();
// Title open next to the categories, so it's still open after playing it and coming back.
const lastOpenId = new Map<string, string | null>();

/** Movies and Series (spec §5): category rail | poster grid, sortable, with "Continue watching". */
export function VodScreen(props: { kind: Kind }): JSX.Element {
  enterLibrary(props.kind);
  const playlistId = () => activePlaylist()?.id ?? null;
  // Already in memory on the way back from the player or a page, so the first paint has everything.
  const held = cachedLibrary<Row>(activePlaylist()?.id ?? null, props.kind);
  const [library, setLibrary] = createSignal<Library<Row> | undefined>(held);
  const { hidden: hiddenCats, hide } = useHiddenCategories(props.kind);
  const all = createMemo((): Row[] => withoutHidden(library()?.rows ?? NO_ROWS, hiddenCats()));
  const cats = (): CategoryRow[] => library()?.cats ?? NO_CATEGORIES;
  const [favKeys, setFavKeys] = createSignal<string[]>(held?.favs ?? []);
  // Starts on the remembered category, so nothing flashes "All" (and resets) on the way back.
  const [category, setCategory] = createSignal(lastCategory.get(`${activePlaylist()?.id ?? null}|${props.kind}`) ?? 'all');
  /** Title open inside the grid area (Settings → Browsing → next to categories). */
  const [openId, setOpenIdSignal] = createSignal<string | null>(
    detailMode() === 'inline' ? (lastOpenId.get(`${activePlaylist()?.id ?? null}|${props.kind}`) ?? null) : null,
  );
  const setOpenId = (id: string | null) => {
    setOpenIdSignal(id);
    lastOpenId.set(memoryKey(), id);
  };
  const [loading, setLoading] = createSignal(!held);
  const [sortOpen, setSortOpen] = createSignal(false);
  const [focused, setFocused] = createSignal<Row | null>(null);
  const searchKey = () => `items|${activePlaylist()?.id ?? ''}|${props.kind}`;
  const [query, setQuerySignal] = createSignal(rememberedSearch(searchKey()));
  const setQuery = (q: string) => {
    if (q && !query()) track(`search.${props.kind}`);
    setQuerySignal(q);
    rememberSearch(searchKey(), q);
    // Positions in the old results mean nothing in the new ones.
    lastGridIndex.set(memoryKey(), null);
    setFocused(null);
  };
  const progress = useProgress();
  let grid: VirtualGridApi | undefined;
  let seq = 0;

  const memoryKey = () => `${playlistId()}|${props.kind}`;

  /** Settings → Appearance → Movies / Series layout. */
  const large = () => (props.kind === 'vod' ? moviesLayout() : seriesLayout()) === 'large';
  // Opens on the categories, unless Back brought us here from a title that was opened from the posters.
  const [largeStep, setLargeStep] = createSignal<'categories' | 'items'>(
    justWentBack() && lastLargeStep.get(`${activePlaylist()?.id ?? null}|${props.kind}`) === 'items' ? 'items' : 'categories',
  );
  const [largeStart, setLargeStart] = createSignal(0);
  const [largeCatQuery, setLargeCatQuery] = createSignal('');
  const [focusedCategory, setFocusedCategory] = createSignal<RailItem | null>(null);
  let largeView: LargeBrowseApi | undefined;
  const [catSort, setCatSort] = categorySort(props.kind);
  const [catSortOpen, setCatSortOpen] = createSignal(false);
  const { pins, toggle: togglePin } = usePins(props.kind);
  const favSet = createMemo(() => new Set(favKeys()));
  const byKey = () => library()?.byKey() ?? NO_KEYS;

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
    const lib = library();
    if (!lib) return NO_ROWS;
    const sort = vodSort();
    const lang = locale();
    const rows = all();
    const key = `${id}|${sort}|${lang}|${id === 'all' ? hiddenCats().join() : ''}`;
    return lib.sorted(key, () => sortRows(id === 'all' ? rows.slice() : rows.filter((r) => r.categoryIds.indexOf(id) >= 0), sort, lang));
  });

  const items = createMemo<Row[]>(() => {
    const match = makeMatcher(query());
    const list = inCategory();
    if (!match) return list;
    const names = library()?.normNames();
    if (!names) return list;
    return perf.timedSync('filter.items', () => list.filter((r) => match(names.get(r.key) ?? '')));
  });

  const railItems = createMemo<RailItem[]>(() => {
    const locked = lockedCategories();
    return [
      { id: 'continue', name: t('vod.continue'), count: continueRows().length, locked: false, icon: 'history' as IconName },
      { id: 'fav', name: t('live.favorites'), count: favKeys().length, locked: false, icon: 'star' as IconName },
      { id: 'all', name: props.kind === 'vod' ? t('vod.allMovies') : t('vod.allSeries'), count: all().length, locked: false, icon: 'grid' },
      // Only while something is hidden, so there's always a way back to it.
      ...(hiddenCats().length ? [{ id: 'hidden', name: t('hidden.entry'), count: hiddenCats().length, locked: false, icon: 'eyeOff' as IconName }] : []),
      ...cats()
        .filter((c) => hiddenCats().indexOf(c.id) < 0)
        .map((c) => ({
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
      if (!cachedLibrary(id, props.kind)) setLoading(true);
      try {
        const [lib, favs] = await Promise.all([loadLibrary<Row>(id, props.kind), favoriteKeys(id, props.kind)]);
        if (mine !== seq) return;
        lib.favs = favs;
        setLibrary(lib);
        setFavKeys(favs);
        setCategory(lastCategory.get(memoryKey()) ?? 'all');
        setQuerySignal(rememberedSearch(searchKey()));
        setOpenIdSignal(detailMode() === 'inline' ? (lastOpenId.get(memoryKey()) ?? null) : null);
        const index = lastGridIndex.get(memoryKey());
        if (large()) {
          if (largeStep() === 'items') setLargeStart(index ?? 0);
          else setLargeStart(Math.max(0, largeCategories().findIndex((c) => c.id === category())));
        } else if (index != null) setTimeout(() => grid?.focusIndex(index), 0);
      } catch (e) {
        log.error('vod', 'could not load', { kind: props.kind, error: e });
      } finally {
        if (mine === seq) setLoading(false);
      }
    }),
  );

  // Bigger text means bigger posters, so fewer fit across (and more when it's smaller).
  const columns = () => Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.round((COLUMNS * 100) / textScale())));

  // The open category was hidden in Settings.
  createEffect(() => {
    if (hiddenCats().indexOf(category()) >= 0) chooseCategory('all');
  });

  function chooseCategory(id: string): void {
    if (id === category()) return;
    setCategory(id);
    setQuery('');
    // Settings → Browsing: an open title stays (Back shows the new category), or closes now.
    if (!keepTitleOpen()) setOpenId(null);
    lastCategory.set(memoryKey(), id);
    lastGridIndex.set(memoryKey(), null);
    grid?.scrollToIndex(0);
  }

  const open = (row: Row) => {
    lastLargeStep.set(memoryKey(), 'items');
    if (detailMode() === 'inline' && !large()) return setOpenId(row.id);
    if (props.kind === 'vod') navigate({ name: 'vod-detail', id: row.id });
    else navigate({ name: 'series-detail', id: row.id });
  };

  /** Back from a title shown in the grid area: the grid returns on the same poster. */
  const closeInline = () => {
    setOpenId(null);
    const index = lastGridIndex.get(memoryKey());
    setTimeout(() => grid?.focusIndex(index ?? 0), 0);
  };

  const toggleFavorite = async (row: Row | null) => {
    const pid = playlistId();
    if (!row || !pid) return;
    const added = await catalog().call('toggleFavorite', { playlistId: pid, kind: props.kind, key: row.key, name: row.name });
    setFavKeys((keys) => (added ? keys.concat(row.key) : keys.filter((k) => k !== row.key)));
  };

  const largeCategories = createMemo<RailItem[]>(() => {
    const fixed = railItems().filter((c) => VIRTUAL.indexOf(c.id) >= 0);
    return fixed.concat(arrangeCategories(railItems().filter((c) => VIRTUAL.indexOf(c.id) < 0), catSort(), pins(), locale()));
  });
  const largeShown = createMemo<RailItem[]>(() => {
    const match = makeMatcher(largeCatQuery());
    return match ? largeCategories().filter((c) => VIRTUAL.indexOf(c.id) < 0 && match(normalizeText(c.name))) : largeCategories();
  });

  /** Puts the cursor on a poster in whichever layout is showing. */
  const focusItem = (index: number) => {
    if (!large()) return void setTimeout(() => grid?.focusIndex(index), 0);
    setLargeStart(index);
    setLargeStep('items');
    setTimeout(() => largeView?.focus(index), 0);
  };

  /** The full list of hidden categories. With a PIN set, it's the PIN that lets them back. */
  const openHidden = async () => {
    if (await ensureUnlocked()) navigate({ name: 'hidden-categories', kind: props.kind });
  };

  const hideCategory = (c: RailItem | null | undefined) => {
    if (!c || VIRTUAL.indexOf(c.id) >= 0) return;
    hide(c.id);
    track(`hide.category.${props.kind}`);
    showToast(t('hidden.done', { name: c.name }));
  };

  const openLargeCategory = async (c: RailItem) => {
    if (c.id === 'hidden') return void openHidden();
    if (c.locked && !(await ensureUnlocked())) return;
    chooseCategory(c.id);
    focusItem(0);
  };

  const backToLargeCategories = () => {
    const index = Math.max(0, largeShown().findIndex((c) => c.id === category()));
    setLargeStart(index);
    setLargeStep('categories');
    lastLargeStep.set(memoryKey(), 'categories');
    setTimeout(() => largeView?.focus(index), 0);
  };

  /** The category Green acts on: the open one inside it, else the one the cursor is on. */
  const pinTarget = () => {
    const id = largeStep() === 'items' ? category() : focusedCategory()?.id;
    if (id && VIRTUAL.indexOf(id) < 0) void togglePin(id);
  };
  const dialogOpen = () => !!document.querySelector('.dialog-backdrop');
  const hideTarget = () => {
    const inside = largeStep() === 'items';
    const id = inside ? category() : focusedCategory()?.id;
    const c = railItems().find((x) => x.id === id);
    if (!c || VIRTUAL.indexOf(c.id) >= 0) return;
    const index = largeShown().findIndex((x) => x.id === c.id);
    hideCategory(c);
    if (inside) backToLargeCategories();
    else setTimeout(() => largeView?.focus(Math.max(0, Math.min(index, largeShown().length - 1))), 0);
  };
  const legendKeys = (): LegendKey[] => {
    const keys: LegendKey[] = [
      { id: 'vlegend-green', color: 'green', label: t('legend.pin'), onPress: pinTarget },
      { id: 'vlegend-hide', icon: 'eyeOff', label: t('legend.hide'), onPress: hideTarget },
    ];
    if (largeStep() === 'items') keys.push({ id: 'vlegend-yellow', color: 'yellow', label: t('legend.favourite'), onPress: () => void toggleFavorite(focused()) });
    return keys;
  };

  useKeys((press) => {
    if (large()) {
      if (dialogOpen()) return false;
      if (press.key === 'back' && largeStep() === 'items') {
        backToLargeCategories();
        return true;
      }
      if (press.key === 'green') {
        pinTarget();
        return true;
      }
      if (press.key === 'yellow') {
        if (largeStep() === 'items') void toggleFavorite(focused());
        return largeStep() === 'items';
      }
      return false;
    }
    if (press.key === 'back' && openId()) {
      closeInline();
      return true;
    }
    if (press.key === 'yellow' && !openId()) {
      void toggleFavorite(focused());
      return true;
    }
    return false;
  });

  const progressOf = (row: Row) => (props.kind === 'vod' ? progressRatio(progress().get(`vod|${row.key}`)) : 0);
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
              <RemoteQrPanel id="vod-remote" />
            </FocusZone>
          </div>
        }
      >
        {(p) => (
          <>
            <div class="live-header">
              <span class="live-title">
                <span class="dot" />
                <bdi>{p().name}</bdi>
                <span class="sep">•</span>
                <span class="accent">
                  <bdi>{large() && largeStep() === 'categories' ? t('live.largeTitle') : (railItems().filter((c) => c.id === category())[0]?.name ?? '')}</bdi>
                </span>
              </span>
              <span class="hint">{large() && largeStep() === 'items' ? t('live.largeBack') : statusText(p(), isRefreshing())}</span>
            </div>
            <Show when={large()}>
              <FocusZone id="vod-large" remember>
                <LargeBrowse<Row>
                  step={largeStep()}
                  categoryId="vcat"
                  itemId="vgrid"
                  label={t(props.kind === 'vod' ? 'tab.movies' : 'tab.series')}
                  categories={largeShown()}
                  current={category()}
                  pinned={(id) => pins().indexOf(id) >= 0}
                  countLabel={(n) => t('vod.titles', { n: formatNumber(n) })}
                  items={items()}
                  itemShape="poster"
                  renderItem={(row) => (
                    <PosterTile
                      title={row.name}
                      poster={row.logo}
                      year={row.year}
                      rating={row.rating}
                      progress={progressOf(row)}
                      watched={props.kind === 'vod' && !!progress().get(`vod|${row.key}`)?.watched}
                      favorite={favSet().has(row.key)}
                    />
                  )}
                  startIndex={largeStart()}
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
                  tools={
                    largeStep() === 'categories' ? (
                      <LargeTools id="vcat-search" query={largeCatQuery()} onQuery={setLargeCatQuery} label={t('search.categories')}>
                        <FocusButton id="vcat-sort" class="icon-button" label={t('categories.sortTitle')} onSelect={() => setCatSortOpen(true)}>
                          <Icon name="sort" />
                        </FocusButton>
                      </LargeTools>
                    ) : (
                      <LargeTools
                        id="vgrid-search"
                        query={query()}
                        onQuery={setQuery}
                        label={t('search.inCategory', { name: railItems().filter((c) => c.id === category())[0]?.name ?? '' })}
                        onBack={backToLargeCategories}
                      >
                        <PinButton id="vgrid-pin" kind={props.kind} categoryId={category()} pinnable={VIRTUAL.indexOf(category()) < 0} />
                        <FocusButton id="vgrid-sort" class="sort-chip" onSelect={() => setSortOpen(true)}>
                          <span>{t('vod.sort', { by: t(`sort.${vodSort()}`) })}</span>
                          <Icon name="down" />
                        </FocusButton>
                      </LargeTools>
                    )
                  }
                  legend={<LargeLegend keys={legendKeys()} />}
                  onOpenCategory={(c) => void openLargeCategory(c)}
                  onFocusCategory={(c) => setFocusedCategory(c)}
                  onSelectItem={open}
                  onFocusItem={(row, index) => {
                    setFocused(row);
                    lastGridIndex.set(memoryKey(), index);
                  }}
                  ref={(api) => (largeView = api)}
                />
              </FocusZone>
            </Show>
            <Show when={!large()}>
            <div class="panes">
              <FocusZone id="vod-categories" remember>
                <CategoryRail
                  kind={props.kind}
                  id="vcat"
                  label={t(props.kind === 'vod' ? 'tab.movies' : 'tab.series')}
                  fixed={railItems().filter((c) => VIRTUAL.indexOf(c.id) >= 0)}
                  categories={railItems().filter((c) => VIRTUAL.indexOf(c.id) < 0)}
                  selected={category()}
                  onHide={hideCategory}
                  onOpen={async (c) => {
                    if (c.id === 'hidden') return void openHidden();
                    if (c.locked && !(await ensureUnlocked())) return;
                    chooseCategory(c.id);
                    // Remote: move into the grid. Touch: stay put (the finger is free to go anywhere).
                    if (!focusManager.pointerMode && !openId()) setTimeout(() => grid?.focusIndex(0), 0);
                  }}
                />
              </FocusZone>
              <FocusZone id="vod-grid" remember>
                <div class="pane pane-grid">
                  <Show
                    when={openId()}
                    fallback={
                      <>
                      <div class="pane-tools">
                        <TextField
                          id="vgrid-search"
                          compact
                          label={t('search.inCategory', { name: railItems().filter((c) => c.id === category())[0]?.name ?? '' })}
                          value={query()}
                          onChange={setQuery}
                        />
                        <PinButton id="vod-pin" kind={props.kind} categoryId={category()} pinnable={VIRTUAL.indexOf(category()) < 0} />
                        <span class="pill count">{t('vod.titles', { n: formatNumber(items().length) })}</span>
                        <FocusButton id="vod-sort" class="sort-chip" onSelect={() => setSortOpen(true)}>
                          <span>{t('vod.sort', { by: t(`sort.${vodSort()}`) })}</span>
                          <Icon name="down" />
                        </FocusButton>
                      </div>
                      <FocusStrip row={focused()} kind={props.kind} progress={focused() ? progress().get(`vod|${focused()!.key}`) : undefined} />
                      <VirtualGrid
                        id="vgrid"
                        label={t(props.kind === 'vod' ? 'tab.movies' : 'tab.series')}
                        items={items()}
                        columns={columns()}
                        rowHeight={23}
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
                          <PosterTile
                            title={row.name}
                            poster={row.logo}
                            year={row.year}
                            rating={row.rating}
                            progress={progressOf(row)}
                            watched={props.kind === 'vod' && !!progress().get(`vod|${row.key}`)?.watched}
                            favorite={favSet().has(row.key)}
                          />
                        )}
                      />
                      </>
                    }
                  >
                    {(id) =>
                      props.kind === 'vod' ? (
                        <VodDetailScreen id={id()} embedded onOpen={setOpenId} onClose={closeInline} />
                      ) : (
                        <SeriesDetailScreen id={id()} embedded onOpen={setOpenId} onClose={closeInline} />
                      )
                    }
                  </Show>
                </div>
              </FocusZone>
            </div>
            </Show>
          </>
        )}
      </Show>
      <Show when={catSortOpen()}>
        <PickerDialog
          id="vod-cat-sort-picker"
          title={t('categories.sortTitle')}
          options={CATEGORY_SORTS.map((x) => ({ id: x, label: t(`categories.sort.${x}`) }))}
          selected={catSort()}
          onCancel={() => setCatSortOpen(false)}
          onPick={(id) => {
            setCatSortOpen(false);
            setCatSort(id as (typeof CATEGORY_SORTS)[number]);
          }}
        />
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

/** What the grid cursor is on: title, year, rating and time left, without leaving the grid. */
function FocusStrip(props: { row: Row | null; kind: Kind; progress?: ProgressRow }): JSX.Element {
  return (
    <div class="focus-strip">
      <span class="strip-play">
        <Icon name={props.kind === 'vod' ? 'play' : 'series'} />
      </span>
      <div class="strip-text">
        <div class="strip-title">
          <bdi>{props.row?.name ?? ''}</bdi>
        </div>
        <div class="strip-meta">
          <Show when={props.row?.year}>
            <span>{props.row!.year}</span>
          </Show>
          <Show when={props.row?.year && props.row?.rating}>
            <span> · </span>
          </Show>
          <Show when={props.row?.rating}>
            <span class="star">★ {props.row!.rating}</span>
          </Show>
        </div>
      </div>
      <Show when={props.progress && !props.progress.watched && props.progress.position > 0}>
        <span class="strip-left">{t('home.left', { time: formatLeft(props.progress!.duration - props.progress!.position) })}</span>
      </Show>
      <span class="ok-hint strip-left">
        <span class="key-cap">OK</span>
        {t('vod.openHint')}
      </span>
    </div>
  );
}
