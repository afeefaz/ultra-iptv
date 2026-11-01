import type { ErrorInfo, PlaylistRecord } from '@ultra/core';
import { formatNumber, locale, t } from './i18n';

export function timeAgo(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('time.justNow');
  if (min < 60) return t('time.minutes', { n: formatNumber(min) });
  const h = Math.floor(min / 60);
  if (h < 48) return t('time.hours', { n: formatNumber(h) });
  return t('time.days', { n: formatNumber(Math.floor(h / 24)) });
}

export function formatDate(ms: number | undefined): string {
  if (!ms) return t('form.never');
  return new Date(ms).toLocaleDateString(locale() === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** User-facing text for a worker error (spec §4.5: say why a provider can't be reached). */
export function errorText(e: unknown): string {
  const info = (e as { info?: ErrorInfo })?.info ?? (e as ErrorInfo);
  switch (info?.code) {
    case 'auth':
      return t('error.auth');
    case 'cors':
      return t('error.cors');
    case 'network':
      return t('error.network');
    case 'timeout':
      return t('error.timeout');
    case 'http':
      return t('error.http', { status: info.status ?? '?' });
    case 'format':
      return t('error.format');
    case 'secure-storage':
      return t('error.secure');
    case 'invalid-input':
      return info.message;
    default:
      return t('error.generic', { message: info?.message ?? String(e) });
  }
}

export function countsText(p: PlaylistRecord): string {
  const c = p.counts ?? {};
  return t('status.counts', {
    live: formatNumber(c.live ?? 0),
    vod: formatNumber(c.vod ?? 0),
    series: formatNumber(c.series ?? 0),
  });
}

export function statusText(p: PlaylistRecord, isRefreshing: boolean): string {
  if (isRefreshing) return t('status.refreshing');
  if (p.lastError) return t('status.failed', { message: errorText(p.lastError) });
  return p.lastSync ? t('status.updated', { when: timeAgo(p.lastSync) }) : t('status.never');
}

/** 75 → "1:15", 3725 → "1:02:05" (always Latin digits, shown LTR). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => (n < 10 ? '0' : '') + n;
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}
