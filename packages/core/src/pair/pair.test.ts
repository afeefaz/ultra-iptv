import { describe, expect, it } from 'vitest';
import { deriveDeviceBoxes, deviceUrl, formatDeviceKey, generateDeviceId, generateDeviceKey, newPlaylistId, normalizeDeviceId, normalizeDeviceKey, open, parseDeviceLink, RelayClient, seal } from './pair';

const ID = '02:AB:CD:EF:01:23';
const KEY = 'ABCD2345';

describe('device IDs', () => {
  it('look like a MAC address, marked as locally administered', () => {
    for (let i = 0; i < 200; i++) {
      const id = generateDeviceId();
      expect(id).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
      expect(parseInt(id.slice(0, 2), 16) & 0x03).toBe(0x02);
    }
  });

  it('does not repeat', () => {
    expect(new Set(Array.from({ length: 200 }, generateDeviceId)).size).toBe(200);
  });

  it('accepts what people type, and rejects what cannot be an ID', () => {
    expect(normalizeDeviceId('02abcdef0123')).toBe(ID);
    expect(normalizeDeviceId(' 02-ab-cd-ef-01-23 ')).toBe(ID);
    expect(normalizeDeviceId(ID)).toBe(ID);
    expect(normalizeDeviceId('02:AB:CD')).toBeNull();
    expect(normalizeDeviceId('02:AB:CD:EF:01:GG')).toBeNull();
  });
});

describe('device keys', () => {
  it('are unambiguous and of the right length', () => {
    for (let i = 0; i < 200; i++) expect(generateDeviceKey()).toMatch(/^[2-9A-HJKMNP-TV-Z]{8}$/);
  });

  it('does not repeat', () => {
    expect(new Set(Array.from({ length: 200 }, generateDeviceKey)).size).toBe(200);
  });

  it('accepts what people type, and rejects what cannot be a key', () => {
    expect(normalizeDeviceKey(' abcd-2345 ')).toBe(KEY);
    expect(normalizeDeviceKey(formatDeviceKey(KEY))).toBe(KEY);
    expect(normalizeDeviceKey('ABCD')).toBeNull();
    expect(normalizeDeviceKey('ABCD234O')).toBeNull();
  });
});

describe('device links', () => {
  it('keep the ID and key out of what browsers send to the server', () => {
    const url = new URL(deviceUrl(ID, KEY));
    expect(url.pathname + url.search).toBe('/');
    expect(parseDeviceLink(url.hash)).toEqual({ id: ID, key: KEY });
  });

  it('ignores anything else', () => {
    expect(parseDeviceLink('')).toBeNull();
    expect(parseDeviceLink('#ABCDE23456')).toBeNull();
    expect(parseDeviceLink('#02ABCDEF0123')).toBeNull();
  });
});

describe('boxes', () => {
  it('gives both sides the same box and key', async () => {
    const [tv, page] = await Promise.all([deriveDeviceBoxes(ID, KEY), deriveDeviceBoxes(ID, KEY)]);
    expect(tv.stateBox).toBe(page.stateBox);
    expect(await open(tv.key, await seal(page.key, { hello: 'تجربة' }))).toEqual({ hello: 'تجربة' });
  });

  it('gives box ids that are valid in a URL and reveal nothing', async () => {
    const { stateBox } = await deriveDeviceBoxes(ID, KEY);
    expect(stateBox).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stateBox).not.toContain('ABCD');
  });

  it('cannot be found or opened with the right ID and another key', async () => {
    const [a, b] = await Promise.all([deriveDeviceBoxes(ID, KEY), deriveDeviceBoxes(ID, 'ABCD2346')]);
    expect(a.stateBox).not.toBe(b.stateBox);
    await expect(open(b.key, await seal(a.key, 'secret'))).rejects.toBeTruthy();
  });

  it('cannot be found with the key on another ID', async () => {
    const [a, b] = await Promise.all([deriveDeviceBoxes(ID, KEY), deriveDeviceBoxes('02:AB:CD:EF:01:24', KEY)]);
    expect(a.stateBox).not.toBe(b.stateBox);
  });

  it('detects changed data', async () => {
    const { key } = await deriveDeviceBoxes(ID, KEY);
    const sealed = await seal(key, 'secret');
    const last = sealed[sealed.length - 1] === 'A' ? 'B' : 'A';
    await expect(open(key, sealed.slice(0, -1) + last)).rejects.toBeTruthy();
  });

  it('never seals the same value to the same text', async () => {
    const { key } = await deriveDeviceBoxes(ID, KEY);
    expect(await seal(key, 'x')).not.toBe(await seal(key, 'x'));
  });

  it('does not contain the plain text', async () => {
    const { key } = await deriveDeviceBoxes(ID, KEY);
    const sealed = await seal(key, { password: 'hunter2' });
    expect(sealed).not.toContain('hunter2');
    expect(atob(sealed.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('hunter2');
  });

  it('makes playlist ids that differ', () => {
    expect(newPlaylistId()).not.toBe(newPlaylistId());
  });
});

describe('RelayClient', () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = (status: number, body = '') =>
    new RelayClient('https://relay.test', async (url, init) => {
      calls.push({ url, init });
      return new Response(status === 204 ? null : body, { status });
    });

  it('reads a box, and treats a missing one as empty', async () => {
    expect(await client(200, 'data').get('b')).toBe('data');
    expect(await client(404).get('b')).toBeNull();
  });

  it('never sends cookies', async () => {
    calls.length = 0;
    const c = client(200);
    await c.put('b', 'x', 900);
    await c.get('b');
    expect(calls.every((call) => call.init?.credentials === 'omit')).toBe(true);
    expect(calls[0].url).toBe('https://relay.test/v1/box/b?ttl=900');
  });

  it('reports server errors', async () => {
    await expect(client(500).get('b')).rejects.toThrow('500');
    await expect(client(413).put('b', 'x', 900)).rejects.toThrow('413');
  });
});
