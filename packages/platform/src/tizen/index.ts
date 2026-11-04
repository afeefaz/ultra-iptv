import { toKey } from '../keymap';
import { jsHeapUsed } from '../usage';
import type { DeviceInfo, Platform } from '../types';
import { tizenGlobals } from './api';
import { AvPlayPlayer } from './player';

// Everything the app reacts to besides the keys every remote sends without asking (arrows, OK, Back).
const WANTED_KEYS = [
  'MediaPlayPause',
  'MediaPlay',
  'MediaPause',
  'MediaStop',
  'MediaFastForward',
  'MediaRewind',
  'ColorF0Red',
  'ColorF1Green',
  'ColorF2Yellow',
  'ColorF3Blue',
  'ChannelUp',
  'ChannelDown',
  'Info',
  'Tools',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
];

function registerKeys(): void {
  const input = tizenGlobals().tizen?.tvinputdevice;
  if (!input) return;
  // Asking for a key this model lacks would fail the whole batch.
  const supported = input.getSupportedKeys().map((k) => k.name);
  try {
    input.registerKeyBatch(WANTED_KEYS.filter((k) => supported.indexOf(k) >= 0));
  } catch {
    // Without them the arrows, OK and Back still work.
  }
}

/** Samsung TVs (spec §3): the legacy bundle in the TV's web runtime, with AVPlay for video. */
export const tizenPlatform: Platform = {
  id: 'tizen',
  textInput: 'osk',
  // AVPlay plays raw MPEG-TS natively; it's what providers serve most reliably.
  prefersHls: false,
  createPlayer: () => new AvPlayPlayer(),
  keys: {
    start(handler) {
      registerKeys();
      const onKeyDown = (ev: KeyboardEvent) => {
        const key = toKey(ev);
        if (key && handler({ key, raw: ev.key || ev.keyCode, repeat: ev.repeat })) ev.preventDefault();
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    },
  },
  fileExport: {
    exportText(filename, _mimeType, text) {
      return new Promise((resolve, reject) => {
        const fs = tizenGlobals().tizen?.filesystem;
        if (!fs) return reject(new Error('No file access on this TV'));
        // Read back from the Mac with `sdb pull` (docs/debugging.md).
        fs.resolve(
          'downloads',
          (dir) => {
            dir.createFile(filename).openStream(
              'w',
              (stream) => {
                stream.write(text);
                stream.close();
                resolve();
              },
              reject,
            );
          },
          reject,
          'rw',
        );
      });
    },
  },
  async systemUsage() {
    const info = tizenGlobals().tizen?.systeminfo;
    const ramTotal = info?.getTotalMemory();
    const ramFree = info?.getAvailableMemory();
    return {
      ramTotal,
      ramUsed: ramTotal !== undefined && ramFree !== undefined ? ramTotal - ramFree : undefined,
      appUsed: jsHeapUsed(),
    };
  },
  device(): DeviceInfo {
    const { tizen, webapis } = tizenGlobals();
    const read = (fn: () => string | undefined) => {
      try {
        return fn();
      } catch {
        return undefined;
      }
    };
    const ua = navigator.userAgent;
    const chrome = /Chrom(?:e|ium)\/([\d.]+)/.exec(ua);
    return {
      platform: 'tizen',
      engine: chrome ? `Chromium ${chrome[1]}` : ua.split(' ').pop() ?? 'unknown',
      userAgent: ua,
      screen: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio || 1 },
      language: navigator.language,
      model: read(() => webapis?.productinfo?.getRealModel()),
      osVersion: read(() => tizen?.systeminfo?.getCapability('http://tizen.org/feature/platform.version')),
    };
  },
  exit() {
    tizenGlobals().tizen?.application?.getCurrentApplication().exit();
  },
};
