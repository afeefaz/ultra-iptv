import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { FocusZone } from '../focus';
import { t } from '../i18n';
import { useKeys } from '../keys';
import { FocusButton } from './FocusButton';

export interface OnScreenKeyboardProps {
  id: string;
  title: string;
  value: string;
  masked?: boolean;
  /** Adds a row of URL helpers (http://, .com, :, / …). */
  url?: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
}

const LETTER_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const SYMBOLS = ['-', '_', '.', '@', ':', '/', '?', '=', '&', '#', '+', '%'];
const URL_HELPERS = ['http://', 'https://', '.com', '.net', '.tv', ':8080', '/'];

/**
 * Remote-friendly keyboard (spec §5) for TVs, where the system keyboard covers the whole
 * screen. A physical/Bluetooth keyboard keeps working while it is open.
 */
export function OnScreenKeyboard(props: OnScreenKeyboardProps): JSX.Element {
  const [shift, setShift] = createSignal(false);
  const [symbols, setSymbols] = createSignal(false);
  const [reveal, setReveal] = createSignal(false);

  const insert = (text: string) => props.onChange(props.value + text);
  const backspace = () => props.onChange(props.value.slice(0, -1));
  const keyText = (k: string) => (shift() ? k.toUpperCase() : k);

  useKeys((press) => {
    if (press.key !== 'back') return false;
    props.onClose(); // Back keeps what was typed, like Done.
    return true;
  });

  // Typing on a real keyboard: capture before the remote-key handler sees Backspace/digits.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Backspace') {
        backspace();
      } else {
        // Printable characters; remote number keys on older TVs only report a keyCode.
        const text = e.key && e.key.length === 1 ? e.key : e.keyCode >= 48 && e.keyCode <= 57 ? String(e.keyCode - 48) : null;
        if (text === null) return;
        insert(text);
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    onCleanup(() => window.removeEventListener('keydown', onKey, true));
  });

  const display = () => (props.masked && !reveal() ? '•'.repeat(props.value.length) : props.value);

  return (
    <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <FocusZone id={props.id} trap>
        <div class="dialog osk" role="dialog" aria-modal="true" aria-label={props.title}>
          <div class="osk-title">{props.title}</div>
          <div class="osk-display" dir="ltr">
            {display()}
            <span class="osk-caret" />
          </div>
          <Show when={props.url}>
            <div class="osk-row">
              <For each={URL_HELPERS}>
                {(h) => (
                  <FocusButton id={`${props.id}-u-${h}`} class="osk-key osk-wide" onSelect={() => insert(h)}>
                    <span dir="ltr">{h}</span>
                  </FocusButton>
                )}
              </For>
            </div>
          </Show>
          <Show
            when={!symbols()}
            fallback={
              <div class="osk-row">
                <For each={SYMBOLS}>
                  {(s) => (
                    <FocusButton id={`${props.id}-s-${s}`} class="osk-key" onSelect={() => insert(s)}>
                      {s}
                    </FocusButton>
                  )}
                </For>
              </div>
            }
          >
            <For each={LETTER_ROWS}>
              {(row, r) => (
                <div class="osk-row" dir="ltr">
                  <For each={row.split('')}>
                    {(k) => (
                      <FocusButton
                        id={`${props.id}-k-${k}`}
                        class="osk-key"
                        autofocus={r() === 1 && k === 'q'}
                        onSelect={() => insert(keyText(k))}
                      >
                        {keyText(k)}
                      </FocusButton>
                    )}
                  </For>
                </div>
              )}
            </For>
          </Show>
          <div class="osk-row" dir="ltr">
            <FocusButton id={`${props.id}-shift`} class="osk-key osk-wide" selected={shift()} onSelect={() => setShift(!shift())}>
              ⇧
            </FocusButton>
            <FocusButton id={`${props.id}-sym`} class="osk-key osk-wide" selected={symbols()} onSelect={() => setSymbols(!symbols())}>
              {symbols() ? 'abc' : '#+='}
            </FocusButton>
            <FocusButton id={`${props.id}-space`} class="osk-key osk-space" onSelect={() => insert(' ')}>
              {t('osk.space')}
            </FocusButton>
            <FocusButton id={`${props.id}-bksp`} class="osk-key osk-wide" label={t('osk.backspace')} onSelect={backspace}>
              ⌫
            </FocusButton>
            <FocusButton id={`${props.id}-clear`} class="osk-key osk-wide" onSelect={() => props.onChange('')}>
              {t('osk.clear')}
            </FocusButton>
            <Show when={props.masked}>
              <FocusButton id={`${props.id}-reveal`} class="osk-key osk-wide" selected={reveal()} onSelect={() => setReveal(!reveal())}>
                {reveal() ? t('form.hide') : t('form.show')}
              </FocusButton>
            </Show>
            <FocusButton id={`${props.id}-done`} class="osk-key osk-wide btn-primary" onSelect={() => props.onClose()}>
              {t('osk.done')}
            </FocusButton>
          </div>
        </div>
      </FocusZone>
    </div>
  );
}
