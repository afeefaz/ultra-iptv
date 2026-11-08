import type { ChannelRow } from '@ultra/core';
import { Show, type JSX } from 'solid-js';
import { useNowNext } from '../data/epg';
import { ChannelLogo } from './ChannelLogo';
import { fitText, Marks, type CellSize } from './LargeBrowse';

/** A channel in the Boxes layout: logo, number and name, and what's on now when the provider has a guide. */
export function ChannelBox(props: {
  channel: ChannelRow;
  size: CellSize;
  guide: boolean;
  favorite: boolean;
  locked: boolean;
  playing: boolean;
}): JSX.Element {
  const epg = useNowNext(() => (props.guide && props.channel.stream.t === 'x' ? props.channel.id : null));
  const logo = () => `${(props.size.height * 0.34).toFixed(2)}rem`;
  return (
    <div class="large-box large-channel" classList={{ 'is-current': props.playing }}>
      <span class="large-logo" style={{ width: logo(), height: logo() }}>
        <ChannelLogo src={props.channel.logo} name={props.channel.name} />
      </span>
      <span class="large-box-name" style={{ 'font-size': fitText(props.channel.name, 2, props.size, 0.13) }}>
        <span class="large-number">{props.channel.num}</span>
        <bdi>{props.channel.name}</bdi>
      </span>
      <span class="large-box-sub" style={{ 'font-size': `${Math.min(1.35, props.size.height * 0.09).toFixed(2)}rem` }}>
        <Show when={epg().now} fallback={<span class="large-now" />}>
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
