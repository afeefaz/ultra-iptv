import { log, parseXtreamUrl, type PlaylistInput, type PlaylistType, type TestResult } from '@ultra/core';
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { BackButton } from '../components/BackButton';
import { FocusButton } from '../components/FocusButton';
import { LoadingCard } from '../components/LoadingProgress';
import { Icon } from '../components/Icon';
import { TextField } from '../components/TextField';
import { catalog } from '../data/catalog';
import { refreshPlaylist, reloadPlaylists, setActivePlaylist } from '../data/playlists';
import { FocusZone } from '../focus';
import { formatDate, errorText } from '../format';
import { formatNumber, t } from '../i18n';
import { goBack, openRoot } from '../nav';

const REFRESH_CHOICES = [6, 12, 24, 48];
const EPG_OFFSETS = [-3, -2, -1, 0, 1, 2, 3];
const SERVER_CHIPS = ['http://', 'https://', ':8080', '.com', '/'];

type Phase = 'idle' | 'testing' | 'saving';

/** Add/edit playlist, designed for a remote (spec §5). */
export function PlaylistFormScreen(props: { id?: string }): JSX.Element {
  const [type, setType] = createSignal<PlaylistType>('xtream');
  const [name, setName] = createSignal('');
  const [server, setServer] = createSignal('');
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [m3uUrl, setM3uUrl] = createSignal('');
  const [userAgent, setUserAgent] = createSignal('');
  const [refreshHours, setRefreshHours] = createSignal(12);
  const [epgOffset, setEpgOffset] = createSignal(0);
  const [advanced, setAdvanced] = createSignal(false);
  const [phase, setPhase] = createSignal<Phase>('idle');
  const [message, setMessage] = createSignal<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  /** New playlist being loaded: the form shows its progress, then opens Live TV. */
  const [loadingId, setLoadingId] = createSignal<string | null>(null);
  /** Set once a new playlist is saved, so retrying after a failed load updates it (no duplicate). */
  let savedId: string | undefined;
  const editing = !!props.id;
  onCleanup(() => setLoadingId(null));

  onMount(async () => {
    if (!props.id) return;
    try {
      const data = await catalog().call('editData', props.id);
      setType(data.type);
      setName(data.name);
      setServer(data.server ?? '');
      setUsername(data.username ?? '');
      setPassword(data.password ?? '');
      setM3uUrl(data.m3uUrl ?? '');
      setUserAgent(data.userAgent ?? '');
      setRefreshHours(data.refreshHours ?? 12);
      setEpgOffset(data.epgOffsetHours ?? 0);
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    }
  });

  // A pasted get.php / player_api.php / /playlist/u/p link fills the other fields (spec §5).
  // Only for pastes (one big insertion): while typing letter by letter the link is incomplete.
  // A typed link is still understood on submit, where the worker extracts the credentials.
  const onServer = (value: string) => {
    const pasted = value.length - server().length >= 8;
    const parsed = pasted && /username=|\/playlist\//i.test(value) ? parseXtreamUrl(value) : null;
    if (parsed) {
      setServer(parsed.server);
      setUsername(parsed.username);
      setPassword(parsed.password);
      setMessage({ kind: 'info', text: t('form.pasted') });
    } else {
      setServer(value);
    }
  };

  const input = (): PlaylistInput => ({
    id: props.id ?? savedId,
    name: name(),
    type: type(),
    server: server(),
    username: username(),
    password: password(),
    m3uUrl: m3uUrl(),
    userAgent: userAgent(),
    refreshHours: refreshHours(),
    epgOffsetHours: epgOffset(),
  });

  const testAndSave = async () => {
    if (phase() !== 'idle') return;
    setPhase('testing');
    setMessage(null);
    try {
      const tested: TestResult = await catalog().call('testPlaylist', input());
      setMessage({ kind: 'ok', text: describe(tested) });
      setPhase('saving');
      const record = await catalog().call('savePlaylist', input());
      await reloadPlaylists();
      if (editing) {
        void refreshPlaylist(record.id);
        goBack();
        return;
      }
      savedId = record.id;
      setActivePlaylist(record.id);
      setLoadingId(record.id);
      const loaded = await refreshPlaylist(record.id);
      // Still on this screen (Back leaves the load running in the background).
      if (loadingId() !== record.id) return;
      if (loaded && loaded.ok) {
        openRoot({ name: 'live' });
        return;
      }
      // Saved, but the catalogue didn't load: show why; "Test & save" retries.
      setLoadingId(null);
      setPhase('idle');
      setMessage({ kind: 'error', text: errorText(loaded?.error ?? { code: 'network', message: '' }) });
    } catch (e) {
      log.warn('playlist', 'test or save failed', { error: e });
      setMessage({ kind: 'error', text: errorText(e) });
      setPhase('idle');
    }
  };

  return (
    <div class="screen form-screen">
      <div class="crumbs">
        <BackButton />
        <Icon name="playlist" />
        <span class="accent">{t('settings.playlists')}</span>
        <span class="sep">/</span>
        <span>{editing ? t('form.edit') : t('form.add')}</span>
      </div>
      <h1 class="screen-title">{editing ? t('form.editTitle') : t('form.addTitle')}</h1>
      <p class="form-sub">{t('form.subtitle')}</p>
      <Show when={loadingId()}>{(id) => <LoadingCard playlistId={id()} />}</Show>
      <div class="form-layout" style={{ display: loadingId() ? 'none' : undefined }}>
        <FocusZone id="playlist-form" remember>
          <div class="form">
            <div class="segmented type-tabs" role="radiogroup">
              <FocusButton id="form-type-xtream" selected={type() === 'xtream'} autofocus={!editing} onSelect={() => setType('xtream')}>
                <Icon name="dns" />
                <span>{t('form.xtream')}</span>
              </FocusButton>
              <FocusButton id="form-type-m3u" selected={type() === 'm3u'} onSelect={() => setType('m3u')}>
                <Icon name="link" />
                <span>{t('form.m3u')}</span>
              </FocusButton>
            </div>

            <div class="field-card">
              <TextField id="form-name" label={t('form.name')} value={name()} onChange={setName} placeholder={t('form.namePlaceholder')} autofocus={editing} />
            </div>

            <Show
              when={type() === 'xtream'}
              fallback={
                <div class="field-card">
                  <TextField id="form-m3u" label={t('form.m3uUrl')} type="url" value={m3uUrl()} onChange={setM3uUrl} placeholder="https://…/playlist.m3u" onSubmit={() => void testAndSave()} />
                </div>
              }
            >
              <div class="field-card">
                <TextField
                  id="form-server"
                  label={t('form.server')}
                  type="url"
                  value={server()}
                  onChange={onServer}
                  placeholder="http://example.com:8080"
                  hint={t('form.serverHint')}
                />
                <div class="button-row chips" dir="ltr">
                  <span class="chips-label">{t('form.quickInput')}</span>
                  <For each={SERVER_CHIPS}>
                    {(chip) => (
                      <FocusButton id={`form-chip-${chip}`} class="chip" onSelect={() => onServer(server() + chip)}>
                        {chip}
                      </FocusButton>
                    )}
                  </For>
                </div>
              </div>
              <div class="field-card field-pair">
                <TextField id="form-user" label={t('form.username')} value={username()} onChange={setUsername} />
                <TextField id="form-pass" label={t('form.password')} value={password()} onChange={setPassword} onSubmit={() => void testAndSave()} />
              </div>
            </Show>

            <FocusButton id="form-advanced" class="link-button" selected={advanced()} onSelect={() => setAdvanced(!advanced())}>
              <Icon name="tune" />
              <span>{t('form.advanced')}</span>
              <Icon name={advanced() ? 'up' : 'down'} />
            </FocusButton>
            <Show when={advanced()}>
              <div class="field-card">
                <TextField id="form-ua" label={t('form.userAgent')} value={userAgent()} onChange={setUserAgent} hint={t('form.userAgentHint')} />
                <div class="field">
                  <div class="field-label">{t('form.refreshEvery')}</div>
                  <div class="segmented">
                    <For each={REFRESH_CHOICES}>
                      {(h) => (
                        <FocusButton id={`form-refresh-${h}`} selected={refreshHours() === h} onSelect={() => setRefreshHours(h)}>
                          {t('form.hours', { n: formatNumber(h) })}
                        </FocusButton>
                      )}
                    </For>
                  </div>
                </div>
                <Show when={type() === 'xtream'}>
                  <div class="field">
                    <div class="field-label">{t('form.epgOffset')}</div>
                    <div class="segmented" dir="ltr">
                      <For each={EPG_OFFSETS}>
                        {(h) => (
                          <FocusButton id={`form-epg-${h}`} selected={epgOffset() === h} onSelect={() => setEpgOffset(h)}>
                            {h > 0 ? `+${h}` : String(h)}
                          </FocusButton>
                        )}
                      </For>
                    </div>
                    <div class="field-hint">{t('form.epgHint')}</div>
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={message()}>
              {(m) => (
                <p class={`form-message form-${m().kind}`} role={m().kind === 'error' ? 'alert' : 'status'}>
                  {m().text}
                </p>
              )}
            </Show>

            <div class="button-row form-actions">
              <FocusButton id="form-submit" class="btn-primary btn-lg" onSelect={() => void testAndSave()}>
                <Icon name="check" />
                <span>{phase() === 'testing' ? t('form.testing') : phase() === 'saving' ? t('form.saving') : t('form.testSave')}</span>
              </FocusButton>
              <FocusButton id="form-cancel" class="btn-lg" onSelect={() => goBack()}>
                <Icon name="close" />
                <span>{t('form.cancel')}</span>
              </FocusButton>
            </div>
          </div>
        </FocusZone>
        <aside class="form-aside">
          <div class="guide-card">
            <h2>
              <Icon name="info" />
              {type() === 'xtream' ? t('form.xtream') : t('form.m3u')}
            </h2>
            <p>{type() === 'xtream' ? t('form.guideXtream') : t('form.guideM3u')}</p>
            <ul>
              <li>
                <Icon name="check" />
                <span>{t('form.guidePoint1')}</span>
              </li>
              <li>
                <Icon name="check" />
                <span>{t('form.guidePoint2')}</span>
              </li>
              <li>
                <Icon name="check" />
                <span>{t('form.guidePoint3')}</span>
              </li>
            </ul>
          </div>
          <div class="guide-card">
            <h2>
              <Icon name="lock" />
              {t('form.privacyTitle')}
            </h2>
            <p>{t('form.privacy')}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function describe(r: TestResult): string {
  if (r.type === 'm3u') return t('form.okM3u', { count: formatNumber(r.sampleEntries ?? 0) });
  const a = r.account ?? {};
  return t('form.ok', {
    status: a.status ?? '?',
    expires: formatDate(a.expiresAt),
    connections: a.maxConnections !== undefined ? formatNumber(a.maxConnections) : '?',
  });
}
