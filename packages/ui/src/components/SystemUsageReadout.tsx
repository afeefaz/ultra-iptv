import type { SystemUsage } from '@ultra/platform';
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { showSystemUsage } from '../data/settings';
import { formatBytes } from '../format';
import { locale, t } from '../i18n';
import { usePlatform } from '../platform-context';

const REFRESH_MS = 1000;

const pair = (used: number, total: number) => {
  const unit = total >= 1024 ** 3 ? 'GB' : 'MB';
  return `${formatBytes(used, unit)} / ${formatBytes(total, unit)}`;
};

/**
 * Live memory next to the playlist (Settings → Display). Only runs while it's on. In Arabic each
 * item reads right to left (label first, on the right); the figures stay left to right, kept apart
 * so they aren't reordered around the Arabic words.
 */
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
        <div class="system-usage" dir={locale() === 'ar' ? 'rtl' : 'ltr'} role="status">
          <Show when={u().ramUsed !== undefined && u().ramTotal}>
            <span class="system-usage-item">
              <b>{t('usage.ram')}</b>
              <bdi dir="ltr">{pair(u().ramUsed!, u().ramTotal!)}</bdi>
            </span>
          </Show>
          <Show when={u().appUsed !== undefined}>
            <span class="system-usage-item">
              <b>{t('usage.app')}</b>
              <bdi dir="ltr">{formatBytes(u().appUsed!, 'MB')}</bdi>
            </span>
          </Show>
        </div>
      )}
    </Show>
  );
}
