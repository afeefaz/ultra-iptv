/**
 * Device ID, key and encryption for the relay (docs/remote-and-sync-plan.md). Each device shows an
 * ID in MAC format and a key. Everything the relay stores is encrypted with what they derive, under
 * box ids they derive, and neither ever reaches it. No dependencies: the web page uses this too.
 */

/** Where the relay and its web page live. */
export const RELAY_URL = 'https://ultra-iptv-relay.afeef-az11.workers.dev';
/** Long enough to be managed for years with the TV off. Every save starts it again. */
export const DEVICE_TTL_SECONDS = 10 * 365 * 24 * 3600;

// No 0/O, 1/I/L or U, so a key is easy to read off a TV and hard to mistype.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_LENGTH = 8;
const ID_BYTES = 6;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT = 'ultra-iptv-device-v1';
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Apps can't read the real MAC on most devices, and a real one would be guessable from its maker's
 * prefix. So this is random, marked as locally administered the way MAC addresses allow.
 */
export function generateDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES));
  bytes[0] = (bytes[0]! | 0x02) & 0xfe;
  return Array.from(bytes, (b) => (b < 16 ? '0' : '') + b.toString(16).toUpperCase()).join(':');
}

/** What people type: any case, with or without separators. Null if it can't be an ID. */
export function normalizeDeviceId(input: string): string | null {
  const hex = input.toUpperCase().replace(/[\s:.-]/g, '');
  if (!/^[0-9A-F]{12}$/.test(hex)) return null;
  return hex.match(/../g)!.join(':');
}

export function generateDeviceKey(): string {
  // Rejection sampling, so every character is equally likely.
  const limit = 256 - (256 % ALPHABET.length);
  let key = '';
  while (key.length < KEY_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(KEY_LENGTH))) {
      if (byte < limit && key.length < KEY_LENGTH) key += ALPHABET[byte % ALPHABET.length];
    }
  }
  return key;
}

/** What people type: any case, with spaces or dashes. Null if it can't be a key. */
export function normalizeDeviceKey(input: string): string | null {
  const key = input.toUpperCase().replace(/[\s-]/g, '');
  if (key.length !== KEY_LENGTH) return null;
  for (const c of key) if (ALPHABET.indexOf(c) < 0) return null;
  return key;
}

export const formatDeviceKey = (key: string): string => `${key.slice(0, 4)}-${key.slice(4)}`;

/** The ID and key stay in the #fragment, which browsers don't send to servers. */
export const deviceUrl = (id: string, key: string): string => `${RELAY_URL}/#${id.replace(/:/g, '')}-${key}`;

export function parseDeviceLink(fragment: string): { id: string; key: string } | null {
  const [rawId, rawKey] = fragment.replace(/^#/, '').split('-');
  const id = normalizeDeviceId(rawId ?? '');
  const key = normalizeDeviceKey(rawKey ?? '');
  return id && key ? { id, key } : null;
}

export const newPlaylistId = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(12)));

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const hkdfParts = async (secret: BufferSource, infos: string[]): Promise<Uint8Array[]> => {
  const hkdf = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return Promise.all(
    infos.map(async (info) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(info) }, hkdf, 256))),
  );
};

const aesKey = (bytes: Uint8Array) => crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

export interface DeviceBoxes {
  /** The device's playlists, saved by the website or the device. */
  stateBox: string;
  key: CryptoKey;
}

/** Both sides call this with the same ID and key, and get the same box and encryption key. */
export async function deriveDeviceBoxes(id: string, key: string): Promise<DeviceBoxes> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(`${id}|${key}`), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(PBKDF2_SALT), iterations: PBKDF2_ITERATIONS }, base, 256);
  const [aes, state] = await hkdfParts(master, ['device-key', 'device-state']);
  return { stateBox: toBase64Url(state!), key: await aesKey(aes!) };
}

export async function seal(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value))));
  const out = new Uint8Array(IV_BYTES + data.length);
  out.set(iv);
  out.set(data, IV_BYTES);
  return toBase64Url(out);
}

/** Throws if the data was changed or was sealed with another key. */
export async function open<T>(key: CryptoKey, sealed: string): Promise<T> {
  const bytes = fromBase64Url(sealed);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) }, key, bytes.slice(IV_BYTES));
  return JSON.parse(decoder.decode(plain)) as T;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The relay's three operations. Failures throw, so callers can retry or explain. */
export class RelayClient {
  constructor(
    private readonly baseUrl: string = RELAY_URL,
    private readonly fetcher: FetchLike = (url, init) => fetch(url, init),
  ) {}

  async put(box: string, body: string, ttlSeconds: number): Promise<void> {
    const res = await this.fetcher(`${this.baseUrl}/v1/box/${box}?ttl=${ttlSeconds}`, { method: 'PUT', body, credentials: 'omit' });
    if (!res.ok) throw new Error(`Relay answered ${res.status}`);
  }

  /** Null when the box is empty. */
  async get(box: string): Promise<string | null> {
    const res = await this.fetcher(`${this.baseUrl}/v1/box/${box}`, { cache: 'no-store', credentials: 'omit' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Relay answered ${res.status}`);
    return res.text();
  }

  async remove(box: string): Promise<void> {
    await this.fetcher(`${this.baseUrl}/v1/box/${box}`, { method: 'DELETE', credentials: 'omit' });
  }
}

/** A playlist as the TV and the website save it: the same fields as the playlist form. */
export interface RemotePlaylist {
  id: string;
  name: string;
  type: 'xtream' | 'm3u';
  server?: string;
  username?: string;
  password?: string;
  m3uUrl?: string;
  userAgent?: string;
  refreshHours?: number;
  epgOffsetHours?: number;
}

export interface RemoteState {
  playlists: RemotePlaylist[];
}
