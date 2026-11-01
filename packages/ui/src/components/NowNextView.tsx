import type { NowNext } from '@ultra/core';
import { Show, type JSX } from 'solid-js';
import { formatClock } from '../data/epg';
import { t } from '../i18n';

/** Now/next with a progress bar (spec §5). Renders nothing when there's no guide data. */
export function NowNextView(props: { data: NowNext; compact?: boolean }): JSX.Element {
  return (
    <Show when={props.data.now || props.data.next}>
      <div class={props.compact ? 'now-next compact' : 'now-next'}>
        <Show when={props.data.now}>
          {(now) => (
            <>
              <div class="nn-line">
                <span class="nn-time" dir="ltr">
                  {formatClock(now().start)}–{formatClock(now().stop)}
                </span>
                <span class="nn-title">
                  <bdi>{now().title}</bdi>
                </span>
              </div>
              <div class="progress">
                <div class="progress-fill" style={{ width: `${Math.round((props.data.progress ?? 0) * 100)}%` }} />
              </div>
              <Show when={!props.compact && now().description}>
                <p class="nn-desc">
                  <bdi>{now().description}</bdi>
                </p>
              </Show>
            </>
          )}
        </Show>
        <Show when={!props.compact && props.data.next}>
          {(next) => (
            <div class="nn-line nn-next">
              <span class="nn-label">{t('player.next')}</span>
              <span class="nn-time" dir="ltr">
                {formatClock(next().start)}
              </span>
              <span class="nn-title">
                <bdi>{next().title}</bdi>
              </span>
            </div>
          )}
        </Show>
      </div>
    </Show>
  );
}
