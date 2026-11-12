import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openUltraDb, useDatabaseName } from '../catalog/db';
import type { EncryptedBlob } from '../catalog/model';
import { SecretBox, setSecretKeySource } from './secret-box';

let n = 0;
afterEach(() => setSecretKeySource(Promise.resolve(null)));

describe('SecretBox', () => {
  it('seals and opens with the key kept in IndexedDB', async () => {
    useDatabaseName(`box-${n++}`);
    const box = new SecretBox(openUltraDb);
    expect(await box.open(await box.seal({ password: 'x' }))).toEqual({ password: 'x' });
    expect(await (await openUltraDb()).get('keys', 'master')).toBeTruthy();
  });

  it('moves everything to a platform key once, and drops the stored one', async () => {
    useDatabaseName(`box-${n++}`);
    const db = await openUltraDb();
    const before = new SecretBox(openUltraDb);
    await db.put('secrets', await before.seal({ password: 'secret' }), 'pl_1');
    await db.put('settings', await before.seal('pin-hash'), 'pin');
    await db.put('settings', 'plain value', 'other');

    setSecretKeySource(Promise.resolve(crypto.getRandomValues(new Uint8Array(32))));
    const after = new SecretBox(openUltraDb);
    // The first use of the key does the move; read the stored values after it.
    await after.seal('warm up');
    expect(await after.open((await db.get('secrets', 'pl_1')) as EncryptedBlob)).toEqual({ password: 'secret' });
    expect(await after.open((await db.get('settings', 'pin')) as EncryptedBlob)).toBe('pin-hash');
    expect(await db.get('settings', 'other')).toBe('plain value');
    expect(await db.get('keys', 'master')).toBeUndefined();
    // New secrets use the platform key, and nothing goes back into IndexedDB.
    expect(await after.open(await after.seal('new'))).toBe('new');
    expect(await db.get('keys', 'master')).toBeUndefined();
  });
});
