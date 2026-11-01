import type { JSX } from 'solid-js';
import { useFocusable } from '../focus';

export interface FocusButtonProps {
  id: string;
  children: JSX.Element;
  onSelect?: () => void;
  autofocus?: boolean;
  selected?: boolean;
  class?: string;
  label?: string;
}

export function FocusButton(props: FocusButtonProps): JSX.Element {
  const ref = useFocusable({ id: props.id, autofocus: props.autofocus, onSelect: () => props.onSelect?.() });
  return (
    <div
      ref={ref}
      role="button"
      aria-label={props.label}
      aria-pressed={props.selected === undefined ? undefined : props.selected}
      class={`btn ${props.class ?? ''}`}
      classList={{ 'is-selected': !!props.selected }}
    >
      {props.children}
    </div>
  );
}
