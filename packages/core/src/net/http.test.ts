import { afterEach, describe, expect, it } from 'vitest';
import { getJson, setFallbackFetch, setFetch } from './http';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  setFetch((url, init) => fetch(url, init));
  setFallbackFetch(null);
});

describe('fetch with a native fallback', () => {
  it('uses fetch when it works and never touches the fallback', async () => {
    let native = 0;
    setFetch(async () => ok({ via: 'fetch' }));
    setFallbackFetch(async () => (native++, ok({ via: 'native' })));
    expect(await getJson('http://a.test/x')).toEqual({ via: 'fetch' });
    expect(native).toBe(0);
  });

  it('falls back when fetch fails without an answer, then goes straight to native for that server', async () => {
    let fetches = 0;
    setFetch(async () => {
      fetches++;
      throw new TypeError('Failed to fetch');
    });
    setFallbackFetch(async () => ok({ via: 'native' }));
    expect(await getJson('http://a.test/x')).toEqual({ via: 'native' });
    expect(await getJson('http://a.test/y')).toEqual({ via: 'native' });
    expect(fetches).toBe(1);
  });

  it('keeps HTTP errors from fetch (the server answered) instead of retrying natively', async () => {
    setFetch(async () => new Response('no', { status: 403 }));
    setFallbackFetch(async () => ok({ via: 'native' }));
    await expect(getJson('http://a.test/x')).rejects.toMatchObject({ info: { code: 'auth', status: 403 } });
  });

  it('retries native HTTP once after a dropped connection', async () => {
    let calls = 0;
    setFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    setFallbackFetch(async () => {
      calls++;
      if (calls === 1) throw new Error('unexpected end of stream');
      return ok({ via: 'native' });
    });
    expect(await getJson('http://a.test/x')).toEqual({ via: 'native' });
    expect(calls).toBe(2);
  });
});
