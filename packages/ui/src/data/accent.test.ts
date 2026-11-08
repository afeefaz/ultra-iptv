import { describe, expect, it } from 'vitest';
import { ACCENT_COLORS, accentColor, accentVariables, contrastRatio, DEFAULT_ACCENT } from './accent';

const CANVAS = '#080a10';
const SURFACE = '#1a2232';
const ON_ACCENT = '#080a10';
// The darkest backgrounds text sits on in the light theme.
const LIGHT_WELL = '#e8ecf3';

describe('accent colours', () => {
  it('offers nine different colours', () => {
    expect(ACCENT_COLORS).toHaveLength(9);
    expect(new Set(ACCENT_COLORS.map((c) => c.hex)).size).toBe(9);
  });

  it('keeps text on a filled button readable', () => {
    for (const c of ACCENT_COLORS) {
      expect(contrastRatio(c.hex, c.on ?? ON_ACCENT), c.hex).toBeGreaterThanOrEqual(4.5);
      if (c.darkHex) expect(contrastRatio(c.darkHex, c.on ?? ON_ACCENT), c.darkHex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps coloured text readable on the dark backgrounds', () => {
    for (const c of ACCENT_COLORS) {
      expect(contrastRatio(c.light, CANVAS), c.light).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.light, SURFACE), c.light).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps coloured text readable on the light theme too', () => {
    for (const c of ACCENT_COLORS) expect(contrastRatio(c.deep, LIGHT_WELL), c.deep).toBeGreaterThanOrEqual(4.5);
  });

  it('shows black as a dark slate on the dark theme, and as black on the light one', () => {
    const black = accentColor('#0f172a');
    expect(accentVariables(black, 'dark')['--accent']).toBe('#334155');
    expect(accentVariables(black, 'light')['--accent']).toBe('#0f172a');
    expect(accentVariables(black, 'light')['--on-accent']).toBe('#ffffff');
    expect(accentVariables(accentColor(DEFAULT_ACCENT))['--on-accent']).toBe('#080a10');
  });

  it('uses the deep shade for text only on the light theme', () => {
    const amber = accentColor(DEFAULT_ACCENT);
    expect(accentVariables(amber, 'light')['--accent-light']).toBe(amber.deep);
    expect(accentVariables(amber)['--accent-light']).toBe(amber.light);
    expect(accentVariables(amber, 'light')['--accent-bright']).toBe(amber.light);
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
