import type { JSX } from 'solid-js';
import { FocusZone } from '../focus';
import { t } from '../i18n';
import { useKeys } from '../keys';
import { FocusButton } from './FocusButton';

export interface ConfirmDialogProps {
  id: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal confirmation for destructive actions (spec §5). Cancel has focus first. */
export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  useKeys((press) => {
    if (press.key !== 'back') return false;
    props.onCancel();
    return true;
  });
  return (
    <div class="dialog-backdrop">
      <FocusZone id={props.id} trap>
        <div class="dialog" role="alertdialog" aria-modal="true">
          <p class="dialog-message">{props.message}</p>
          <div class="dialog-actions">
            <FocusButton id={`${props.id}-cancel`} autofocus onSelect={() => props.onCancel()}>
              {t('common.cancel')}
            </FocusButton>
            <FocusButton id={`${props.id}-confirm`} class="btn-danger" onSelect={() => props.onConfirm()}>
              {props.confirmLabel ?? t('common.yes')}
            </FocusButton>
          </div>
        </div>
      </FocusZone>
    </div>
  );
}
