import type { BufferProfile, PictureFit } from '@ultra/platform';
import { For, Show, type JSX } from 'solid-js';
import { B, Sketch, SketchEither } from '../components/Sketch';
import type { CategoryGrouping, DetailMode, SubtitleSize, Theme } from '../data/settings';

/**
 * The drawings behind each drawn setting (components/Sketch.tsx). Coordinates are percent of a
 * 16:9 frame; a circle is about 1.8 times taller in percent than it is wide.
 */

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** The app's top bar: logo, optional section tabs, optional memory readout, playlist and gear. */
function TopBar(props: { tabs?: boolean; usage?: boolean }): JSX.Element {
  return (
    <>
      <B x={0} y={0} w={100} h={15} ink="faint" />
      <B x={3} y={4} w={9} h={7} ink="strong" />
      <Show when={props.tabs}>
        <For each={range(4)}>{(i) => <B x={17 + i * 10} y={5} w={8} h={5} ink={i === 0 ? 'accent' : 'soft'} />}</For>
      </Show>
      <Show when={props.usage}>
        <B x={52} y={5} w={18} h={5} ink="accent" />
      </Show>
      <B x={74} y={3.5} w={13} h={8} ink="frame" />
      <B x={90} y={2.5} w={6} h={10.5} ink="soft" round />
    </>
  );
}

/** Posters under a top bar. */
function Posters(props: { top: number }): JSX.Element {
  const rows = 2;
  const height = (96 - props.top) / rows;
  return (
    <For each={range(rows * 4)}>
      {(i) => <B x={3 + (i % 4) * 24} y={props.top + Math.floor(i / 4) * height + 2} w={21} h={height - 4} />}
    </For>
  );
}

/** Live TV: categories, channels and the preview. */
function LiveScreen(props: { rail: JSX.Element; railWidth: number }): JSX.Element {
  const list = props.railWidth + 4;
  return (
    <>
      {props.rail}
      <For each={range(6)}>{(i) => <B x={list} y={6 + i * 15} w={30} h={8} />}</For>
      <B x={list + 34} y={6} w={96 - list - 34} h={40} ink="video" />
      <B x={list + 34} y={52} w={(96 - list - 34) * 0.8} h={6} />
      <B x={list + 34} y={63} w={(96 - list - 34) * 0.5} h={6} />
    </>
  );
}

/** The player's timeline at the bottom. */
function Timeline(props: { played: number }): JSX.Element {
  return (
    <>
      <B x={5} y={86} w={90} h={5} ink="faint" />
      <B x={5} y={86} w={90 * props.played} h={5} ink="accent" />
    </>
  );
}

export function BufferSketch(props: { profile: BufferProfile }): JSX.Element {
  const ahead = () => ({ low: 6, balanced: 22, stable: 52 })[props.profile];
  return (
    <Sketch>
      <B x={0} y={0} w={100} h={74} ink="video" />
      <B x={0} y={84} w={100} h={7} ink="faint" />
      <B x={0} y={84} w={30 + ahead()} h={7} ink="soft" />
      <B x={0} y={84} w={30} h={7} ink="accent" />
      <B x={27.5} y={83} w={5} h={9} ink="strong" round />
    </Sketch>
  );
}

/** A square picture on a wide screen, with a round subject so a stretch shows. */
export function PictureSketch(props: { fit: PictureFit }): JSX.Element {
  return (
    <Sketch>
      <B x={0} y={0} w={100} h={100} ink="faint" />
      <Show
        when={props.fit === 'fit'}
        fallback={
          <>
            <B x={0} y={0} w={100} h={100} ink="video" />
            <B x={36.6} y={props.fit === 'fill' ? 26.3 : 32.2} w={26.8} h={props.fit === 'fill' ? 47.4 : 35.6} ink="strong" round />
          </>
        }
      >
        <B x={12.5} y={0} w={75} h={100} ink="video" />
        <B x={40} y={32.2} w={20} h={35.6} ink="strong" round />
      </Show>
    </Sketch>
  );
}

export function PictureSkipSketch(props: { shown: boolean }): JSX.Element {
  return (
    <Sketch>
      <B x={0} y={0} w={100} h={100} ink="video" />
      <Show when={props.shown}>
        <B x={16} y={30} w={13} h={23} ink="panel" round />
        <B x={71} y={30} w={13} h={23} ink="panel" round />
      </Show>
      <Timeline played={0.4} />
    </Sketch>
  );
}

export function AutoPlayNextSketch(props: { on: boolean }): JSX.Element {
  return (
    <Sketch>
      <B x={0} y={0} w={100} h={100} ink="video" />
      <Show when={props.on} fallback={<B x={43} y={33} w={14} h={25} ink="panel" round />}>
        <B x={56} y={40} w={38} h={36} ink="panel" />
        <B x={59} y={46} w={14} h={24} ink="soft" />
        <B x={76} y={48} w={15} h={6} ink="soft" />
        <B x={76} y={59} w={10} h={6} ink="accent" />
      </Show>
      <Timeline played={0.98} />
    </Sketch>
  );
}

export function SubtitleSketch(props: { size: SubtitleSize }): JSX.Element {
  // Two centred lines, as subtitles sit.
  const lines = () =>
    ({
      small: [
        [32, 70, 36, 5],
        [37, 79, 26, 5],
      ],
      medium: [
        [26, 64, 48, 7.5],
        [33, 76, 34, 7.5],
      ],
      large: [
        [17, 56, 66, 10.5],
        [27, 72, 46, 10.5],
      ],
    })[props.size];
  return (
    <Sketch>
      <B x={0} y={0} w={100} h={100} ink="video" />
      <For each={lines()}>{(l) => <B x={l[0]} y={l[1]} w={l[2]} h={l[3]} ink="panel" />}</For>
    </Sketch>
  );
}

/** The theme's own colours, not the card's: you see the app as it will look. */
export function ThemeSketch(props: { theme: Theme }): JSX.Element {
  return (
    <Sketch class={`sk-theme sk-theme-${props.theme}`}>
      <TopBar tabs />
      <Posters top={20} />
    </Sketch>
  );
}

export function TopBarSketch(props: { tabs: boolean }): JSX.Element {
  return (
    <Sketch>
      <TopBar tabs={props.tabs} />
      <Posters top={20} />
    </Sketch>
  );
}

export function UsageSketch(props: { shown: boolean }): JSX.Element {
  return (
    <Sketch>
      <TopBar usage={props.shown} />
      <Posters top={20} />
    </Sketch>
  );
}

/** Movies with a title open beside the grid, or the grid alone. */
function InlineDetail(props: { open: boolean; pick: number }): JSX.Element {
  const columns = () => (props.open ? 2 : 4);
  return (
    <>
      <For each={range(6)}>{(i) => <B x={2} y={6 + i * 15} w={18} h={8} ink={i === props.pick ? 'accent' : 'soft'} />}</For>
      <For each={range(columns() * 3)}>
        {(i) => <B x={23 + (i % columns()) * 17} y={5 + Math.floor(i / columns()) * 31} w={15} h={28} ink={props.open && i === 0 ? 'strong' : 'soft'} />}
      </For>
      <Show when={props.open}>
        <B x={58} y={4} w={40} h={92} ink="panel" />
        <B x={61} y={8} w={12} h={30} ink="soft" />
        <B x={76} y={10} w={19} h={6} ink="soft" />
        <B x={76} y={20} w={14} h={4} ink="soft" />
        <B x={61} y={45} w={34} h={4} ink="soft" />
        <B x={61} y={53} w={28} h={4} ink="soft" />
        <B x={61} y={82} w={14} h={8} ink="accent" />
      </Show>
    </>
  );
}

export function DetailSketch(props: { mode: DetailMode }): JSX.Element {
  return (
    <Sketch>
      <Show when={props.mode === 'page'} fallback={<InlineDetail open pick={1} />}>
        <B x={0} y={0} w={100} h={50} ink="video" />
        <B x={5} y={26} w={17} h={54} ink="strong" />
        <B x={26} y={56} w={40} h={7} ink="strong" />
        <B x={26} y={68} w={55} h={4} />
        <B x={26} y={75} w={45} h={4} />
        <B x={26} y={85} w={14} h={9} ink="accent" />
        <B x={42} y={85} w={14} h={9} />
      </Show>
    </Sketch>
  );
}

export function KeepOpenSketch(props: { keep: boolean }): JSX.Element {
  return (
    <Sketch>
      <InlineDetail open={props.keep} pick={3} />
    </Sketch>
  );
}

export function GroupPickerSketch(props: { shown: boolean }): JSX.Element {
  return (
    <Sketch>
      <Show
        when={props.shown}
        fallback={<LiveScreen railWidth={22} rail={<For each={range(6)}>{(i) => <B x={2} y={6 + i * 15} w={22} h={8} ink={i === 0 ? 'accent' : 'soft'} />}</For>} />}
      >
        <LiveScreen
          railWidth={22}
          rail={
            <>
              <B x={2} y={4} w={22} h={10} ink="frame" />
              <For each={range(5)}>{(i) => <B x={2} y={20 + i * 15} w={22} h={8} ink={i === 0 ? 'accent' : 'soft'} />}</For>
            </>
          }
        />
      </Show>
    </Sketch>
  );
}

/** The channel list: every row with what's on, or only the one you're on, with room for more rows. */
export function GuideRowsSketch(props: { every: boolean }): JSX.Element {
  const rows = () => (props.every ? 5 : 7);
  const height = () => 94 / rows();
  return (
    <Sketch>
      <For each={range(rows())}>
        {(i) => {
          const y = 3 + i * height();
          const picked = i === 1;
          return (
            <>
              <Show when={picked}>
                <B x={1} y={y} w={98} h={height() - 2} ink="faint" />
              </Show>
              <B x={4} y={y + 2} w={8} h={height() - 6} ink={picked ? 'accent' : 'soft'} />
              <B x={16} y={y + (props.every || picked ? 2 : height() / 2 - 3)} w={34} h={5} ink="strong" />
              <Show when={props.every || picked}>
                <B x={16} y={y + 9.5} w={56} h={3.5} />
              </Show>
            </>
          );
        }}
      </For>
    </Sketch>
  );
}

export function LiveRecentSketch(props: { shown: boolean }): JSX.Element {
  return (
    <Sketch>
      <LiveScreen
        railWidth={24}
        rail={
          <>
            <Show when={props.shown}>
              <B x={2} y={5} w={5} h={9} ink="accent" round />
              <B x={9} y={6} w={17} h={7} ink="accent" />
            </Show>
            <For each={range(props.shown ? 5 : 6)}>{(i) => <B x={2} y={(props.shown ? 21 : 6) + i * 15} w={24} h={8} />}</For>
          </>
        }
      />
    </Sketch>
  );
}

/** Hidden categories: names under shared starts, or one plain list. */
function GroupedList(props: { grouped: boolean }): JSX.Element {
  return (
    <Show when={props.grouped} fallback={<For each={range(7)}>{(i) => <B x={4} y={5 + i * 13} w={70} h={7} />}</For>}>
      <For each={[0, 1]}>
        {(g) => (
          <>
            <B x={4} y={5 + g * 48} w={40} h={8} ink="strong" />
            <For each={range(3)}>{(i) => <B x={14} y={17 + g * 48 + i * 11} w={60} h={6} />}</For>
          </>
        )}
      </For>
    </Show>
  );
}

export function GroupingSketch(props: { mode: CategoryGrouping }): JSX.Element {
  return (
    <Sketch>
      <Show when={props.mode === 'auto'} fallback={<GroupedList grouped={props.mode === 'on'} />}>
        <SketchEither first={<GroupedList grouped />} second={<GroupedList grouped={false} />} />
      </Show>
    </Sketch>
  );
}
