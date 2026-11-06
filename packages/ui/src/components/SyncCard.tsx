import { createSignal, onMount, Show, type JSX } from 'solid-js';
import { pinSet, requestPin } from '../data/parental';
import { remoteIdentity } from '../data/remoteAccess';
import { applyPull, fetchPush, linkDevice, loadSyncStatus, pushNow, syncStatus, unlinkDevice } from '../data/syncAccess';
import { FocusZone } from '../focus';
import { t } from '../i18n';
import { useKeys } from '../keys';
import { ConfirmDialog } from './ConfirmDialog';
import { FocusButton } from './FocusButton';
import { Icon } from './Icon';
import { TextField } from './TextField';

const when = (at: number) => new Date(at).toLocaleString();

/** Asks for another device's ID and key, once. */
function LinkDialog(props: { notice?: string; onCancel: () => void; onLinked: () => void }): JSX.Element {
  const [id, setId] = createSignal('');
  const [key, setKey] = createSignal('');
  const [error, setError] = createSignal(props.notice ?? '');
  const [busy, setBusy] = createSignal(false);
  useKeys((press) => {
    if (press.key !== 'back') return false;
    props.onCancel();
    return true;
  });
  const save = async () => {
    if (busy()) return;
    setBusy(true);
    setError('');
    const result = await linkDevice(id(), key());
    setBusy(false);
    if (result.ok) props.onLinked();
    else setError(t(result.reason === 'invalid' ? 'sync.linkInvalid' : result.reason === 'not-found' ? 'sync.linkNotFound' : 'remote.offline'));
  };
  return (
    <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && props.onCancel()}>
      <FocusZone id="sync-link" trap>
        <div class="dialog sync-link" role="dialog" aria-modal="true" aria-label={t('sync.linkTitle')}>
          <h2 class="dialog-title">{t('sync.linkTitle')}</h2>
          <p class="hint">{t('sync.linkHelp')}</p>
          <TextField id="sync-link-id" label={t('remote.deviceId')} value={id()} onChange={setId} placeholder="02:AB:CD:EF:01:23" autofocus />
          <TextField id="sync-link-key" label={t('remote.deviceKey')} value={key()} onChange={setKey} />
          <Show when={error()}>
            <p class="form-message form-error" role="alert">
              {error()}
            </p>
          </Show>
          <div class="button-row dialog-actions">
            <FocusButton id="sync-link-save" class="btn-primary" onSelect={() => void save()}>
              {busy() ? t('sync.working') : t('sync.link')}
            </FocusButton>
            <FocusButton id="sync-link-cancel" onSelect={() => props.onCancel()}>
              {t('common.cancel')}
            </FocusButton>
          </div>
        </div>
      </FocusZone>
    </div>
  );
}

/** Push and Pull, in Settings. */
export function SyncCard(): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal<{ text: string; error?: boolean } | null>(null);
  const [confirmPush, setConfirmPush] = createSignal(false);
  const [pullPrompt, setPullPrompt] = createSignal<string | null>(null);
  const [linking, setLinking] = createSignal<'link' | 'link-then-pull' | null>(null);
  const [linkNotice, setLinkNotice] = createSignal<string | undefined>();
  onMount(() => void loadSyncStatus());

  const push = async () => {
    setConfirmPush(false);
    setBusy(true);
    setMessage(null);
    const result = await pushNow();
    setBusy(false);
    if (result.ok) setMessage({ text: t('sync.pushed') });
    else setMessage({ text: t(result.reason === 'too-large' ? 'sync.tooLarge' : 'remote.offline'), error: true });
  };

  const askToLink = (notice?: string) => {
    setLinkNotice(notice);
    setLinking('link-then-pull');
  };

  const pull = async () => {
    const status = syncStatus();
    // Nothing of its own to pull, and no group yet: it needs to know where from.
    if (status && !status.linkedTo && !status.pushedAt) return askToLink();
    setBusy(true);
    setMessage(null);
    const found = await fetchPush();
    setBusy(false);
    if (found.kind === 'offline') return setMessage({ text: t('remote.offline'), error: true });
    // A link that finds nothing is a wrong one, so go straight to fixing it.
    if (found.kind === 'none') return status?.linkedTo ? askToLink(t('sync.linkBroken')) : setMessage({ text: t('sync.nothing'), error: true });
    // Pulling its own push would change nothing, and look broken.
    if (found.pushedBy === remoteIdentity()?.id) return status?.linkedTo ? setMessage({ text: t('sync.ownPush') }) : askToLink(t('sync.linkToPull'));
    setPullPrompt(t('sync.pullConfirm', { when: when(found.pushedAt), device: found.pushedBy, n: found.playlists }));
  };

  const applyConfirmed = async () => {
    setPullPrompt(null);
    // Otherwise pulling from a device with no PIN would be a way around the lock.
    if (pinSet() && !(await requestPin('verify'))) return;
    setBusy(true);
    try {
      await applyPull();
    } catch {
      setBusy(false);
      setMessage({ text: t('sync.pullFailed'), error: true });
    }
  };

  return (
    <div class="sync-card">
      <div class="sync-points">
        <div class="setting-name">{t('settings.syncName')}</div>
        <div class="setting-desc">{t('settings.syncDesc')}</div>
        <div class="sync-status">
          <span>{syncStatus()?.linkedTo ? t('sync.linkedTo', { device: syncStatus()!.linkedTo! }) : t('sync.notLinked')}</span>
          <Show when={syncStatus()?.pushedAt}>{(at) => <span>{t('sync.lastPush', { when: when(at()) })}</span>}</Show>
          <Show when={syncStatus()?.pulledAt}>{(at) => <span>{t('sync.lastPull', { when: when(at()) })}</span>}</Show>
        </div>
        <Show when={message()}>
          {(m) => (
            <p class="remote-refresh-message" classList={{ 'text-error': !!m().error }} role="status">
              {m().text}
            </p>
          )}
        </Show>
      </div>
      <div class="button-row sync-actions">
        <FocusButton id="settings-sync-push" class="btn-primary" onSelect={() => !busy() && setConfirmPush(true)}>
          <Icon name="sync" />
          <span>{busy() ? t('sync.working') : t('sync.push')}</span>
        </FocusButton>
        <FocusButton id="settings-sync-pull" onSelect={() => !busy() && void pull()}>
          {t('sync.pull')}
        </FocusButton>
        <Show
          when={syncStatus()?.linkedTo}
          fallback={
            <FocusButton
              id="settings-sync-link"
              onSelect={() => {
                setLinkNotice(undefined);
                setLinking('link');
              }}
            >
              {t('sync.link')}
            </FocusButton>
          }
        >
          <FocusButton
            id="settings-sync-unlink"
            onSelect={() => {
              void unlinkDevice().then((done) => !done && setMessage({ text: t('remote.offline'), error: true }));
            }}
          >
            {t('sync.unlink')}
          </FocusButton>
        </Show>
      </div>
      <Show when={confirmPush()}>
        <ConfirmDialog id="sync-push-confirm" message={t('sync.pushConfirm')} confirmLabel={t('sync.push')} onCancel={() => setConfirmPush(false)} onConfirm={() => void push()} />
      </Show>
      <Show when={pullPrompt()}>
        {(text) => <ConfirmDialog id="sync-pull-confirm" message={text()} confirmLabel={t('sync.pull')} onCancel={() => setPullPrompt(null)} onConfirm={() => void applyConfirmed()} />}
      </Show>
      <Show when={linking()}>
        {(mode) => (
          <LinkDialog
            notice={linkNotice()}
            onCancel={() => setLinking(null)}
            onLinked={() => {
              const thenPull = mode() === 'link-then-pull';
              setLinking(null);
              void loadSyncStatus().then(() => {
                if (thenPull) void pull();
                else setMessage({ text: t('sync.linked') });
              });
            }}
          />
        )}
      </Show>
    </div>
  );
}
