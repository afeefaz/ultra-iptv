import type { ChannelRow } from '@ultra/core';
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { largeLayout } from '../data/settings';
import { useNowNext } from '../data/epg';
import { formatNumber, t } from '../i18n';
import { ChannelLogo } from './ChannelLogo';
import { Icon, type IconName } from './Icon';
import { TextField } from './TextField';
import { VirtualGrid, type VirtualGridApi } from './VirtualGrid';

export interface LargeCategory {
  id: string;
  name: string;
  count: number;
  locked: boolean;
  icon?: IconName;
}

export interface LiveLargeApi {
  focus(index: number): void;
}

export interface LiveLargeProps {
  step: 'categories' | 'channels';
  categories: LargeCategory[];
  /** The open category, marked among the others. */
  current: string;
  channels: ChannelRow[];
  /** Box or row the step opens on. */
  startIndex: number;
  pinned: (id: string) => boolean;
  favorite: (key: string) => boolean;
  locked: (channel: ChannelRow) => boolean;
  playing: (key: string) => boolean;
  /** Programme names in the channel boxes (Xtream, and only if Settings allows a guide request per row). */
  guide: boolean;
  /** The search box above the boxes: categories by name, or the open category's channels. */
  query: string;
  onQuery: (q: string) => void;
  searchLabel: string;
  empty: JSX.Element;
  onOpenCategory: (c: LargeCategory) => void;
  onFocusCategory: (c: LargeCategory) => void;
  onPlay: (c: ChannelRow) => void;
  onFocusChannel: (c: ChannelRow) => void;
  ref?: (api: LiveLargeApi) => void;
}

/**
 * Live TV for reading from across the room (Settings → Appearance): categories full screen, then
 * the channels of one, in boxes sized so a chosen number fits the screen. The focus ids
 * are the standard layout's (`lcat-`, `lch-`), so Yellow, Red and the number keys work the same.
 */
export function LiveLarge(props: LiveLargeProps): JSX.Element {
  let area: HTMLDivElement | undefined;
  // The height available, in rem: the boxes fill it, and the text-size setting still applies.
  const [areaRem, setAreaRem] = createSignal(0);
  onMount(() => {
    const measure = () => {
      if (!area) return;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize || '16');
      setAreaRem(Math.floor((area.clientHeight / rem) * 10) / 10);
    };
    measure();
    window.addEventListener('resize', measure);
    onCleanup(() => window.removeEventListener('resize', measure));
  });

  let grid: VirtualGridApi | undefined;
  props.ref?.({ focus: (index) => grid?.focusIndex(index) });

  // Remounted when the shape or the space changes: the grid measures its rows once.
  const shape = () => (areaRem() > 0 ? `${props.step}|${largeLayout().columns}|${largeLayout().rows}|${areaRem()}` : '');
  const rowRem = () => areaRem() / largeLayout().rows;

  return (
    <div class="live-large">
      <div class="pane-tools live-large-tools">
        <TextField id={props.step === 'categories' ? 'lcat-search' : 'lch-search'} compact label={props.searchLabel} value={props.query} onChange={props.onQuery} />
      </div>
      <div class="live-large-area" ref={(el) => (area = el)}>
        <Show when={shape()} keyed>
          {(key) => key && body()}
        </Show>
      </div>
    </div>
  );

  function body(): JSX.Element {
    return props.step === 'categories' ? (
      <VirtualGrid
        id="lcat"
        label={t('live.largeTitle')}
        items={props.categories}
        columns={largeLayout().columns}
        rowHeight={rowRem()}
        autofocusIndex={props.startIndex}
        ref={(api) => (grid = api)}
        empty={<p class="hint pane-empty">{t('search.noCategories')}</p>}
        onFocusItem={(c) => props.onFocusCategory(c)}
        onSelect={(c) => props.onOpenCategory(c)}
        renderItem={(c) => <CategoryBox category={c} current={c.id === props.current} pinned={props.pinned(c.id)} size={rowRem()} />}
      />
    ) : (
      <VirtualGrid
        id="lch"
        label={t('tab.live')}
        items={props.channels}
        columns={largeLayout().columns}
        rowHeight={rowRem()}
        autofocusIndex={props.startIndex}
        ref={(api) => (grid = api)}
        empty={props.empty}
        onFocusItem={(c) => props.onFocusChannel(c)}
        onSelect={(c) => props.onPlay(c)}
        renderItem={(c) => (
          <ChannelBox channel={c} size={rowRem()} guide={props.guide} favorite={props.favorite(c.key)} locked={props.locked(c)} playing={props.playing(c.key)} />
        )}
      />
    );
  }
}

/** Text as big as the text-size setting makes it, but never too big for its box. */
const fit = (base: number, size: number, share: number) => `${Math.min(base, size * share).toFixed(2)}rem`;

function Marks(props: { locked: boolean; pinned?: boolean; favorite?: boolean }): JSX.Element {
  return (
    <>
      <Show when={props.favorite}>
        <span class="fav-star">
          <Icon name="starFill" />
        </span>
      </Show>
      <Show when={props.pinned}>
        <span class="pin-mark" aria-label={t('categories.pinned')}>
          <Icon name="pinFill" />
        </span>
      </Show>
      <Show when={props.locked}>
        <span class="lock-icon" aria-label={t('live.lock')}>
          <Icon name="lock" />
        </span>
      </Show>
    </>
  );
}

function CategoryBox(props: { category: LargeCategory; current: boolean; pinned: boolean; size: number }): JSX.Element {
  return (
    <div class="large-box" classList={{ 'is-current': props.current }}>
      <Show when={props.category.icon}>{(name) => <Icon name={name()} />}</Show>
      <span class="large-box-name" style={{ 'font-size': fit(2.2, props.size, 0.16) }}>
        <bdi>{props.category.name}</bdi>
      </span>
      <span class="large-box-sub" style={{ 'font-size': fit(1.4, props.size, 0.1) }}>
        {props.category.count === 1 ? t('live.channelCountOne') : t('live.channelCount', { n: formatNumber(props.category.count) })}
        <Marks locked={props.category.locked} pinned={props.pinned} />
      </span>
    </div>
  );
}

function useNow(props: { channel: ChannelRow; guide: boolean }) {
  return useNowNext(() => (props.guide && props.channel.stream.t === 'x' ? props.channel.id : null));
}

function ChannelBox(props: { channel: ChannelRow; size: number; guide: boolean; favorite: boolean; locked: boolean; playing: boolean }): JSX.Element {
  const epg = useNow(props);
  const logo = () => `${(props.size * 0.34).toFixed(2)}rem`;
  return (
    <div class="large-box large-channel" classList={{ 'is-current': props.playing }}>
      <span class="large-logo" style={{ width: logo(), height: logo() }}>
        <ChannelLogo src={props.channel.logo} name={props.channel.name} />
      </span>
      <span class="large-box-name" style={{ 'font-size': fit(2, props.size, 0.13) }}>
        <span class="large-number">{props.channel.num}</span>
        <bdi>{props.channel.name}</bdi>
      </span>
      <span class="large-box-sub" style={{ 'font-size': fit(1.3, props.size, 0.09) }}>
        <Show when={epg().now} fallback={<span />}>
          {(now) => (
            <span class="large-now">
              <bdi>{now().title}</bdi>
            </span>
          )}
        </Show>
        <Marks locked={props.locked} favorite={props.favorite} />
      </span>
    </div>
  );
}
