import { pickNext, pickWrap, type Candidate, type Direction } from './geometry';
import { ensureVisible } from './scroll';

export interface FocusableSpec {
  id: string;
  zone: string;
  el: HTMLElement;
  onSelect?: () => void;
  onFocus?: () => void;
  autofocus?: boolean;
}

export interface ZoneSpec {
  id: string;
  parent?: string;
  /** Re-entering the zone returns to its last focused item. */
  remember?: boolean;
  /** Moving past the last item jumps to the first (and back). */
  wrap?: boolean;
  /** Modal: focus can't leave the zone while it's mounted. */
  trap?: boolean;
}

export const FOCUSED_CLASS = 'is-focused';
/** Zone wrapping the current screen's content; default focus target after navigation. */
export const CONTENT_ZONE = 'content';

/**
 * The single spatial-navigation module used on every platform (spec §5).
 * Framework-free; `solid.tsx` binds it to components.
 */
export class FocusManager {
  private readonly items = new Map<string, FocusableSpec>();
  private readonly zones = new Map<string, ZoneSpec>();
  private readonly lastInZone = new Map<string, string>();
  private readonly traps: string[] = [];
  private readonly listeners = new Set<(id: string | null) => void>();
  private current: string | null = null;
  /** Item whose onFocus last ran; pointer hover highlights without running it. */
  private notified: string | null = null;
  private ensureTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while focus is an automatic fallback choice rather than the user's or the app's. */
  private weakFocus = false;
  private reclaim = false;
  pointerMode = false;

  get currentId(): string | null {
    return this.current;
  }

  onChange(fn: (id: string | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  registerZone(zone: ZoneSpec): () => void {
    this.zones.set(zone.id, zone);
    // A modal remembers what had focus so closing it puts focus back there.
    const restoreId = zone.trap ? this.current : null;
    if (zone.trap) {
      this.traps.push(zone.id);
      this.ensureFocusSoon();
    }
    return () => {
      if (this.zones.get(zone.id) === zone) this.zones.delete(zone.id);
      const i = this.traps.lastIndexOf(zone.id);
      if (i >= 0) this.traps.splice(i, 1);
      if (restoreId && this.items.has(restoreId) && this.focus(restoreId)) return;
      this.ensureFocusSoon();
    };
  }

  register(spec: FocusableSpec): () => void {
    this.items.set(spec.id, spec);
    spec.el.tabIndex = -1;
    // Hover only highlights: with a mouse, "focus opens the category" would act like a click.
    // onFocus runs when the item is clicked or reached with the keys.
    const onEnter = () => {
      if (this.pointerMode) this.focus(spec.id, false, false);
    };
    const onClick = () => {
      this.focus(spec.id, false);
      spec.onSelect?.();
    };
    spec.el.addEventListener('mouseenter', onEnter);
    spec.el.addEventListener('click', onClick);
    // Content that loads late (async data) may claim focus, but only from an automatic choice.
    this.ensureFocusSoon(!!spec.autofocus && this.weakFocus);
    return () => {
      spec.el.removeEventListener('mouseenter', onEnter);
      spec.el.removeEventListener('click', onClick);
      if (this.items.get(spec.id) !== spec) return;
      this.items.delete(spec.id);
      if (this.notified === spec.id) this.notified = null;
      if (this.current === spec.id) {
        this.current = null;
        this.ensureFocusSoon();
      }
    };
  }

  focus(id: string, scroll = true, notify = true): boolean {
    const next = this.items.get(id);
    if (!next) return false;
    this.weakFocus = false;
    const prev = this.current ? this.items.get(this.current) : undefined;
    if (prev && prev !== next) prev.el.classList.remove(FOCUSED_CLASS);
    this.current = id;
    next.el.classList.add(FOCUSED_CLASS);
    try {
      next.el.focus({ preventScroll: true });
    } catch {
      next.el.focus();
    }
    if (scroll) ensureVisible(next.el);
    for (let zone: string | undefined = next.zone; zone; zone = this.zones.get(zone)?.parent) {
      this.lastInZone.set(zone, id);
    }
    if (notify && this.notified !== id) {
      this.notified = id;
      next.onFocus?.();
    }
    this.listeners.forEach((fn) => fn(id));
    return true;
  }

  move(dir: Direction): boolean {
    this.pointerMode = false;
    const pool = this.eligible().filter((i) => isVisible(i.el));
    const cur = this.current ? this.items.get(this.current) : undefined;
    if (!cur || pool.indexOf(cur) < 0) return this.focusFallback(pool);

    const from = rectOf(cur.el);
    const others = pool.filter((i) => i !== cur);
    const sameZone = others.filter((i) => i.zone === cur.zone).map(toCandidate);
    let next = pickNext(from, sameZone, dir);
    if (!next && this.zones.get(cur.zone)?.wrap) {
      // Only wrap along the list's own axis (same column for up/down, same row for left/right),
      // so pressing Right at the end of a vertical list still leaves the list.
      const opposite = sameZone.filter((c) => inBeam(from, c.rect, dir) && !isAhead(from, c.rect, dir));
      next = pickWrap(from, opposite, dir);
    }
    // Something straight across in another zone (the next pane) beats a diagonal jump inside
    // this one (e.g. Right from a category row goes to the channels, not the sort button above).
    if (!next || !inBeam(from, rectOf(next.el), dir)) {
      const target = pickNext(from, others.filter((i) => i.zone !== cur.zone).map(toCandidate), dir);
      if (target && (!next || inBeam(from, rectOf(target.el), dir))) next = this.remembered(target.zone, pool) ?? target;
    }
    return next ? this.focus(next.id) : false;
  }

  select(): boolean {
    const cur = this.current ? this.items.get(this.current) : undefined;
    if (!cur?.onSelect) return false;
    cur.onSelect();
    return true;
  }

  isInZone(id: string, zoneId: string): boolean {
    const item = this.items.get(id);
    return !!item && this.inZone(item, zoneId);
  }

  /** Focus the remembered or first item of a zone (e.g. after switching screens). */
  focusZone(zoneId: string): boolean {
    const pool = this.eligible().filter((i) => this.inZone(i, zoneId) && isVisible(i.el));
    const target = this.remembered(zoneId, pool) ?? pool.filter((i) => i.autofocus)[0] ?? firstInReadingOrder(pool);
    return target ? this.focus(target.id) : false;
  }

  /**
   * After mounts/unmounts, make sure something sensible has focus. `reclaim` lets a newly
   * mounted autofocus item replace focus that was chosen automatically (never one the user chose).
   */
  private ensureFocusSoon(reclaim = false): void {
    if (reclaim) this.reclaim = true;
    if (this.ensureTimer) return;
    this.ensureTimer = setTimeout(() => {
      this.ensureTimer = null;
      const reclaimNow = this.reclaim && this.weakFocus;
      this.reclaim = false;
      const pool = this.eligible().filter((i) => isVisible(i.el));
      const cur = this.current ? this.items.get(this.current) : undefined;
      if (cur && pool.indexOf(cur) >= 0 && !reclaimNow) return;
      this.focusFallback(pool);
    }, 0);
  }

  /** Prefers an `autofocus` item, then the screen content, then anything. Marked as weak focus. */
  private focusFallback(pool: FocusableSpec[]): boolean {
    const auto = pool.filter((i) => i.autofocus);
    const content = pool.filter((i) => this.inZone(i, CONTENT_ZONE));
    const target = auto[auto.length - 1] ?? firstInReadingOrder(content) ?? firstInReadingOrder(pool);
    if (!target || !this.focus(target.id)) return false;
    this.weakFocus = true;
    return true;
  }

  private eligible(): FocusableSpec[] {
    const all = Array.from(this.items.values());
    const trap = this.traps[this.traps.length - 1];
    return trap ? all.filter((i) => this.inZone(i, trap)) : all;
  }

  private inZone(item: FocusableSpec, zoneId: string): boolean {
    for (let z: string | undefined = item.zone; z; z = this.zones.get(z)?.parent) if (z === zoneId) return true;
    return false;
  }

  private remembered(zoneId: string, pool: FocusableSpec[]): FocusableSpec | undefined {
    if (!this.zones.get(zoneId)?.remember) return undefined;
    const id = this.lastInZone.get(zoneId);
    const item = id ? this.items.get(id) : undefined;
    return item && pool.indexOf(item) >= 0 ? item : undefined;
  }
}

function rectOf(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function toCandidate(item: FocusableSpec): Candidate<FocusableSpec> {
  return { item, rect: rectOf(item.el) };
}

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function isAhead(from: { left: number; top: number; right: number; bottom: number }, r: typeof from, dir: Direction): boolean {
  if (dir === 'down') return r.top >= from.bottom - 0.5;
  if (dir === 'up') return r.bottom <= from.top + 0.5;
  if (dir === 'right') return r.left >= from.right - 0.5;
  return r.right <= from.left + 0.5;
}

function inBeam(from: { left: number; top: number; right: number; bottom: number }, r: typeof from, dir: Direction): boolean {
  return dir === 'up' || dir === 'down'
    ? r.left < from.right && r.right > from.left
    : r.top < from.bottom && r.bottom > from.top;
}

function firstInReadingOrder(pool: FocusableSpec[]): FocusableSpec | undefined {
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  let best: FocusableSpec | undefined;
  let bestKey = Infinity;
  for (const item of pool) {
    const r = item.el.getBoundingClientRect();
    const key = Math.round(r.top) * 1e5 + (rtl ? -r.right : r.left);
    if (key < bestKey) {
      bestKey = key;
      best = item;
    }
  }
  return best;
}
