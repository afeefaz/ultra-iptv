import type { ContentKind } from '@ultra/core';
import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import { arrangeCategories, CATEGORY_SORTS, categorySort, makeMatcher, normalizeText, usePins } from '../data/categories';
import { focusManager } from '../focus';
import { formatNumber, locale, t } from '../i18n';
import { useKeys } from '../keys';
import { FocusButton } from './FocusButton';
import { PickerDialog } from './PickerDialog';
import { TextField } from './TextField';
import { VirtualList, type VirtualListApi } from './VirtualList';

export interface RailItem {
  id: string;
  name: string;
  count: number;
  locked: boolean;
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
 * sort order, and pinned categories first. Green (F2) or the pin icon pins the focused row.
 */
export function CategoryRail(props: CategoryRailProps): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [sortOpen, setSortOpen] = createSignal(false);
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
  const canPin = (id: string) => props.fixed.every((f) => f.id !== id);

  const focusedItem = (): RailItem | undefined => {
    const id = focusManager.currentId ?? '';
    if (id.indexOf(props.id + '-') !== 0) return undefined;
    return items()[Number(id.slice(props.id.length + 1))];
  };

  const togglePin = async (c: RailItem | undefined) => {
    if (!c || !canPin(c.id)) return;
    await toggle(c.id);
    // Remote: keep focus on the same category after it moves. Mouse: leave focus alone,
    // since focusing a category also opens it.
    if (focusManager.pointerMode) return;
    const index = items().findIndex((x) => x.id === c.id);
    if (index >= 0) setTimeout(() => list?.focusIndex(index), 0);
  };

  useKeys((press) => {
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
        <FocusButton id={`${props.id}-sort`} class="icon-button" label={t('categories.sortTitle')} onSelect={() => setSortOpen(true)}>
          ⇅
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
            <span class="list-label">
              <bdi>{c.name}</bdi>
            </span>
            <Show when={c.locked}>
              <span class="lock-icon" aria-label={t('live.lock')}>
                🔒
              </span>
            </Show>
            <Show when={canPin(c.id)}>
              <span
                class="pin-toggle"
                classList={{ pinned: isPinned(c.id) }}
                role="button"
                title={isPinned(c.id) ? t('categories.unpin') : t('categories.pin')}
                aria-label={isPinned(c.id) ? t('categories.unpin') : t('categories.pin')}
                // Native listener, so it runs before the row's click (which opens the category).
                on:click={(e) => {
                  e.stopPropagation();
                  void togglePin(c);
                }}
              >
                📌
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
    </div>
  );
}
