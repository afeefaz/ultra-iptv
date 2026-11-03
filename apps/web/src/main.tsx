import type { Platform } from '@ultra/platform';
import { webPlatform } from '@ultra/platform/web';
import { App, startLogging } from '@ultra/ui';
import '@ultra/ui/styles.css';
import { render } from 'solid-js/web';

// Capacitor injects its bridge before the page loads, so this is known at start-up.
const isAndroidApp = !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

const platformReady: Promise<Platform> = isAndroidApp
  ? import('@ultra/platform/android').then((m) => m.androidPlatform)
  : Promise.resolve(webPlatform);

void platformReady.then((platform) => {
  startLogging(platform);
  render(() => <App platform={platform} />, document.getElementById('root')!);
});
