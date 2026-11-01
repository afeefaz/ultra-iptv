import { createMemo, createSignal, For, Index, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { focusManager, useFocusable } from '../focus';
import { useKeys } from '../keys';

export interface VirtualGridApi {
  focusIndex(index: number): void;
  scrollToIndex(index: number): void;
}

export interface VirtualGridProps<T> {
  /** Focus id prefix; cells are `${id}-${index}`. */
  id: string;
  items: T[];
  columns: number;
  /** Row height in rem (fixed, like VirtualList). */
  rowHeight: number;
  overscan?: number;
  renderItem: (item: T, index: number) => JSX.Element;
  onSelect?: (item: T, index: number) => void;
  onFocusItem?: (item: T, index: number) => void;
  ref?: (api: VirtualGridApi) => void;
  empty?: JSX.Element;
  label?: string;
}

const remToPx = (rem: number) => rem * parseFloat(getComputedStyle(document.documentElement).fontSize || '16');

/**
 * Poster grid windowed by rows (spec §5: 20k movies must scroll smoothly). Up/Down and paging
 * move by index like VirtualList; Left/Right use the focus geometry, so RTL mirroring and
 * leaving the grid for the category rail need no special cases.
 */
export function VirtualGrid<T>(props: VirtualGridProps<T>): JSX.Element {
  let scroller: HTMLDivElement | undefined;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewport, setViewport] = createSignal(600);
  const [rowPx, setRowPx] = createSignal(remToPx(props.rowHeight));
  const rowCount = () => Math.ceil(props.items.length / props.columns);

  const rows = createMemo(() => {
    const h = rowPx();
    const over = props.overscan ?? 2;
    const first = Math.max(0, Math.floor(scrollTop() / h) - over);
    const last = Math.min(rowCount() - 1, Math.ceil((scrollTop() + viewport()) / h) + over);
    const out: number[] = [];
    for (let r = first; r <= last; r++) out.push(r);
    return out;
  });

  const cellId = (index: number) => `${props.id}-${index}`;
  const indexOf = (id: string | null): number | null => {
    if (!id || id.indexOf(props.id + '-') !== 0) return null;
    const n = Number(id.slice(props.id.length + 1));
    return isFinite(n) ? n : null;
  };

  const api: VirtualGridApi = {
    scrollToIndex(index) {
      if (!scroller) return;
      const h = rowPx();
      const top = Math.floor(index / props.columns) * h;
      if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (top + h > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + h - scroller.clientHeight;
      setScrollTop(scroller.scrollTop);
    },
    focusIndex(index) {
      const n = props.items.length;
      if (n === 0) return;
      const i = Math.max(0, Math.min(n - 1, index));
      api.scrollToIndex(i);
      if (!focusManager.focus(cellId(i))) setTimeout(() => focusManager.focus(cellId(i)), 0);
    },
  };

  useKeys((press) => {
    const idx = indexOf(focusManager.currentId);
    if (idx === null) return false;
    const n = props.items.length;
    const cols = props.columns;
    const row = Math.floor(idx / cols);
    const page = Math.max(1, Math.floor(viewport() / rowPx()) - 1) * cols;
    if (press.key === 'down') {
      if (row >= rowCount() - 1) return false;
      api.focusIndex(Math.min(n - 1, idx + cols)); // short last row: land on its last item
    } else if (press.key === 'up') {
      if (row === 0) return false; // leave upwards (sort button)
      api.focusIndex(idx - cols);
    } else if (press.key === 'chDown') api.focusIndex(Math.min(n - 1, idx + page));
    else if (press.key === 'chUp') api.focusIndex(Math.max(idx % cols, idx - page));
    else return false;
    return true;
  });

  onMount(() => {
    const measure = () => {
      if (!scroller) return;
      setRowPx(remToPx(props.rowHeight));
      setViewport(scroller.clientHeight || 600);
    };
    measure();
    window.addEventListener('resize', measure);
    onCleanup(() => window.removeEventListener('resize', measure));
    props.ref?.(api);
  });

  return (
    <div class="vlist vgrid" ref={(el) => (scroller = el)} role="grid" aria-label={props.label} onScroll={() => scroller && setScrollTop(scroller.scrollTop)}>
      <Show when={props.items.length > 0} fallback={props.empty}>
        <div class="vlist-inner" style={{ height: `${rowCount() * rowPx()}px` }}>
          <For each={rows()}>
            {(r) => (
              <div class="vgrid-row" role="row" style={{ top: `${r * rowPx()}px`, height: `${rowPx()}px` }}>
                <Index each={cellsOf(r, props.columns, props.items.length)}>
                  {(index) => <Cell index={index()} id={cellId(index())} item={() => props.items[index()]} grid={props} />}
                </Index>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function cellsOf(row: number, cols: number, n: number): number[] {
  const out: number[] = [];
  for (let i = row * cols; i < Math.min(n, (row + 1) * cols); i++) out.push(i);
  return out;
}

function Cell<T>(p: { index: number; id: string; item: () => T; grid: VirtualGridProps<T> }): JSX.Element {
  const ref = useFocusable({
    id: p.id,
    onSelect: () => {
      const item = p.item();
      if (item !== undefined) p.grid.onSelect?.(item, p.index);
    },
    onFocus: () => {
      const item = p.item();
      if (item !== undefined) p.grid.onFocusItem?.(item, p.index);
    },
  });
  return (
    <div ref={ref} role="gridcell" class="btn vgrid-cell" style={{ width: `${100 / p.grid.columns}%` }}>
      <Show when={p.item() !== undefined}>{p.grid.renderItem(p.item(), p.index)}</Show>
    </div>
  );
}
