import { formatDeviceKey } from '@ultra/core/pair';
import { createSignal, Show, type JSX } from 'solid-js';
import { checkNow, remoteIdentity, type CheckOutcome } from '../data/remoteAccess';
import { FocusZone } from '../focus';
import { t } from '../i18n';
import { useKeys } from '../keys';
import { FocusButton } from './FocusButton';
import { Icon } from './Icon';

function messageFor(outcome: CheckOutcome): string {
  if (outcome.kind === 'failed') return t('remote.failed', { name: outcome.name, reason: outcome.reason });
  return t(outcome.kind === 'updated' ? 'remote.updated' : outcome.kind === 'none' ? 'remote.upToDate' : 'remote.offline');
}

/** Makes this device match what's saved on the website. */
export function RemoteRefreshButton(props: { id: string }): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [outcome, setOutcome] = createSignal<CheckOutcome | null>(null);
  const press = async () => {
    if (busy()) return;
    setBusy(true);
    setOutcome(null);
    setOutcome(await checkNow());
    setBusy(false);
  };
  return (
    <>
      <FocusButton id={props.id} onSelect={() => void press()}>
        {busy() ? t('remote.refreshing') : t('remote.refresh')}
      </FocusButton>
      <Show when={outcome()}>
        {(o) => (
          <p class="remote-refresh-message" classList={{ 'text-error': o().kind === 'failed' }} role="status">
            {messageFor(o())}
          </p>
        )}
      </Show>
    </>
  );
}

/** Full screen and sized by the screen's width, so it stays huge at any text size. */
function BigIdentity(props: { id: string; deviceKey: string; onClose: () => void }): JSX.Element {
  useKeys((press) => {
    if (press.key !== 'back') return false;
    props.onClose();
    return true;
  });
  return (
    <div class="dialog-backdrop remote-big" onClick={() => props.onClose()}>
      <FocusZone id="remote-big" trap>
        <div class="remote-big-body" role="dialog" aria-modal="true" aria-label={t('remote.deviceId')} dir="ltr">
          <div class="remote-big-label">{t('remote.deviceId')}</div>
          <div class="remote-big-value">{props.id}</div>
          <div class="remote-big-label">{t('remote.deviceKey')}</div>
          <div class="remote-big-value">{props.deviceKey}</div>
          <FocusButton id="remote-big-close" class="btn-primary btn-lg" autofocus onSelect={() => props.onClose()}>
            {t('remote.closeBig')}
          </FocusButton>
        </div>
      </FocusZone>
    </div>
  );
}

/** The ID and key in writing, for saving somewhere and typing into the website. */
export function RemoteIdentityLine(): JSX.Element {
  return (
    <Show when={remoteIdentity()}>
      {(identity) => (
        <div class="remote-identity" dir="ltr">
          <div class="remote-identity-item">
            <div class="remote-identity-label">{t('remote.deviceId')}</div>
            <div class="remote-identity-value">{identity().id}</div>
          </div>
          <div class="remote-identity-item">
            <div class="remote-identity-label">{t('remote.deviceKey')}</div>
            <div class="remote-identity-value">{formatDeviceKey(identity().key)}</div>
          </div>
        </div>
      )}
    </Show>
  );
}

/** Opens the ID and key full screen, for reading from across the room. */
export function RemoteBigButton(props: { id: string }): JSX.Element {
  const [big, setBig] = createSignal(false);
  return (
    <Show when={remoteIdentity()}>
      {(identity) => (
        <>
          <FocusButton id={`${props.id}-big`} class="remote-big-button" onSelect={() => setBig(true)}>
            <Icon name="search" />
            <span>{t('remote.makeBigger')}</span>
          </FocusButton>
          <Show when={big()}>
            <BigIdentity id={identity().id} deviceKey={formatDeviceKey(identity().key)} onClose={() => setBig(false)} />
          </Show>
        </>
      )}
    </Show>
  );
}
