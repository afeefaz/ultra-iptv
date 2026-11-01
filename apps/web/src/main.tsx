import { webPlatform } from '@ultra/platform/web';
import { App, startLogging } from '@ultra/ui';
import '@ultra/ui/styles.css';
import { render } from 'solid-js/web';

startLogging(webPlatform);
render(() => <App platform={webPlatform} />, document.getElementById('root')!);
