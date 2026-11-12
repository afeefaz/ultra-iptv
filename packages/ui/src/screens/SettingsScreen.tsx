import type { ContentKind, StreamFormat } from '@ultra/core';
import type { BufferProfile } from '@ultra/platform';
import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { FocusButton } from '../components/FocusButton';
import { Icon, type IconName } from '../components/Icon';
import { RemoteQrPanel } from '../components/RemoteQrPanel';
import { SyncCard } from '../components/SyncCard';
import { UpdateRow } from '../components/UpdateRow';
import { RemoteIdentityLine } from '../components/RemoteRefreshButton';
import { SpeedTestCard } from '../components/SpeedTestCard';
import { ACCENT_COLORS, accentColor } from '../data/accent';
import { CATEGORY_SORTS, useCategoryNames, useHiddenCategories } from '../data/categories';
import { lockedCategories, lockedChannels, pinSet, requestPin } from '../data/parental';
import { changeStorageMode, fastStorageAvailable, storageMode, type StorageMode } from '../data/catalog';
import { activePlaylist } from '../data/playlists';
import {
  accent,
  autoPlayNext,
  categoryGrouping,
  setCategoryGrouping,
  setTheme,
  theme,
  type CategoryGrouping,
  type Theme,
  boxGrid,
  LARGE_BOXES,
  largeBoxes,
  liveLayout,
  moviesLayout,
  POSTER_COLUMNS,
  posterColumns,
  seriesLayout,
  setMoviesLayout,
  setPosterColumns,
  setSeriesLayout,
  setLargeBoxes,
  setLiveLayout,
  type LiveLayout,
  setAccent,
  setAutoPlayNext,
  bufferProfile,
  defaultCatSort,
  defaultVodSort,
  detailMode,
  guideOnEveryRow,
  liveGroupPicker,
  liveShowRecent,
  setLiveGroupPicker,
  setLiveShowRecent,
  setGuideOnEveryRow,
  hiddenHomeSections,
  HOME_SECTIONS,
  homeShows,
  keepTitleOpen,
  MAX_SEEK_SECONDS,
  MAX_TEXT_SCALE,
  MIN_SEEK_SECONDS,
  MIN_TEXT_SCALE,
  seekSeconds,
  setSeekSeconds,
  setShowPictureSkip,
  setShowSystemUsage,
  setTextScale,
  showPictureSkip,
  showSystemUsage,
  TEXT_SCALE_STEP,
  textScale,
  preferredAudio,
  preferredText,
  setBufferProfile,
  setDefaultCatSort,
  setDefaultVodSort,
  setDetailMode,
  setHiddenHomeSections,
  setKeepTitleOpen,
  setPreferredAudio,
  setPreferredText,
  setStreamFormat,
  setSubtitleSize,
  streamFormat,
  subtitleSize,
  type DetailMode,
  type SortBy,
  type SubtitleSize,
} from '../data/settings';
import { CONTENT_ZONE, focusManager, FocusZone } from '../focus';
import { countsText, expiryText } from '../format';
import { formatNumber, locale, setLocale, t, type Locale, type MessageKey } from '../i18n';
import { useKeys } from '../keys';
import { navigate } from '../nav';
import { usePlatform } from '../platform-context';

// Language names are always shown in their own language.
const LANGUAGES: Array<{ id: Locale; name: string; badge: string; sub: MessageKey }> = [
  { id: 'en', name: 'English', badge: 'EN', sub: 'settings.lang.enSub' },
  { id: 'ar', name: 'العربية', badge: 'ع', sub: 'settings.lang.arSub' },
];

interface Section {
  id: string;
  icon: IconName;
  title: MessageKey;
}

const SECTIONS: Section[] = [
  { id: 'general', icon: 'language', title: 'settings.language' },
  { id: 'playback', icon: 'tune', title: 'settings.playback' },
  { id: 'subtitles', icon: 'subtitles', title: 'settings.subtitles' },
  { id: 'display', icon: 'tv', title: 'settings.display' },
  { id: 'browsing', icon: 'grid', title: 'settings.browsing' },
  { id: 'hidden', icon: 'list', title: 'settings.hiddenCategories' },
  { id: 'home', icon: 'layers', title: 'settings.home' },
  { id: 'parental', icon: 'shield', title: 'settings.parental' },
  { id: 'playlists', icon: 'playlist', title: 'settings.playlists' },
  { id: 'remote', icon: 'link', title: 'settings.remote' },
  { id: 'sync', icon: 'sync', title: 'settings.sync' },
  { id: 'network', icon: 'sync', title: 'settings.network' },
  { id: 'about', icon: 'info', title: 'settings.about' },
];

interface Page {
  id: string;
  icon: IconName;
  title: MessageKey;
  sections: string[];
  /** First control of the page, focused when it's opened. */
  first: () => string;
}

const PAGES: Page[] = [
  { id: 'playback', icon: 'tune', title: 'settings.playback', sections: ['playback', 'subtitles'], first: () => `settings-format-${streamFormat()}` },
  { id: 'appearance', icon: 'tv', title: 'settings.appearance', sections: ['general', 'display'], first: () => `settings-lang-${locale()}` },
  { id: 'browsing', icon: 'grid', title: 'settings.browsing', sections: ['browsing', 'hidden', 'home'], first: () => `settings-detail-${detailMode()}` },
  { id: 'devices', icon: 'playlist', title: 'settings.devices', sections: ['playlists', 'remote', 'sync'], first: () => 'settings-playlists' },
  { id: 'parental', icon: 'shield', title: 'settings.parental', sections: ['parental'], first: () => (pinSet() ? 'settings-pin-change' : 'settings-pin-set') },
  { id: 'system', icon: 'info', title: 'settings.system', sections: ['network', 'about'], first: () => 'settings-speed' },
];

/**
 * Module state, because the screen unmounts when a page like Hidden categories opens and Back has
 * to return to the same page. Lasts until the app closes.
 */
const [openPage, setOpenPage] = createSignal(PAGES[0]);

function Segmented<T extends string>(props: {
  id: string;
  label: string;
  value: T;
  options: Array<{ value: T; label: MessageKey }>;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div class="segmented" role="radiogroup" aria-label={props.label}>
      <For each={props.options}>
        {(o) => (
          <FocusButton id={`${props.id}-${o.value}`} selected={props.value === o.value} onSelect={() => props.onChange(o.value)}>
            {t(o.label)}
          </FocusButton>
        )}
      </For>
    </div>
  );
}

function Card(props: { section: Section; aside?: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="settings-card" id={`settings-${props.section.id}`}>
      <div class="settings-card-head">
        <h2>
          <Icon name={props.section.icon} />
          {t(props.section.title)}
        </h2>
        <Show when={props.aside}>
          <span class="aside">{props.aside}</span>
        </Show>
      </div>
      {props.children}
    </section>
  );
}

/** − value + for numbers: a remote can reach every value, one press at a time. */
function Stepper(props: {
  id: string;
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  reset?: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <div class="stepper" role="group" aria-label={props.label}>
      <FocusButton
        id={`${props.id}-down`}
        class="stepper-button"
        label={t('settings.stepDown')}
        onSelect={() => props.onChange(Math.max(props.min, props.value - props.step))}
      >
        −
      </FocusButton>
      <span class="stepper-value" dir="ltr">
        {props.value}
        {props.unit}
      </span>
      <FocusButton
        id={`${props.id}-up`}
        class="stepper-button"
        label={t('settings.stepUp')}
        onSelect={() => props.onChange(Math.min(props.max, props.value + props.step))}
      >
        +
      </FocusButton>
      <Show when={props.reset !== undefined && props.value !== props.reset}>
        <FocusButton id={`${props.id}-reset`} onSelect={() => props.onChange(props.reset!)}>
          {t('settings.stepReset', { value: `${props.reset}${props.unit}` })}
        </FocusButton>
      </Show>
      <span class="stepper-range" dir="ltr">
        {props.min}–{props.max}
        {props.unit}
      </span>
    </div>
  );
}

/** A small picture of the screen in each layout, so the choice is seen rather than read. */
function LayoutSketch(props: { layout: LiveLayout; kind: 'live' | 'vod' }): JSX.Element {
  return (
    <span class="sketch" aria-hidden="true">
      <span class="sketch-inner">
        <Show when={props.layout === 'split'}>
          <span class="sketch-col sketch-rail-big">
            <For each={[1, 2, 3, 4]}>{() => <span class="sketch-line sketch-line-tall" />}</For>
          </span>
          <span class="sketch-col sketch-posters">
            <BoxesCells columns={3} rows={2} />
          </span>
        </Show>
        <Show when={props.layout === 'standard'} fallback={props.layout === 'large' ? <BoxesCells columns={props.kind === 'live' ? 3 : 4} rows={props.kind === 'live' ? 2 : 1} /> : undefined}>
          <span class="sketch-col sketch-rail">
            <For each={[1, 2, 3, 4, 5]}>{() => <span class="sketch-line" />}</For>
          </span>
          <Show
            when={props.kind === 'live'}
            fallback={
              <span class="sketch-col sketch-posters">
                <BoxesCells columns={4} rows={2} />
              </span>
            }
          >
            <span class="sketch-col sketch-list">
              <For each={[1, 2, 3, 4, 5]}>{() => <span class="sketch-line" />}</For>
            </span>
            <span class="sketch-col sketch-preview">
              <span class="sketch-video" />
              <span class="sketch-line" />
              <span class="sketch-line short" />
            </span>
          </Show>
        </Show>
      </span>
    </span>
  );
}

/** Standard or Boxes for one library. */
function LayoutPicker(props: {
  title: MessageKey;
  desc?: MessageKey;
  kind: 'live' | 'vod';
  /** Which layouts this library offers. */
  options: LiveLayout[];
  value: LiveLayout;
  onPick: (layout: LiveLayout) => void;
}): JSX.Element {
  return (
    <>
      <div class="setting-name setting-gap">{t(props.title)}</div>
      <Show when={props.desc}>{(d) => <div class="setting-desc">{t(d())}</div>}</Show>
      <div class="option-cards layout-picks" classList={{ 'layout-picks-three': props.options.length > 2 }} role="radiogroup" aria-label={t(props.title)}>
        <For each={props.options}>
          {(l) => (
            <FocusButton id={`settings-${props.title}-${l}`} class="layout-pick" selected={props.value === l} onSelect={() => props.onPick(l)}>
              <LayoutSketch layout={l} kind={props.kind} />
              <span class="layout-pick-label">
                <span class="option-card-text">
                  <span class="option-card-title">{t(`settings.liveLayout.${l}`)}</span>
                  <span class="option-card-sub">{t(`settings.liveLayout.${l}Sub`)}</span>
                </span>
                <Icon name={props.value === l ? 'checkCircle' : 'radioOff'} />
              </span>
            </FocusButton>
          )}
        </For>
      </div>
    </>
  );
}

function BoxesSketch(props: { columns: number; rows: number }): JSX.Element {
  return (
    <span class="sketch" aria-hidden="true">
      <span class="sketch-inner">
        <BoxesCells columns={props.columns} rows={props.rows} />
      </span>
    </span>
  );
}

function BoxesCells(props: { columns: number; rows: number }): JSX.Element {
  const cells = () => Array.from({ length: props.columns * props.rows }, (_, i) => i);
  return (
    <span class="sketch-boxes">
      <For each={cells()}>
        {() => (
          <span class="sketch-cell" style={{ width: `${100 / props.columns}%`, height: `${100 / props.rows}%` }}>
            <span class="sketch-box" />
          </span>
        )}
      </For>
    </span>
  );
}

const VOD_SORTS: SortBy[] = ['added', 'name', 'rating', 'year'];
const HIDDEN_KINDS: Array<{ kind: ContentKind; title: MessageKey }> = [
  { kind: 'live', title: 'tab.live' },
  { kind: 'vod', title: 'tab.movies' },
  { kind: 'series', title: 'tab.series' },
];

export function SettingsScreen(): JSX.Element {
  const platform = usePlatform();
  const section = (id: string) => SECTIONS.filter((s) => s.id === id)[0];
  const shows = (id: string) => openPage().sections.indexOf(id) >= 0;
  let content: HTMLDivElement | undefined;
  const open = (p: Page) => {
    setOpenPage(p);
    if (content) content.scrollTop = 0;
    // The page's controls register after this has rendered.
    setTimeout(() => focusManager.focus(p.first()), 0);
  };

  // The gear is far to the right: if focus stayed on it, Down would skip the menu. After the
  // controls register, and after App has restored focus when coming Back to this screen.
  onMount(() => {
    setTimeout(() => {
      const id = focusManager.currentId;
      if (!id || !focusManager.isInZone(id, CONTENT_ZONE)) focusManager.focus(`settings-menu-${openPage().id}`);
    }, 0);
  });

  // Back from a page returns to the menu; Back from the menu leaves Settings. Dialogs get it first.
  useKeys((press) => {
    const id = focusManager.currentId;
    if (press.key !== 'back' || !id || !focusManager.isInZone(id, 'settings')) return false;
    return focusManager.focus(`settings-menu-${openPage().id}`);
  });

  return (
    <div class="screen settings">
      <div class="settings-header">
        <Icon name="settings" />
        <div>
          <h1 class="screen-title">{t('tab.settings')}</h1>
          <div class="sub">{t('settings.subtitle')}</div>
        </div>
      </div>
      <div class="settings-layout">
        <FocusZone id="settings-menu" remember>
          <nav class="settings-menu">
            <div class="eyebrow">{t('settings.menu')}</div>
            <For each={PAGES}>
              {(p) => (
                <FocusButton id={`settings-menu-${p.id}`} class="list-item" selected={openPage() === p} autofocus={openPage() === p} onSelect={() => open(p)}>
                  <Icon name={p.icon} />
                  <span class="list-label">{t(p.title)}</span>
                  <Icon name="chevronRight" />
                </FocusButton>
              )}
            </For>
          </nav>
        </FocusZone>
        <FocusZone id="settings" remember>
          <div class="settings-sections" ref={(el) => (content = el)}>
            <Show when={shows('general')}>
              <Card section={section('general')} aside={t('settings.lang.aside')}>
                <div class="option-cards">
                  {LANGUAGES.map((lang) => (
                    <FocusButton id={`settings-lang-${lang.id}`} selected={locale() === lang.id} onSelect={() => setLocale(lang.id)}>
                      <span class="lang-badge" lang={lang.id}>
                        {lang.badge}
                      </span>
                      <span class="option-card-text">
                        <span class="option-card-title" lang={lang.id}>
                          {lang.name}
                        </span>
                        <span class="option-card-sub">{t(lang.sub)}</span>
                      </span>
                      <Icon name={locale() === lang.id ? 'checkCircle' : 'radioOff'} />
                    </FocusButton>
                  ))}
                </div>
              </Card>
            </Show>

            <Show when={shows('playback')}>
              <Card section={section('playback')}>
                <div class="setting-row">
                  <div>
                    <div class="setting-name">{t('settings.streamFormat')}</div>
                    <div class="setting-desc">{t('settings.streamFormatDesc')}</div>
                  </div>
                  <Segmented<StreamFormat>
                    id="settings-format"
                    label={t('settings.streamFormat')}
                    value={streamFormat()}
                    onChange={setStreamFormat}
                    options={[
                      { value: 'auto', label: 'settings.format.auto' },
                      { value: 'hls', label: 'settings.format.hls' },
                      { value: 'ts', label: 'settings.format.ts' },
                    ]}
                  />
                </div>
                <div class="setting-name">{t('settings.buffer')}</div>
                <div class="setting-desc">{t('settings.bufferDesc')}</div>
                <div class="option-cards" style={{ 'margin-top': '0.8rem' }}>
                  <For each={['low', 'balanced', 'stable'] as BufferProfile[]}>
                    {(b) => (
                      <FocusButton id={`settings-buffer-${b}`} selected={bufferProfile() === b} onSelect={() => setBufferProfile(b)}>
                        <span class="option-card-text">
                          <span class="option-card-title">{t(`settings.buffer.${b}`)}</span>
                          <span class="option-card-sub">{t(`settings.buffer.${b}Sub`)}</span>
                        </span>
                        <Icon name={bufferProfile() === b ? 'checkCircle' : 'radioOff'} />
                      </FocusButton>
                    )}
                  </For>
                </div>
                <div class="setting-name setting-gap">{t('settings.seekSeconds')}</div>
                <div class="setting-desc">{t('settings.seekSecondsDesc')}</div>
                <Stepper
                  id="settings-seek"
                  label={t('settings.seekSeconds')}
                  value={seekSeconds()}
                  unit=" s"
                  min={MIN_SEEK_SECONDS}
                  max={MAX_SEEK_SECONDS}
                  step={1}
                  reset={MIN_SEEK_SECONDS}
                  onChange={setSeekSeconds}
                />
                <div class="setting-name setting-gap">{t('settings.pictureSkip')}</div>
                <div class="setting-desc">{t('settings.pictureSkipDesc')}</div>
                <div class="option-cards" style={{ 'margin-top': '0.8rem' }}>
                  <For each={[true, false]}>
                    {(show) => (
                      <FocusButton id={`settings-picture-skip-${show}`} selected={showPictureSkip() === show} onSelect={() => setShowPictureSkip(show)}>
                        <span class="option-card-text">
                          <span class="option-card-title">{t(show ? 'settings.usage.on' : 'settings.usage.off')}</span>
                        </span>
                        <Icon name={showPictureSkip() === show ? 'checkCircle' : 'radioOff'} />
                      </FocusButton>
                    )}
                  </For>
                </div>
                <div class="setting-name setting-gap">{t('settings.autoPlayNext')}</div>
                <div class="setting-desc">{t('settings.autoPlayNextDesc')}</div>
                <div class="option-cards" style={{ 'margin-top': '0.8rem' }}>
                  <For each={[true, false]}>
                    {(on) => (
                      <FocusButton id={`settings-auto-next-${on}`} selected={autoPlayNext() === on} onSelect={() => setAutoPlayNext(on)}>
                        <span class="option-card-text">
                          <span class="option-card-title">{t(on ? 'settings.autoPlayNext.on' : 'settings.autoPlayNext.off')}</span>
                        </span>
                        <Icon name={autoPlayNext() === on ? 'checkCircle' : 'radioOff'} />
                      </FocusButton>
                    )}
                  </For>
                </div>
              </Card>
            </Show>

            <Show when={shows('subtitles')}>
              <Card section={section('subtitles')}>
                <div class="setting-row">
                  <div class="setting-name">{t('settings.subtitleSize')}</div>
                  <Segmented<SubtitleSize>
                    id="settings-subsize"
                    label={t('settings.subtitleSize')}
                    value={subtitleSize()}
                    onChange={setSubtitleSize}
                    options={[
                      { value: 'small', label: 'settings.size.small' },
                      { value: 'medium', label: 'settings.size.medium' },
                      { value: 'large', label: 'settings.size.large' },
                    ]}
                  />
                </div>
                <div class="status-row">
                  <Icon name="volume" />
                  <div class="grow">
                    <div class="setting-name">{t('settings.languageMemory')}</div>
                    <div class="setting-desc">
                      {t('settings.languages', {
                        audio: preferredAudio() ?? t('settings.none'),
                        text: preferredText() === 'off' ? t('player.off') : (preferredText() ?? t('settings.none')),
                      })}
                    </div>
                  </div>
                  <Show when={preferredAudio() || preferredText()}>
                    <FocusButton
                      id="settings-forget-langs"
                      onSelect={() => {
                        setPreferredAudio(null);
                        setPreferredText(null);
                      }}
                    >
                      {t('settings.forget')}
                    </FocusButton>
                  </Show>
                </div>
              </Card>
            </Show>

            <Show when={shows('display')}>
              <Card section={section('display')}>
                <div class="setting-name">{t('settings.textSize')}</div>
                <div class="setting-desc">{t('settings.textSizeDesc')}</div>
                <Stepper
                  id="settings-text"
                  label={t('settings.textSize')}
                  value={textScale()}
                  unit="%"
                  min={MIN_TEXT_SCALE}
                  max={MAX_TEXT_SCALE}
                  step={TEXT_SCALE_STEP}
                  reset={100}
                  onChange={setTextScale}
                />
                <div class="setting-name setting-gap">{t('settings.theme')}</div>
                <div class="setting-desc">{t('settings.themeDesc')}</div>
                <div class="option-cards" role="radiogroup" aria-label={t('settings.theme')} style={{ 'margin-top': '0.8rem' }}>
                  <For each={['dark', 'light'] as Theme[]}>
                    {(mode) => (
                      <FocusButton id={`settings-theme-${mode}`} selected={theme() === mode} onSelect={() => setTheme(mode)}>
                        <span class={`theme-swatch theme-swatch-${mode}`} />
                        <span class="option-card-text">
                          <span class="option-card-title">{t(`settings.theme.${mode}`)}</span>
                          <span class="option-card-sub">{t(`settings.theme.${mode}Sub`)}</span>
                        </span>
                        <Icon name={theme() === mode ? 'checkCircle' : 'radioOff'} />
                      </FocusButton>
                    )}
                  </For>
                </div>
                <div class="setting-name setting-gap">{t('settings.appColor')}</div>
                <div class="setting-desc">{t('settings.appColorDesc')}</div>
                <div class="option-cards option-cards-wrap" role="radiogroup" aria-label={t('settings.appColor')}>
                  <For each={ACCENT_COLORS}>
                    {(c) => (
                      <FocusButton id={`settings-color-${c.hex.slice(1)}`} selected={accentColor(accent()).hex === c.hex} onSelect={() => setAccent(c.hex)}>
                        <span class="color-swatch" style={{ background: c.hex }} />
                        <span class="option-card-text">
                          <span class="option-card-title">{t(c.name)}</span>
                        </span>
                        <Icon name={accentColor(accent()).hex === c.hex ? 'checkCircle' : 'radioOff'} />
                      </FocusButton>
                    )}
                  </For>
                </div>
                <LayoutPicker title="settings.liveLayout" desc="settings.liveLayoutDesc" kind="live" options={['standard', 'large', 'split']} value={liveLayout()} onPick={setLiveLayout} />
                <LayoutPicker title="settings.moviesLayout" kind="vod" options={['standard', 'large']} value={moviesLayout()} onPick={setMoviesLayout} />
                <LayoutPicker title="settings.seriesLayout" kind="vod" options={['standard', 'large']} value={seriesLayout()} onPick={setSeriesLayout} />
                <Show when={liveLayout() !== 'standard' || moviesLayout() === 'large' || seriesLayout() === 'large'}>
                  <div class="setting-name setting-gap">{t('settings.largeCount')}</div>
                  <div class="setting-desc">{t('settings.largeCountDesc')}</div>
                  <div class="option-cards layout-picks" role="radiogroup" aria-label={t('settings.largeCount')}>
                    <For each={LARGE_BOXES}>
                      {(n) => (
                        <FocusButton id={`settings-large-count-${n}`} class="layout-pick" selected={largeBoxes() === n} onSelect={() => setLargeBoxes(n)}>
                          <BoxesSketch columns={boxGrid(n).columns} rows={boxGrid(n).rows} />
                          <span class="layout-pick-label">
                            <span class="option-card-title">{t('settings.largeCount.boxes', { n: formatNumber(n) })}</span>
                            <Icon name={largeBoxes() === n ? 'checkCircle' : 'radioOff'} />
                          </span>
                        </FocusButton>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={moviesLayout() === 'large' || seriesLayout() === 'large'}>
                  <div class="setting-name setting-gap">{t('settings.posterColumns')}</div>
                  <div class="setting-desc">{t('settings.posterColumnsDesc')}</div>
                  <div class="option-cards layout-picks" role="radiogroup" aria-label={t('settings.posterColumns')}>
                    <For each={POSTER_COLUMNS}>
                      {(n) => (
                        <FocusButton id={`settings-poster-columns-${n}`} class="layout-pick" selected={posterColumns() === n} onSelect={() => setPosterColumns(n)}>
                          <BoxesSketch columns={n} rows={1} />
                          <span class="layout-pick-label">
                            <span class="option-card-title">{t('settings.posterColumns.n', { n: formatNumber(n) })}</span>
                            <Icon name={posterColumns() === n ? 'checkCircle' : 'radioOff'} />
                          </span>
                        </FocusButton>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={platform.systemUsage}>
                  <div class="setting-name setting-gap">{t('settings.usage')}</div>
                  <div class="setting-desc">{t('settings.usageDesc')}</div>
                  <div class="option-cards" style={{ 'margin-top': '0.8rem' }}>
                    <For each={[true, false]}>
                      {(on) => (
                        <FocusButton id={`settings-usage-${on}`} selected={showSystemUsage() === on} onSelect={() => setShowSystemUsage(on)}>
                          <span class="option-card-text">
                            <span class="option-card-title">{t(on ? 'settings.usage.on' : 'settings.usage.off')}</span>
                          </span>
                          <Icon name={showSystemUsage() === on ? 'checkCircle' : 'radioOff'} />
                        </FocusButton>
                      )}
                    </For>
                  </div>
                </Show>
              </Card>
            </Show>

            <Show when={shows('browsing')}>
              <Card section={section('browsing')}>
                <div class="setting-name">{t('settings.detailMode')}</div>
                <div class="setting-desc">{t('settings.detailModeDesc')}</div>
                <div class="option-cards" style={{ 'margin-top': '0.8rem' }}>
                  <For each={['page', 'inline'] as DetailMode[]}>
                    {(m) => (
                      <FocusButton id={`settings-detail-${m}`} selected={detailMode() === m} onSelect={() => setDetailMode(m)}>
                        <span class="option-card-text">
                          <span class="option-card-title">{t(`settings.detail.${m}`)}</span>
                          <span class="option-card-sub">{t(`settings.detail.${m}Sub`)}</span>
                        </span>
                        <Icon name={detailMode() === m ? 'checkCircle' : 'radioOff'} />
                      </FocusButton>
                    )}
                  </For>
                </div>
                <div class="setting-name setting-gap">{t('settings.defaultSort')}</div>
                <div class="setting-desc">{t('settings.defaultSortDesc')}</div>
                <div class="option-cards wrap" style={{ 'margin-top': '0.8rem' }}>
                  <For each={VOD_SORTS}>
                    {(sort) => (
                      <FocusButton id={`settings-sort-${sort}`} selected={defaultVodSort() === sort} onSelect={() => setDefaultVodSort(sort)}>
                        <span class="option-card-text">
                          <span class="option-card-title">{t(`sort.${sort}`)}</span>
                        </span>
                        <Icon name={defaultVodSort() === sort ? 'checkCircle' : 'radioOff'} />
                      </FocusButton>
                    )}
                  </For>
                </div>
                <div class="setting-name setting-gap">{t('settings.defaultCatSort')}</div>
                <div class="setting-desc">{t('settings.defaultCatSortDesc')}</div>
                <div class="option-cards wrap" style={{ 'margin-top': '0.8rem' }}>
                  <For each={CATEGORY_SORTS}>
                    {(sort) => (
                      <FocusButton id={`settings-catsort-${sort}`} selected={defaultCatSort() === sort} onSelect={() => setDefaultCatSort(sort)}>
                        <span class="option-card-text">
                          <span class="option-card-title">{t(`categories.sort.${sort}`)}</span>
                        </span>
                        <Icon name={defaultCatSort() === sort ? 'checkCircle' : 'radioOff'} />
                      </FocusButton>
                    )}
                  </For>
                </div>
                <div class="setting-name setting-gap">{t('settings.groupPicker')}</div>
                <div class="setting-desc">{t('settings.groupPickerDesc')}</div>
                <div class="option-cards" style={{ 'margin-top': '0.8rem' }}>
                  <For each={[true, false]}>
                    {(on) => (
                      <FocusButton id={`settings-groups-${on}`} selected={liveGroupPicker() === on} onSelect={() => setLiveGroupPicker(on)}>
                        <span class="option-card-text">
                          <span class="option-card-title">{t(on ? 'settings.groupPicker.on' : 'settings.groupPicker.off')}</span>
                          <span class="option-card-sub">{t(on ? 'settings.groupPicker.onSub' : 'settings.groupPicker.offSub')}</span>
                        </span>
                        <Icon name={liveGroupPicker() === on ? 'checkCircle' : 'radioOff'} />
                      </FocusButton>
                    )}
                  </For>
                </div>
                <div class="setting-name setting-gap">{t('settings.guideRows')}</div>
                <div class="setting-desc">{t('settings.guideRowsDesc')}</div>
                <div class="option-cards" style={{ 'margin-top': '0.8rem' }}>
                  <For each={[true, false]}>
                    {(every) => (
                      <FocusButton id={`settings-guide-${every}`} selected={guideOnEveryRow() === every} onSelect={() => setGuideOnEveryRow(every)}>
                        <span class="option-card-text">
                          <span class="option-card-title">{t(every ? 'settings.guideRows.every' : 'settings.guideRows.selected')}</span>
                          <span class="option-card-sub">{t(every ? 'settings.guideRows.everySub' : 'settings.guideRows.selectedSub')}</span>
                        </span>
                        <Icon name={guideOnEveryRow() === every ? 'checkCircle' : 'radioOff'} />
                      </FocusButton>
                    )}
                  </For>
                </div>
                <div class="setting-name setting-gap">{t('settings.liveRecent')}</div>
                <div class="setting-desc">{t('settings.liveRecentDesc')}</div>
                <div class="option-cards" style={{ 'margin-top': '0.8rem' }}>
                  <For each={[true, false]}>
                    {(show) => (
                      <FocusButton id={`settings-live-recent-${show}`} selected={liveShowRecent() === show} onSelect={() => setLiveShowRecent(show)}>
                        <span class="option-card-text">
                          <span class="option-card-title">{t(show ? 'settings.usage.on' : 'settings.usage.off')}</span>
                        </span>
                        <Icon name={liveShowRecent() === show ? 'checkCircle' : 'radioOff'} />
                      </FocusButton>
                    )}
                  </For>
                </div>
                <Show when={detailMode() === 'inline'}>
                  <div class="setting-name setting-gap">{t('settings.keepOpen')}</div>
                  <div class="setting-desc">{t('settings.keepOpenDesc')}</div>
                  <div class="option-cards" style={{ 'margin-top': '0.8rem' }}>
                    <For each={[true, false]}>
                      {(keep) => (
                        <FocusButton id={`settings-keep-${keep}`} selected={keepTitleOpen() === keep} onSelect={() => setKeepTitleOpen(keep)}>
                          <span class="option-card-text">
                            <span class="option-card-title">{t(keep ? 'settings.keepOpen.on' : 'settings.keepOpen.off')}</span>
                            <span class="option-card-sub">{t(keep ? 'settings.keepOpen.onSub' : 'settings.keepOpen.offSub')}</span>
                          </span>
                          <Icon name={keepTitleOpen() === keep ? 'checkCircle' : 'radioOff'} />
                        </FocusButton>
                      )}
                    </For>
                  </div>
                </Show>
              </Card>
            </Show>

            <Show when={shows('hidden')}>
              <Card section={section('hidden')}>
                <div class="setting-desc">{t('settings.hiddenDesc')}</div>
                <div class="option-cards" style={{ 'margin-top': '0.8rem' }}>
                  <For each={HIDDEN_KINDS}>
                    {(k) => (
                      <FocusButton id={`settings-hidden-${k.kind}`} onSelect={() => navigate({ name: 'hidden-categories', kind: k.kind })}>
                        <span class="option-card-text">
                          <span class="option-card-title">{t(k.title)}</span>
                          <span class="option-card-sub">{t('hidden.summary', { n: formatNumber(useHiddenCategories(k.kind).hidden().length) })}</span>
                        </span>
                        <Icon name="chevronRight" />
                      </FocusButton>
                    )}
                  </For>
                </div>
                <div class="setting-name setting-gap">{t('settings.grouping')}</div>
                <div class="setting-desc">{t('settings.groupingDesc')}</div>
                <div class="option-cards" style={{ 'margin-top': '0.8rem' }}>
                  <For each={['auto', 'on', 'off'] as CategoryGrouping[]}>
                    {(mode) => (
                      <FocusButton id={`settings-grouping-${mode}`} selected={categoryGrouping() === mode} onSelect={() => setCategoryGrouping(mode)}>
                        <span class="option-card-text">
                          <span class="option-card-title">{t(`settings.grouping.${mode}`)}</span>
                          <span class="option-card-sub">{t(`settings.grouping.${mode}Sub`)}</span>
                        </span>
                        <Icon name={categoryGrouping() === mode ? 'checkCircle' : 'radioOff'} />
                      </FocusButton>
                    )}
                  </For>
                </div>
                <div class="setting-name setting-gap">{t('rename.pageTitle')}</div>
                <div class="setting-desc">{t('rename.settingsDesc')}</div>
                <div class="option-cards" style={{ 'margin-top': '0.8rem' }}>
                  <FocusButton id="settings-rename" onSelect={() => navigate({ name: 'rename-categories' })}>
                    <Icon name="edit" />
                    <span class="option-card-text">
                      <span class="option-card-title">{t('tab.live')}</span>
                      <span class="option-card-sub">{t('rename.count', { n: formatNumber(Object.keys(useCategoryNames('live').names()).length) })}</span>
                    </span>
                    <Icon name="chevronRight" />
                  </FocusButton>
                </div>
              </Card>
            </Show>

            <Show when={shows('home')}>
              <Card section={section('home')} aside={t('settings.homeAside')}>
                <div class="option-cards wrap">
                  <For each={HOME_SECTIONS}>
                    {(h) => (
                      <FocusButton
                        id={`settings-home-${h}`}
                        selected={homeShows(h)}
                        onSelect={() =>
                          setHiddenHomeSections(homeShows(h) ? hiddenHomeSections().concat(h) : hiddenHomeSections().filter((x) => x !== h))
                        }
                      >
                        <span class="option-card-text">
                          <span class="option-card-title">{t(`settings.homeSection.${h}`)}</span>
                          <span class="option-card-sub">{homeShows(h) ? t('settings.shown') : t('settings.hidden')}</span>
                        </span>
                        <Icon name={homeShows(h) ? 'checkCircle' : 'radioOff'} />
                      </FocusButton>
                    )}
                  </For>
                </div>
              </Card>
            </Show>

            <Show when={shows('parental')}>
              <Card section={section('parental')} aside={pinSet() ? t('settings.pinOn') : t('settings.pinOff')}>
                <div class="status-row">
                  <Icon name="lock" />
                  <div class="grow">
                    <div class="setting-name">{pinSet() ? t('settings.pinActive') : t('settings.noPin')}</div>
                    <div class="setting-desc">
                      {pinSet()
                        ? t('settings.pinSet', { cats: formatNumber(lockedCategories().size), chans: formatNumber(lockedChannels().size) })
                        : t('settings.pinNotSet')}
                    </div>
                  </div>
                  <Show
                    when={pinSet()}
                    fallback={
                      <FocusButton id="settings-pin-set" class="btn-primary" onSelect={() => void requestPin('create')}>
                        <Icon name="key" />
                        <span>{t('settings.setPin')}</span>
                      </FocusButton>
                    }
                  >
                    <FocusButton id="settings-pin-change" class="btn-primary" onSelect={() => void requestPin('change')}>
                      <Icon name="key" />
                      <span>{t('settings.changePin')}</span>
                    </FocusButton>
                    <FocusButton id="settings-pin-remove" class="btn-danger" onSelect={() => void requestPin('remove')}>
                      {t('settings.removePin')}
                    </FocusButton>
                  </Show>
                </div>
              </Card>
            </Show>

            <Show when={shows('playlists')}>
              <Card section={section('playlists')}>
                <div class="status-row">
                  <Icon name="playlist" />
                  <div class="grow">
                    <div class="setting-name">
                      <bdi>{activePlaylist()?.name ?? t('playlists.none')}</bdi>
                    </div>
                    <Show when={activePlaylist()}>{(p) => <div class="setting-desc">{countsText(p())}</div>}</Show>
                    <Show when={activePlaylist() && expiryText(activePlaylist()!)}>
                      {(e) => (
                        <div class="setting-desc" classList={{ 'text-warn': e().level === 'soon', 'text-error': e().level === 'expired' }}>
                          {e().text}
                        </div>
                      )}
                    </Show>
                  </div>
                  <FocusButton id="settings-playlists" onSelect={() => navigate({ name: 'playlists' })}>
                    <Icon name="list" />
                    <span>{t('playlists.manage')}</span>
                  </FocusButton>
                </div>
                <Show when={fastStorageAvailable()}>
                  <div class="setting-name setting-gap">{t('settings.storage')}</div>
                  <div class="setting-desc">{t('settings.storageDesc')}</div>
                  <div class="option-cards" style={{ 'margin-top': '0.8rem' }}>
                    <For each={['fast', 'classic'] as StorageMode[]}>
                      {(mode) => (
                        <FocusButton id={`settings-storage-${mode}`} selected={storageMode() === mode} onSelect={() => void changeStorageMode(mode)}>
                          <span class="option-card-text">
                            <span class="option-card-title">{t(`settings.storage.${mode}`)}</span>
                            <span class="option-card-sub">{t(`settings.storage.${mode}Sub`)}</span>
                          </span>
                          <Icon name={storageMode() === mode ? 'checkCircle' : 'radioOff'} />
                        </FocusButton>
                      )}
                    </For>
                  </div>
                </Show>
              </Card>
            </Show>

            <Show when={shows('remote')}>
              <Card section={section('remote')}>
                <div class="remote-settings">
                  <div class="remote-settings-info">
                    <div class="remote-settings-title">{t('settings.remoteName')}</div>
                    <ul class="remote-settings-points">
                      <li>
                        <Icon name="check" />
                        <span>{t('settings.remotePoint1')}</span>
                      </li>
                      <li>
                        <Icon name="check" />
                        <span>{t('settings.remotePoint2')}</span>
                      </li>
                      <li class="remote-settings-warning">
                        <Icon name="info" />
                        <span>{t('settings.remoteWarning')}</span>
                      </li>
                    </ul>
                    <RemoteIdentityLine />
                  </div>
                  <div class="remote-settings-qr">
                    <RemoteQrPanel id="settings-remote" hideText />
                  </div>
                </div>
              </Card>
            </Show>

            <Show when={shows('sync')}>
              <Card section={section('sync')}>
                <SyncCard />
              </Card>
            </Show>

            <Show when={shows('network')}>
              <Card section={section('network')}>
                <SpeedTestCard />
              </Card>
            </Show>

            <Show when={shows('about')}>
              <Card section={section('about')}>
                <div class="status-row">
                  <Icon name="info" />
                  <div class="grow">
                    <div class="setting-name">{t('about.version', { version: __APP_VERSION__ })}</div>
                    <div class="setting-desc">
                      {t('about.platform', { platform: platform.id })} · {t('about.build', { time: __BUILD_TIME__ })}
                    </div>
                  </div>
                  <FocusButton id="settings-about" onSelect={() => navigate({ name: 'about' })}>
                    {t('settings.about')}
                  </FocusButton>
                </div>
                <Show when={platform.updater}>{(updater) => <UpdateRow updater={updater()} />}</Show>
              </Card>
            </Show>
          </div>
        </FocusZone>
      </div>
    </div>
  );
}
