import { toKey } from '../keymap';
import { jsHeapUsed } from '../usage';
import type { DeviceInfo, Key, Platform } from '../types';
import { WebPlayer } from './player';

// Keys that keep their normal meaning while typing in a text field.
const TEXT_EDITING_KEYS: Key[] = ['left', 'right', 'back', 'digit0', 'digit1', 'digit2', 'digit3', 'digit4', 'digit5', 'digit6', 'digit7', 'digit8', 'digit9'];

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

// `?tv=1` makes the browser behave like a TV (on-screen keyboard), for testing on the Mac.
const tvMode = typeof location !== 'undefined' && /[?&]tv=1(&|$)/.test(location.search);

export const webPlatform: Platform = {
  id: 'web',
  textInput: tvMode ? 'osk' : 'native',
  isTv: () => tvMode,
  // Browsers can't play raw MPEG-TS without mpegts.js; HLS is the more robust default.
  prefersHls: true,
  createPlayer: () => new WebPlayer(),
  keys: {
    start(handler) {
      const onKeyDown = (ev: KeyboardEvent) => {
        const key = toKey(ev);
        if (!key) return;
        // Backspace deletes text; Escape still leaves the field (handled as `back`).
        if (isEditable(ev.target) && TEXT_EDITING_KEYS.indexOf(key) >= 0 && ev.key !== 'Escape') return;
        if (handler({ key, raw: ev.key || ev.keyCode, repeat: ev.repeat })) ev.preventDefault();
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    },
  },
  fileExport: {
    async exportText(filename, mimeType, text) {
      const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  },
  // A browser only reveals its own page's memory, not the device's.
  async systemUsage() {
    return { appUsed: jsHeapUsed() };
  },
  device(): DeviceInfo {
    const ua = navigator.userAgent;
    const chrome = /Chrom(?:e|ium)\/([\d.]+)/.exec(ua);
    return {
      platform: 'web',
      engine: chrome ? `Chromium ${chrome[1]}` : ua.split(' ').pop() ?? 'unknown',
      userAgent: ua,
      screen: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio || 1 },
      language: navigator.language,
    };
  },
};
