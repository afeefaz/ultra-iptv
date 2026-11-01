import { describe, expect, it } from 'vitest';
import { pickNext, pickWrap, type Candidate, type Rect } from './geometry';

const box = (x: number, y: number, w = 100, h = 50): Rect => ({ left: x, top: y, right: x + w, bottom: y + h });

// 3x3 grid, 100x50 cells with 10px spacing; ids "r,c".
const grid: Candidate<string>[] = [];
for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) grid.push({ item: `${r},${c}`, rect: box(c * 110, r * 60) });
const at = (id: string) => grid.filter((g) => g.item === id)[0].rect;
const others = (id: string) => grid.filter((g) => g.item !== id);

describe('pickNext', () => {
  it('moves within a grid', () => {
    expect(pickNext(at('1,1'), others('1,1'), 'right')).toBe('1,2');
    expect(pickNext(at('1,1'), others('1,1'), 'left')).toBe('1,0');
    expect(pickNext(at('1,1'), others('1,1'), 'up')).toBe('0,1');
    expect(pickNext(at('1,1'), others('1,1'), 'down')).toBe('2,1');
  });

  it('returns nothing at the edge', () => {
    expect(pickNext(at('0,2'), others('0,2'), 'right')).toBeUndefined();
    expect(pickNext(at('2,0'), others('2,0'), 'down')).toBeUndefined();
  });

  it('prefers an aligned item over a closer diagonal one', () => {
    const from = box(0, 0);
    const cands = [
      { item: 'diagonal', rect: box(120, 70) },
      { item: 'aligned-far', rect: box(400, 0) },
    ];
    expect(pickNext(from, cands, 'right')).toBe('aligned-far');
  });

  it('moves from a list into a neighbouring pane', () => {
    const listItem = box(0, 300, 300, 60);
    const pane = [
      { item: 'top-of-pane', rect: box(320, 0, 600, 60) },
      { item: 'middle-of-pane', rect: box(320, 290, 600, 60) },
    ];
    expect(pickNext(listItem, pane, 'right')).toBe('middle-of-pane');
  });
});

describe('pickWrap', () => {
  it('wraps to the other end of the same column', () => {
    const column = others('2,1').filter((g) => g.item !== '2,1');
    expect(pickWrap(at('2,1'), column, 'down')).toBe('0,1');
    expect(pickWrap(at('0,1'), others('0,1'), 'up')).toBe('2,1');
  });
});

describe('pickNext across rows', () => {
  it('prefers the nearest row over a further, better aligned one', () => {
    const from = { left: 1228, top: 80, right: 1350, bottom: 112 };
    const nearRow = { left: 20, top: 228, right: 170, bottom: 456 };
    const farRow = { left: 310, top: 500, right: 436, bottom: 620 };
    expect(pickNext(from, [{ item: 'far', rect: farRow }, { item: 'near', rect: nearRow }], 'down')).toBe('near');
  });
});
