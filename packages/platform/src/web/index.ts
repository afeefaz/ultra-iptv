import { toKey } from '../keymap';
import { jsHeapUsed } from '../usage';
import type { CatalogFiles, DeviceInfo, Key, Platform } from '../types';
import { WebPlayer } from './player';

// Keys that keep their normal meaning while typing in a text field.
const TEXT_EDITING_KEYS: Key[] = ['left', 'right', 'back', 'digit0', 'digit1', 'digit2', 'digit3', 'digit4', 'digit5', 'digit6', 'digit7', 'digit8', 'digit9'];

/** Space is play/pause, except while typing. */
function isSpace(ev: KeyboardEvent): boolean {
  return ev.key === ' ' || ev.key === 'Spacebar' || ev.keyCode === 32;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

// `?tv=1` makes the browser behave like a TV (on-screen keyboard), for testing on the Mac.
const tvMode = typeof location !== 'undefined' && /[?&]tv=1(&|$)/.test(location.search);

// `?files=1` keeps the catalogue in (in-memory) files like a Samsung TV does, for testing on the Mac.
const filesMode = typeof location !== 'undefined' && /[?&]files=1(&|$)/.test(location.search);

function memoryCatalogFiles(): CatalogFiles {
  const files = new Map<string, string>();
  return {
    write: async (path, text) => {
      files.set(path, text);
    },
    read: async (path) => (files.has(path) ? (files.get(path) as string) : null),
    append: async (path, text, start) => {
      files.set(path, (start ? '' : (files.get(path) ?? '')) + text);
    },
    // Like the TV: a UTF-8 byte position, then a number of code points.
    readSlice: async (path, byteOffset, count) => {
      if (!files.has(path)) return null;
      const bytes = new TextEncoder().encode(files.get(path) as string).subarray(byteOffset);
      return Array.from(new TextDecoder().decode(bytes)).slice(0, count).join('');
    },
    removeDir: async (path) => {
      files.forEach((_, key) => {
        if (key === path || key.indexOf(`${path}/`) === 0) files.delete(key);
      });
    },
    freeBytes: async () => undefined,
  };
}

export const webPlatform: Platform = {
  catalogFiles: filesMode ? memoryCatalogFiles() : undefined,
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
        if (isEditable(ev.target) && (TEXT_EDITING_KEYS.indexOf(key) >= 0 || isSpace(ev)) && ev.key !== 'Escape') return;
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
