import type { IDBPDatabase } from 'idb';
import type { UltraDb } from '../catalog/db';
import type { EncryptedBlob } from '../catalog/model';
import { AppError } from '../net/http';

const MASTER_KEY = 'master';

/**
 * Where the key comes from, when the platform keeps it itself (the Mac app, in a file in its data
 * folder). WebKit wraps a CryptoKey stored in IndexedDB with a key in the login keychain, and an
 * unsigned app is asked for the keychain password at every launch after an update. Null: the
 * usual non-extractable key in IndexedDB.
 */
let keySource: Promise<Uint8Array | null> = Promise.resolve(null);

/** The catalogue worker sets this before anything is decrypted (see worker.ts `init`). */
export function setSecretKeySource(source: Promise<Uint8Array | null>): void {
  keySource = source;
}

/** A sealed value: by shape, since `instanceof` fails for buffers from another realm (tests, some engines). */
const isBlob = (v: unknown): v is EncryptedBlob => {
  const b = v as { iv?: { byteLength?: unknown }; data?: { byteLength?: unknown } } | null;
  return !!b && typeof b === 'object' && !!b.iv && b.iv.byteLength === 12 && !!b.data && typeof b.data.byteLength === 'number';
};

/**
 * Credentials encrypted at rest with AES-GCM (spec §4.4). The key is a non-extractable
 * WebCrypto key kept in IndexedDB; Android swaps in a Keystore-backed key in phase 4.
 * Protects exports/backups and casual inspection, not a fully compromised device.
 */
export class SecretBox {
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(private readonly db: () => Promise<IDBPDatabase<UltraDb>>) {}

  static available(): boolean {
    return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.subtle.encrypt === 'function';
  }

  async seal(value: unknown): Promise<EncryptedBlob> {
    const key = await this.key();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
    return { iv, data };
  }

  async open<T>(blob: EncryptedBlob): Promise<T> {
    const key = await this.key();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.iv as Uint8Array<ArrayBuffer> }, key, blob.data);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  }

  private key(): Promise<CryptoKey> {
    if (!SecretBox.available()) {
      return Promise.reject(
        new AppError({
          code: 'secure-storage',
          message: 'Encrypted storage is unavailable here (WebCrypto needs https:// or localhost)',
        }),
      );
    }
    if (!this.keyPromise) {
      this.keyPromise = (async () => {
        const db = await this.db();
        const raw = await keySource;
        if (raw) {
          const key = await crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
          await this.moveFromStoredKey(db, key);
          return key;
        }
        const existing = await db.get('keys', MASTER_KEY);
        if (existing) return existing;
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await db.put('keys', key, MASTER_KEY);
        return key;
      })();
      this.keyPromise.catch(() => (this.keyPromise = null));
    }
    return this.keyPromise;
  }

  /**
   * Once, when the platform starts supplying the key: everything sealed with the old IndexedDB key
   * (secrets, and the sealed settings) is sealed again with the new one, and the old key deleted.
   * If it can't be read, what it sealed can't be either: the old key goes anyway, so nobody is
   * asked again, and those playlists need their password once more.
   */
  private async moveFromStoredKey(db: IDBPDatabase<UltraDb>, key: CryptoKey): Promise<void> {
    const old = (await db.get('keys', MASTER_KEY)) as CryptoKey | undefined;
    if (!old) return;
    const reseal = async (blob: EncryptedBlob): Promise<EncryptedBlob> => {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.iv as Uint8Array<ArrayBuffer> }, old, blob.data);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      return { iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain) };
    };
    for (const store of ['secrets', 'settings'] as const) {
      const keys = await db.getAllKeys(store);
      for (const k of keys) {
        const value = await db.get(store, k);
        if (!isBlob(value)) continue;
        try {
          await db.put(store, await reseal(value), k);
        } catch {
          // Unreadable with the old key: left as it is (it can't be opened either way).
        }
      }
    }
    await db.delete('keys', MASTER_KEY);
  }
}
