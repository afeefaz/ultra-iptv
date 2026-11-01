import type { IDBPDatabase } from 'idb';
import type { UltraDb } from '../catalog/db';
import type { EncryptedBlob } from '../catalog/model';
import { AppError } from '../net/http';

const MASTER_KEY = 'master';

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
}
