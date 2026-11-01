import fc from 'fast-check';
import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromHex, hmacSha256, sha256, toHex, utf8 } from './sha256';

describe('sha256', () => {
  it('matches the FIPS 180-2 vectors', () => {
    expect(toHex(sha256(utf8('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHex(sha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(toHex(sha256(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('matches node:crypto for random input, including block boundaries', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect(toHex(sha256(bytes))).toBe(createHash('sha256').update(bytes).digest('hex'));
      }),
      { numRuns: 300 },
    );
  });
});

describe('hmacSha256', () => {
  it('matches RFC 4231 test cases 1, 2 and 6', () => {
    expect(toHex(hmacSha256(new Uint8Array(20).fill(0x0b), utf8('Hi There')))).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
    expect(toHex(hmacSha256(utf8('Jefe'), utf8('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
    expect(
      toHex(hmacSha256(new Uint8Array(131).fill(0xaa), utf8('Test Using Larger Than Block-Size Key - Hash Key First'))),
    ).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });

  it('matches node:crypto for random keys and messages', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 150 }), fc.uint8Array({ maxLength: 200 }), (key, msg) => {
        expect(toHex(hmacSha256(key, msg))).toBe(createHmac('sha256', key).update(msg).digest('hex'));
      }),
      { numRuns: 300 },
    );
  });
});

describe('hex helpers', () => {
  it('round-trip', () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 255]);
    expect(toHex(bytes)).toBe('00010f10ff');
    expect(fromHex(toHex(bytes))).toEqual(bytes);
  });
});
