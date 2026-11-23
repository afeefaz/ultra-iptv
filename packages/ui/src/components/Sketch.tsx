import { For, Show, type JSX } from 'solid-js';
import { t, type MessageKey } from '../i18n';
import { FocusButton } from './FocusButton';
import { Icon } from './Icon';

/**
 * Drawn settings: each choice shows a small picture of the screen it gives, so it's seen rather
 * than read (docs/engineering.md, "Settings are drawn").
 */

/** How a block is painted. All take the card's text colour, so focus and themes just work. */
export type Ink =
  | 'faint' // background areas: a bar, a track
  | 'soft' // lines of text, posters
  | 'video' // a picture
  | 'strong' // what the choice is about
  | 'accent' // the selected item in the drawing
  | 'panel' // a box drawn on top of the picture (a card, a popup)
  | 'frame'; // an outline

/** One block, placed in percent of its area. (The layout is left to right in Arabic too.) */
export function B(props: { x: number; y: number; w: number; h: number; ink?: Ink; round?: boolean }): JSX.Element {
  const style = (): JSX.CSSProperties => ({
    left: `${props.x}%`,
    top: `${props.y}%`,
    width: `${props.w}%`,
    height: `${props.h}%`,
  });
  return <span class={`sk sk-${props.ink ?? 'soft'}`} classList={{ 'sk-round': !!props.round }} style={style()} />;
}

/** A part of the drawing with its own percent space, for two small screens side by side. */
export function Area(props: { x: number; y: number; w: number; h: number; children: JSX.Element }): JSX.Element {
  const style = (): JSX.CSSProperties => ({
    left: `${props.x}%`,
    top: `${props.y}%`,
    width: `${props.w}%`,
    height: `${props.h}%`,
  });
  return (
    <span class="sk-area" style={style()}>
      {props.children}
    </span>
  );
}

/** The 16:9 frame a drawing sits in. `class` paints the screen itself (the theme drawings). */
export function Sketch(props: { class?: string; children: JSX.Element }): JSX.Element {
  return (
    <span class="sketch" aria-hidden="true">
      <span class={`sketch-inner ${props.class ?? ''}`}>
        <span class="sk-area sk-full">{props.children}</span>
      </span>
    </span>
  );
}

/** The turn arrow between two small drawings, for Auto: one or the other, as it fits. */
export function SketchEither(props: { first: JSX.Element; second: JSX.Element }): JSX.Element {
  return (
    <>
      <Area x={0} y={14} w={42} h={72}>
        {props.first}
      </Area>
      <span class="sk-turn">
        <Icon name="sync" />
      </span>
      <Area x={58} y={14} w={42} h={72}>
        {props.second}
      </Area>
    </>
  );
}

export interface SketchOption<T> {
  value: T;
  title: string;
  sub?: string;
  sketch: () => JSX.Element;
}

/** A setting as drawings to pick from, with the name and a check under each. */
export function SketchPicker<T extends string | number | boolean>(props: {
  /** Each card's id is `${id}-${value}`. */
  id: string;
  title: MessageKey;
  desc?: MessageKey;
  options: Array<SketchOption<T>>;
  value: T;
  onPick: (value: T) => void;
  /** No gap above: the first setting in its card. */
  first?: boolean;
}): JSX.Element {
  return (
    <>
      <div class="setting-name" classList={{ 'setting-gap': !props.first }}>
        {t(props.title)}
      </div>
      <Show when={props.desc}>{(d) => <div class="setting-desc">{t(d())}</div>}</Show>
      <div class="option-cards layout-picks" classList={{ 'layout-picks-three': props.options.length > 2 }} role="radiogroup" aria-label={t(props.title)}>
        <For each={props.options}>
          {(o) => (
            <FocusButton id={`${props.id}-${String(o.value)}`} class="layout-pick" selected={props.value === o.value} onSelect={() => props.onPick(o.value)}>
              {o.sketch()}
              <span class="layout-pick-label">
                <span class="option-card-text">
                  <span class="option-card-title">{o.title}</span>
                  <Show when={o.sub}>
                    <span class="option-card-sub">{o.sub}</span>
                  </Show>
                </span>
                <Icon name={props.value === o.value ? 'checkCircle' : 'radioOff'} />
              </span>
            </FocusButton>
          )}
        </For>
      </div>
    </>
  );
}
