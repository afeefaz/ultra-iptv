import { MAX_CATEGORY_NAME } from '@ultra/core';
import { createSignal, Show, type JSX } from 'solid-js';
import { FocusZone } from '../focus';
import { t } from '../i18n';
import { useKeys } from '../keys';
import { FocusButton } from './FocusButton';
import { Icon } from './Icon';
import { TextField } from './TextField';

export interface RenameDialogProps {
  id: string;
  /** The provider's name, shown so the original is never lost. */
  original: string;
  /** The name it has now, given or the provider's. */
  current: string;
  renamed: boolean;
  onSave: (name: string) => void;
  onReset: () => void;
  onCancel: () => void;
}

/** A new name for a category. An empty name goes back to the provider's. */
export function RenameDialog(props: RenameDialogProps): JSX.Element {
  const [name, setName] = createSignal(props.current);
  useKeys((press) => {
    if (press.key !== 'back') return false;
    props.onCancel();
    return true;
  });
  const save = () => {
    const next = name().replace(/\s+/g, ' ').trim().slice(0, MAX_CATEGORY_NAME);
    if (!next || next === props.original) props.onReset();
    else props.onSave(next);
  };
  return (
    <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && props.onCancel()}>
      <FocusZone id={props.id} trap>
        <div class="dialog rename-dialog" role="dialog" aria-modal="true" aria-label={t('rename.title')}>
          <h2 class="dialog-title">{t('rename.title')}</h2>
          <p class="setting-desc rename-original">
            {t('rename.original')} <bdi>{props.original}</bdi>
          </p>
          <TextField id={`${props.id}-name`} label={t('rename.label')} value={name()} onChange={setName} onSubmit={save} autofocus />
          <div class="dialog-actions">
            <FocusButton id={`${props.id}-save`} class="btn-primary" onSelect={save}>
              <Icon name="check" />
              <span>{t('rename.save')}</span>
            </FocusButton>
            <Show when={props.renamed}>
              <FocusButton id={`${props.id}-reset`} onSelect={() => props.onReset()}>
                <Icon name="restart" />
                <span>{t('rename.reset')}</span>
              </FocusButton>
            </Show>
            <FocusButton id={`${props.id}-cancel`} onSelect={() => props.onCancel()}>
              {t('common.cancel')}
            </FocusButton>
          </div>
        </div>
      </FocusZone>
    </div>
  );
}
