import type { PlaylistRecord } from '@ultra/core';
import { createSignal, For, Show, type JSX } from 'solid-js';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BackButton } from '../components/BackButton';
import { FocusButton } from '../components/FocusButton';
import { RemoteQrPanel } from '../components/RemoteQrPanel';
import { catalog } from '../data/catalog';
import { activePlaylist, playlists, refreshing, refreshPlaylist, reloadPlaylists, setActivePlaylist } from '../data/playlists';
import { publishDeleted } from '../data/remoteAccess';
import { FocusZone } from '../focus';
import { countsText, errorText, statusText } from '../format';
import { t } from '../i18n';
import { navigate } from '../nav';

export function PlaylistsScreen(): JSX.Element {
  const [deleting, setDeleting] = createSignal<PlaylistRecord | null>(null);
  const [error, setError] = createSignal('');

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await reloadPlaylists();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div class="screen playlists">
      <div class="screen-header-row">
        <div class="title-with-back">
          <BackButton />
          <h1 class="screen-title">{t('playlists.title')}</h1>
        </div>
        <FocusZone id="playlists-top">
          <FocusButton id="playlists-add" class="btn-primary" autofocus={playlists().length === 0} onSelect={() => navigate({ name: 'playlist-form' })}>
            + {t('playlists.add')}
          </FocusButton>
        </FocusZone>
      </div>
      <div class="playlists-layout">
        <div class="playlists-main">
      <Show when={error()}>
        <p class="form-message form-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={playlists().length > 0} fallback={<p class="hint">{t('playlists.empty')}</p>}>
        <FocusZone id="playlists-list" remember>
          <div class="cards">
            <For each={playlists()}>
              {(p, i) => {
                const isActive = () => activePlaylist()?.id === p.id;
                const busy = () => !!refreshing()[p.id];
                return (
                  <div class="card" classList={{ 'is-active': isActive() }}>
                    <div class="card-main">
                      <div class="card-title">
                        <bdi>{p.name}</bdi>
                        <Show when={isActive()}>
                          <span class="badge">{t('playlists.active')}</span>
                        </Show>
                      </div>
                      <div class="card-sub" dir="ltr">
                        {p.type === 'xtream' ? 'Xtream' : 'M3U'} · {p.host}
                        {p.userHint ? ` · ${p.userHint}` : ''}
                      </div>
                      <div class="card-sub">{countsText(p)}</div>
                      <div class="card-sub" classList={{ 'text-error': !!p.lastError && !busy() }}>
                        {statusText(p, busy())}
                      </div>
                    </div>
                    <div class="button-row card-actions">
                      <Show when={!isActive()}>
                        <FocusButton id={`pl-use-${p.id}`} autofocus={i() === 0} onSelect={() => setActivePlaylist(p.id)}>
                          {t('playlists.use')}
                        </FocusButton>
                      </Show>
                      <FocusButton id={`pl-refresh-${p.id}`} autofocus={i() === 0 && isActive()} onSelect={() => void refreshPlaylist(p.id)}>
                        {t('playlists.refresh')}
                      </FocusButton>
                      <FocusButton id={`pl-edit-${p.id}`} onSelect={() => navigate({ name: 'playlist-form', id: p.id })}>
                        {t('playlists.edit')}
                      </FocusButton>
                      <Show when={i() > 0}>
                        <FocusButton id={`pl-up-${p.id}`} onSelect={() => void run(() => catalog().call('movePlaylist', p.id, -1))}>
                          {t('playlists.moveUp')}
                        </FocusButton>
                      </Show>
                      <Show when={i() < playlists().length - 1}>
                        <FocusButton id={`pl-down-${p.id}`} onSelect={() => void run(() => catalog().call('movePlaylist', p.id, 1))}>
                          {t('playlists.moveDown')}
                        </FocusButton>
                      </Show>
                      <FocusButton id={`pl-delete-${p.id}`} class="btn-danger" onSelect={() => setDeleting(p)}>
                        {t('playlists.delete')}
                      </FocusButton>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </FocusZone>
      </Show>
        </div>
        <aside class="playlists-aside guide-card">
          <FocusZone id="playlists-remote">
            <RemoteQrPanel id="playlists-remote" showIdentity />
          </FocusZone>
        </aside>
      </div>
      <Show when={deleting()}>
        {(p) => (
          <ConfirmDialog
            id="playlist-delete"
            message={t('playlists.deleteConfirm', { name: p().name })}
            confirmLabel={t('playlists.delete')}
            onCancel={() => setDeleting(null)}
            onConfirm={() => {
              const id = p().id;
              setDeleting(null);
              void run(async () => {
                await catalog().call('deletePlaylist', id);
                publishDeleted(id);
              });
            }}
          />
        )}
      </Show>
    </div>
  );
}
