import { describe, expect, it } from 'vitest';
import { normalizeSlowly, normalizeText } from './hash';

describe('normalizeText fast path', () => {
  it('gives the same result as the full version', () => {
    const samples = ['Movie 1 (2019)', '  Two   Spaces\tTab ', 'UPPER lower', 'Café Crème', 'قناة الجزيرة', 'مُسَلْسَل', 'Ünïcödé', 'A|B - C', '', 'x\u00a0y', 'ﾃｽﾄ'];
    for (const s of samples) expect(normalizeText(s), s).toBe(normalizeSlowly(s));
  });
});
