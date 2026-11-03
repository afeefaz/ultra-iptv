import { createSignal, Show, type JSX } from 'solid-js';
import { useFocusable } from '../focus';
import { direction, t } from '../i18n';
import { usePlatform } from '../platform-context';
import { OnScreenKeyboard } from './OnScreenKeyboard';

export interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password' | 'url';
  placeholder?: string;
  hint?: string;
  autofocus?: boolean;
  /** Search-box style: no label row; the label becomes the placeholder. */
  compact?: boolean;
  /** Text typed when the form is submitted with OK inside a native field. */
  onSubmit?: () => void;
}

/**
 * Form field: OK opens the on-screen keyboard on TVs, or focuses a normal input on
 * phones/desktop (spec §5). Passwords stay masked unless revealed.
 */
export function TextField(props: TextFieldProps): JSX.Element {
  const platform = usePlatform();
  const [open, setOpen] = createSignal(false);
  const [reveal, setReveal] = createSignal(false);
  let input: HTMLInputElement | undefined;
  const osk = platform.textInput === 'osk';
  const masked = () => props.type === 'password' && !reveal();

  const ref = useFocusable({
    id: props.id,
    autofocus: props.autofocus,
    onSelect: () => {
      if (osk) setOpen(true);
      else if (input && document.activeElement !== input) input.focus();
      else props.onSubmit?.();
    },
  });

  return (
    <div class="field" classList={{ compact: !!props.compact }}>
      <Show when={!props.compact}>
        <label class="field-label" for={`${props.id}-input`}>
          {props.label}
        </label>
      </Show>
      <div class="field-row">
        <div ref={ref} class="btn field-box" classList={{ 'is-empty': !props.value }}>
          <Show
            when={!osk}
            fallback={
              <span class="field-value" dir={props.compact ? 'auto' : 'ltr'}>
                {props.value ? (masked() ? '•'.repeat(props.value.length) : props.value) : (props.placeholder ?? (props.compact ? props.label : ''))}
              </span>
            }
          >
            <input
              id={`${props.id}-input`}
              ref={(el) => (input = el)}
              // Empty search boxes follow the app language, so Arabic placeholders read right to left.
              dir={props.compact && !props.value ? direction() : 'auto'}
              type={masked() ? 'password' : props.type === 'url' ? 'url' : 'text'}
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              placeholder={props.placeholder ?? (props.compact ? props.label : undefined)}
              aria-label={props.compact ? props.label : undefined}
              value={props.value}
              onInput={(e) => props.onChange(e.currentTarget.value)}
            />
          </Show>
        </div>
        <Show when={props.type === 'password'}>
          <RevealButton id={`${props.id}-reveal`} on={reveal()} toggle={() => setReveal(!reveal())} />
        </Show>
      </div>
      <Show when={props.hint}>
        <div class="field-hint">{props.hint}</div>
      </Show>
      <Show when={open()}>
        <OnScreenKeyboard
          id={`${props.id}-osk`}
          title={props.label}
          value={props.value}
          masked={props.type === 'password'}
          url={props.type === 'url'}
          onChange={props.onChange}
          onClose={() => setOpen(false)}
        />
      </Show>
    </div>
  );
}

function RevealButton(props: { id: string; on: boolean; toggle: () => void }): JSX.Element {
  const ref = useFocusable({ id: props.id, onSelect: props.toggle });
  return (
    <div ref={ref} class="btn field-reveal" role="button" aria-pressed={props.on}>
      {props.on ? t('form.hide') : t('form.show')}
    </div>
  );
}
