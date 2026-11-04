import { perf } from '@ultra/core';
import type { Platform } from '@ultra/platform';
import { webPlatform } from '@ultra/platform/web';
import { App, startLogging } from '@ultra/ui';
import '@ultra/ui/styles.css';
import { render } from 'solid-js/web';

// Capacitor injects its bridge before the page loads, so this is known at start-up.
const isAndroidApp = !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

// The TV's web runtime defines `tizen` before any page script runs.
const isTizenApp = 'tizen' in window;

const platformReady: Promise<Platform> = isAndroidApp
  ? import('@ultra/platform/android').then((m) => m.androidPlatform)
  : isTizenApp
    ? import('@ultra/platform/tizen').then((m) => m.tizenPlatform)
    : Promise.resolve(webPlatform);

perf.mark('startup.scriptRan');

void platformReady.then((platform) => {
  perf.mark('startup.platformReady');
  startLogging(platform);
  render(() => <App platform={platform} />, document.getElementById('root')!);
  document.getElementById('splash')?.remove();
});
