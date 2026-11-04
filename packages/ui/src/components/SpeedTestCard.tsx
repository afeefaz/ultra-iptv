import { fetchDownload, log, runSpeedTest, SpeedTestCancelled, type SpeedProgress, type SpeedResult } from '@ultra/core';
import { createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { catalog } from '../data/catalog';
import { stopPlayback } from '../data/playback';
import { activePlaylist } from '../data/playlists';
import { track } from '../data/usage';
import { formatBytes } from '../format';
import { formatNumber, t, type MessageKey } from '../i18n';
import { usePlatform } from '../platform-context';
import { FocusButton } from './FocusButton';
import { Icon } from './Icon';

const TEST_SECONDS = 10;

/** Roughly what a stream needs, highest first. */
const QUALITY: Array<{ mbps: number; label: MessageKey }> = [
  { mbps: 25, label: 'speed.good4k' },
  { mbps: 10, label: 'speed.goodFhd' },
  { mbps: 5, label: 'speed.goodHd' },
  { mbps: 2, label: 'speed.goodSd' },
];

const oneDecimal = (n: number) => formatNumber(Math.round(n * 10) / 10);

/** Speed test against the active playlist's provider (see core/net/speed.ts). */
export function SpeedTestCard(): JSX.Element {
  const platform = usePlatform();
  const [progress, setProgress] = createSignal<SpeedProgress | null>(null);
  const [result, setResult] = createSignal<SpeedResult | null>(null);
  const [error, setError] = createSignal('');
  let cancelled = false;
  onCleanup(() => (cancelled = true));

  const running = () => progress() !== null;

  const start = async () => {
    const id = activePlaylist()?.id;
    if (!id) return;
    cancelled = false;
    setResult(null);
    setError('');
    setProgress({ phase: 'ping', fraction: 0 });
    track('speedTest');
    // Nothing else may share the connection, and providers often allow only one at a time.
    stopPlayback();
    try {
      const targets = await catalog().call('speedTargets', id);
      const outcome = await runSpeedTest(targets, platform.download ?? fetchDownload, {
        seconds: TEST_SECONDS,
        isCancelled: () => cancelled,
        onProgress: setProgress,
      });
      log.info('speed', 'test finished', { mbps: Math.round(outcome.mbps), pingMs: Math.round(outcome.pingMs), estimate: outcome.estimate });
      setResult(outcome);
    } catch (e) {
      if (!(e instanceof SpeedTestCancelled)) {
        log.warn('speed', 'test failed', { error: e });
        setError(t('speed.failed'));
      }
    } finally {
      setProgress(null);
    }
  };

  const quality = () => {
    const mbps = result()?.mbps ?? 0;
    return QUALITY.filter((q) => mbps >= q.mbps)[0]?.label ?? 'speed.tooSlow';
  };

  return (
    <div class="speed-test">
      <div class="status-row">
        <Icon name="sync" />
        <div class="grow">
          <div class="setting-name">{t('speed.title')}</div>
          <div class="setting-desc">{t('speed.desc')}</div>
        </div>
        <Show
          when={running()}
          fallback={
            <FocusButton id="settings-speed" class="btn-primary" onSelect={() => void start()}>
              {result() || error() ? t('speed.again') : t('speed.start')}
            </FocusButton>
          }
        >
          <FocusButton id="settings-speed-stop" onSelect={() => (cancelled = true)}>
            {t('speed.stop')}
          </FocusButton>
        </Show>
      </div>
      <Show when={progress()}>
        {(p) => (
          <div class="speed-running" role="status">
            <div class="setting-name">
              {p().mbps !== undefined ? `${oneDecimal(p().mbps!)} Mbps` : t('speed.connecting')}
            </div>
            <span class="progress progress-accent">
              <span class="progress-fill" style={{ width: `${Math.round(p().fraction * 100)}%` }} />
            </span>
          </div>
        )}
      </Show>
      <Show when={result()}>
        {(r) => (
          <div class="speed-result" role="status">
            <div class="speed-figure">
              <span class="speed-value">{oneDecimal(r().mbps)}</span> Mbps
              <div class="setting-desc">{t('speed.download')}</div>
            </div>
            <div class="speed-figure">
              <span class="speed-value">{oneDecimal(r().peakMbps)}</span> Mbps
              <div class="setting-desc">{t('speed.peak')}</div>
            </div>
            <div class="speed-figure">
              <span class="speed-value">{formatNumber(Math.round(r().pingMs))}</span> ms
              <div class="setting-desc">{t('speed.response')}</div>
            </div>
            <div class="speed-figure">
              <span class="speed-value">{formatBytes(r().bytes, r().bytes >= 1024 ** 3 ? 'GB' : 'MB')}</span>
              <div class="setting-desc">{t('speed.tested')}</div>
            </div>
            <div class="speed-verdict">
              {t(quality())}
              <Show when={r().estimate}> {t('speed.estimate')}</Show>
            </div>
          </div>
        )}
      </Show>
      <Show when={error()}>
        <p class="form-message form-error" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  );
}
