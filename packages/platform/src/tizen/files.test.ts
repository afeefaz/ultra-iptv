import { afterEach, describe, expect, it } from 'vitest';
import { safePath, tizenCatalogFiles } from './files';

/** A stand-in for Samsung's file API: a map of paths, and directories made on demand. */
function fakeTizen(free = 1234) {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['wgt-private']);
  const making = new Set<string>();
  const fs = {
    resolve() {},
    pathExists: (p: string) => files.has(p) || dirs.has(p),
    // Like the TV: folder calls return at once and finish a moment later, through callbacks,
    // and asking for a folder that is being made fails with "File exists".
    createDirectory: (p: string, _parents: boolean, ok?: () => void, fail?: (e: { name: string; message: string }) => void) => {
      if (making.has(p)) {
        setTimeout(() => fail?.({ name: 'IOError', message: 'File exists' }), 0);
        return;
      }
      making.add(p);
      setTimeout(() => {
        const parts = p.split('/');
        for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
        making.delete(p);
        ok?.();
      }, 5);
    },
    deleteDirectory: (p: string, _recursive: boolean, ok?: () => void) => {
      setTimeout(() => {
        for (const k of Array.from(files.keys())) if (k.indexOf(`${p}/`) === 0) files.delete(k);
        for (const d of Array.from(dirs)) if (d === p || d.indexOf(`${p}/`) === 0) dirs.delete(d);
        ok?.();
      }, 5);
    },
    openFile: (p: string, mode: string) => {
      const dir = p.slice(0, p.lastIndexOf('/'));
      if (!dirs.has(dir)) throw new Error('NotFoundError');
      return {
        readString: () => {
          if (!files.has(p)) throw new Error('NotFoundError');
          return files.get(p) as string;
        },
        writeString: (text: string) => {
          if (mode !== 'w') throw new Error('mode');
          files.set(p, text);
          return text.length;
        },
        close: () => undefined,
      };
    },
  };
  const systeminfo = {
    getCapability: () => '',
    getTotalMemory: () => 0,
    getAvailableMemory: () => 0,
    getPropertyValue: (_: string, ok: (s: { units: Array<{ type: string; capacity: number; availableCapacity: number }> }) => void) =>
      ok({ units: [{ type: 'INTERNAL', capacity: 4000, availableCapacity: free }] }),
  };
  (globalThis as unknown as { window: unknown }).window = { tizen: { filesystem: fs, systeminfo } };
  return { files, dirs };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('Samsung catalogue files', () => {
  it('keeps every path inside the catalogue folder', () => {
    expect(safePath('pl1/live/12.json')).toBe('wgt-private/catalog/pl1/live/12.json');
    for (const bad of ['', '../x', 'a/../b', 'a//b', '/abs', 'a/./b', 'a b']) expect(() => safePath(bad), bad).toThrow();
  });

  it('writes, reads back, and makes folders as needed', async () => {
    const { files } = fakeTizen();
    const store = tizenCatalogFiles()!;
    await store.write('pl1/vod/7.json', '[1,2]');
    expect(files.get('wgt-private/catalog/pl1/vod/7.json')).toBe('[1,2]');
    expect(await store.read('pl1/vod/7.json')).toBe('[1,2]');
    expect(await store.read('pl1/vod/8.json')).toBeNull();
  });

  it('waits for folders, and many writes into one new folder at once all land', async () => {
    const { files } = fakeTizen();
    const store = tizenCatalogFiles()!;
    await Promise.all([0, 1, 2, 3, 4].map((i) => store.write(`pl1/live-g1/${i}.json`, String(i))));
    expect(Array.from(files.keys()).sort()).toEqual([0, 1, 2, 3, 4].map((i) => `wgt-private/catalog/pl1/live-g1/${i}.json`));
  });

  it('removes a playlist folder and tells the free space', async () => {
    const { files } = fakeTizen(5555);
    const store = tizenCatalogFiles()!;
    await store.write('pl1/live/1.json', 'a');
    await store.write('pl2/live/1.json', 'b');
    await store.removeDir('pl1');
    await store.removeDir('missing');
    expect(Array.from(files.keys())).toEqual(['wgt-private/catalog/pl2/live/1.json']);
    expect(await store.freeBytes()).toBe(5555);
  });

  it('is missing on TVs without the newer file API', () => {
    (globalThis as unknown as { window: unknown }).window = { tizen: { filesystem: { resolve() {} } } };
    expect(tizenCatalogFiles()).toBeUndefined();
  });
});
