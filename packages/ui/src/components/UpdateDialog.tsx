import type { LatestRelease } from '@ultra/core';
import type { AppUpdater } from '@ultra/platform';
import { createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { dismissOfferedUpdate, offeredUpdate } from '../data/autoUpdate';
import { pinRequest } from '../data/parental';
import { FocusZone } from '../focus';
import { t } from '../i18n';
import { useKeys } from '../keys';
import { currentRoute } from '../nav';
import { usePlatform } from '../platform-context';
import { FocusButton } from './FocusButton';
import { Icon } from './Icon';
import { createUpdateFlow } from './UpdateRow';

/**
 * A press that was already on its way when the popup appeared (OK on a channel) mustn't start the
 * update: the buttons wait this long before they answer.
 */
const IGNORE_PRESSES_MS = 800;

/**
 * Rendered once by the App. Shows what the automatic check found, but never over the full-screen
 * player or the PIN pad: it waits until they close.
 */
export function UpdateHost(): JSX.Element {
  const platform = usePlatform();
  const shown = () => (currentRoute().name !== 'player' && !pinRequest() ? offeredUpdate() : null);
  return (
    <Show when={platform.updater && shown()} keyed>
      {(latest) => <UpdateDialog updater={platform.updater as AppUpdater} latest={latest} />}
    </Show>
  );
}

function UpdateDialog(props: { updater: AppUpdater; latest: LatestRelease }): JSX.Element {
  const { state, act, label, description, notes, percent } = createUpdateFlow(props.updater, usePlatform(), props.latest);
  const [ready, setReady] = createSignal(false);
  const timer = setTimeout(() => setReady(true), IGNORE_PRESSES_MS);
  onCleanup(() => clearTimeout(timer));

  const later = () => {
    if (ready()) dismissOfferedUpdate();
  };
  useKeys((press) => {
    if (press.key !== 'back') return false;
    later();
    return true;
  });

  return (
    <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && later()}>
      <FocusZone id="update-popup" trap>
        <div class="dialog update-dialog" role="alertdialog" aria-modal="true" aria-labelledby="update-popup-title">
          <h2 class="dialog-title update-dialog-title" id="update-popup-title">
            <Icon name="sync" />
            <span>{t('update.popupTitle')}</span>
          </h2>
          <p class="dialog-message" classList={{ 'text-error': state().kind === 'error' }} role="status">
            {description()}
          </p>
          <Show when={percent() !== null}>
            <div class="update-bar">
              <div class="update-bar-fill" style={{ width: `${percent()}%` }} />
            </div>
          </Show>
          <Show when={notes().length}>
            <div class="update-dialog-notes-title">{t('update.whatsNew')}</div>
            <ul class="update-notes update-dialog-notes">
              <For each={notes()}>{(note) => <li>{note}</li>}</For>
            </ul>
          </Show>
          <div class="dialog-actions">
            <FocusButton id="update-popup-later" onSelect={later}>
              {t('update.later')}
            </FocusButton>
            <FocusButton id="update-popup-update" class="btn-primary" autofocus onSelect={() => ready() && act()}>
              {label()}
            </FocusButton>
          </div>
        </div>
      </FocusZone>
    </div>
  );
}
