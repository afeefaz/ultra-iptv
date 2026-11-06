import { detectGroups, type ContentKind } from '@ultra/core';
import { createEffect, createMemo, createSignal, on, Show, type JSX } from 'solid-js';
import { rememberedSearch, rememberSearch } from '../data/libraryMemory';
import { activePlaylist } from '../data/playlists';
import { liveGroupPicker } from '../data/settings';
import { arrangeCategories, CATEGORY_SORTS, categorySort, makeMatcher, normalizeText, usePins } from '../data/categories';
import { focusManager } from '../focus';
import { formatNumber, locale, t } from '../i18n';
import { useKeys } from '../keys';
import { FocusButton } from './FocusButton';
import { Icon, type IconName } from './Icon';
import { PickerDialog } from './PickerDialog';
import { TextField } from './TextField';
import { VirtualList, type VirtualListApi } from './VirtualList';

export interface RailItem {
  id: string;
  name: string;
  count: number;
  locked: boolean;
  /** Fixed rows (Favourites, Recent, All…) carry an icon. */
  icon?: IconName;
}

export interface CategoryRailProps {
  kind: ContentKind;
  /** Focus id prefix for rows (`lcat`, `vcat`). */
  id: string;
  label: string;
  /** Favourites / Recent / All…: always on top, never sorted, pinned or filtered. */
  fixed: RailItem[];
  categories: RailItem[];
  selected: string;
  onFocusRow?: (item: RailItem) => void;
  onOpen: (item: RailItem) => void;
  ref?: (api: VirtualListApi) => void;
}

/**
 * Category column for Live, Movies and Series (spec §5): a search box for category names,
 * sort order, and pinned categories first. Green (F2) pins the focused row; the pin button
 * next to the item search pins the open category.
 */
export function CategoryRail(props: CategoryRailProps): JSX.Element {
  const railKey = () => `rail|${activePlaylist()?.id ?? ''}|${props.kind}`;
  const [query, setQuerySignal] = createSignal(rememberedSearch(railKey()));
  const setQuery = (q: string) => {
    setQuerySignal(q);
    rememberSearch(railKey(), q);
  };
  createEffect(on(railKey, (key) => setQuerySignal(rememberedSearch(key)), { defer: true }));
  const [sortOpen, setSortOpen] = createSignal(false);
  const [groupsOpen, setGroupsOpen] = createSignal(false);
  const [sort, setSort] = categorySort(props.kind);
  const { pins, toggle } = usePins(props.kind);
  let list: VirtualListApi | undefined;

  const items = createMemo<RailItem[]>(() => {
    const match = makeMatcher(query());
    const arranged = arrangeCategories(props.categories, sort(), pins(), locale());
    // While searching, only real categories are listed.
    return match ? arranged.filter((c) => match(normalizeText(c.name))) : props.fixed.concat(arranged);
  });
  const isPinned = (id: string) => pins().indexOf(id) >= 0;

  // Live only: its lists get long enough to need this, and it can be turned off in Settings.
  const groups = createMemo(() => (props.kind === 'live' && liveGroupPicker() ? (detectGroups(props.categories)?.groups ?? []) : []));

  const jumpToGroup = (key: string) => {
    setGroupsOpen(false);
    if (query()) setQuery('');
    setTimeout(() => {
      const group = groups().filter((g) => g.key === key)[0];
      // Below the pinned rows, which is where the rest of the group is.
      const index = group ? items().findIndex((c) => !isPinned(c.id) && group.items.some((g) => g.id === c.id)) : 0;
      list?.focusIndex(Math.max(0, index));
    }, 0);
  };
  const canPin = (id: string) => props.fixed.every((f) => f.id !== id);

  const focusedItem = (): RailItem | undefined => {
    const id = focusManager.currentId ?? '';
    if (id.indexOf(props.id + '-') !== 0) return undefined;
    return items()[Number(id.slice(props.id.length + 1))];
  };

  const togglePin = async (c: RailItem | undefined) => {
    if (!c || !canPin(c.id)) return;
    await toggle(c.id);
    // Keep focus on the same category after it moves (remote; touch pins with the pin button).
    if (focusManager.pointerMode) return;
    const index = items().findIndex((x) => x.id === c.id);
    if (index >= 0) setTimeout(() => list?.focusIndex(index), 0);
  };

  // Coming back to the screen: show the open category where it is in the list, not the top.
  let shownFor = '';
  createEffect(
    on([() => items().length, () => props.selected], ([count, selected]) => {
      const index = items().findIndex((c) => c.id === selected);
      if (index < 0 || shownFor === `${selected}|${count}`) return;
      const first = !shownFor;
      shownFor = `${selected}|${count}`;
      setTimeout(() => list?.scrollToIndex(index, first), 0);
    }),
  );

  useKeys((press) => {
    // Nothing is to the left of this column, so Left is free.
    if (press.key === 'left' && focusedItem() && groups().length) {
      setGroupsOpen(true);
      return true;
    }
    if (press.key !== 'green') return false;
    const c = focusedItem();
    if (!c) return false;
    void togglePin(c);
    return true;
  });

  return (
    <div class="pane pane-categories">
      <div class="pane-tools">
        <TextField id={`${props.id}-search`} compact label={t('search.categories')} value={query()} onChange={setQuery} />
        <Show when={groups().length}>
          <FocusButton id={`${props.id}-groups`} class="icon-button" label={t('categories.groups')} onSelect={() => setGroupsOpen(true)}>
            <Icon name="layers" />
          </FocusButton>
        </Show>
        <FocusButton id={`${props.id}-sort`} class="icon-button" label={t('categories.sortTitle')} onSelect={() => setSortOpen(true)}>
          <Icon name="sort" />
        </FocusButton>
      </div>
      <VirtualList
        id={props.id}
        label={props.label}
        items={items()}
        rowHeight={3}
        autofocusIndex={Math.max(0, items().findIndex((c) => c.id === props.selected))}
        ref={(api) => {
          list = api;
          props.ref?.(api);
        }}
        rowClass={(c) => (c.id === props.selected ? 'list-item is-selected' : 'list-item')}
        onFocusRow={(c) => props.onFocusRow?.(c)}
        onSelect={(c) => props.onOpen(c)}
        empty={<p class="hint pane-empty">{t('search.noCategories')}</p>}
        renderRow={(c) => (
          <>
            <Show when={c.icon}>{(name) => <Icon name={name()} />}</Show>
            <span class="list-label">
              <bdi>{c.name}</bdi>
            </span>
            <Show when={c.locked}>
              <span class="lock-icon" aria-label={t('live.lock')}>
                <Icon name="lock" />
              </span>
            </Show>
            <Show when={isPinned(c.id)}>
              <span class="pin-mark" aria-label={t('categories.pinned')}>
                <Icon name="pinFill" />
              </span>
            </Show>
            <span class="list-count">{formatNumber(c.count)}</span>
          </>
        )}
      />
      <Show when={sortOpen()}>
        <PickerDialog
          id={`${props.id}-sort-picker`}
          title={t('categories.sortTitle')}
          options={CATEGORY_SORTS.map((s) => ({ id: s, label: t(`categories.sort.${s}`) }))}
          selected={sort()}
          onCancel={() => setSortOpen(false)}
          onPick={(id) => {
            setSortOpen(false);
            setSort(id as typeof CATEGORY_SORTS[number]);
          }}
        />
      </Show>
      <Show when={groupsOpen()}>
        <PickerDialog
          id={`${props.id}-group-picker`}
          title={t('categories.groups')}
          options={[{ id: '', label: t('categories.groupsAll') }].concat(groups().map((g) => ({ id: g.key, label: g.label, detail: t('categories.groupCount', { n: formatNumber(g.items.length) }) })))}
          onCancel={() => setGroupsOpen(false)}
          onPick={jumpToGroup}
        />
      </Show>
    </div>
  );
}
