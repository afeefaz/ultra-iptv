import type { JSX } from 'solid-js';
import { t } from '../i18n';
import type { Tab } from '../nav';

const PHASE: Partial<Record<Tab, number>> = { live: 1 };

export function PlaceholderScreen(props: { tab: Tab }): JSX.Element {
  return (
    <div class="screen placeholder">
      <h1 class="screen-title">{t('placeholder.title', { section: t(`tab.${props.tab}`) })}</h1>
      <p class="hint">{t('placeholder.body', { phase: PHASE[props.tab] ?? 1 })}</p>
    </div>
  );
}
