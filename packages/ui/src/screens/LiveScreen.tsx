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
import { ChannelLogo } from '../components/ChannelLogo';
import { PinButton } from '../components/PinButton';
import { Icon, type IconName } from '../components/Icon';
import { TextField } from '../components/TextField';
import { guideOnEveryRow } from '../data/settings';
import { track } from '../data/usage';
import { makeMatcher, useHiddenCategories, withoutHidden } from '../data/categories';
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
import { formatNumber, t } from '../i18n';
import { useKeys } from '../keys';
import { currentRoute, navigate } from '../nav';

type CategoryId = 'fav' | 'recent' | 'all' | string;
interface CategoryItem {
  id: CategoryId;
  name: string;
  count: number;
  locked: boolean;
  icon?: IconName;
}

const VIRTUAL = ['fav', 'recent', 'all'];
const NO_CHANNELS: ChannelRow[] = [];
const NO_CATEGORIES: CategoryRow[] = [];
const ZAP_DELAY_MS = 1500;
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
  const { hidden } = useHiddenCategories('live');
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
  // Coming back from full screen lands on the playing channel.
  let pendingFocusKey = props.focusKey ?? playingChannel()?.key ?? lastChannelKey.get(activePlaylist()?.id ?? '');
  let loadSeq = 0;

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

  const categoryItems = createMemo<CategoryItem[]>(() => {
    const locked = lockedCategories();
    return [
      { id: 'fav', name: t('live.favorites'), count: favKeys().length, locked: false, icon: 'star' },
      { id: 'recent', name: t('live.recent'), count: fromKeys(recent()).length, locked: false, icon: 'history' },
      { id: 'all', name: t('live.all'), count: all().length, locked: false, icon: 'grid' },
      ...cats()
        .filter((c) => hidden().indexOf(c.id) < 0)
        .map((c) => ({
          id: c.id,
          name: c.id === UNCATEGORIZED ? t('live.uncategorized') : c.name,
          count: c.count,
          locked: locked.has(c.id),
        })),
    ];
  });

  // The open category was hidden in Settings.
  createEffect(() => {
    if (hidden().indexOf(category()) >= 0) chooseCategory('all');
  });

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
        if (pendingFocusKey && !(remembered && channelsIn(remembered).some((ch) => ch.key === pendingFocusKey))) setCategory('all');
        else setCategory(remembered ?? (favs.length ? 'fav' : 'all'));
        timer.end({ channels: lib.rows.length, categories: lib.cats.length }, 'debug');
      } catch (e) {
        log.error('live', 'could not load channels', { error: e });
      } finally {
        if (seq === loadSeq) setLoading(false);
      }
      if (pendingFocusKey) {
        const key = pendingFocusKey;
        pendingFocusKey = undefined;
        const index = channels().findIndex((c) => c.key === key);
        if (index >= 0) setTimeout(() => channelList?.focusIndex(index), 0);
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
        if (index >= 0) setTimeout(() => channelList?.focusIndex(index), 0);
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
  }

  const openCategory = async (c: CategoryItem) => {
    if (c.locked && !(await ensureUnlocked())) return;
    chooseCategory(c.id);
    // Remote: move into the channels. Touch: stay put.
    if (!focusManager.pointerMode) setTimeout(() => channelList?.focusIndex(0), 0);
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
    if (id.indexOf('lcat-') === 0) {
      const c = focusedCategory();
      if (!c || VIRTUAL.includes(c.id)) return;
      result = await toggleLock('category', c.id);
    } else if (id.indexOf('lch-') === 0 && focused()) {
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
      setTimeout(() => channelList?.focusIndex(index), 0);
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
      void toggleFavorite(focused());
      return true;
    }
    if (press.key === 'red') {
      void toggleFocusedLock();
      return true;
    }
    return false;
  });

  const isRefreshing = () => !!(playlistId() && refreshing()[playlistId()!]);
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
                  <bdi>{categoryName(category())}</bdi>
                </span>
                <span class="pill pill-accent">{formatNumber(channels().length)}</span>
              </span>
              <span class="hint">{statusText(p(), isRefreshing())}</span>
            </div>
            <div class="panes">
              <FocusZone id="live-categories" remember>
                <CategoryRail
                  kind="live"
                  id="lcat"
                  label={t('tab.live')}
                  fixed={categoryItems().slice(0, VIRTUAL.length)}
                  categories={categoryItems().slice(VIRTUAL.length)}
                  selected={category()}
                  onFocusRow={(c) => setFocusedCategory(c)}
                  onOpen={(c) => void openCategory(c)}
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
                    empty={
                      <p class="hint pane-empty">
                        {loading() || isRefreshing()
                          ? t('live.loading')
                          : categoryHidden()
                            ? t('live.lockedCategory')
                            : category() === 'fav'
                              ? t('live.emptyFav')
                              : category() === 'recent'
                                ? t('live.emptyRecent')
                                : t('live.empty')}
                      </p>
                    }
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
                        <NowNextView data={focusedEpg()} />
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
                      </div>
                    )}
                  </Show>
                  <p class="hint keys-hint">{t('live.keysHint')}</p>
                </div>
              </FocusZone>
            </div>
          </>
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
