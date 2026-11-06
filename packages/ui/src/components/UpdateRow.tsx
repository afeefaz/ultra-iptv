import type { LatestRelease } from '@ultra/core';
import type { AppUpdater, UpdateProblem } from '@ultra/platform';
import { createSignal, For, Show, type JSX } from 'solid-js';
import { checkForUpdate } from '../data/appUpdate';
import { track } from '../data/usage';
import { usePlatform } from '../platform-context';
import { locale, t, type MessageKey } from '../i18n';
import { FocusButton } from './FocusButton';
import { Icon } from './Icon';

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available'; latest: LatestRelease }
  | { kind: 'permission'; latest: LatestRelease; settingsMissing?: boolean }
  | { kind: 'downloading'; latest: LatestRelease; percent: number }
  | { kind: 'installing'; latest: LatestRelease }
  | { kind: 'error'; message: MessageKey; latest?: LatestRelease };

const PROBLEMS: Record<UpdateProblem, MessageKey> = {
  network: 'update.errorNetwork',
  corrupt: 'update.errorCorrupt',
  storage: 'update.errorStorage',
  refused: 'update.errorRefused',
  install: 'update.errorInstall',
};

/** Check for updates, in Settings. Only shown where the app can update itself. */
export function UpdateRow(props: { updater: AppUpdater }): JSX.Element {
  const platform = usePlatform();
  const [state, setState] = createSignal<State>({ kind: 'idle' });

  const check = async () => {
    setState({ kind: 'checking' });
    const result = await checkForUpdate(platform);
    if (result.kind === 'available') setState({ kind: 'available', latest: result.latest });
    else if (result.kind === 'current') setState({ kind: 'current' });
    else setState({ kind: 'error', message: 'update.errorOffline' });
  };

  const update = async (latest: LatestRelease) => {
    const info = await props.updater.info();
    if (!info.canInstall) return setState({ kind: 'permission', latest });
    track('update.install');
    setState({ kind: 'downloading', latest, percent: 0 });
    await props.updater.install(latest, {
      onProgress: (percent) => setState({ kind: 'downloading', latest, percent }),
      onInstalling: () => setState({ kind: 'installing', latest }),
      onCancelled: () => setState({ kind: 'available', latest }),
      onProblem: (problem) => setState({ kind: 'error', message: PROBLEMS[problem], latest }),
    });
  };

  const openPermission = async (latest: LatestRelease) => {
    // Update checks the permission again when they come back, or says so if they didn't allow it.
    setState((await props.updater.openInstallPermission()) ? { kind: 'available', latest } : { kind: 'permission', latest, settingsMissing: true });
  };

  // One button that stays in place. If it disappeared while busy, the remote's focus would be lost.
  const label = (): string => {
    const s = state();
    switch (s.kind) {
      case 'checking':
        return t('update.checking');
      case 'downloading':
      case 'installing':
        return t('update.updating');
      case 'permission':
        return s.settingsMissing ? t('update.install', { version: s.latest.versionName }) : t('update.openSettings');
      case 'available':
        return t('update.install', { version: s.latest.versionName });
      case 'error':
        return s.latest ? t('update.install', { version: s.latest.versionName }) : t('update.check');
      default:
        return t('update.check');
    }
  };

  const act = () => {
    const s = state();
    if (s.kind === 'checking' || s.kind === 'downloading' || s.kind === 'installing') return;
    if (s.kind === 'permission' && !s.settingsMissing) return void openPermission(s.latest);
    if ('latest' in s && s.latest) return void update(s.latest);
    void check();
  };

  const latestOf = () => {
    const s = state();
    return 'latest' in s ? s.latest : undefined;
  };
  const notes = () => {
    const latest = latestOf();
    return latest ? (locale() === 'ar' ? latest.notes.ar : latest.notes.en) : [];
  };

  const description = (): string => {
    const s = state();
    switch (s.kind) {
      case 'checking':
        return t('update.checking');
      case 'current':
        return t('update.current');
      case 'available':
        return t('update.available', { version: s.latest.versionName });
      case 'permission':
        return t(s.settingsMissing ? 'update.permissionManual' : 'update.permission');
      case 'downloading':
        return t('update.downloading', { percent: s.percent });
      case 'installing':
        return t('update.installing');
      case 'error':
        return t(s.message);
      default:
        return t('update.desc');
    }
  };

  return (
    <div class="status-row update-row">
      <Icon name="sync" />
      <div class="grow">
        <div class="setting-name">{t('update.title')}</div>
        <div class="setting-desc" classList={{ 'text-error': state().kind === 'error' }} role="status">
          {description()}
        </div>
        <Show when={state().kind === 'downloading'}>
          <div class="update-bar">
            <div class="update-bar-fill" style={{ width: `${(state() as { percent: number }).percent}%` }} />
          </div>
        </Show>
        <Show when={state().kind === 'available' && notes().length}>
          <ul class="update-notes">
            <For each={notes()}>{(note) => <li>{note}</li>}</For>
          </ul>
        </Show>
      </div>
      <FocusButton id="settings-update" onSelect={act}>
        {label()}
      </FocusButton>
    </div>
  );
}
