import { describe, expect, it } from 'vitest';
import { measure, measureSlowly, sliceLikeTv } from './files';

describe('slices the way the TV reads them', () => {
  it('counts UTF-8 bytes and code points (an emoji is one point, four bytes)', () => {
    expect(measure('abc')).toEqual({ bytes: 3, points: 3 });
    expect(measure('قناة')).toEqual({ bytes: 8, points: 4 });
    expect(measure('😀x')).toEqual({ bytes: 5, points: 2 });
    for (const t of ['abc', 'قناة عربية ✓', 'Movie 😀 (2019)', '']) expect(measure(t), t).toEqual(measureSlowly(t));
  });

  it('finds every piece of a joined text by byte offset and point count', () => {
    const parts = ['["abc",1]', '["قناة عربية ✓",2]', '["Movie 😀",3]', '["مسلسل",4]'];
    const text = parts.join('');
    let offset = 0;
    for (const p of parts) {
      const m = measure(p);
      expect(sliceLikeTv(text, offset, m.points)).toBe(p);
      offset += m.bytes;
    }
  });
});
