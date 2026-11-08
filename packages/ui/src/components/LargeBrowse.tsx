import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { fitText, type CellSize } from '../data/largeFit';
import { largeLayout, posterColumns } from '../data/settings';
import { t } from '../i18n';
import { FocusButton } from './FocusButton';
import { Icon, type IconName } from './Icon';
import { TextField } from './TextField';
import { VirtualGrid, type VirtualGridApi } from './VirtualGrid';

export interface LargeCategory {
  id: string;
  name: string;
  count: number;
  locked: boolean;
  icon?: IconName;
}

export interface LargeBrowseApi {
  focus(index: number): void;
}

export interface LargeBrowseProps<T> {
  step: 'categories' | 'items';
  /** Focus id prefixes: the standard layout's (`lcat`/`lch`, `vcat`/`vgrid`), so the colour keys find them. */
  categoryId: string;
  itemId: string;
  label: string;
  categories: LargeCategory[];
  /** The open category, marked among the others. */
  current: string;
  pinned: (id: string) => boolean;
  countLabel: (n: number) => string;
  items: T[];
  /** Boxes (channels) fill the screen by the chosen count; posters are sized by how many fit across. */
  itemShape: 'box' | 'poster';
  renderItem: (item: T, size: CellSize) => JSX.Element;
  /** Box or poster the step opens on. */
  startIndex: number;
  empty: JSX.Element;
  /** Search, Back, sort and pin: above the boxes, and different for each step. */
  tools: JSX.Element;
  /** The colour keys as buttons, for a finger or a remote without them. */
  legend: JSX.Element;
  onOpenCategory: (c: LargeCategory) => void;
  onFocusCategory: (c: LargeCategory) => void;
  onSelectItem: (item: T, index: number) => void;
  onFocusItem: (item: T, index: number) => void;
  ref?: (api: LargeBrowseApi) => void;
}

/**
 * Live TV, Movies and Series for reading from across the room (Settings → Appearance): the
 * categories full screen, then the contents of one, sized so a chosen number fits the screen.
 */
export function LargeBrowse<T>(props: LargeBrowseProps<T>): JSX.Element {
  let area: HTMLDivElement | undefined;
  // The space available, in rem: the boxes fill it, and the text-size setting still applies.
  const [areaRem, setAreaRem] = createSignal(0);
  const [areaWide, setAreaWide] = createSignal(0);
  onMount(() => {
    const measure = () => {
      if (!area) return;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize || '16');
      setAreaRem(Math.floor((area.clientHeight / rem) * 10) / 10);
      setAreaWide(Math.floor((area.clientWidth / rem) * 10) / 10);
    };
    measure();
    window.addEventListener('resize', measure);
    onCleanup(() => window.removeEventListener('resize', measure));
  });

  let grid: VirtualGridApi | undefined;
  props.ref?.({ focus: (index) => grid?.focusIndex(index) });

  const geometry = () => {
    const wide = areaWide();
    const high = areaRem();
    if (props.step === 'items' && props.itemShape === 'poster') {
      const columns = posterColumns();
      const width = wide / columns;
      // A 2:3 cover with its title under it, but never taller than the screen.
      return { columns, width, height: Math.min(high, (width - 1) * 1.5 + 5) };
    }
    const { columns, rows } = largeLayout();
    return { columns, width: wide / columns, height: high / rows };
  };
  // Remounted when the shape or the space changes: the grid measures its rows once.
  const shape = () => {
    if (areaRem() <= 0 || areaWide() <= 0) return '';
    const g = geometry();
    return `${props.step}|${g.columns}|${g.width.toFixed(1)}|${g.height.toFixed(1)}`;
  };

  function body(): JSX.Element {
    const g = geometry();
    const size: CellSize = { width: g.width, height: g.height };
    return props.step === 'categories' ? (
      <VirtualGrid
        id={props.categoryId}
        label={props.label}
        items={props.categories}
        columns={g.columns}
        rowHeight={g.height}
        autofocusIndex={props.startIndex}
        leaveDown
        ref={(api) => (grid = api)}
        empty={<p class="hint pane-empty">{t('search.noCategories')}</p>}
        onFocusItem={(c) => props.onFocusCategory(c)}
        onSelect={(c) => props.onOpenCategory(c)}
        renderItem={(c) => (
          <CategoryBox category={c} current={c.id === props.current} pinned={props.pinned(c.id)} size={size} countLabel={props.countLabel} />
        )}
      />
    ) : (
      <VirtualGrid
        id={props.itemId}
        label={props.label}
        items={props.items}
        columns={g.columns}
        rowHeight={g.height}
        autofocusIndex={props.startIndex}
        leaveDown
        ref={(api) => (grid = api)}
        empty={props.empty}
        onFocusItem={(item, index) => props.onFocusItem(item, index)}
        onSelect={(item, index) => props.onSelectItem(item, index)}
        renderItem={(item) => props.renderItem(item, size)}
      />
    );
  }

  return (
    <div class="live-large">
      {props.tools}
      <div class="live-large-area" ref={(el) => (area = el)}>
        <Show when={shape()} keyed>
          {(key) => key && body()}
        </Show>
      </div>
      {props.legend}
    </div>
  );
}

/** Search, with Back, sort and pin beside it. Smaller than the standard layout's, which fills the row. */
export function LargeTools(props: {
  /** Focus id of the search box; the buttons are named after it. */
  id: string;
  query: string;
  onQuery: (q: string) => void;
  label: string;
  onBack?: () => void;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <div class="pane-tools live-large-tools">
      <Show when={props.onBack}>
        <FocusButton id={`${props.id}-back`} class="back-chip" onSelect={() => props.onBack?.()}>
          <Icon name="back" />
          <span>{t('common.back')}</span>
        </FocusButton>
      </Show>
      <TextField id={props.id} compact label={props.label} value={props.query} onChange={props.onQuery} />
      {props.children}
    </div>
  );
}

export interface LegendKey {
  id: string;
  /** The remote's colour key; none for an action that only has a button. */
  color?: 'blue' | 'green' | 'yellow' | 'red';
  icon?: IconName;
  label: string;
  onPress: () => void;
}

/** The remote's colour keys, drawn as buttons that do the same on a touch screen. */
export function LargeLegend(props: { keys: LegendKey[] }): JSX.Element {
  return (
    <div class="large-legend">
      <For each={props.keys}>
        {(k) => (
          <FocusButton id={k.id} class={`legend-chip legend-${k.color ?? 'none'}`} onSelect={k.onPress}>
            <Show when={k.icon} fallback={<span class="legend-dot" />}>
              {(name) => <Icon name={name()} />}
            </Show>
            <span>{k.label}</span>
          </FocusButton>
        )}
      </For>
    </div>
  );
}

export function Marks(props: { locked: boolean; pinned?: boolean; favorite?: boolean }): JSX.Element {
  return (
    <>
      <Show when={props.favorite}>
        <span class="fav-star">
          <Icon name="starFill" />
        </span>
      </Show>
      <Show when={props.pinned}>
        <span class="pin-mark" aria-label={t('categories.pinned')}>
          <Icon name="pinFill" />
        </span>
      </Show>
      <Show when={props.locked}>
        <span class="lock-icon" aria-label={t('live.lock')}>
          <Icon name="lock" />
        </span>
      </Show>
    </>
  );
}

function CategoryBox(props: {
  category: LargeCategory;
  current: boolean;
  pinned: boolean;
  size: CellSize;
  countLabel: (n: number) => string;
}): JSX.Element {
  return (
    <div class="large-box" classList={{ 'is-current': props.current }}>
      <Show when={props.category.icon}>{(name) => <Icon name={name()} />}</Show>
      <span class="large-box-name" style={{ 'font-size': fitText(props.category.name, 2.2, props.size, 0.16) }}>
        <bdi>{props.category.name}</bdi>
      </span>
      <span class="large-box-sub" style={{ 'font-size': `${Math.min(1.5, props.size.height * 0.1).toFixed(2)}rem` }}>
        {props.countLabel(props.category.count)}
        <Marks locked={props.category.locked} pinned={props.pinned} />
      </span>
    </div>
  );
}

export { fitText, type CellSize };
