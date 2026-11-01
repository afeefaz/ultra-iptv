import type { StreamFormat } from '@ultra/core';
import type { BufferProfile } from '@ultra/platform';
import { For, Show, type JSX } from 'solid-js';
import { FocusButton } from '../components/FocusButton';
import { lockedCategories, lockedChannels, pinSet, requestPin } from '../data/parental';
import {
  bufferProfile,
  preferredAudio,
  preferredText,
  setBufferProfile,
  setPreferredAudio,
  setPreferredText,
  setStreamFormat,
  setSubtitleSize,
  streamFormat,
  subtitleSize,
  type SubtitleSize,
} from '../data/settings';
import { FocusZone } from '../focus';
import { formatNumber, locale, setLocale, t, type Locale, type MessageKey } from '../i18n';
import { navigate } from '../nav';

// Language names are always shown in their own language.
const LANGUAGES: Array<{ id: Locale; name: string }> = [
  { id: 'en', name: 'English' },
  { id: 'ar', name: 'العربية' },
];

function Choice<T extends string>(props: {
  id: string;
  label: string;
  value: T;
  options: Array<{ value: T; label: MessageKey }>;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div class="field">
      <div class="field-label">{props.label}</div>
      <div class="button-row segmented" role="radiogroup" aria-label={props.label}>
        <For each={props.options}>
          {(o) => (
            <FocusButton id={`${props.id}-${o.value}`} selected={props.value === o.value} onSelect={() => props.onChange(o.value)}>
              {t(o.label)}
            </FocusButton>
          )}
        </For>
      </div>
    </div>
  );
}

export function SettingsScreen(): JSX.Element {
  return (
    <div class="screen settings">
      <h1 class="screen-title">{t('tab.settings')}</h1>
      <FocusZone id="settings" remember>
        <section class="settings-section">
          <h2 class="section-title">{t('settings.language')}</h2>
          <div class="button-row">
            {LANGUAGES.map((lang) => (
              <FocusButton
                id={`settings-lang-${lang.id}`}
                selected={locale() === lang.id}
                autofocus={lang.id === locale()}
                onSelect={() => setLocale(lang.id)}
              >
                <span lang={lang.id}>{lang.name}</span>
              </FocusButton>
            ))}
          </div>
        </section>

        <section class="settings-section">
          <h2 class="section-title">{t('settings.playback')}</h2>
          <Choice<StreamFormat>
            id="settings-format"
            label={t('settings.streamFormat')}
            value={streamFormat()}
            onChange={setStreamFormat}
            options={[
              { value: 'auto', label: 'settings.format.auto' },
              { value: 'hls', label: 'settings.format.hls' },
              { value: 'ts', label: 'settings.format.ts' },
            ]}
          />
          <Choice<BufferProfile>
            id="settings-buffer"
            label={t('settings.buffer')}
            value={bufferProfile()}
            onChange={setBufferProfile}
            options={[
              { value: 'low', label: 'settings.buffer.low' },
              { value: 'balanced', label: 'settings.buffer.balanced' },
              { value: 'stable', label: 'settings.buffer.stable' },
            ]}
          />
          <Choice<SubtitleSize>
            id="settings-subsize"
            label={t('settings.subtitleSize')}
            value={subtitleSize()}
            onChange={setSubtitleSize}
            options={[
              { value: 'small', label: 'settings.size.small' },
              { value: 'medium', label: 'settings.size.medium' },
              { value: 'large', label: 'settings.size.large' },
            ]}
          />
          <div class="field">
            <div class="field-label">
              {t('settings.languages', {
                audio: preferredAudio() ?? t('settings.none'),
                text: preferredText() === 'off' ? t('player.off') : (preferredText() ?? t('settings.none')),
              })}
            </div>
            <Show when={preferredAudio() || preferredText()}>
              <div class="button-row">
                <FocusButton
                  id="settings-forget-langs"
                  onSelect={() => {
                    setPreferredAudio(null);
                    setPreferredText(null);
                  }}
                >
                  {t('settings.forget')}
                </FocusButton>
              </div>
            </Show>
          </div>
        </section>

        <section class="settings-section">
          <h2 class="section-title">{t('settings.parental')}</h2>
          <p class="hint">
            {pinSet()
              ? t('settings.pinSet', { cats: formatNumber(lockedCategories().size), chans: formatNumber(lockedChannels().size) })
              : t('settings.pinNotSet')}
          </p>
          <div class="button-row">
            <Show
              when={pinSet()}
              fallback={
                <FocusButton id="settings-pin-set" onSelect={() => void requestPin('create')}>
                  {t('settings.setPin')}
                </FocusButton>
              }
            >
              <FocusButton id="settings-pin-change" onSelect={() => void requestPin('change')}>
                {t('settings.changePin')}
              </FocusButton>
              <FocusButton id="settings-pin-remove" class="btn-danger" onSelect={() => void requestPin('remove')}>
                {t('settings.removePin')}
              </FocusButton>
            </Show>
          </div>
        </section>

        <section class="settings-section">
          <FocusButton id="settings-playlists" class="list-item" onSelect={() => navigate({ name: 'playlists' })}>
            <span class="list-label">{t('settings.playlists')}</span>
          </FocusButton>
          <FocusButton id="settings-about" class="list-item" onSelect={() => navigate({ name: 'about' })}>
            <span class="list-label">{t('settings.about')}</span>
          </FocusButton>
        </section>
      </FocusZone>
    </div>
  );
}
