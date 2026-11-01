import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { focusManager, useFocusable } from '../focus';
import { useKeys } from '../keys';

export interface VirtualListApi {
  focusIndex(index: number): void;
  scrollToIndex(index: number): void;
  focusedIndex(): number | null;
}

export interface VirtualListProps<T> {
  /** Focus id prefix; rows are `${id}-${index}`. */
  id: string;
  items: T[];
  /** Row height in rem (fixed, so 50k rows cost nothing to lay out). */
  rowHeight: number;
  overscan?: number;
  wrap?: boolean;
  /** Row that takes focus when the list appears (if nothing the user chose has focus). */
  autofocusIndex?: number;
  renderRow: (item: T, index: number) => JSX.Element;
  rowClass?: (item: T, index: number) => string;
  onSelect?: (item: T, index: number) => void;
  onFocusRow?: (item: T, index: number) => void;
  ref?: (api: VirtualListApi) => void;
  empty?: JSX.Element;
  label?: string;
}

const remToPx = (rem: number) => rem * parseFloat(getComputedStyle(document.documentElement).fontSize || '16');

/**
 * Windowed list (spec §5): only visible rows plus `overscan` exist in the DOM. Up/Down between
 * rendered rows goes through the normal focus geometry; wrap-around and CH+/CH− paging jump
 * by index here, since the target row may not be rendered yet.
 */
export function VirtualList<T>(props: VirtualListProps<T>): JSX.Element {
  let scroller: HTMLDivElement | undefined;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewport, setViewport] = createSignal(600);
  const [rowPx, setRowPx] = createSignal(remToPx(props.rowHeight));
  const overscan = () => props.overscan ?? 8;

  const indices = createMemo(() => {
    const h = rowPx();
    const n = props.items.length;
    const first = Math.max(0, Math.floor(scrollTop() / h) - overscan());
    const last = Math.min(n - 1, Math.ceil((scrollTop() + viewport()) / h) + overscan());
    const out: number[] = [];
    for (let i = first; i <= last; i++) out.push(i);
    return out;
  });

  const rowId = (index: number) => `${props.id}-${index}`;
  const indexOf = (id: string | null): number | null => {
    if (!id || id.indexOf(props.id + '-') !== 0) return null;
    const n = Number(id.slice(props.id.length + 1));
    return isFinite(n) ? n : null;
  };

  const api: VirtualListApi = {
    scrollToIndex(index) {
      if (!scroller) return;
      const h = rowPx();
      const top = index * h;
      if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (top + h > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + h - scroller.clientHeight;
      setScrollTop(scroller.scrollTop);
    },
    focusIndex(index) {
      const n = props.items.length;
      if (n === 0) return;
      const i = Math.max(0, Math.min(n - 1, index));
      api.scrollToIndex(i);
      // Rows mount synchronously after the scroll update; retry once if not registered yet.
      if (!focusManager.focus(rowId(i))) setTimeout(() => focusManager.focus(rowId(i)), 0);
    },
    focusedIndex: () => indexOf(focusManager.currentId),
  };

  // Up/Down move by index rather than by on-screen geometry, so fast key repeat on a slow TV
  // can never outrun rendering. Left/Right fall through to the focus geometry (other panes).
  useKeys((press) => {
    const idx = indexOf(focusManager.currentId);
    if (idx === null) return false;
    const n = props.items.length;
    const page = Math.max(1, Math.floor(viewport() / rowPx()) - 1);
    if (press.key === 'down') {
      if (idx < n - 1) api.focusIndex(idx + 1);
      else if (props.wrap && n > 1) api.focusIndex(0);
      else return false; // let focus leave the list downwards
    } else if (press.key === 'up') {
      if (idx > 0) api.focusIndex(idx - 1);
      else if (props.wrap && n > 1) api.focusIndex(n - 1);
      else return false;
    } else if (press.key === 'chDown') api.focusIndex(idx + page);
    else if (press.key === 'chUp') api.focusIndex(idx - page);
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
    <div
      class="vlist"
      ref={(el) => (scroller = el)}
      role="listbox"
      aria-label={props.label}
      onScroll={() => scroller && setScrollTop(scroller.scrollTop)}
    >
      <Show when={props.items.length > 0} fallback={props.empty}>
        <div class="vlist-inner" style={{ height: `${props.items.length * rowPx()}px` }}>
          <For each={indices()}>
            {(index) => (
              <Row
                index={index}
                id={rowId(index)}
                top={index * rowPx()}
                height={rowPx()}
                item={() => props.items[index]}
                list={props}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function Row<T>(p: { index: number; id: string; top: number; height: number; item: () => T; list: VirtualListProps<T> }): JSX.Element {
  const ref = useFocusable({
    id: p.id,
    autofocus: p.index === p.list.autofocusIndex,
    onSelect: () => {
      const item = p.item();
      if (item !== undefined) p.list.onSelect?.(item, p.index);
    },
    onFocus: () => {
      const item = p.item();
      if (item !== undefined) p.list.onFocusRow?.(item, p.index);
    },
  });
  // classList (not a reactive `class`) so the focus manager's is-focused class is never wiped.
  const extraClasses = () => {
    const out: Record<string, boolean> = {};
    const item = p.item();
    if (item !== undefined && p.list.rowClass) for (const c of p.list.rowClass(item, p.index).split(' ')) if (c) out[c] = true;
    return out;
  };
  return (
    <div
      ref={ref}
      role="option"
      class="btn vrow"
      classList={extraClasses()}
      style={{ top: `${p.top}px`, height: `${p.height}px` }}
    >
      <Show when={p.item() !== undefined}>{p.list.renderRow(p.item(), p.index)}</Show>
    </div>
  );
}
