import type { SeriesRow } from '@ultra/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./catalog', () => ({ catalog: () => ({ call: vi.fn() }) }));

import { episodeItem, type EpisodeEntry } from './media';

const series = { key: 'show', id: '1', playlistId: 'p', name: 'Show' } as unknown as SeriesRow;
const entry = (season: number, episode: number): EpisodeEntry => ({ season, episode, title: `Episode ${episode}`, ref: { t: 'url', url: 'u' } });
const list = [entry(1, 1), entry(1, 2), entry(2, 1)];

describe('episodeItem', () => {
  it('links an episode to the ones either side, across seasons', () => {
    const middle = episodeItem(series, list, 1);
    expect(middle.key).toBe('show|1x2');
    expect(middle.prev?.key).toBe('show|1x1');
    expect(middle.next?.key).toBe('show|2x1');
  });

  it('has nothing before the first or after the last', () => {
    expect(episodeItem(series, list, 0).prev).toBeUndefined();
    expect(episodeItem(series, list, 2).next).toBeUndefined();
  });

  it('can walk the whole series from any episode', () => {
    expect(episodeItem(series, list, 0).next?.next?.key).toBe('show|2x1');
    expect(episodeItem(series, list, 2).prev?.prev?.key).toBe('show|1x1');
  });
});
