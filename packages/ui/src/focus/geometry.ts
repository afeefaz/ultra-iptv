export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Candidate<T> {
  item: T;
  rect: Rect;
}

const OUT_OF_BEAM = 1e6;

const cx = (r: Rect) => (r.left + r.right) / 2;
const cy = (r: Rect) => (r.top + r.bottom) / 2;

/** Gap between two ranges on one axis; 0 when they overlap. */
function rangeGap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.max(a1, b1) - Math.min(a2, b2));
}

/**
 * Picks the nearest candidate in a direction. Works on screen rectangles, so in RTL
 * layouts "left" still means visually left, which is what a remote user expects.
 */
export function pickNext<T>(from: Rect, candidates: Candidate<T>[], dir: Direction): T | undefined {
  let best: T | undefined;
  let bestScore = Infinity;
  for (const { item, rect } of candidates) {
    let ahead: boolean;
    let primary: number;
    let gap: number;
    let offset: number;
    switch (dir) {
      case 'right':
        ahead = cx(rect) > cx(from) + 0.5 && rect.right > from.right - 0.5;
        primary = Math.max(0, rect.left - from.right);
        gap = rangeGap(from.top, from.bottom, rect.top, rect.bottom);
        offset = Math.abs(cy(rect) - cy(from));
        break;
      case 'left':
        ahead = cx(rect) < cx(from) - 0.5 && rect.left < from.left + 0.5;
        primary = Math.max(0, from.left - rect.right);
        gap = rangeGap(from.top, from.bottom, rect.top, rect.bottom);
        offset = Math.abs(cy(rect) - cy(from));
        break;
      case 'down':
        ahead = cy(rect) > cy(from) + 0.5 && rect.bottom > from.bottom - 0.5;
        primary = Math.max(0, rect.top - from.bottom);
        gap = rangeGap(from.left, from.right, rect.left, rect.right);
        offset = Math.abs(cx(rect) - cx(from));
        break;
      case 'up':
        ahead = cy(rect) < cy(from) - 0.5 && rect.top < from.top + 0.5;
        primary = Math.max(0, from.top - rect.bottom);
        gap = rangeGap(from.left, from.right, rect.left, rect.right);
        offset = Math.abs(cx(rect) - cx(from));
        break;
    }
    if (!ahead) continue;
    // Items overlapping the current row/column ("in the beam") always beat diagonal ones,
    // like Android's focus finder. Diagonal ones use its weighting (13·major² + minor²), so the
    // nearest row/column wins even when a further one is better aligned.
    const score = gap > 0 ? OUT_OF_BEAM + 13 * primary * primary + gap * gap : primary + offset * 0.1;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

/** Wrap-around target: the item furthest in the opposite direction, in the same row/column. */
export function pickWrap<T>(from: Rect, candidates: Candidate<T>[], dir: Direction): T | undefined {
  let best: T | undefined;
  let bestScore = Infinity;
  for (const { item, rect } of candidates) {
    const vertical = dir === 'up' || dir === 'down';
    const offset = vertical ? Math.abs(cx(rect) - cx(from)) : Math.abs(cy(rect) - cy(from));
    const position =
      dir === 'down' ? rect.top : dir === 'up' ? -rect.bottom : dir === 'right' ? rect.left : -rect.right;
    const score = offset * 1e6 + position;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}
