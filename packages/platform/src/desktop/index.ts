import { DESKTOP_LATEST_URL } from '@ultra/core';
import type { DeviceInfo, Platform, UpdateProblem } from '../types';
import { webPlatform } from '../web';
import { MpvPlayer } from './player';
import { native } from './plugin';

/**
 * The Mac app (Tauri, apps/desktop): the same app in a native window, with mpv for video and
 * provider requests, files and the speed test done natively, so no browser limits apply.
 */
export async function createDesktopPlatform(): Promise<Platform> {
  // The page can't see the macOS version or the Mac's model; ask once at start-up.
  const info = await native.appInfo().catch(() => null);
  let player: MpvPlayer | null = null;

  const toggleFullscreen = async () => native.setFullscreen(!(await native.isFullscreen()));

  return {
    id: 'macos',
    textInput: 'native',
    isTv: () => false,
    // mpv plays raw MPEG-TS natively, like the TVs and Android do.
    prefersHls: false,
    createPlayer: () => (player = player ?? new MpvPlayer({ ...native.mpv, keepAwake: native.keepAwake })),
    keys: {
      start(handler) {
        const stopKeys = webPlatform.keys.start(handler);
        // F11, or the Mac's own Ctrl+Cmd+F, makes the window full screen.
        const onKeyDown = (ev: KeyboardEvent) => {
          const isFull = ev.key === 'F11' || (ev.metaKey && ev.ctrlKey && (ev.key === 'f' || ev.key === 'F'));
          if (!isFull) return;
          ev.preventDefault();
          void toggleFullscreen();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
          stopKeys();
          window.removeEventListener('keydown', onKeyDown);
        };
      },
    },
    windowFullscreen: {
      get: () => native.isFullscreen(),
      set: (on) => native.setFullscreen(on),
    },
    fileExport: {
      async exportText(filename, _mimeType, text) {
        await native.exportText(filename, text);
      },
    },
    secretKey: () => native.secretKey(),
    http: (request) => native.httpGet(request.url, request.headers, request.timeoutMs),
    catalogFiles: {
      write: (path, text) => native.files.write(path, text),
      append: (path, text, start) => native.files.append(path, text, start),
      readSlice: (path, offset, count) => native.files.readSlice(path, offset, count),
      read: (path) => native.files.read(path),
      removeDir: (path) => native.files.removeDir(path),
      freeBytes: () => native.files.freeBytes().then((n) => (n === null ? undefined : n), () => undefined),
    },
    updater: {
      latestUrl: DESKTOP_LATEST_URL,
      relaunches: true,
      async info() {
        const i = await native.updateInfo();
        return { versionCode: i.versionCode, canInstall: i.canInstall, blocker: i.blocker ?? undefined };
      },
      // Nothing to allow on a Mac.
      openInstallPermission: async () => true,
      async install({ versionName }, events) {
        try {
          await native.updateInstall(versionName, (percent) => {
            events.onProgress(percent);
            if (percent >= 100) events.onInstalling();
          });
          events.onInstalling();
        } catch (e) {
          const code = String(e);
          events.onProblem((['network', 'corrupt', 'storage'].indexOf(code) >= 0 ? code : 'install') as UpdateProblem);
        }
      },
    },
    // The database has plenty of room on a Mac: Classic until Fast is chosen in Settings.
    catalogFilesByDefault: false,
    systemUsage: () => native.systemUsage(),
    async download(url, { seconds, onProgress, isCancelled }) {
      const result = await native.measureDownload(url, seconds, (p) => {
        if (isCancelled?.()) void native.cancelDownload();
        else onProgress?.(p.bytes, p.ms);
      });
      return { ...result, compressed: false };
    },
    device(): DeviceInfo {
      const ua = navigator.userAgent;
      const webkit = /AppleWebKit\/([\d.]+)/.exec(ua);
      return {
        platform: 'macos',
        engine: webkit ? `WebKit ${webkit[1]}` : 'WebKit',
        userAgent: ua,
        screen: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio || 1 },
        language: navigator.language,
        model: info?.model,
        osVersion: info?.osVersion,
      };
    },
  };
}
