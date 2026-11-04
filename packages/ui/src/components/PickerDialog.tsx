import { For, type JSX } from 'solid-js';
import { FocusZone } from '../focus';
import { useKeys } from '../keys';
import { FocusButton } from './FocusButton';

export interface PickerOption {
  id: string;
  label: string;
  detail?: string;
}

/** Modal list picker (e.g. playlist switcher). Back cancels; the current option has focus first. */
export function PickerDialog(props: {
  id: string;
  title: string;
  options: PickerOption[];
  selected?: string;
  footer?: JSX.Element;
  onPick: (id: string) => void;
  onCancel: () => void;
}): JSX.Element {
  useKeys((press) => {
    if (press.key !== 'back') return false;
    props.onCancel();
    return true;
  });
  return (
    <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && props.onCancel()}>
      <FocusZone id={props.id} trap>
        <div class="dialog picker" role="dialog" aria-modal="true" aria-label={props.title}>
          <h2 class="dialog-title">{props.title}</h2>
          <div class="picker-list">
            <For each={props.options}>
              {(o) => (
                <FocusButton
                  id={`${props.id}-${o.id}`}
                  class="list-item picker-item"
                  selected={o.id === props.selected}
                  autofocus={o.id === props.selected}
                  onSelect={() => props.onPick(o.id)}
                >
                  <span class="list-label">{o.label}</span>
                  {o.detail ? <span class="list-count">{o.detail}</span> : null}
                </FocusButton>
              )}
            </For>
          </div>
          {props.footer}
        </div>
      </FocusZone>
    </div>
  );
}
