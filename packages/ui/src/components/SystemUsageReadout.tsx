import type { SystemUsage } from '@ultra/platform';
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { showSystemUsage } from '../data/settings';
import { formatBytes } from '../format';
import { t } from '../i18n';
import { usePlatform } from '../platform-context';

const REFRESH_MS = 1000;

const pair = (used: number, total: number) => {
  const unit = total >= 1024 ** 3 ? 'GB' : 'MB';
  return `${formatBytes(used, unit)} / ${formatBytes(total, unit)}`;
};

/** Live memory next to the playlist (Settings → Display). Only runs while it's on. */
export function SystemUsageReadout(): JSX.Element {
  const platform = usePlatform();
  const [usage, setUsage] = createSignal<SystemUsage | null>(null);

  createEffect(() => {
    const read = platform.systemUsage;
    if (!showSystemUsage() || !read) {
      setUsage(null);
      return;
    }
    const tick = () => read().then(setUsage, () => setUsage(null));
    void tick();
    const timer = setInterval(() => void tick(), REFRESH_MS);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <Show when={usage()}>
      {(u) => (
        <div class="system-usage" dir="ltr" role="status">
          <Show when={u().ramUsed !== undefined && u().ramTotal}>
            <span>
              <b>{t('usage.ram')}</b> {pair(u().ramUsed!, u().ramTotal!)}
            </span>
          </Show>
          <Show when={u().appUsed !== undefined}>
            <span>
              <b>{t('usage.app')}</b> {formatBytes(u().appUsed!, 'MB')}
            </span>
          </Show>
        </div>
      )}
    </Show>
  );
}
