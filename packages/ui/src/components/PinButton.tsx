import type { ContentKind } from '@ultra/core';
import { Show, type JSX } from 'solid-js';
import { usePins } from '../data/categories';
import { t } from '../i18n';
import { FocusButton } from './FocusButton';
import { Icon } from './Icon';

/** Pin / unpin the open category; sits next to the search box above its items. */
export function PinButton(props: { id: string; kind: ContentKind; categoryId: string; pinnable: boolean }): JSX.Element {
  const { pins, toggle } = usePins(props.kind);
  const pinned = () => pins().indexOf(props.categoryId) >= 0;
  return (
    <Show when={props.pinnable}>
      <FocusButton
        id={props.id}
        class="icon-button pin-button"
        selected={pinned()}
        label={pinned() ? t('categories.unpin') : t('categories.pin')}
        onSelect={() => void toggle(props.categoryId)}
      >
        <Icon name={pinned() ? 'pinFill' : 'pin'} />
      </FocusButton>
    </Show>
  );
}
