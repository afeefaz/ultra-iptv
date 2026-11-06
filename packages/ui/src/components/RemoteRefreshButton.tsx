import { formatDeviceKey } from '@ultra/core/pair';
import { createSignal, Show, type JSX } from 'solid-js';
import { checkNow, remoteIdentity, type CheckOutcome } from '../data/remoteAccess';
import { t } from '../i18n';
import { FocusButton } from './FocusButton';

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

/** The ID and key in writing, for typing into the website on a device that can't scan. */
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
