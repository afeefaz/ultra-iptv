import { describe, expect, it } from 'vitest';
import { ACCENT_COLORS, accentColor, accentVariables, contrastRatio, DEFAULT_ACCENT } from './accent';

const CANVAS = '#080a10';
const SURFACE = '#1a2232';
const ON_ACCENT = '#080a10';

describe('accent colours', () => {
  it('offers eight different colours', () => {
    expect(ACCENT_COLORS).toHaveLength(8);
    expect(new Set(ACCENT_COLORS.map((c) => c.hex)).size).toBe(8);
  });

  it('keeps text on a filled button readable', () => {
    for (const c of ACCENT_COLORS) expect(contrastRatio(c.hex, ON_ACCENT), c.hex).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps coloured text readable on the dark backgrounds', () => {
    for (const c of ACCENT_COLORS) {
      expect(contrastRatio(c.light, CANVAS), c.light).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.light, SURFACE), c.light).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('falls back to the default for a value it does not know', () => {
    expect(accentColor('#123456').hex).toBe(DEFAULT_ACCENT);
    expect(accentColor('#3b82f6').hex).toBe('#3b82f6');
  });

  it('works out the see-through variables from the colour', () => {
    const vars = accentVariables(accentColor('#3b82f6'));
    expect(vars['--accent']).toBe('#3b82f6');
    expect(vars['--accent-soft']).toBe('rgba(59, 130, 246, 0.16)');
    expect(vars['--accent-ring']).toBe('rgba(59, 130, 246, 0.5)');
  });
});
