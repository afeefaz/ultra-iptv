import { App } from '@capacitor/app';
import { CapacitorHttp } from '@capacitor/core';
import type { DeviceInfo, Platform } from '../types';
import { jsHeapUsed } from '../usage';
import { webPlatform } from '../web';
import { UltraPlayer, UltraUpdater } from './plugin';
import { NativePlayer } from './player';

/**
 * Android phone, Android TV and Fire TV (spec §3): the same app in a Capacitor WebView, with
 * Media3 ExoPlayer for playback and native HTTP for playlists.
 */
export const androidPlatform: Platform = {
  id: 'android',
  // The system keyboard works on phones and on TVs (Android TV's on-screen keyboard).
  textInput: 'native',
  // ExoPlayer plays raw MPEG-TS natively; it's what providers serve most reliably.
  prefersHls: false,
  createPlayer: () => new NativePlayer(),
  keys: {
    start(handler) {
      // D-pad, OK, media, channel and colour keys reach the WebView as key events.
      const stopKeys = webPlatform.keys.start(handler);
      // Back is delivered by Capacitor, not as a key event.
      const sub = App.addListener('backButton', () => {
        handler({ key: 'back', raw: 'backButton', repeat: false });
      });
      return () => {
        stopKeys();
        void sub.then((h) => h.remove());
      };
    },
  },
  fileExport: {
    async exportText(filename, mimeType, text) {
      await UltraPlayer.shareText({ filename, mimeType, text });
    },
  },
  async http(request) {
    const res = await CapacitorHttp.get({
      url: request.url,
      headers: request.headers,
      responseType: 'text',
      connectTimeout: request.timeoutMs,
      readTimeout: request.timeoutMs,
    });
    return { status: res.status, body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) };
  },
  async systemUsage() {
    const usage = await UltraPlayer.systemUsage();
    // The native figure is the app's main process; the page's memory lives in a separate one.
    return { ...usage, appUsed: usage.appUsed + (jsHeapUsed() ?? 0) };
  },
  async download(url, { seconds, onProgress, isCancelled }) {
    const sub = await UltraPlayer.addListener('downloadProgress', (e) => {
      if (isCancelled?.()) void UltraPlayer.cancelDownload();
      else onProgress?.(e.bytes, e.ms);
    });
    try {
      // Sent uncompressed, so the byte count is what really crossed the network.
      return { ...(await UltraPlayer.measureDownload({ url, seconds })), compressed: false };
    } finally {
      void sub.remove();
    }
  },
  updater: {
    info: () => UltraUpdater.info(),
    async openInstallPermission() {
      return (await UltraUpdater.openInstallPermission()).opened;
    },
    async install({ url, sha256 }, events) {
      const progress = await UltraUpdater.addListener('progress', (e) => events.onProgress(e.percent));
      const status = await UltraUpdater.addListener('status', (e) => {
        if (e.state === 'cancelled') events.onCancelled();
        else if (e.state === 'refused' || e.state === 'storage') events.onProblem(e.state);
      });
      try {
        await UltraUpdater.install({ url, sha256 });
        events.onInstalling();
      } catch (e) {
        const code = (e as { code?: string }).code;
        events.onProblem(code === 'corrupt' || code === 'network' ? code : 'install');
        void status.remove();
      } finally {
        void progress.remove();
      }
    },
  },
  async openExternal(url, title) {
    await UltraPlayer.openExternal({ url, title });
  },
  exit() {
    void App.exitApp();
  },
  device(): DeviceInfo {
    const ua = navigator.userAgent;
    const chrome = /Chrome\/([\d.]+)/.exec(ua);
    const android = /Android ([\d.]+)/.exec(ua);
    const model = /Android [\d.]+; ([^;)]+)/.exec(ua);
    return {
      platform: 'android',
      engine: chrome ? `WebView ${chrome[1]}` : 'WebView',
      userAgent: ua,
      screen: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio || 1 },
      language: navigator.language,
      model: model ? model[1].trim() : undefined,
      osVersion: android ? `Android ${android[1]}` : undefined,
    };
  },
};
