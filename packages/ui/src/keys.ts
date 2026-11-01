import type { KeyPress } from '@ultra/platform';
import { onCleanup, onMount } from 'solid-js';

/** Return `true` when handled; unhandled presses fall through to the next handler down. */
export type ScreenKeyHandler = (press: KeyPress) => boolean | void;

const stack: ScreenKeyHandler[] = [];

export function pushKeyHandler(handler: ScreenKeyHandler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Most recently mounted handler first (dialogs over screens over the app). */
export function dispatchKey(press: KeyPress): boolean {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i](press) === true) return true;
  return false;
}

export function useKeys(handler: ScreenKeyHandler): void {
  onMount(() => onCleanup(pushKeyHandler(handler)));
}
