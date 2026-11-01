import type { StreamFormat } from '@ultra/core';
import type { BufferProfile } from '@ultra/platform';
import { createSignal, type Accessor } from 'solid-js';

export type SubtitleSize = 'small' | 'medium' | 'large';

/** Device settings in localStorage (not sensitive; read synchronously by the player). */
function persisted<T>(key: string, fallback: T): [Accessor<T>, (value: T) => void] {
  let initial = fallback;
  try {
    const raw = localStorage.getItem('ultraiptv.' + key);
    if (raw !== null) initial = JSON.parse(raw) as T;
  } catch {
    // ignore
  }
  const [get, set] = createSignal<T>(initial);
  return [
    get,
    (value: T) => {
      set(() => value);
      try {
        localStorage.setItem('ultraiptv.' + key, JSON.stringify(value));
      } catch {
        // ignore
      }
    },
  ];
}

export const [streamFormat, setStreamFormat] = persisted<StreamFormat>('playback.format', 'auto');
export const [bufferProfile, setBufferProfile] = persisted<BufferProfile>('playback.buffer', 'balanced');
export const [subtitleSize, setSubtitleSize] = persisted<SubtitleSize>('playback.subtitleSize', 'medium');
/** Remembered from the user's last pick (spec §4.2); null = no preference yet. */
export const [preferredAudio, setPreferredAudio] = persisted<string | null>('playback.audioLang', null);
/** Language, 'off', or null for no preference. */
export const [preferredText, setPreferredText] = persisted<string | null>('playback.textLang', null);

export type SortBy = 'added' | 'name' | 'rating' | 'year';
/** Movie and series grids (spec §5). */
export const [vodSort, setVodSort] = persisted<SortBy>('vod.sort', 'added');

export type CategorySort = 'default' | 'az' | 'za' | 'count';
/** Category rails, per section (Live / Movies / Series). */
export const [liveCatSort, setLiveCatSort] = persisted<CategorySort>('categories.sort.live', 'default');
export const [vodCatSort, setVodCatSort] = persisted<CategorySort>('categories.sort.vod', 'default');
export const [seriesCatSort, setSeriesCatSort] = persisted<CategorySort>('categories.sort.series', 'default');
