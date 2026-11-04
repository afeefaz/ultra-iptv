import type { JSX } from 'solid-js';
import { FocusZone } from '../focus';
import { t } from '../i18n';
import { goBack } from '../nav';
import { FocusButton } from './FocusButton';
import { Icon } from './Icon';

/** On-screen Back for pages below a tab: phones with gesture navigation have no back button. */
export function BackButton(props: { onBack?: () => void }): JSX.Element {
  return (
    <FocusZone id="page-back">
      <FocusButton id="page-back" class="chip-button back-chip" onSelect={() => (props.onBack ? props.onBack() : goBack())}>
        <Icon name="back" />
        <span>{t('common.back')}</span>
      </FocusButton>
    </FocusZone>
  );
}
