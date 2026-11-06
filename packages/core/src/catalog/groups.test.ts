import { describe, expect, it } from 'vitest';
import { applyHiddenRule, detectGroups, groupKey, groupLabel } from './groups';

const named = (...names: string[]) => names.map((name, i) => ({ id: String(i), name }));

describe('groupLabel', () => {
  it('finds a label in the patterns providers use', () => {
    expect(groupLabel('AR| News')).toBe('AR');
    expect(groupLabel('AR|News')).toBe('AR');
    expect(groupLabel('IL | News')).toBe('IL');
    expect(groupLabel('UK - Sports')).toBe('UK');
    expect(groupLabel('UK – Sports')).toBe('UK');
    expect(groupLabel('[FR] Films')).toBe('FR');
    expect(groupLabel('(DE) Sport')).toBe('DE');
    expect(groupLabel('ARABIC: Drama')).toBe('ARABIC');
    expect(groupLabel('VIP • Movies')).toBe('VIP');
    expect(groupLabel('## AR | Drama ##')).toBe('AR');
    expect(groupLabel('★ AR| Relax ★')).toBe('AR');
    expect(groupLabel('عربي | رياضة')).toBe('عربي');
  });

  it('ignores names that only look like it', () => {
    expect(groupLabel('Al-Noor')).toBeNull();
    expect(groupLabel('24/7 Movies')).toBeNull();
    expect(groupLabel('Sports')).toBeNull();
    expect(groupLabel('News 24 - 7')).toBe('News 24');
    expect(groupLabel('2024 - Movies')).toBeNull();
    expect(groupLabel('AR|')).toBeNull();
    expect(groupLabel('A much longer name than a label would be: Sports')).toBeNull();
  });

  it('treats case and spacing as the same group', () => {
    expect(groupKey('Ar | One')).toBe(groupKey('AR| Two'));
    expect(groupKey('Sports')).toBeNull();
  });
});

describe('detectGroups', () => {
  const live = named('AR| One', 'IL| One', 'AR| Two', 'FR| One', 'IL| Two', 'AR| Three', 'IL| Three', 'FR| Two', 'FR| Three', 'Adults');

  it('groups in first-seen order and leaves the rest in Other', () => {
    const result = detectGroups(live)!;
    expect(result.groups.map((g) => [g.label, g.items.length])).toEqual([['AR', 3], ['IL', 3], ['FR', 3]]);
    expect(result.other.map((c) => c.name)).toEqual(['Adults']);
  });

  it('puts a label with too few members in Other', () => {
    const result = detectGroups(live.concat(named('ES| One')))!;
    expect(result.groups).toHaveLength(3);
    expect(result.other.map((c) => c.name)).toEqual(['Adults', 'ES| One']);
  });

  it('keeps a small group once the pattern is clear', () => {
    const result = detectGroups(live.concat(named('IL2| One', 'IL2| Two')))!;
    expect(result.groups.map((g) => g.label)).toContain('IL2');
    expect(result.other.map((c) => c.name)).toEqual(['Adults']);
  });

  it('does not treat a couple of look-alike names as a pattern', () => {
    expect(detectGroups(named('Sports: One', 'Sports: Two', 'News: One', 'News: Two', 'Kids', 'Drama'))).toBeNull();
  });

  it('gives no groups to a provider without a pattern', () => {
    expect(detectGroups(named('Action', 'Comedy', 'Drama', 'Kids', 'News', 'Sports'))).toBeNull();
    expect(detectGroups([])).toBeNull();
  });

  it('gives no groups when a pattern is rare or a single group', () => {
    expect(detectGroups(named('AR| A', 'AR| B', 'AR| C', 'One', 'Two'))).toBeNull();
    const few = named('AR| A', 'AR| B', 'AR| C', 'IL| A', 'IL| B', 'IL| C');
    const many = named(...Array.from({ length: 20 }, (_, i) => `Name ${i}`));
    expect(detectGroups(few.concat(many))).toBeNull();
  });

  it('handles a thousand categories quickly', () => {
    const big = named(...Array.from({ length: 1000 }, (_, i) => `L${i % 40}| Category ${i}`));
    const start = performance.now();
    expect(detectGroups(big)!.groups).toHaveLength(40);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('applyHiddenRule', () => {
  const cats = named('AR| Old', 'AR| New', 'IL| One');

  it('hides a new category in a hidden group', () => {
    expect(applyHiddenRule(cats, ['0'], { labels: ['AR'], shown: [] })).toEqual(['0', '1']);
  });

  it('respects one shown by hand, and other groups', () => {
    expect(applyHiddenRule(cats, ['0'], { labels: ['AR'], shown: ['1'] })).toEqual(['0']);
  });

  it('leaves everything alone with no rule', () => {
    const ids = ['2'];
    expect(applyHiddenRule(cats, ids, { labels: [], shown: [] })).toBe(ids);
  });
});
