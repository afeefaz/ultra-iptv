import { describe, expect, it } from 'vitest';
import { fitText } from './largeFit';

const roomy = { width: 30, height: 20 };
const narrow = { width: 14, height: 20 };

describe('fitText', () => {
  it('keeps the base size when the name fits', () => {
    expect(fitText('News', 2.2, roomy, 0.16)).toBe('2.20rem');
  });

  it('is limited by the height of the box', () => {
    expect(fitText('News', 2.2, { width: 30, height: 8 }, 0.16)).toBe('1.28rem');
  });

  it('shrinks so the longest word fits instead of breaking in the middle', () => {
    const long = fitText('Entertainmentextraordinary Programmes', 2.2, narrow, 0.16);
    expect(parseFloat(long)).toBeLessThan(1.4);
    expect(parseFloat(long)).toBeGreaterThanOrEqual(1.1);
  });

  it('only looks at the longest word, so many short words keep their size', () => {
    expect(fitText('One two three four five six seven', 2.2, narrow, 0.16)).toBe('2.20rem');
  });

  it('never goes below a readable size', () => {
    expect(fitText('x'.repeat(80), 2.2, narrow, 0.16)).toBe('1.10rem');
  });
});
