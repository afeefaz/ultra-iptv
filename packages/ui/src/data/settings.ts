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
const [storedVodSort, storeVodSort] = persisted<SortBy>('vod.defaultSort', 'added');
export const defaultVodSort = storedVodSort;
/** Movie and series grids (spec §5): starts from the default whenever a library is opened. */
export const [vodSort, setVodSort] = createSignal<SortBy>(storedVodSort());

export type CategorySort = 'default' | 'az' | 'za' | 'count';
const [storedCatSort, storeCatSort] = persisted<CategorySort>('categories.defaultSort', 'default');
export const defaultCatSort = storedCatSort;
/** Category rails, per section (Live / Movies / Series); same rule as the grids. */
export const [liveCatSort, setLiveCatSort] = createSignal<CategorySort>(storedCatSort());
export const [vodCatSort, setVodCatSort] = createSignal<CategorySort>(storedCatSort());
export const [seriesCatSort, setSeriesCatSort] = createSignal<CategorySort>(storedCatSort());

/** Back to the defaults chosen in Settings. */
export function resetSorts(): void {
  setVodSort(storedVodSort());
  setLiveCatSort(storedCatSort());
  setVodCatSort(storedCatSort());
  setSeriesCatSort(storedCatSort());
}

export function setDefaultVodSort(sort: SortBy): void {
  storeVodSort(sort);
  resetSorts();
}

export function setDefaultCatSort(sort: CategorySort): void {
  storeCatSort(sort);
  resetSorts();
}

/** Movies and series open as a full page, or inside the grid area with the categories kept. */
export type DetailMode = 'page' | 'inline';
export const [detailMode, setDetailMode] = persisted<DetailMode>('vod.detailMode', 'page');
/** Next to categories: choosing another category keeps the open title (or closes it). */
export const [keepTitleOpen, setKeepTitleOpen] = persisted<boolean>('vod.keepTitleOpen', true);

export const MIN_TEXT_SCALE = 70;
export const MAX_TEXT_SCALE = 150;
export const TEXT_SCALE_STEP = 5;
/** Percent. Scales the whole interface with its text, so every screen keeps its layout. */
export const [textScale, setTextScale] = persisted<number>('display.textScale', 100);

/** The live memory and storage readout next to the playlist. */
export const [showSystemUsage, setShowSystemUsage] = persisted<boolean>('display.systemUsage', false);

/** Home sections the user can hide; "Explore library" always shows. */
export type HomeSection = 'hero' | 'continue' | 'favorites' | 'recent';
export const HOME_SECTIONS: HomeSection[] = ['hero', 'continue', 'favorites', 'recent'];
export const [hiddenHomeSections, setHiddenHomeSections] = persisted<HomeSection[]>('home.hidden', []);
export const homeShows = (section: HomeSection): boolean => hiddenHomeSections().indexOf(section) < 0;
