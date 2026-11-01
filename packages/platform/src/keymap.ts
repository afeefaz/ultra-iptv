import type { Digit, Key } from './types';

// KeyboardEvent.key names (web, Android WebView, newer TVs).
const BY_NAME: Record<string, Key> = {
  ArrowUp: 'up',
  Up: 'up',
  ArrowDown: 'down',
  Down: 'down',
  ArrowLeft: 'left',
  Left: 'left',
  ArrowRight: 'right',
  Right: 'right',
  Enter: 'ok',
  Accept: 'ok',
  Escape: 'back',
  Esc: 'back',
  Backspace: 'back',
  BrowserBack: 'back',
  GoBack: 'back',
  XF86Back: 'back',
  ContextMenu: 'menu',
  Info: 'info',
  MediaPlayPause: 'playPause',
  MediaPlay: 'play',
  MediaPause: 'pause',
  MediaStop: 'stop',
  MediaFastForward: 'ff',
  MediaRewind: 'rew',
  ChannelUp: 'chUp',
  ChannelDown: 'chDown',
  PageUp: 'chUp',
  PageDown: 'chDown',
  F1: 'red',
  F2: 'green',
  F3: 'yellow',
  F4: 'blue',
  ColorF0Red: 'red',
  ColorF1Green: 'green',
  ColorF2Yellow: 'yellow',
  ColorF3Blue: 'blue',
};

// keyCodes, for engines where `key` is missing or "Unidentified" (Tizen 4, webOS 4).
const BY_CODE: Record<number, Key> = {
  38: 'up',
  40: 'down',
  37: 'left',
  39: 'right',
  13: 'ok',
  27: 'back',
  8: 'back',
  10009: 'back', // Tizen Return
  461: 'back', // webOS Back
  33: 'chUp',
  34: 'chDown',
  427: 'chUp', // Tizen
  428: 'chDown',
  112: 'red',
  113: 'green',
  114: 'yellow',
  115: 'blue',
  403: 'red',
  404: 'green',
  405: 'yellow',
  406: 'blue',
  415: 'play',
  19: 'pause',
  413: 'stop',
  417: 'ff',
  412: 'rew',
  179: 'playPause',
  10252: 'playPause', // Tizen
  457: 'info',
  93: 'menu',
  10135: 'menu', // Tizen Tools
};

export function toKey(e: { key?: string; keyCode?: number }): Key | null {
  if (e.key && e.key !== 'Unidentified') {
    if (/^[0-9]$/.test(e.key)) return `digit${Number(e.key) as Digit}`;
    const named = BY_NAME[e.key];
    if (named) return named;
  }
  const code = e.keyCode ?? 0;
  if (code >= 48 && code <= 57) return `digit${(code - 48) as Digit}`;
  if (code >= 96 && code <= 105) return `digit${(code - 96) as Digit}`;
  return BY_CODE[code] ?? null;
}
