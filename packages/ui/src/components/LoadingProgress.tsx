import type { ContentKind } from '@ultra/core';
import { For, Show, type JSX } from 'solid-js';
import { loadProgress, playlists, refreshing } from '../data/playlists';
import { formatNumber, t } from '../i18n';
import { Icon } from './Icon';

const KINDS: ContentKind[] = ['live', 'vod', 'series'];

/** Slim bar under the top bar while any playlist is loading (spec §5). */
export function LoadingLine(): JSX.Element {
  const running = () => {
    const r = refreshing();
    return playlists().filter((p) => r[p.id])[0];
  };
  return (
    <Show when={running()}>
      {(p) => (
        <div class="loading-line" role="status">
          <span class="loading-line-text">
            {t('loading.line', { name: p().name, percent: formatNumber(loadProgress()[p().id]?.percent ?? 0) })}
          </span>
          <span class="loading-line-track">
            <span class="loading-line-fill" style={{ width: `${loadProgress()[p().id]?.percent ?? 0}%` }} />
          </span>
        </div>
      )}
    </Show>
  );
}

/** Big progress card for a playlist being loaded for the first time. */
export function LoadingCard(props: { playlistId: string }): JSX.Element {
  const progress = () => loadProgress()[props.playlistId];
  const percent = () => progress()?.percent ?? 0;
  return (
    <div class="loading-card" role="status">
      <div class="loading-card-head">
        <span class="loading-card-title">{t('loading.title')}</span>
        <span class="loading-card-percent">{formatNumber(percent())}%</span>
      </div>
      <span class="progress progress-accent loading-card-bar">
        <span class="progress-fill" style={{ width: `${percent()}%` }} />
      </span>
      <div class="loading-steps">
        <For each={KINDS}>
          {(kind) => (
            <div class="loading-step" classList={{ done: progress()?.saved[kind] !== undefined }}>
              <Icon name={progress()?.saved[kind] !== undefined ? 'checkCircle' : 'schedule'} />
              <span>{t(`loading.${kind}`)}</span>
              <Show when={progress()?.saved[kind] !== undefined}>
                <span class="loading-step-count">{formatNumber(progress()!.saved[kind]!)}</span>
              </Show>
            </div>
          )}
        </For>
      </div>
      <p class="hint">{t('loading.hint')}</p>
    </div>
  );
}
