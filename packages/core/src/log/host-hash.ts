import { fromHex, hmacSha256, toHex, utf8 } from './sha256';

const SALT_KEY = 'ultraiptv.log.salt';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Per-install salt, so host hashes are stable on one device but can't be matched across devices. */
export function loadSalt(storage: KeyValueStorage | undefined): Uint8Array {
  try {
    const hex = storage?.getItem(SALT_KEY);
    if (hex && /^[0-9a-f]{32}$/.test(hex)) return fromHex(hex);
  } catch {
    // storage blocked: fall through to a session-only salt
  }
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  try {
    storage?.setItem(SALT_KEY, toHex(salt));
  } catch {
    // ignore
  }
  return salt;
}

export interface HostHasher {
  /** `host-` + first 8 hex chars of HMAC-SHA256(host, salt). */
  hash(host: string): string;
  /** Hash ↔ host pairs seen this session. For the on-device debug screen only, never exported. */
  lookup(): Array<{ label: string; host: string }>;
}

export function createHostHasher(salt: Uint8Array): HostHasher {
  const cache = new Map<string, string>();
  return {
    hash(host) {
      const key = host.toLowerCase();
      let label = cache.get(key);
      if (!label) {
        label = 'host-' + toHex(hmacSha256(salt, utf8(key))).slice(0, 8);
        cache.set(key, label);
      }
      return label;
    },
    lookup() {
      return Array.from(cache, ([host, label]) => ({ label, host }));
    },
  };
}
