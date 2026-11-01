import { log } from '@ultra/core';
import { createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { catalog } from '../data/catalog';
import { finishPinRequest, pinRequest, type PinMode } from '../data/parental';
import { FocusZone } from '../focus';
import { formatNumber, t } from '../i18n';
import { useKeys } from '../keys';
import { FocusButton } from './FocusButton';

const PIN_LENGTH = 4;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 30_000;
let failures = 0;
let lockedUntil = 0;

/** Rendered once by the App; shows whenever something calls `requestPin()`. */
export function PinHost(): JSX.Element {
  return (
    <Show when={pinRequest()} keyed>
      {(req) => <PinDialog mode={req.mode} onDone={finishPinRequest} />}
    </Show>
  );
}

type Step = 'current' | 'new' | 'confirm';

/** Number pad for the parental PIN (spec §5). Digit keys on the remote work too. */
function PinDialog(props: { mode: PinMode; onDone: (ok: boolean) => void }): JSX.Element {
  const [step, setStep] = createSignal<Step>(props.mode === 'create' ? 'new' : 'current');
  const [digits, setDigits] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  let currentPin = '';
  let firstNew = '';

  const title = () =>
    step() === 'new' ? t('pin.new') : step() === 'confirm' ? t('pin.confirm') : props.mode === 'verify' ? t('pin.enter') : t('pin.current');

  const wrong = () => {
    failures++;
    if (failures >= MAX_FAILURES) {
      lockedUntil = Date.now() + LOCKOUT_MS;
      failures = 0;
    }
    setError(t('pin.wrong'));
    setDigits('');
  };

  const submit = async (pin: string) => {
    setBusy(true);
    try {
      if (step() === 'current') {
        if (props.mode === 'remove') {
          await catalog().call('clearPin', pin);
          failures = 0;
          return props.onDone(true);
        }
        if (!(await catalog().call('verifyPin', pin))) return wrong();
        failures = 0;
        if (props.mode === 'verify') return props.onDone(true);
        currentPin = pin;
        setStep('new');
      } else if (step() === 'new') {
        firstNew = pin;
        setStep('confirm');
      } else {
        if (pin !== firstNew) {
          setError(t('pin.mismatch'));
          setStep('new');
        } else {
          await catalog().call('setPin', props.mode === 'change' ? currentPin : null, pin);
          return props.onDone(true);
        }
      }
      setDigits('');
      if (step() !== 'confirm' || pin === firstNew) setError('');
    } catch (e) {
      log.warn('parental', 'pin step failed', { error: e });
      wrong();
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (busy()) return;
    const wait = lockedUntil - Date.now();
    if (wait > 0) {
      setError(t('pin.locked', { n: formatNumber(Math.ceil(wait / 1000)) }));
      return;
    }
    const next = (digits() + d).slice(0, PIN_LENGTH);
    setDigits(next);
    if (next.length === PIN_LENGTH) void submit(next);
  };

  const backspace = () => setDigits((d) => d.slice(0, -1));

  useKeys((p) => {
    if (p.key.indexOf('digit') === 0) {
      press(p.key.slice(5));
      return true;
    }
    if (p.key === 'back') {
      if (digits()) backspace();
      else props.onDone(false);
      return true;
    }
    return false;
  });

  // Physical keyboards: Backspace edits rather than closing.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Backspace') return;
    e.preventDefault();
    e.stopPropagation();
    backspace();
  };
  window.addEventListener('keydown', onKey, true);
  onCleanup(() => window.removeEventListener('keydown', onKey, true));

  return (
    <div class="dialog-backdrop">
      <FocusZone id="pin-dialog" trap>
        <div class="dialog pin-dialog" role="dialog" aria-modal="true" aria-label={title()}>
          <h2 class="dialog-title">{title()}</h2>
          <div class="pin-dots" dir="ltr" aria-label={formatNumber(digits().length)}>
            <For each={[0, 1, 2, 3]}>{(i) => <span class="pin-dot" classList={{ filled: i < digits().length }} />}</For>
          </div>
          <p class="pin-error" role="alert">
            {error()}
          </p>
          <div class="pin-pad" dir="ltr">
            <For each={['1', '2', '3', '4', '5', '6', '7', '8', '9']}>
              {(d) => (
                <FocusButton id={`pin-${d}`} class="pin-key" autofocus={d === '5'} onSelect={() => press(d)}>
                  {d}
                </FocusButton>
              )}
            </For>
            <FocusButton id="pin-cancel" class="pin-key pin-small" onSelect={() => props.onDone(false)}>
              {t('common.cancel')}
            </FocusButton>
            <FocusButton id="pin-0" class="pin-key" onSelect={() => press('0')}>
              0
            </FocusButton>
            <FocusButton id="pin-back" class="pin-key pin-small" label={t('osk.backspace')} onSelect={backspace}>
              ⌫
            </FocusButton>
          </div>
        </div>
      </FocusZone>
    </div>
  );
}
