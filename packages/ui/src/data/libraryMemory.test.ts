import { describe, expect, it } from 'vitest';
import { enterLibrary, rememberedSearch, rememberSearch } from './libraryMemory';
import { defaultVodSort, resetSorts, setVodSort, vodSort } from './settings';

describe('library memory', () => {
  it('keeps searches and sorts in the same library, and forgets them in another', () => {
    enterLibrary('live');
    rememberSearch('a', 'news');
    setVodSort('year');
    enterLibrary('live');
    expect(rememberedSearch('a')).toBe('news');
    expect(vodSort()).toBe('year');
    enterLibrary('vod');
    expect(rememberedSearch('a')).toBe('');
    expect(vodSort()).toBe(defaultVodSort());
    resetSorts();
  });
});
