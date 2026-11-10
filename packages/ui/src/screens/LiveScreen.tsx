import {
  favoriteKeys,
  log,
  perf,
  recentKeys,
  UNCATEGORIZED,
  type CategoryRow,
  type ChannelRow,
} from '@ultra/core';
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { CategoryRail } from '../components/CategoryRail';
import { ChannelBox } from '../components/ChannelBox';
import { LargeBrowse, LargeLegend, LargeTools, type LargeBrowseApi, type LegendKey } from '../components/LargeBrowse';
import { PickerDialog } from '../components/PickerDialog';
import { ChannelLogo } from '../components/ChannelLogo';
import { PinButton } from '../components/PinButton';
import { RenameDialog } from '../components/RenameDialog';
import { Icon, type IconName } from '../components/Icon';
import { TextField } from '../components/TextField';
import { guideOnEveryRow, liveLayout, liveShowRecent } from '../data/settings';
import { showToast as showMessage } from '../data/toast';
import { track } from '../data/usage';
import { arrangeCategories, CATEGORY_SORTS, categorySort, makeMatcher, normalizeText, useCategoryNames, useHiddenCategories, usePins, withoutHidden } from '../data/categories';
import { useFileSection } from '../data/fileSection';
import { cachedLibrary, loadLibrary, type Library } from '../data/libraryCache';
import { enterLibrary, rememberedSearch, rememberSearch } from '../data/libraryMemory';
import { FocusButton } from '../components/FocusButton';
import { RemoteQrPanel } from '../components/RemoteQrPanel';
import { NowNextView } from '../components/NowNextView';
import { VirtualList, type VirtualListApi } from '../components/VirtualList';
import { catalog } from '../data/catalog';
import { useNowNext } from '../data/epg';
import { ensureUnlocked, isCategoryLocked, isChannelLocked, lockedCategories, lockedChannels, toggleLock, unlocked } from '../data/parental';
import {
  claimSurface,
  videoResolution,
  playbackStatus,
  playChannel,
  playerState,
  playingChannel,
  recentVersion,
  releaseSurface,
  retryNow,
  updateSurface,
} from '../data/playback';
import { activePlaylist, refreshing, versionOf } from '../data/playlists';
import { FocusZone, focusManager } from '../focus';
import { statusText } from '../format';
import { formatNumber, locale, t } from '../i18n';
import { useKeys } from '../keys';
import { currentRoute, navigate } from '../nav';

type CategoryId = 'fav' | 'recent' | 'all' | string;
interface CategoryItem {
  id: CategoryId;
  name: string;
  count: number;
  locked: boolean;
  icon?: IconName;
  /** The provider's name, when the user gave it another. */
  original?: string;
}

const VIRTUAL = ['fav', 'recent', 'all', 'hidden'];
const NO_CHANNELS: ChannelRow[] = [];
const NO_CATEGORIES: CategoryRow[] = [];
const ZAP_DELAY_MS = 1500;
const RETURN_FOCUS_DELAY_MS = 50;
// Last category per playlist, kept for the session.
const lastCategory = new Map<string, CategoryId>();
// Last channel the cursor was on, per playlist, so coming back lands on it.
const lastChannelKey = new Map<string, string>();

/** Three panes (spec §5): categories | channels | preview + info. */
export function LiveScreen(props: { focusKey?: string }): JSX.Element {
  enterLibrary('live');
  const playlistId = () => activePlaylist()?.id ?? null;
  const isXtream = () => activePlaylist()?.type === 'xtream';
  /** Programme names on every row, or only for the selected channel (Settings → Browsing). */
  const rowGuide = () => isXtream() && guideOnEveryRow();
  // Already in memory on the way back from full screen, so the first paint has everything.
  const held = cachedLibrary<ChannelRow>(activePlaylist()?.id ?? null, 'live');
  const [library, setLibrary] = createSignal<Library<ChannelRow> | undefined>(held);
  const { hidden, hide } = useHiddenCategories('live');
  const cats = (): CategoryRow[] => library()?.cats ?? NO_CATEGORIES;
  const all = createMemo((): ChannelRow[] => withoutHidden(library()?.rows ?? NO_CHANNELS, hidden()));
  const [favKeys, setFavKeys] = createSignal<string[]>(held?.favs ?? []);
  const [recent, setRecent] = createSignal<string[]>(held?.recent ?? []);
  // Starts on the remembered category, so nothing flashes "All" (and resets) on the way back.
  const [category, setCategory] = createSignal<CategoryId>(lastCategory.get(activePlaylist()?.id ?? '') ?? 'all');
  const [focused, setFocused] = createSignal<ChannelRow | null>(null);
  const [focusedCategory, setFocusedCategory] = createSignal<CategoryItem | null>(null);
  const [loading, setLoading] = createSignal(!held);
  const [digits, setDigits] = createSignal('');
  const [toast, setToast] = createSignal('');
  // Jumping to a specific channel (from Home) can't keep a search that might hide it.
  const searchKey = (id: string | null) => `channels|${id ?? ''}`;
  if (props.focusKey) rememberSearch(searchKey(activePlaylist()?.id ?? null), '');
  const [channelQuery, setChannelQuerySignal] = createSignal(rememberedSearch(searchKey(activePlaylist()?.id ?? null)));
  const setChannelQuery = (q: string) => {
    if (q && !channelQuery()) track('search.channels');
    setChannelQuerySignal(q);
    rememberSearch(searchKey(activePlaylist()?.id ?? null), q);
  };
  let channelList: VirtualListApi | undefined;
  /** Settings → Appearance → Live TV layout. */
  const large = () => liveLayout() === 'large';
  /** Settings → Appearance → Live TV layout → Split: a big category list, and the channels as boxes beside it. */
  const split = () => liveLayout() === 'split';
  // Always opens on the categories (from Home, on the channel it was asked for). The screen stays
  // alive under the player, so the step survives watching a channel.
  const [largeStep, setLargeStep] = createSignal<'categories' | 'items'>(props.focusKey ? 'items' : 'categories');
  const [largeStart, setLargeStart] = createSignal(0);
  let largeView: LargeBrowseApi | undefined;
  // Coming back from full screen lands on the playing channel.
  let pendingFocusKey = props.focusKey ?? playingChannel()?.key ?? lastChannelKey.get(activePlaylist()?.id ?? '');
  let loadSeq = 0;

  // Samsung, catalogue in files: read in just what's shown.
  useFileSection<ChannelRow>({
    kind: 'live',
    playlistId,
    library,
    setLibrary,
    categories: () => (VIRTUAL.indexOf(category()) < 0 ? [category()] : []),
    keys: () => favKeys().concat(recent()),
    search: () => (category() === 'all' ? channelQuery() : ''),
  });

  const favSet = createMemo(() => new Set(favKeys()));
  const fromKeys = (keys: string[]) => {
    const rows = library()?.byKey();
    return rows ? keys.map((k) => rows.get(k)).filter((c): c is ChannelRow => !!c) : NO_CHANNELS;
  };

  /** A locked category shows nothing until the PIN is entered (spec §5). */
  const categoryHidden = () => !VIRTUAL.includes(category()) && isCategoryLocked(category()) && !unlocked();

  const inCategory = createMemo<ChannelRow[]>(() => {
    const id = category();
    if (id === 'all') return all();
    if (id === 'fav') return fromKeys(favKeys());
    if (id === 'recent') return fromKeys(recent());
    if (categoryHidden()) return [];
    return all().filter((c) => c.categoryIds.indexOf(id) >= 0);
  });
  const channels = createMemo<ChannelRow[]>(() => {
    const match = makeMatcher(channelQuery());
    if (!match) return inCategory();
    const names = library()?.normNames();
    if (!names) return inCategory();
    return perf.timedSync('filter.channels', () => inCategory().filter((c) => match(names.get(c.key) ?? '')));
  });

  const { names, rename } = useCategoryNames('live');
  /** The category Blue opened the rename box for. */
  const [renaming, setRenaming] = createSignal<CategoryItem | null>(null);
  const categoryItems = createMemo<CategoryItem[]>(() => {
    const locked = lockedCategories();
    const given = names();
    return [
      { id: 'fav', name: t('live.favorites'), count: favKeys().length, locked: false, icon: 'star' },
      ...(liveShowRecent() ? [{ id: 'recent', name: t('live.recent'), count: fromKeys(recent()).length, locked: false, icon: 'history' as IconName }] : []),
      { id: 'all', name: t('live.all'), count: library()?.files ? library()!.total() : all().length, locked: false, icon: 'grid' },
      // Only while something is hidden, so there's always a way back to it.
      ...(hidden().length ? [{ id: 'hidden', name: t('hidden.entry'), count: hidden().length, locked: false, icon: 'eyeOff' as IconName }] : []),
      ...cats()
        .filter((c) => hidden().indexOf(c.id) < 0)
        .map((c) => {
          const provider = c.id === UNCATEGORIZED ? t('live.uncategorized') : c.name;
          return { id: c.id, name: given[c.id] ?? provider, original: given[c.id] ? provider : undefined, count: c.count, locked: locked.has(c.id) };
        }),
    ];
  });

  const [catSort, setCatSort] = categorySort('live');
  const [sortOpen, setSortOpen] = createSignal(false);
  const { pins, toggle: togglePin } = usePins('live');
  /** Same order as the standard rail: Favourites, Recent and All first, then pinned, then sorted. */
  const largeCategories = createMemo(() =>
    categoryItems()
      .filter((c) => VIRTUAL.indexOf(c.id) >= 0)
      .concat(arrangeCategories(categoryItems().filter((c) => VIRTUAL.indexOf(c.id) < 0), catSort(), pins(), locale())),
  );
  /** Searching the categories in the large layout, like the standard rail's box. */
  const [largeCatQuery, setLargeCatQuery] = createSignal('');
  const largeShown = createMemo(() => {
    const match = makeMatcher(largeCatQuery());
    if (!match) return largeCategories();
    return largeCategories().filter(
      (c) => VIRTUAL.indexOf(c.id) < 0 && (match(normalizeText(c.name)) || (!!c.original && match(normalizeText(c.original)))),
    );
  });

  /** Puts the cursor on a channel of the open category, in whichever layout is showing. */
  const focusChannel = (index: number, delay = 0) => {
    if (split()) {
      setTimeout(() => largeView?.focus(index), delay);
      return;
    }
    if (!large()) {
      setTimeout(() => channelList?.focusIndex(index), delay);
      return;
    }
    setLargeStart(index);
    setLargeStep('items');
    setTimeout(() => largeView?.focus(index), delay);
  };

  const openLargeCategory = async (c: CategoryItem) => {
    if (c.id === 'hidden') return void openHidden();
    if (c.locked && !(await ensureUnlocked())) return;
    chooseCategory(c.id);
    track('live.large.category');
    const last = playingChannel()?.key ?? lastChannelKey.get(playlistId() ?? '');
    focusChannel(Math.max(0, channels().findIndex((ch) => ch.key === last)));
  };

  const backToLargeCategories = () => {
    const index = Math.max(0, largeShown().findIndex((c) => c.id === category()));
    setLargeStart(index);
    setLargeStep('categories');
    setTimeout(() => largeView?.focus(index), 0);
  };

  /** Straight to full screen: there's no preview in the large layout. */
  const playLarge = async (c: ChannelRow) => {
    const pid = playlistId();
    if (!pid) return;
    const status = playbackStatus()?.kind;
    if (playingChannel()?.key === c.key && status !== 'failed' && status !== 'needs-gesture') {
      navigate({ name: 'player' });
      return;
    }
    if (await playChannel(c, channels(), pid)) navigate({ name: 'player' });
  };

  // The open category was hidden in Settings.
  createEffect(() => {
    if (hidden().indexOf(category()) >= 0 || (category() === 'recent' && !liveShowRecent())) chooseCategory('all');
  });

  const fixedItems = () => categoryItems().filter((c) => VIRTUAL.indexOf(c.id) >= 0);
  const realItems = () => categoryItems().filter((c) => VIRTUAL.indexOf(c.id) < 0);

  const categoryName = (id: string | undefined) => categoryItems().filter((c) => c.id === id)[0]?.name ?? '';

  // Reload when the playlist changes or its catalogue was rewritten by a refresh.
  createEffect(
    on([playlistId, () => versionOf(playlistId())], async ([id]) => {
      const seq = ++loadSeq;
      if (!id) {
        setLoading(false);
        return;
      }
      if (!cachedLibrary(id, 'live')) setLoading(true);
      const timer = log.time('live', 'catalogue loaded');
      try {
        const [lib, favs, rec] = await Promise.all([
          loadLibrary<ChannelRow>(id, 'live'),
          favoriteKeys(id, 'live'),
          recentKeys(id, 'live'),
        ]);
        if (seq !== loadSeq) return;
        if (focused()?.playlistId !== id) setFocused(null);
        lib.favs = favs;
        lib.recent = rec;
        setLibrary(lib);
        setFavKeys(favs);
        setRecent(rec);
        const remembered = lastCategory.get(id);
        setChannelQuerySignal(rememberedSearch(searchKey(id)));
        // In files (Samsung), "All" holds only what's been read: open on a list that has something in it.
        const allOr = lib.files ? (pendingFocusKey && rec.indexOf(pendingFocusKey) >= 0 ? 'recent' : pendingFocusKey && favs.indexOf(pendingFocusKey) >= 0 ? 'fav' : (lib.cats[0]?.id ?? 'all')) : 'all';
        if (pendingFocusKey && !(remembered && channelsIn(remembered).some((ch) => ch.key === pendingFocusKey))) setCategory(allOr);
        else setCategory(remembered && (remembered !== 'recent' || liveShowRecent()) ? remembered : favs.length ? 'fav' : allOr);
        timer.end({ channels: lib.rows.length, categories: lib.cats.length }, 'debug');
      } catch (e) {
        log.error('live', 'could not load channels', { error: e });
      } finally {
        if (seq === loadSeq) setLoading(false);
      }
      // Large always opens on the categories, on the open one; asked for a channel (from Home), on it.
      if (large() && largeStep() === 'categories') {
        pendingFocusKey = undefined;
        setLargeStart(Math.max(0, largeShown().findIndex((c) => c.id === category())));
      }
      if (pendingFocusKey) {
        const key = pendingFocusKey;
        pendingFocusKey = undefined;
        const index = channels().findIndex((c) => c.key === key);
        if (index >= 0) focusChannel(index);
      }
    }),
  );

  // Back from full screen, where the channel may have changed: land on what's playing.
  createEffect(
    on(
      () => currentRoute().name,
      (name) => {
        const key = playingChannel()?.key;
        if (name !== 'live' || !key) return;
        const index = channels().findIndex((c) => c.key === key);
        // After App has put focus back where it was, which was the channel before any zapping.
        if (index >= 0) focusChannel(index, RETURN_FOCUS_DELAY_MS);
      },
      { defer: true },
    ),
  );

  // Recent list follows playback.
  createEffect(
    on(recentVersion, () => {
      const id = playlistId();
      if (id) void recentKeys(id, 'live').then(setRecent);
    }, { defer: true }),
  );

  function channelsIn(id: CategoryId): ChannelRow[] {
    if (id === 'all') return all();
    if (id === 'fav') return fromKeys(favKeys());
    if (id === 'recent') return fromKeys(recent());
    return all().filter((c) => c.categoryIds.indexOf(id) >= 0);
  }

  function chooseCategory(id: CategoryId): void {
    if (id === category()) return;
    setCategory(id);
    setChannelQuery('');
    const pid = playlistId();
    if (pid) lastCategory.set(pid, id);
    channelList?.scrollToIndex(0);
    largeView?.top();
  }

  /** The full list of hidden categories. With a PIN set, it's the PIN that lets them back. */
  const openHidden = async () => {
    if (await ensureUnlocked()) navigate({ name: 'hidden-categories', kind: 'live' });
  };

  const hideCategory = (c: CategoryItem | null) => {
    if (!c || VIRTUAL.indexOf(c.id) >= 0) return;
    hide(c.id);
    track('hide.category.live');
    showMessage(t('hidden.done', { name: c.original ?? c.name }));
  };

  const openCategory = async (c: CategoryItem) => {
    if (c.id === 'hidden') return void openHidden();
    if (c.locked && !(await ensureUnlocked())) return;
    chooseCategory(c.id);
    // Remote: move into the channels. Touch: stay put.
    if (!focusManager.pointerMode) focusChannel(0);
  };

  /** OK on a channel plays it in the preview; OK on the playing channel goes full screen. */
  const selectChannel = async (c: ChannelRow) => {
    const pid = playlistId();
    if (!pid) return;
    const status = playbackStatus()?.kind;
    if (playingChannel()?.key === c.key) {
      if (status === 'failed' || status === 'needs-gesture') retryNow();
      else navigate({ name: 'player' });
      return;
    }
    await playChannel(c, channels(), pid);
  };

  const toggleFavorite = async (channel: ChannelRow | null) => {
    const pid = playlistId();
    if (!channel || !pid) return;
    const added = await catalog().call('toggleFavorite', {
      playlistId: pid,
      kind: 'live',
      key: channel.key,
      name: channel.name,
      tvgId: channel.tvgId,
    });
    setFavKeys((keys) => (added ? keys.concat(channel.key) : keys.filter((k) => k !== channel.key)));
  };

  /** Red: lock/unlock the focused category or channel (asks for / creates the PIN). */
  const toggleFocusedLock = async () => {
    const id = focusManager.currentId ?? '';
    let result: boolean | null;
    if (/^lcat-\d+$/.test(id)) {
      const c = focusedCategory();
      if (!c || VIRTUAL.includes(c.id)) return;
      result = await toggleLock('category', c.id);
    } else if (/^lch-\d+$/.test(id) && focused()) {
      result = await toggleLock('channel', focused()!.key);
    } else {
      return;
    }
    if (result !== null) showToast(result ? t('live.lockedNow') : t('live.unlockedNow'));
  };

  // Number entry: digits collect for 1.5 s (or until OK), then jump to that channel number.
  let zapTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(zapTimer));
  const commitZap = () => {
    clearTimeout(zapTimer);
    const n = Number(digits());
    setDigits('');
    if (!n) return;
    let index = channels().findIndex((c) => c.num === n);
    if (index < 0) {
      const inAll = all().findIndex((c) => c.num === n);
      if (inAll >= 0) {
        setCategory('all');
        index = inAll;
      }
    }
    if (index >= 0) {
      focusChannel(index);
      log.debug('live', 'number zap', { number: n });
    } else {
      showToast(t('live.notFound', { n: formatNumber(n) }));
    }
  };

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(toastTimer));
  const showToast = (text: string) => {
    setToast(text);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(''), 2500);
  };

  /** The category Blue and Green act on: the open one inside it, else the one the cursor is on. */
  const targetCategory = (): CategoryItem | null => {
    const id = largeStep() === 'items' || split() ? category() : focusedCategory()?.id;
    const c = categoryItems().find((x) => x.id === id);
    return c && VIRTUAL.indexOf(c.id) < 0 ? c : null;
  };
  const renameTarget = () => {
    const c = targetCategory();
    if (c) setRenaming(c);
  };
  const pinTarget = () => {
    const c = targetCategory();
    if (c) void togglePin(c.id);
  };
  const hideTarget = () => {
    const c = targetCategory();
    if (!c) return;
    const inside = largeStep() === 'items' && !split();
    const index = largeShown().findIndex((x) => x.id === c.id);
    hideCategory(c);
    if (inside) backToLargeCategories();
    else setTimeout(() => largeView?.focus(Math.max(0, Math.min(index, largeShown().length - 1))), 0);
  };
  const favouriteFocused = () => {
    if (largeStep() === 'items' || split()) void toggleFavorite(focused());
  };
  const legendKeys = (): LegendKey[] => {
    const keys: LegendKey[] = [
      { id: 'llegend-blue', color: 'blue', label: t('legend.rename'), onPress: renameTarget },
      { id: 'llegend-green', color: 'green', label: t('legend.pin'), onPress: pinTarget },
      { id: 'llegend-hide', icon: 'eyeOff', label: t('legend.hide'), onPress: hideTarget },
    ];
    if (largeStep() === 'items' || split()) keys.push({ id: 'llegend-yellow', color: 'yellow', label: t('legend.favourite'), onPress: favouriteFocused });
    return keys;
  };
  const dialogOpen = () => !!document.querySelector('.dialog-backdrop');

  useKeys((press) => {
    if (press.key.indexOf('digit') === 0) {
      setDigits((d) => (d + press.key.slice(5)).slice(-5));
      clearTimeout(zapTimer);
      zapTimer = setTimeout(commitZap, ZAP_DELAY_MS);
      return true;
    }
    if (digits() && press.key === 'ok') {
      commitZap();
      return true;
    }
    if (digits() && press.key === 'back') {
      clearTimeout(zapTimer);
      setDigits('');
      return true;
    }
    if (press.key === 'yellow') {
      if (large()) {
        if (dialogOpen() || largeStep() !== 'items') return false;
        void toggleFavorite(focused());
        return true;
      }
      void toggleFavorite(focused());
      return true;
    }
    if (press.key === 'red') {
      void toggleFocusedLock();
      return true;
    }
    // Blue renames the category the cursor is on (Settings → Browsing has the same, for touch).
    if (press.key === 'blue' && large()) {
      if (dialogOpen()) return false;
      renameTarget();
      return true;
    }
    if (press.key === 'blue') {
      const c = focusedCategory();
      if (!c || VIRTUAL.indexOf(c.id) >= 0 || !/^lcat-\d+$/.test(focusManager.currentId ?? '')) return false;
      setRenaming(c);
      return true;
    }
    if (large() && press.key === 'back' && largeStep() === 'items') {
      backToLargeCategories();
      return true;
    }
    // The standard layout pins from its category rail.
    if (large() && press.key === 'green') {
      if (dialogOpen()) return false;
      pinTarget();
      return true;
    }
    return false;
  });

  const isRefreshing = () => !!(playlistId() && refreshing()[playlistId()!]);
  const emptyText = () =>
    loading() || isRefreshing()
      ? t('live.loading')
      : categoryHidden()
        ? t('live.lockedCategory')
        : category() === 'fav'
          ? t('live.emptyFav')
          : category() === 'recent'
            ? t('live.emptyRecent')
            : category() === 'all' && library()?.files
              ? t('files.allHint', { count: formatNumber(library()!.total()) })
              : t('live.empty');
  const focusedEpg = useNowNext(() => (isXtream() && focused()?.stream.t === 'x' ? focused()!.id : null), true);
  // Keep the lock maps reactive in row rendering.
  const rowLocked = (c: ChannelRow) => (lockedChannels(), lockedCategories(), isChannelLocked(c));

  return (
    <div class="screen live">
      <Show
        when={activePlaylist()}
        fallback={
          <div class="empty-state">
            <p>{t('live.noPlaylist')}</p>
            <FocusZone id="live-empty">
              <FocusButton id="live-add" class="btn-primary" autofocus onSelect={() => navigate({ name: 'playlist-form' })}>
                {t('home.addPlaylist')}
              </FocusButton>
              <RemoteQrPanel id="live-remote" />
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
                  <bdi>{large() && largeStep() === 'categories' ? t('live.largeTitle') : categoryName(category())}</bdi>
                </span>
                <span class="pill pill-accent">
                  {formatNumber(large() && largeStep() === 'categories' ? largeShown().length : channels().length)}
                </span>
              </span>
              <span class="hint">
                {large() && largeStep() === 'items' ? t('live.largeBack') : statusText(p(), isRefreshing())}
              </span>
            </div>
            <Show when={large()}>
              <FocusZone id="live-large" remember>
                <LargeBrowse<ChannelRow>
                  step={largeStep()}
                  categoryId="lcat"
                  itemId="lch"
                  label={t('tab.live')}
                  categories={largeShown()}
                  current={category()}
                  pinned={(id) => pins().indexOf(id) >= 0}
                  countLabel={(n) => (n === 1 ? t('live.channelCountOne') : t('live.channelCount', { n: formatNumber(n) }))}
                  items={channels()}
                  itemShape="box"
                  renderItem={(c, size) => (
                    <ChannelBox channel={c} size={size} guide={rowGuide()} favorite={favSet().has(c.key)} locked={rowLocked(c)} playing={playingChannel()?.key === c.key} />
                  )}
                  startIndex={largeStart()}
                  empty={<p class="hint pane-empty">{emptyText()}</p>}
                  tools={
                    largeStep() === 'categories' ? (
                      <LargeTools id="lcat-search" query={largeCatQuery()} onQuery={setLargeCatQuery} label={t('search.categories')}>
                        <FocusButton id="lcat-sort" class="icon-button" label={t('categories.sortTitle')} onSelect={() => setSortOpen(true)}>
                          <Icon name="sort" />
                        </FocusButton>
                      </LargeTools>
                    ) : (
                      <LargeTools
                        id="lch-search"
                        query={channelQuery()}
                        onQuery={setChannelQuery}
                        label={t('search.inCategory', { name: categoryName(category()) })}
                        onBack={backToLargeCategories}
                      >
                        <PinButton id="lch-pin" kind="live" categoryId={category()} pinnable={VIRTUAL.indexOf(category()) < 0} />
                      </LargeTools>
                    )
                  }
                  legend={<LargeLegend keys={legendKeys()} />}
                  onOpenCategory={(c) => void openLargeCategory(c)}
                  onFocusCategory={(c) => setFocusedCategory(c)}
                  onSelectItem={(c) => void playLarge(c)}
                  onFocusItem={(c) => {
                    setFocused(c);
                    lastChannelKey.set(c.playlistId, c.key);
                  }}
                  ref={(api) => (largeView = api)}
                />
              </FocusZone>
            </Show>
            <Show when={split()}>
              <div class="panes">
                <FocusZone id="live-categories" remember>
                  <CategoryRail
                    big
                    kind="live"
                    id="lcat"
                    label={t('tab.live')}
                    fixed={fixedItems()}
                    categories={realItems()}
                    selected={category()}
                    onFocusRow={(c) => setFocusedCategory(c)}
                    onOpen={(c) => void openCategory(c)}
                    onHide={(c) => hideCategory(categoryItems().find((x) => x.id === c.id) ?? null)}
                  />
                </FocusZone>
                <FocusZone id="live-split" remember>
                  <div class="pane pane-split">
                    <LargeBrowse<ChannelRow>
                      step="items"
                      categoryId="lcatx"
                      itemId="lch"
                      label={t('tab.live')}
                      categories={[]}
                      current={category()}
                      pinned={() => false}
                      countLabel={() => ''}
                      items={channels()}
                      itemShape="box"
                      columnsCap={3}
                      renderItem={(c, size) => (
                        <ChannelBox channel={c} size={size} guide={rowGuide()} favorite={favSet().has(c.key)} locked={rowLocked(c)} playing={playingChannel()?.key === c.key} />
                      )}
                      startIndex={0}
                      empty={<p class="hint pane-empty">{emptyText()}</p>}
                      tools={
                        <LargeTools id="lch-search" query={channelQuery()} onQuery={setChannelQuery} label={t('search.inCategory', { name: categoryName(category()) })}>
                          <PinButton id="lch-pin" kind="live" categoryId={category()} pinnable={VIRTUAL.indexOf(category()) < 0} />
                        </LargeTools>
                      }
                      legend={<LargeLegend keys={legendKeys()} />}
                      onOpenCategory={() => undefined}
                      onFocusCategory={() => undefined}
                      onSelectItem={(c) => void playLarge(c)}
                      onFocusItem={(c) => {
                        setFocused(c);
                        lastChannelKey.set(c.playlistId, c.key);
                      }}
                      ref={(api) => (largeView = api)}
                    />
                  </div>
                </FocusZone>
              </div>
            </Show>
            <Show when={!large() && !split()}>
            <div class="panes">
              <FocusZone id="live-categories" remember>
                <CategoryRail
                  kind="live"
                  id="lcat"
                  label={t('tab.live')}
                  fixed={fixedItems()}
                  categories={realItems()}
                  selected={category()}
                  onFocusRow={(c) => setFocusedCategory(c)}
                  onOpen={(c) => void openCategory(c)}
                  onHide={(c) => hideCategory(categoryItems().find((x) => x.id === c.id) ?? null)}
                />
              </FocusZone>
              <FocusZone id="live-channels" remember>
                <div class="pane pane-channels">
                  <div class="pane-tools">
                    <TextField
                      id="lch-search"
                      compact
                      label={t('search.inCategory', { name: categoryName(category()) })}
                      value={channelQuery()}
                      onChange={setChannelQuery}
                    />
                    <PinButton id="live-pin" kind="live" categoryId={category()} pinnable={VIRTUAL.indexOf(category()) < 0} />
                  </div>
                  <VirtualList
                    id="lch"
                    label={t('tab.live')}
                    items={channels()}
                    rowHeight={rowGuide() ? 3.9 : 3.4}
                    ref={(api) => (channelList = api)}
                    rowClass={(c) => (playingChannel()?.key === c.key ? 'list-item channel-row is-selected' : 'list-item channel-row')}
                    onFocusRow={(c) => {
                      setFocused(c);
                      lastChannelKey.set(c.playlistId, c.key);
                    }}
                    onSelect={(c) => void selectChannel(c)}
                    empty={<p class="hint pane-empty">{emptyText()}</p>}
                    renderRow={(c) => (
                      <ChannelRowContent channel={c} epg={rowGuide()} favorite={favSet().has(c.key)} locked={rowLocked(c)} />
                    )}
                  />
                </div>
              </FocusZone>
              <FocusZone id="live-info">
                <div class="pane pane-preview">
                  <PreviewBox />
                  <Show when={focused()}>
                    {(c) => (
                      <div class="channel-info">
                        <div class="channel-info-title">
                          <span class="num">{c().num}</span>
                          <bdi>{c().name}</bdi>
                          <Show when={rowLocked(c())}>
                            <span class="lock-icon">
                              <Icon name="lock" />
                            </span>
                          </Show>
                        </div>
                        <div class="hint">
                          <bdi>{c().categoryIds.map((id) => categoryName(id)).join(' · ')}</bdi>
                          <Show when={c().catchupDays}>
                            {' · '}
                            {t('live.catchup', { n: formatNumber(c().catchupDays!) })}
                          </Show>
                        </div>
                        <div class="button-row">
                          <FocusButton id="live-fav" class={favSet().has(c().key) ? 'btn-primary' : ''} onSelect={() => void toggleFavorite(focused())}>
                            <Icon name={favSet().has(c().key) ? 'starFill' : 'star'} />
                            <span>{favSet().has(c().key) ? t('live.removeFav') : t('live.addFav')}</span>
                          </FocusButton>
                          <Show when={c().catchupDays}>
                            <FocusButton id="live-catchup" onSelect={() => navigate({ name: 'catchup', channelId: c().id })}>
                              <Icon name="replay" />
                              <span>{t('catchup.open')}</span>
                            </FocusButton>
                          </Show>
                        </div>
                        <NowNextView data={focusedEpg()} />
                      </div>
                    )}
                  </Show>
                  <p class="hint keys-hint">{t('live.keysHint')}</p>
                </div>
              </FocusZone>
            </div>
            </Show>
          </>
        )}
      </Show>
      <Show when={sortOpen()}>
        <PickerDialog
          id="live-large-sort"
          title={t('categories.sortTitle')}
          options={CATEGORY_SORTS.map((x) => ({ id: x, label: t(`categories.sort.${x}`) }))}
          selected={catSort()}
          onCancel={() => setSortOpen(false)}
          onPick={(id) => {
            setSortOpen(false);
            setCatSort(id as (typeof CATEGORY_SORTS)[number]);
          }}
        />
      </Show>
      <Show when={renaming()}>
        {(c) => (
          <RenameDialog
            id="live-rename"
            original={c().original ?? c().name}
            current={c().name}
            renamed={!!c().original}
            onSave={(name) => {
              void rename(c().id, name);
              setRenaming(null);
            }}
            onReset={() => {
              void rename(c().id, null);
              setRenaming(null);
            }}
            onCancel={() => setRenaming(null)}
          />
        )}
      </Show>
      <Show when={digits()}>
        <div class="zap-overlay" dir="ltr">
          {digits()}
        </div>
      </Show>
      <Show when={toast()}>
        <div class="toast" role="status">
          {toast()}
        </div>
      </Show>
    </div>
  );
}

/** Channel row: number, logo, name, now-playing title + progress (Xtream), favourite, lock. */
function ChannelRowContent(props: { channel: ChannelRow; epg: boolean; favorite: boolean; locked: boolean }): JSX.Element {
  const epg = useNowNext(() => (props.epg && props.channel.stream.t === 'x' ? props.channel.id : null));
  return (
    <>
      <span class="list-number">{props.channel.num}</span>
      <ChannelLogo src={props.channel.logo} name={props.channel.name} />
      <span class="channel-text">
        <span class="list-label">
          <bdi>{props.channel.name}</bdi>
        </span>
        <Show when={props.epg && epg().now}>
          {(now) => (
            <span class="row-now">
              <span class="row-now-title">
                <bdi>{now().title}</bdi>
              </span>
              <span class="progress">
                <span class="progress-fill" style={{ width: `${Math.round((epg().progress ?? 0) * 100)}%` }} />
              </span>
            </span>
          )}
        </Show>
      </span>
      <Show when={props.locked}>
        <span class="lock-icon">
          <Icon name="lock" />
        </span>
      </Show>
      <Show when={props.favorite}>
        <span class="fav-star">
          <Icon name="starFill" />
        </span>
      </Show>
    </>
  );
}

/** The box the video layer is positioned over while the Live screen shows. */
function PreviewBox(): JSX.Element {
  let box: HTMLDivElement | undefined;
  const rectOf = () => {
    const r = box!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  // This screen stays alive under the full-screen player: take the video back on returning.
  createEffect(
    on(
      () => currentRoute().name,
      (name) => {
        if (name === 'live' && box) claimSurface('preview', rectOf());
      },
      { defer: true },
    ),
  );
  onMount(() => {
    if (!box) return;
    claimSurface('preview', rectOf());
    const sync = () => box && updateSurface('preview', rectOf());
    window.addEventListener('resize', sync);
    // Layout can shift (fonts, header text); cheap to re-measure.
    const interval = setInterval(sync, 500);
    onCleanup(() => {
      window.removeEventListener('resize', sync);
      clearInterval(interval);
      releaseSurface('preview');
    });
  });
  return (
    <div class="preview-box" ref={(el) => (box = el)}>
      <Show when={playingChannel() && playerState() === 'playing'}>
        <div class="preview-badges">
          <span class="pill pill-live">{t('player.live')}</span>
          <Show when={videoResolution()}>{(r) => <span class="pill pill-resolution">{r()}</span>}</Show>
        </div>
      </Show>
      <Show when={!playingChannel()}>
        <span class="preview-hint">{t('live.watchHint')}</span>
      </Show>
    </div>
  );
}
