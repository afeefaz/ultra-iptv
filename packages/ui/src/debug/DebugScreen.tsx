import { formatLine, LEVELS, log, logging, toNdjson, type LogEntry, type LogLevel } from '@ultra/core';
import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FocusButton } from '../components/FocusButton';
import { FocusZone, useFocusable } from '../focus';
import { formatNumber, t } from '../i18n';
import { usePlatform } from '../platform-context';
import { addSampleEntries } from './sample-entries';

const MAX_ROWS = 200;
const MAX_LIVE = 5000;
const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

// Stable focus ids per entry, so rows keep their identity as new entries arrive.
const rowIds = new WeakMap<LogEntry, number>();
let nextRowId = 0;
function rowId(entry: LogEntry): number {
  let id = rowIds.get(entry);
  if (id === undefined) {
    id = nextRowId++;
    rowIds.set(entry, id);
  }
  return id;
}

/** Hidden debug screen (spec §10): view, filter, clear and export the local log buffer. */
export function DebugScreen(): JSX.Element {
  const platform = usePlatform();
  const [entries, setEntries] = createSignal<LogEntry[]>([]);
  const [paused, setPaused] = createSignal(false);
  const [minLevel, setMinLevel] = createSignal<LogLevel>('debug');
  const [query, setQuery] = createSignal('');
  const [expanded, setExpanded] = createSignal<LogEntry | null>(null);
  const [showHosts, setShowHosts] = createSignal(false);
  const [confirmClear, setConfirmClear] = createSignal(false);
  const [status, setStatus] = createSignal('');
  const [logLevel, setLogLevel] = createSignal(log.level);

  onMount(async () => {
    const stored = (await logging.buffer?.getAll()) ?? [];
    setEntries(stored);
    const off = log.subscribe((entry) => {
      if (paused()) return;
      setEntries((prev) => (prev.length >= MAX_LIVE ? prev.slice(1 - MAX_LIVE) : prev).concat(entry));
    });
    onCleanup(off);
  });

  const filtered = createMemo(() => {
    const q = query().toLowerCase();
    const min = LEVELS[minLevel()];
    const matches = entries().filter((e) => LEVELS[e.level] >= min && (!q || formatLine(e).toLowerCase().indexOf(q) >= 0));
    return matches.slice(-MAX_ROWS).reverse();
  });

  // Re-read whenever new entries arrive, since logging them may have hashed new hosts.
  const hostPairs = createMemo(() => {
    entries();
    return logging.hosts.lookup();
  });

  const cycleLogLevel = () => {
    const next = LOG_LEVELS[(LOG_LEVELS.indexOf(log.level) + 1) % LOG_LEVELS.length];
    logging.setLevel(next);
    setLogLevel(next);
    log.warn('debug', 'log level changed', { level: next });
  };

  const exportLogs = async () => {
    const all = (await logging.buffer?.getAll()) ?? entries();
    const header = {
      type: 'ultra-iptv-log-export',
      appVersion: __APP_VERSION__,
      exportedAt: new Date().toISOString(),
      device: platform.device(),
      count: all.length,
    };
    const stamp = header.exportedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    await platform.fileExport.exportText(`ultra-iptv-logs-${stamp}.ndjson`, 'application/x-ndjson', JSON.stringify(header) + '\n' + toNdjson(all));
    log.info('debug', 'logs exported', { count: all.length });
    setStatus(t('debug.exported', { count: formatNumber(all.length) }));
  };

  const clearLogs = async () => {
    setConfirmClear(false);
    await logging.buffer?.clear();
    setEntries([]);
    setExpanded(null);
    log.info('debug', 'log buffer cleared');
  };

  const device = platform.device();

  return (
    <div class="screen debug">
      <h1 class="screen-title">{t('debug.title')}</h1>
      <FocusZone id="debug-toolbar" remember>
        <div class="button-row">
          <FocusButton id="debug-pause" autofocus onSelect={() => setPaused(!paused())}>
            {paused() ? t('debug.resume') : t('debug.pause')}
          </FocusButton>
          <FocusButton id="debug-level" onSelect={cycleLogLevel}>
            {t('debug.level', { level: logLevel() })}
          </FocusButton>
          <FocusButton id="debug-sample" onSelect={addSampleEntries}>
            {t('debug.sample')}
          </FocusButton>
          <FocusButton id="debug-export" onSelect={() => void exportLogs()}>
            {t('debug.export')}
          </FocusButton>
          <FocusButton id="debug-clear" class="btn-danger" onSelect={() => setConfirmClear(true)}>
            {t('debug.clear')}
          </FocusButton>
          <FocusButton id="debug-hosts" selected={showHosts()} onSelect={() => setShowHosts(!showHosts())}>
            {t('debug.hosts')}
          </FocusButton>
        </div>
        <div class="button-row">
          <FocusButton id="debug-min-all" selected={minLevel() === 'debug'} onSelect={() => setMinLevel('debug')}>
            {t('debug.all')}
          </FocusButton>
          {(['info', 'warn', 'error'] as LogLevel[]).map((level) => (
            <FocusButton id={`debug-min-${level}`} selected={minLevel() === level} onSelect={() => setMinLevel(level)}>
              <span dir="ltr">{level}+</span>
            </FocusButton>
          ))}
          <TextFilter value={query()} onInput={setQuery} />
        </div>
      </FocusZone>

      <p class="hint" aria-live="polite">
        {t('debug.count', { shown: formatNumber(filtered().length), total: formatNumber(entries().length) })}
        {status() ? ` · ${status()}` : ''}
      </p>

      <Show when={showHosts()}>
        <div class="debug-panel">
          <p class="hint">{t('debug.hostsNote')}</p>
          <For each={hostPairs()} fallback={<p class="hint">{t('debug.noHosts')}</p>}>
            {(pair) => (
              <div class="kv">
                <span class="kv-key" dir="ltr">{pair.label}</span>
                <span class="kv-value" dir="ltr">{pair.host}</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="debug-body">
        <FocusZone id="debug-list" remember>
          <div class="debug-list" dir="ltr">
            <For each={filtered()} fallback={<p class="hint">{t('debug.empty')}</p>}>
              {(entry) => (
                <FocusButton
                  id={`debug-row-${rowId(entry)}`}
                  class={`log-row log-${entry.level}`}
                  onSelect={() => setExpanded(expanded() === entry ? null : entry)}
                >
                  <span class="log-line">{formatLine(entry)}</span>
                  <Show when={expanded() === entry}>
                    <pre class="log-detail">{JSON.stringify(entry, null, 2)}</pre>
                  </Show>
                </FocusButton>
              )}
            </For>
          </div>
        </FocusZone>
        <div class="debug-panel debug-device">
          <h2 class="section-title">{t('debug.device')}</h2>
          {[
            ['platform', device.platform],
            ['engine', device.engine],
            ['screen', `${device.screen.width}×${device.screen.height} @${device.screen.pixelRatio}x`],
            ['language', device.language],
            ['app', `${__APP_VERSION__}${__LEGACY__ ? ' (legacy bundle)' : ''}`],
            ['built', __BUILD_TIME__],
            ['log level', logLevel()],
            ['buffer', logging.buffer ? 'IndexedDB' : 'unavailable'],
          ].map(([k, v]) => (
            <div class="kv">
              <span class="kv-key">{k}</span>
              <span class="kv-value" dir="ltr">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <Show when={confirmClear()}>
        <ConfirmDialog
          id="debug-clear-dialog"
          message={t('debug.clearConfirm')}
          confirmLabel={t('debug.clear')}
          onConfirm={() => void clearLogs()}
          onCancel={() => setConfirmClear(false)}
        />
      </Show>
    </div>
  );
}

/** Text filter: OK starts typing, Up/Down/Back leave the field. TV on-screen keyboard comes in phase 1. */
function TextFilter(props: { value: string; onInput: (v: string) => void }): JSX.Element {
  let input: HTMLInputElement | undefined;
  const ref = useFocusable({ id: 'debug-filter', onSelect: () => input?.focus() });
  return (
    <div ref={ref} class="btn text-field">
      <input
        ref={(el) => (input = el)}
        type="text"
        dir="auto"
        placeholder={t('debug.filter')}
        aria-label={t('debug.filter')}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
    </div>
  );
}
