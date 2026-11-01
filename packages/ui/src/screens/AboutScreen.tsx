import { log } from '@ultra/core';
import type { JSX } from 'solid-js';
import { FocusButton } from '../components/FocusButton';
import { FocusZone } from '../focus';
import { t } from '../i18n';
import { navigate } from '../nav';
import { usePlatform } from '../platform-context';

const PRESSES_TO_UNLOCK = 5;
const PRESS_WINDOW_MS = 4000;

export function AboutScreen(): JSX.Element {
  const platform = usePlatform();
  let presses: number[] = [];

  // Hidden debug screen: OK on the version number 5 times (spec §10).
  const onVersion = () => {
    const now = Date.now();
    presses = presses.filter((p) => now - p < PRESS_WINDOW_MS).concat(now);
    if (presses.length >= PRESSES_TO_UNLOCK) {
      presses = [];
      log.info('debug', 'debug screen unlocked');
      navigate({ name: 'debug' });
    }
  };

  return (
    <div class="screen about">
      <h1 class="screen-title">{t('about.title')}</h1>
      <FocusZone id="about">
        <FocusButton id="about-version" class="list-item" autofocus onSelect={onVersion}>
          <span class="list-label">{t('about.version', { version: __APP_VERSION__ })}</span>
        </FocusButton>
      </FocusZone>
      <p class="hint">{t('about.build', { time: __BUILD_TIME__ })}</p>
      <p class="hint">{t('about.platform', { platform: platform.id })}</p>
    </div>
  );
}
