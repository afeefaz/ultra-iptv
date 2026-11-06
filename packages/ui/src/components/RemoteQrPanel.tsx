import { deviceUrl } from '@ultra/core/pair';
import { createResource, Show, type JSX } from 'solid-js';
import { remoteIdentity } from '../data/remoteAccess';
import { t } from '../i18n';
import { RemoteRefreshButton } from './RemoteRefreshButton';

async function qrSvg(url: string): Promise<string> {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
}

/** The way to manage this device from a phone. Its button joins the surrounding focus zone. */
export function RemoteQrPanel(props: { id: string; hideText?: boolean }): JSX.Element {
  const [svg] = createResource(remoteIdentity, (identity) => qrSvg(deviceUrl(identity.id, identity.key)));
  return (
    <div class="remote-qr">
      <div class="remote-qr-code" innerHTML={svg() ?? ''} />
      <Show when={!props.hideText}>
        <p class="remote-qr-text">{t('remote.scan')}</p>
      </Show>
      <RemoteRefreshButton id={`${props.id}-refresh`} />
    </div>
  );
}
