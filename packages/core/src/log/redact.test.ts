import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createHostHasher } from './host-hash';
import { MASK, Redactor } from './redact';

const USER = 'alice77';
const PASS = 's3cr3tPw';
const HOST = 'prov.example.com';

function makeRedactor(register = false) {
  const hosts = createHostHasher(new Uint8Array(16).fill(7));
  const r = new Redactor({ hashHost: hosts.hash, keepHosts: ['localhost'] });
  if (register) {
    r.addSecret(USER);
    r.addSecret(PASS);
    r.addHost(HOST);
  }
  return { r, hosts };
}

function expectClean(out: string, ...forbidden: string[]) {
  for (const f of forbidden) expect(out.toLowerCase()).not.toContain(f.toLowerCase());
}

const STRUCTURAL_FIXTURES = [
  `http://${HOST}:8080/get.php?username=${USER}&password=${PASS}&type=m3u_plus&output=ts`,
  `http://${HOST}:8080/player_api.php?username=${USER}&password=${PASS}&action=get_live_streams`,
  `http://${HOST}/xmltv.php?username=${USER}&password=${PASS}`,
  `http://${HOST}/live/${USER}/${PASS}/1234.ts`,
  `http://${HOST}/live/${USER}/${PASS}/1234.m3u8`,
  `https://${HOST}/movie/${USER}/${PASS}/555.mkv`,
  `http://${HOST}/series/${USER}/${PASS}/777.mp4`,
  `http://${HOST}/timeshift/${USER}/${PASS}/60/2026-10-31:20-00/1234.ts`,
  `http://${HOST}/streaming/timeshift.php?username=${USER}&password=${PASS}&stream=1234&start=2026-10-31:20-00&duration=60`,
  `http://${HOST}/playlist/${USER}/${PASS}/m3u_plus`,
  `http://${HOST}:25461/${USER}/${PASS}/1234`,
  `http://${USER}:${PASS}@${HOST}/list.m3u`,
  `HTTP://${HOST.toUpperCase()}/LIVE/${USER}/${PASS}/1.TS`,
];

describe('Redactor.url', () => {
  it.each(STRUCTURAL_FIXTURES)('removes credentials and host without any registration: %s', (url) => {
    const { r } = makeRedactor(false);
    const out = r.url(url);
    expectClean(out, USER, PASS, HOST);
    expect(out).toMatch(/host-[0-9a-f]{8}/);
  });

  it('keeps useful non-secret parts', () => {
    const { r } = makeRedactor();
    const out = r.url(`http://${HOST}:8080/player_api.php?username=${USER}&password=${PASS}&action=get_live_streams`);
    expect(out).toMatch(/^http:\/\/host-[0-9a-f]{8}:8080\/player_api\.php\?username=\*\*\*&password=\*\*\*&action=get_live_streams$/);
  });

  it('masks Xtream path credentials but keeps the stream id', () => {
    const { r } = makeRedactor();
    expect(r.url(`http://${HOST}/live/${USER}/${PASS}/1234.ts`)).toMatch(/\/live\/\*\*\*\/\*\*\*\/1234\.ts$/);
  });

  it('leaves the app’s own hosts readable', () => {
    const { r } = makeRedactor();
    expect(r.url('http://localhost:5173/src/main.tsx')).toBe('http://localhost:5173/src/main.tsx');
  });

  it('redacts URLs nested in a query parameter', () => {
    const { r } = makeRedactor(false);
    const nested = encodeURIComponent(`http://${HOST}/live/${USER}/${PASS}/1.ts`);
    const out = r.url(`http://other.example.net/proxy?url=${nested}`);
    expectClean(out, USER, PASS, HOST, encodeURIComponent(HOST));
  });

  it('handles percent-encoded and double-encoded registered secrets', () => {
    const hosts = createHostHasher(new Uint8Array(16));
    const r = new Redactor({ hashHost: hosts.hash });
    const pw = 'p@ss w/rd';
    r.addSecret(pw);
    const once = encodeURIComponent(pw);
    const twice = encodeURIComponent(once);
    const out = r.text(`opening http://cdn.example.net/hls/${once}/index.m3u8 and later ${twice}`);
    expectClean(out, pw, once, twice);
  });

  it('falls back to pattern rules for URLs the URL parser rejects', () => {
    const { r } = makeRedactor(false);
    const out = r.url(`http://${USER}:${PASS}@${HOST}:99999/live/${USER}/${PASS}/1.ts?token=abc`);
    expectClean(out, USER, PASS, HOST, 'token=abc');
  });
});

describe('Redactor.text', () => {
  it('redacts URLs inside error messages and stack traces', () => {
    const { r } = makeRedactor(false);
    const stack = `TypeError: Failed to fetch\n    at load (http://${HOST}/live/${USER}/${PASS}/1.ts:1:2)\n    at http://localhost:5173/src/x.ts:3:4`;
    const out = r.text(stack);
    expectClean(out, USER, PASS, HOST);
    expect(out).toContain('http://localhost:5173/src/x.ts:3:4');
  });

  it('hashes registered hosts mentioned without a scheme', () => {
    const { r, hosts } = makeRedactor(true);
    const out = r.text(`getaddrinfo ENOTFOUND ${HOST}.`);
    expect(out).toBe(`getaddrinfo ENOTFOUND ${hosts.hash(HOST)}.`);
  });

  it('scrubs registered credentials in free text', () => {
    const { r } = makeRedactor(true);
    expect(r.text(`login failed for ${USER} using ${PASS}`)).toBe(`login failed for ${MASK} using ${MASK}`);
  });

  it('is idempotent: redacting redacted text changes nothing', () => {
    const { r } = makeRedactor(true);
    for (const url of STRUCTURAL_FIXTURES) {
      const once = r.text(`failed: ${url}`);
      expect(r.text(once)).toBe(once);
    }
  });

  it('keeps trailing punctuation outside the URL', () => {
    const { r } = makeRedactor();
    expect(r.text(`see http://localhost/a.`)).toBe('see http://localhost/a.');
  });
});

describe('Redactor.value', () => {
  it('masks sensitive fields and headers, recurses into nested data', () => {
    const { r } = makeRedactor(false);
    const out = r.value({
      username: USER,
      password: PASS,
      playlist: { url: `http://${HOST}/get.php?username=${USER}&password=${PASS}` },
      headers: { Authorization: 'Bearer abc', Cookie: 'sid=1', Accept: 'application/json' },
      list: [`http://${HOST}/live/${USER}/${PASS}/1.ts`],
    });
    const json = JSON.stringify(out);
    expectClean(json, USER, PASS, HOST, 'Bearer abc', 'sid=1');
    expect(json).toContain('application/json');
  });

  it('serialises errors with redacted message and stack', () => {
    const { r } = makeRedactor(false);
    const err = new Error(`GET http://${HOST}/live/${USER}/${PASS}/1.ts failed`);
    const out = r.value(err) as { name: string; message: string; stack?: string };
    expect(out.name).toBe('Error');
    expectClean(out.message + (out.stack ?? ''), USER, PASS, HOST);
  });

  it('limits depth and handles non-JSON values', () => {
    const { r } = makeRedactor();
    type Deep = { next?: Deep };
    const deep: Deep = {};
    let cur = deep;
    for (let i = 0; i < 10; i++) cur = cur.next = {};
    expect(JSON.stringify(r.value(deep))).toContain('[depth]');
    expect(r.value(10n)).toBe('10');
    expect(r.value(() => 1)).toBe('[function]');
  });
});

describe('host hashing', () => {
  it('is stable per salt and differs between salts', () => {
    const a = createHostHasher(new Uint8Array(16).fill(1));
    const b = createHostHasher(new Uint8Array(16).fill(2));
    expect(a.hash(HOST)).toBe(a.hash(HOST.toUpperCase()));
    expect(a.hash(HOST)).not.toBe(b.hash(HOST));
    expect(a.hash(HOST)).toMatch(/^host-[0-9a-f]{8}$/);
    expect(a.lookup()).toEqual([{ label: a.hash(HOST), host: HOST }]);
  });
});

describe('property: credentials and hosts never survive', () => {
  const TEMPLATES = [
    'http://{h}:8080/get.php?username={u}&password={p}&type=m3u_plus',
    'http://{h}/player_api.php?username={u}&password={p}&action=get_vod_info&vod_id=1',
    'http://{h}/live/{u}/{p}/42.ts',
    'http://{h}/movie/{u}/{p}/42.mkv',
    'http://{h}/series/{u}/{p}/42.mp4',
    'http://{h}/timeshift/{u}/{p}/30/2026-01-02:03-04/42.ts',
    'http://{h}/playlist/{u}/{p}/m3u_plus',
    'http://{h}:25461/{u}/{p}/42',
    'http://{u}:{p}@{h}/x.m3u',
    'Error: request to http://{h}/live/{u}/{p}/42.ts failed\n    at fetch (http://{h}/player_api.php?username={u}&password={p})',
  ];
  const constantText = TEMPLATES.join(' ').replace(/\{[uph]\}/g, ' ').toLowerCase() + ' host- *** ';
  const token = fc.stringMatching(/^[a-z0-9]{8,14}$/).filter((s) => constantText.indexOf(s) < 0);
  const host = fc
    .tuple(fc.stringMatching(/^[a-z]{5,12}$/), fc.constantFrom('com', 'net', 'tv', 'xyz'))
    .map(([name, tld]) => `${name}.${tld}`)
    .filter((h) => constantText.indexOf(h) < 0);

  it('holds for structural redaction alone', () => {
    fc.assert(
      fc.property(token, token, host, fc.constantFrom(...TEMPLATES), (u, p, h, tpl) => {
        const { r } = makeRedactor(false);
        const out = r.text(tpl.replace(/\{u\}/g, u).replace(/\{p\}/g, p).replace(/\{h\}/g, h));
        expectClean(out, u, p, h);
      }),
      { numRuns: 300 },
    );
  });

  it('holds when credentials appear in free text and are registered', () => {
    fc.assert(
      fc.property(token, token, host, (u, p, h) => {
        const hosts = createHostHasher(new Uint8Array(16).fill(3));
        const r = new Redactor({ hashHost: hosts.hash });
        r.addSecret(u);
        r.addSecret(p);
        r.addHost(h);
        const out = r.text(`user ${u} pass ${p} at ${h} (${encodeURIComponent(p)})`);
        expectClean(out, u, p, h);
      }),
      { numRuns: 300 },
    );
  });
});
