import { createSignal } from 'solid-js';

const [toastText, setToastText] = createSignal('');
let timer: ReturnType<typeof setTimeout> | undefined;
const SHOWN_MS = 4000;

export { toastText };

/** A short message at the bottom of the screen, whichever screen it's on. */
export function showToast(text: string): void {
  setToastText(text);
  clearTimeout(timer);
  timer = setTimeout(() => setToastText(''), SHOWN_MS);
}
