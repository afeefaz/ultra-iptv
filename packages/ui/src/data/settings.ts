import type { StreamFormat } from '@ultra/core';
import type { BufferProfile } from '@ultra/platform';
import { createSignal, type Accessor } from 'solid-js';
import { DEFAULT_ACCENT } from './accent';
import { track } from './usage';

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
      track(`setting.${key}`);
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

export const MIN_SEEK_SECONDS = 10;
export const MAX_SEEK_SECONDS = 30;
/** How far the skip buttons and Left/Right jump in movies and episodes. */
export const [seekSeconds, setSeekSeconds] = persisted<number>('playback.seekSeconds', MIN_SEEK_SECONDS);

/** Set at startup, once the platform has answered. Nothing reads it before a player opens. */
const [deviceIsTv, setDeviceIsTv] = createSignal(false);
export { setDeviceIsTv };

const [storedPictureSkip, storePictureSkip] = persisted<boolean | null>('playback.showPictureSkip', null);
/**
 * The big skip buttons on the picture; the ones under the timeline are always there. Until someone
 * chooses, a remote has Left and Right for skipping, and a phone needs the buttons.
 */
export const showPictureSkip = (): boolean => storedPictureSkip() ?? !deviceIsTv();
export const setShowPictureSkip = (show: boolean): void => storePictureSkip(show);

/** When an episode ends, count down and play the next one. */
export const [autoPlayNext, setAutoPlayNext] = persisted<boolean>('playback.autoPlayNext', true);

/** Programme names on every channel row (a guide request per row), or only the selected channel. */
export const [guideOnEveryRow, setGuideOnEveryRow] = persisted<boolean>('live.guideOnEveryRow', true);
export const [liveGroupPicker, setLiveGroupPicker] = persisted<boolean>('live.groupPicker', true);
/** The Recent category in Live TV. Home has its own Recently watched row. */
export const [liveShowRecent, setLiveShowRecent] = persisted<boolean>('live.showRecent', false);

/**
 * `large` is Boxes: categories, then channels, full screen and big, for reading from across the room.
 * `split` is a big category list beside the channels as boxes, with no preview. Live only.
 */
export type LiveLayout = 'standard' | 'large' | 'split';
export const [liveLayout, setLiveLayout] = persisted<LiveLayout>('live.layout', 'standard');
/** The same two layouts for Movies and Series. */
export const [moviesLayout, setMoviesLayout] = persisted<LiveLayout>('movies.layout', 'standard');
export const [seriesLayout, setSeriesLayout] = persisted<LiveLayout>('series.layout', 'standard');
/** Posters across the screen in the Boxes layout of Movies and Series. */
export const POSTER_COLUMNS = [4, 5, 6];
export const [storedPosterColumns, setPosterColumns] = persisted<number>('large.posterColumns', 5);
export const posterColumns = (): number => (POSTER_COLUMNS.indexOf(storedPosterColumns()) >= 0 ? storedPosterColumns() : 5);
/** How many fit on the screen. Boxes are laid out as 2×2, 3×2, 3×3 and 4×3. */
export const LARGE_BOXES = [4, 6, 9, 12];
export const [largeBoxes, setLargeBoxes] = persisted<number>('live.largeBoxes', 6);

/** Columns and visible rows. A value from another device's sync that isn't offered here falls back. */
export function boxGrid(count: number): { columns: number; rows: number } {
  if (count === 4) return { columns: 2, rows: 2 };
  if (count === 9) return { columns: 3, rows: 3 };
  if (count === 12) return { columns: 4, rows: 3 };
  return { columns: 3, rows: 2 };
}
export const largeLayout = (): { columns: number; rows: number } => boxGrid(largeBoxes());

export const MIN_TEXT_SCALE = 70;
export const MAX_TEXT_SCALE = 150;
export const TEXT_SCALE_STEP = 5;
/** Percent. Scales the whole interface with its text, so every screen keeps its layout. */
export const [textScale, setTextScale] = persisted<number>('display.textScale', 100);

/** Dark is the default; light is easier on a bright screen or a bright room. */
export type Theme = 'dark' | 'light';
export const [theme, setTheme] = persisted<Theme>('display.theme', 'dark');

/** How categories are grouped when hiding them: `auto` only when the names clearly follow a pattern. */
export type CategoryGrouping = 'auto' | 'on' | 'off';
export const [categoryGrouping, setCategoryGrouping] = persisted<CategoryGrouping>('categories.grouping', 'auto');

/** The colour of the app, as the preset's hex (see accent.ts). */
export const [accent, setAccent] = persisted<string>('display.accent', DEFAULT_ACCENT);

/** The live memory and storage readout next to the playlist. */
export const [showSystemUsage, setShowSystemUsage] = persisted<boolean>('display.systemUsage', false);

/** Home sections the user can hide; "Explore library" always shows. */
export type HomeSection = 'hero' | 'continue' | 'favorites' | 'recent';
export const HOME_SECTIONS: HomeSection[] = ['hero', 'continue', 'favorites', 'recent'];
export const [hiddenHomeSections, setHiddenHomeSections] = persisted<HomeSection[]>('home.hidden', []);
export const homeShows = (section: HomeSection): boolean => hiddenHomeSections().indexOf(section) < 0;
