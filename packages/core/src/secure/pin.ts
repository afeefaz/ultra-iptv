import { fromHex, toHex } from '../log/sha256';

const ITERATIONS = 100_000;

export interface PinHash {
  salt: string;
  hash: string;
  iterations: number;
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

/** Parental PIN stored as PBKDF2-SHA256 with a random salt (spec §5), then sealed like credentials. */
export async function hashPin(pin: string): Promise<PinHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toHex(salt), hash: await derive(pin, salt, ITERATIONS), iterations: ITERATIONS };
}

export async function checkPin(pin: string, stored: PinHash): Promise<boolean> {
  const hash = await derive(pin, fromHex(stored.salt), stored.iterations);
  // Constant-time comparison.
  let diff = hash.length ^ stored.hash.length;
  for (let i = 0; i < hash.length && i < stored.hash.length; i++) diff |= hash.charCodeAt(i) ^ stored.hash.charCodeAt(i);
  return diff === 0;
}

export const isValidPin = (pin: string) => /^\d{4}$/.test(pin);
