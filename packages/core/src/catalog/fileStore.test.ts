import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setFetch } from '../net/http';
import { mockXtream } from '../testing/mock-provider';
import { openUltraDb, useDatabaseName } from './db';
import { memoryFiles, setCatalogFiles, setSectionWorkers, type SectionWorkerLike } from './files';
import { runSectionJob, type SectionReply } from './sectionJob';
import { fileIndexKey, readCategoryFile, type FileIndex } from './fileStore';
import { categoriesOfKeys, categoryRowsFromFiles, favoriteKeys, getItem, itemsByKeys, listCategories, listItems, sectionFiles, sectionNames } from './queries';
import { PlaylistService } from './service';

const ORIGIN = 'http://mock.test';
let generation = 0;
setFetch(async (url) => {
  const u = new URL(url);
  const body = mockXtream(u.searchParams.get('action'), u.searchParams.get('username')!, u.searchParams.get('password')!, generation, ORIGIN, null);
  return new Response(JSON.stringify(body), { status: 200 });
});

let n = 0;
const service = () => new PlaylistService({ changed: () => undefined, progress: () => undefined, secrets: () => undefined });
const XTREAM = { name: 'Demo', type: 'xtream' as const, server: `${ORIGIN}/`, username: 'demo', password: 'demo' };

beforeEach(() => {
  useDatabaseName(`files-test-${n++}`);
  generation = 0;
});
afterEach(() => {
  setCatalogFiles(null);
  setSectionWorkers(null);
});

describe('catalogue in files (Samsung)', () => {
  it('saves one file per category, the same rows the database would hold, and no rows in the database', async () => {
    const classic = service();
    const a = await classic.save(XTREAM);
    await classic.refresh(a.id);

    const files = memoryFiles();
    setCatalogFiles(files);
    const s = service();
    const b = await s.save({ ...XTREAM, id: 'in-files' });
    const result = await s.refresh(b.id);
    expect(result).toMatchObject({ ok: true, counts: { live: 300, vod: 200, series: 60 } });
    const db = await openUltraDb();
    for (const kind of ['live', 'vod', 'series'] as const) {
      expect(await listItems(b.id, kind, null)).toHaveLength(0);
      const cats = await listCategories(b.id, kind);
      expect(cats.map((c) => [c.id, c.count])).toEqual((await listCategories(a.id, kind)).map((c) => [c.id, c.count]));
      for (const c of cats.slice(0, 3)) {
        const fromFile = await readCategoryFile(db, files, b.id, kind, c.id);
        const fromDb = await listItems(a.id, kind, c.id);
        expect(fromFile!.map((r) => r.key).sort()).toEqual(fromDb.map((r) => r.key).sort());
      }
    }
    expect(Array.from(files.files.keys()).every((k) => k.indexOf('in-files/') === 0)).toBe(true);
  });

  it('switches to a new generation only once it is complete, and removes the old one', async () => {
    const files = memoryFiles();
    setCatalogFiles(files);
    const s = service();
    const rec = await s.save(XTREAM);
    await s.refresh(rec.id);
    const db = await openUltraDb();
    const first = (await db.get('settings', fileIndexKey(rec.id, 'live'))) as FileIndex;

    // A write that fails half way: the previous generation is still what's read.
    const append = files.append;
    files.append = async (path, text, start) => {
      if (path.indexOf('/live-') > 0) throw new Error('disk error');
      return append(path, text, start);
    };
    generation = 1;
    await s.refresh(rec.id);
    const still = (await db.get('settings', fileIndexKey(rec.id, 'live'))) as FileIndex;
    expect(still.gen).toBe(first.gen);
    expect(Array.from(files.files.keys()).filter((k) => k.indexOf(`${rec.id}/live-`) === 0 && k.indexOf(first.gen) < 0)).toHaveLength(0);

    files.append = append;
    await s.refresh(rec.id);
    const next = (await db.get('settings', fileIndexKey(rec.id, 'live'))) as FileIndex;
    expect(next.gen).not.toBe(first.gen);
    expect(Array.from(files.files.keys()).some((k) => k.indexOf(first.gen) >= 0)).toBe(false);
  });

  it('refuses cleanly when the device is nearly full, keeping what was there', async () => {
    const files = memoryFiles();
    files.freeBytes = async () => 100 * 1024 * 1024;
    setCatalogFiles(files);
    const s = service();
    const rec = await s.save(XTREAM);
    const result = await s.refresh(rec.id);
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'storage' });
    expect(files.files.size).toBe(0);
  });

  it('keeps favourites across a refresh that renumbers every stream', async () => {
    const files = memoryFiles();
    setCatalogFiles(files);
    const s = service();
    const rec = await s.save(XTREAM);
    await s.refresh(rec.id);
    const db = await openUltraDb();
    const cat = (await listCategories(rec.id, 'live'))[0];
    const fav = (await readCategoryFile(db, files, rec.id, 'live', cat.id))![2];
    await s.toggleFavorite({ playlistId: rec.id, kind: 'live', key: fav.key, name: fav.name, tvgId: fav.tvgId });
    generation = 1;
    await s.refresh(rec.id);
    expect(await favoriteKeys(rec.id, 'live')).toEqual([fav.key]);
  });

  it('deletes the files with the playlist', async () => {
    const files = memoryFiles();
    setCatalogFiles(files);
    const s = service();
    const rec = await s.save(XTREAM);
    await s.refresh(rec.id);
    expect(files.files.size).toBeGreaterThan(0);
    await s.remove(rec.id);
    expect(files.files.size).toBe(0);
    expect(await (await openUltraDb()).get('settings', fileIndexKey(rec.id, 'live'))).toBeUndefined();
  });

  it('answers the page\'s lookups from the files: item by id, items by key, one category, the names', async () => {
    const files = memoryFiles();
    setCatalogFiles(files);
    const s = service();
    const rec = await s.save(XTREAM);
    await s.refresh(rec.id);
    expect(await sectionFiles(rec.id, 'vod')).toEqual({ items: 200 });
    const cat = (await listCategories(rec.id, 'vod'))[1];
    const rows = (await categoryRowsFromFiles(rec.id, 'vod', cat.id))!;
    expect(rows.length).toBe(cat.count);
    const movie = rows[4];
    expect((await getItem(rec.id, 'vod', movie.id))?.key).toBe(movie.key);
    expect(await getItem(rec.id, 'vod', 'no-such-id')).toBeUndefined();
    const two = await itemsByKeys(rec.id, 'vod', [rows[0].key, 'missing', movie.key]);
    expect(two.map((r) => r.key)).toEqual([rows[0].key, movie.key]);
    expect(await categoriesOfKeys(rec.id, 'vod', [movie.key])).toEqual([cat.id]);
    expect((await sectionNames(rec.id, 'vod'))!.length).toBe(200);
    // "More like this" and the speed test read from files too.
    expect((await s.vodMore(rec.id, movie.id)).more.length).toBeGreaterThan(0);
    expect((await s.speedTargets(rec.id)).downloads.filter((d) => d.kind === 'media').length).toBeGreaterThan(0);
  });

  it('reads a category slice back exactly, Arabic and emoji included', async () => {
    const files = memoryFiles();
    setCatalogFiles(files);
    const s = service();
    const rec = await s.save(XTREAM);
    await s.refresh(rec.id);
    const db = await openUltraDb();
    const index = (await db.get('settings', fileIndexKey(rec.id, 'live'))) as FileIndex;
    expect(Array.from(files.files.keys()).filter((k) => k.indexOf('/live-') > 0).map((k) => k.split('/').pop()).sort()).toEqual(['data.json', 'names.json']);
    for (const c of await listCategories(rec.id, 'live')) {
      const rows = (await readCategoryFile(db, files, rec.id, 'live', c.id))!;
      expect(rows.length, c.name).toBe(c.count);
      expect(Array.isArray(index.files[c.id])).toBe(true);
    }
  });

  it('gives the same catalogue when Movies is processed in a section worker', async () => {
    /** A stand-in for a real worker: same messages, copied between "threads" like postMessage does. */
    const fakeWorker = (): SectionWorkerLike => {
      const waiting: Array<(r: SectionReply) => void> = [];
      const queued: SectionReply[] = [];
      const next = () => new Promise<SectionReply>((resolve) => (queued.length ? resolve(queued.shift()!) : waiting.push(resolve)));
      const w: SectionWorkerLike = {
        onmessage: null,
        onerror: null,
        terminate: () => undefined,
        postMessage: (raw) => {
          const m = structuredClone(raw) as SectionReply;
          setTimeout(() => {
            if (m.type === 'job') void runSectionJob(m.job, (out) => setTimeout(() => w.onmessage?.({ data: structuredClone(out) }), 0), next);
            else if (waiting.length) waiting.shift()!(m);
            else queued.push(m);
          }, 0);
        },
      };
      return w;
    };
    const inOne = memoryFiles();
    setCatalogFiles(inOne);
    const a = await service().save(XTREAM);
    await service().refresh(a.id);

    const split = memoryFiles();
    setCatalogFiles(split);
    let started = 0;
    setSectionWorkers(() => (started++, fakeWorker()));
    const s = service();
    const b = await s.save({ ...XTREAM, id: 'two-workers' });
    const result = await s.refresh(b.id);
    expect(started).toBe(1);
    expect(result).toMatchObject({ ok: true, counts: { live: 300, vod: 200, series: 60 } });
    const db = await openUltraDb();
    setCatalogFiles(inOne);
    const one = await Promise.all((await listCategories(a.id, 'vod')).map((c) => readCategoryFile(db, inOne, a.id, 'vod', c.id)));
    setCatalogFiles(split);
    const two = await Promise.all((await listCategories(b.id, 'vod')).map((c) => readCategoryFile(db, split, b.id, 'vod', c.id)));
    expect(two.map((rows) => rows!.map((r) => r.key))).toEqual(one.map((rows) => rows!.map((r) => r.key)));
    expect((await listCategories(b.id, 'vod')).map((c) => c.count)).toEqual((await listCategories(a.id, 'vod')).map((c) => c.count));

    // A second refresh with nothing changed is recognised in the section worker too.
    const again = await s.refresh(b.id);
    expect(again.ok).toBe(true);
    expect(started).toBe(2);
  });
});
