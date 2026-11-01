import { log, parseXtreamUrl, type PlaylistInput, type PlaylistType, type TestResult } from '@ultra/core';
import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { FocusButton } from '../components/FocusButton';
import { TextField } from '../components/TextField';
import { catalog } from '../data/catalog';
import { playlists, refreshPlaylist, reloadPlaylists, setActivePlaylist } from '../data/playlists';
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
  const editing = !!props.id;

  onMount(async () => {
    if (!props.id) return;
    try {
      const data = await catalog().call('editData', props.id);
      setType(data.type);
      setName(data.name);
      setServer(data.server ?? '');
      setUsername(data.username ?? '');
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
    id: props.id,
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
      const result: TestResult = await catalog().call('testPlaylist', input());
      setMessage({ kind: 'ok', text: describe(result) });
      setPhase('saving');
      const record = await catalog().call('savePlaylist', input());
      await reloadPlaylists();
      const first = playlists().length === 1;
      if (first || !editing) setActivePlaylist(record.id);
      void refreshPlaylist(record.id);
      if (first) openRoot({ name: 'live' });
      else goBack();
    } catch (e) {
      log.warn('playlist', 'test or save failed', { error: e });
      setMessage({ kind: 'error', text: errorText(e) });
      setPhase('idle');
    }
  };

  return (
    <div class="screen form-screen">
      <h1 class="screen-title">{editing ? t('form.editTitle') : t('form.addTitle')}</h1>
      <FocusZone id="playlist-form" remember>
        <div class="form">
          <div class="button-row segmented" role="radiogroup">
            <FocusButton id="form-type-xtream" selected={type() === 'xtream'} autofocus={!editing} onSelect={() => setType('xtream')}>
              {t('form.xtream')}
            </FocusButton>
            <FocusButton id="form-type-m3u" selected={type() === 'm3u'} onSelect={() => setType('m3u')}>
              {t('form.m3u')}
            </FocusButton>
          </div>

          <TextField id="form-name" label={t('form.name')} value={name()} onChange={setName} placeholder={t('form.namePlaceholder')} autofocus={editing} />

          <Show
            when={type() === 'xtream'}
            fallback={
              <TextField id="form-m3u" label={t('form.m3uUrl')} type="url" value={m3uUrl()} onChange={setM3uUrl} placeholder="https://…/playlist.m3u" onSubmit={() => void testAndSave()} />
            }
          >
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
              <For each={SERVER_CHIPS}>
                {(chip) => (
                  <FocusButton id={`form-chip-${chip}`} class="chip" onSelect={() => onServer(server() + chip)}>
                    {chip}
                  </FocusButton>
                )}
              </For>
            </div>
            <TextField id="form-user" label={t('form.username')} value={username()} onChange={setUsername} />
            <TextField
              id="form-pass"
              label={t('form.password')}
              type="password"
              value={password()}
              onChange={setPassword}
              hint={editing ? t('form.passwordKeep') : undefined}
              onSubmit={() => void testAndSave()}
            />
          </Show>

          <FocusButton id="form-advanced" class="link-button" selected={advanced()} onSelect={() => setAdvanced(!advanced())}>
            {t('form.advanced')} {advanced() ? '▾' : '▸'}
          </FocusButton>
          <Show when={advanced()}>
            <TextField id="form-ua" label={t('form.userAgent')} value={userAgent()} onChange={setUserAgent} hint={t('form.userAgentHint')} />
            <div class="field">
              <div class="field-label">{t('form.refreshEvery')}</div>
              <div class="button-row segmented">
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
                <div class="button-row segmented" dir="ltr">
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
          </Show>

          <Show when={message()}>
            {(m) => (
              <p class={`form-message form-${m().kind}`} role={m().kind === 'error' ? 'alert' : 'status'}>
                {m().text}
              </p>
            )}
          </Show>

          <div class="button-row form-actions">
            <FocusButton id="form-submit" class="btn-primary" onSelect={() => void testAndSave()}>
              {phase() === 'testing' ? t('form.testing') : phase() === 'saving' ? t('form.saving') : t('form.testSave')}
            </FocusButton>
            <FocusButton id="form-cancel" onSelect={() => goBack()}>
              {t('form.cancel')}
            </FocusButton>
          </div>
        </div>
      </FocusZone>
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
