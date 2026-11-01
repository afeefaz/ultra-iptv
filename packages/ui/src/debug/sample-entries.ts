import { log, logging } from '@ultra/core';

const DEMO_HOST = 'demo-provider.example.com';
const DEMO_USER = 'demo_user';
const DEMO_PASS = 'demo_pass';

/**
 * Writes realistic entries containing fake credentials, so the redaction can be checked
 * by eye on the debug screen. Registers them like a real playlist would (phase 1).
 */
export function addSampleEntries(): void {
  logging.redactor.addSecret(DEMO_USER);
  logging.redactor.addSecret(DEMO_PASS);
  logging.redactor.addHost(DEMO_HOST);

  log.log(
    'info',
    'net',
    'GET',
    {
      url: `http://${DEMO_HOST}:8080/player_api.php?username=${DEMO_USER}&password=${DEMO_PASS}&action=get_live_streams`,
      status: 200,
      bytes: 1843200,
    },
    2310,
  );
  log.info('player', 'first-frame', { engine: 'web', zapMs: 812 });
  log.warn('player', 'reconnect', { attempt: 2, delayMs: 1000 });
  log.warn('net', `login failed for ${DEMO_USER} on ${DEMO_HOST}`);
  log.error(
    'net',
    'request failed',
    new Error(`Failed to fetch http://${DEMO_USER}:${DEMO_PASS}@${DEMO_HOST}/live/${DEMO_USER}/${DEMO_PASS}/1001.ts`),
  );
  log.debug('keys', 'press', { key: 'ok', raw: 'Enter' });
}
