import type { ContentKind, StreamFormat } from '@ultra/core';
import type { BufferProfile } from '@ultra/platform';
import { For, Show, type JSX } from 'solid-js';
import { FocusButton } from '../components/FocusButton';
import { Icon, type IconName } from '../components/Icon';
import { RemoteQrPanel } from '../components/RemoteQrPanel';
import { SyncCard } from '../components/SyncCard';
import { UpdateRow } from '../components/UpdateRow';
import { RemoteIdentityLine } from '../components/RemoteRefreshButton';
import { SpeedTestCard } from '../components/SpeedTestCard';
import { CATEGORY_SORTS, useHiddenCategories } from '../data/categories';
import { lockedCategories, lockedChannels, pinSet, requestPin } from '../data/parental';
import { activePlaylist } from '../data/playlists';
import {
  bufferProfile,
  defaultCatSort,
  defaultVodSort,
  detailMode,
  guideOnEveryRow,
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
import { focusManager, FocusZone } from '../focus';
import { countsText } from '../format';
import { formatNumber, locale, setLocale, t, type Locale, type MessageKey } from '../i18n';
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
  /** First control of the section, focused when the menu entry is chosen. */
  first: () => string;
}

const SECTIONS: Section[] = [
  { id: 'general', icon: 'language', title: 'settings.language', first: () => `settings-lang-${locale()}` },
  { id: 'playback', icon: 'tune', title: 'settings.playback', first: () => `settings-format-${streamFormat()}` },
  { id: 'subtitles', icon: 'subtitles', title: 'settings.subtitles', first: () => `settings-subsize-${subtitleSize()}` },
  { id: 'display', icon: 'tv', title: 'settings.display', first: () => 'settings-text-down' },
  { id: 'browsing', icon: 'grid', title: 'settings.browsing', first: () => `settings-detail-${detailMode()}` },
  { id: 'hidden', icon: 'list', title: 'settings.hiddenCategories', first: () => 'settings-hidden-live' },
  { id: 'home', icon: 'layers', title: 'settings.home', first: () => 'settings-home-hero' },
  { id: 'parental', icon: 'shield', title: 'settings.parental', first: () => (pinSet() ? 'settings-pin-change' : 'settings-pin-set') },
  { id: 'playlists', icon: 'playlist', title: 'settings.playlists', first: () => 'settings-playlists' },
  { id: 'remote', icon: 'link', title: 'settings.remote', first: () => 'settings-remote-refresh' },
  { id: 'sync', icon: 'sync', title: 'settings.sync', first: () => 'settings-sync-push' },
  { id: 'network', icon: 'sync', title: 'settings.network', first: () => 'settings-speed' },
  { id: 'about', icon: 'info', title: 'settings.about', first: () => 'settings-about' },
];

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

const VOD_SORTS: SortBy[] = ['added', 'name', 'rating', 'year'];
const HIDDEN_KINDS: Array<{ kind: ContentKind; title: MessageKey }> = [
  { kind: 'live', title: 'tab.live' },
  { kind: 'vod', title: 'tab.movies' },
  { kind: 'series', title: 'tab.series' },
];

export function SettingsScreen(): JSX.Element {
  const platform = usePlatform();
  const section = (id: string) => SECTIONS.filter((s) => s.id === id)[0];
  const jump = (s: Section) => {
    document.getElementById(`settings-${s.id}`)?.scrollIntoView();
    focusManager.focus(s.first());
  };

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
            <For each={SECTIONS}>
              {(s) => (
                <FocusButton id={`settings-menu-${s.id}`} class="list-item" autofocus={s.id === 'general'} onSelect={() => jump(s)}>
                  <Icon name={s.icon} />
                  <span class="list-label">{t(s.title)}</span>
                  <Icon name="chevronRight" />
                </FocusButton>
              )}
            </For>
          </nav>
        </FocusZone>
        <FocusZone id="settings" remember>
          <div class="settings-sections">
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
            </Card>

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
            </Card>

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

            <Card section={section('playlists')}>
              <div class="status-row">
                <Icon name="playlist" />
                <div class="grow">
                  <div class="setting-name">
                    <bdi>{activePlaylist()?.name ?? t('playlists.none')}</bdi>
                  </div>
                  <Show when={activePlaylist()}>{(p) => <div class="setting-desc">{countsText(p())}</div>}</Show>
                </div>
                <FocusButton id="settings-playlists" onSelect={() => navigate({ name: 'playlists' })}>
                  <Icon name="list" />
                  <span>{t('playlists.manage')}</span>
                </FocusButton>
              </div>
            </Card>

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

            <Card section={section('sync')}>
              <SyncCard />
            </Card>

            <Card section={section('network')}>
              <SpeedTestCard />
            </Card>

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
          </div>
        </FocusZone>
      </div>
    </div>
  );
}
