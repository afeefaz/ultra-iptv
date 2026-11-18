import { describe, expect, it } from 'vitest';
import { firstVideoId, trailerQuery } from './trailer';

describe('trailerQuery', () => {
  it('cleans the provider name and adds the year and kind', () => {
    expect(trailerQuery('TOP: The Pit (2026) 4K', undefined, 'series')).toBe('the pit 2026 series trailer');
    expect(trailerQuery('DE - Die Odyssee', 2026, 'vod')).toBe('die odyssee 2026 trailer');
    expect(trailerQuery('Other Mommy', undefined, 'vod')).toBe('other mommy trailer');
  });
});

describe('firstVideoId', () => {
  it('takes the first video in the results data', () => {
    const html = 'x {"channelRenderer":{"channelId":"UC1"}} {"videoRenderer":{"videoId":"aqz-KE-bpKQ","thumbnail":{}}} {"videoRenderer":{"videoId":"bbbbbbbbbbb"}}';
    expect(firstVideoId(html)).toBe('aqz-KE-bpKQ');
  });

  it('gives null when there is none', () => {
    expect(firstVideoId('<html>consent</html>')).toBeNull();
  });
});
