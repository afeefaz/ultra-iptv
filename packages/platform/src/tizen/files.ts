import type { CatalogFiles } from '../types';
import { tizenGlobals } from './api';

/** Everything the catalogue keeps on disk lives under here, in the app's private folder. */
const ROOT = 'wgt-private/catalog';

/** A relative path made of plain names only: nothing can reach outside the catalogue folder. */
export function safePath(path: string): string {
  const parts = path.split('/');
  if (!path || parts.some((p) => !p || p === '.' || p === '..' || !/^[\w.\-|~]+$/.test(p))) throw new Error(`Bad catalogue path: ${path}`);
  return `${ROOT}/${path}`;
}

/**
 * Samsung's file API (Tizen 5.0+). The calls are synchronous; callers keep files small (one
 * category each), so a write or read takes milliseconds. On older TVs it is missing and the
 * catalogue stays in the web database.
 */
export function tizenCatalogFiles(): CatalogFiles | undefined {
  const fs = tizenGlobals().tizen?.filesystem;
  if (!fs || !fs.openFile || !fs.createDirectory || !fs.deleteDirectory || !fs.pathExists) return undefined;
  const { openFile, createDirectory, deleteDirectory, pathExists } = {
    openFile: fs.openFile.bind(fs),
    createDirectory: fs.createDirectory.bind(fs),
    deleteDirectory: fs.deleteDirectory.bind(fs),
    pathExists: fs.pathExists.bind(fs),
  };
  const run = <T>(fn: () => T): Promise<T> => {
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e);
    }
  };
  // Folder calls finish later, through callbacks: wait for them, and ask for each folder once.
  const making = new Map<string, Promise<void>>();
  const mkdir = (dir: string): Promise<void> => {
    if (pathExists(dir)) return Promise.resolve();
    let pending = making.get(dir);
    if (!pending) {
      pending = new Promise<void>((resolve, reject) => {
        createDirectory(
          dir,
          true,
          () => resolve(),
          // Made by an earlier call that finished meanwhile: fine.
          (e) => (pathExists(dir) ? resolve() : reject(new Error(`${e.name}: ${e.message}`))),
        );
      });
      making.set(dir, pending);
      const forget = () => making.delete(dir);
      pending.then(forget, forget);
    }
    return pending;
  };
  return {
    write: (path, text) => {
      const full = safePath(path);
      return mkdir(full.slice(0, full.lastIndexOf('/'))).then(() =>
        run(() => {
          const file = openFile(full, 'w');
          try {
            file.writeString(text);
          } finally {
            file.close();
          }
        }),
      );
    },
    append: (path, text, start) => {
      const full = safePath(path);
      return mkdir(full.slice(0, full.lastIndexOf('/'))).then(() =>
        run(() => {
          const file = openFile(full, start ? 'w' : 'a');
          try {
            file.writeString(text);
          } finally {
            file.close();
          }
        }),
      );
    },
    readSlice: (path, byteOffset, count) =>
      run(() => {
        const full = safePath(path);
        if (!pathExists(full)) return null;
        const file = openFile(full, 'r');
        try {
          file.seek(byteOffset);
          return file.readString(count);
        } finally {
          file.close();
        }
      }),
    read: (path) =>
      run(() => {
        const full = safePath(path);
        if (!pathExists(full)) return null;
        const file = openFile(full, 'r');
        try {
          return file.readString();
        } finally {
          file.close();
        }
      }),
    removeDir: (path) => {
      const full = safePath(path);
      if (!pathExists(full)) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        deleteDirectory(
          full,
          true,
          () => resolve(),
          (e) => (pathExists(full) ? reject(new Error(`${e.name}: ${e.message}`)) : resolve()),
        );
      });
    },
    freeBytes: () =>
      new Promise((resolve) => {
        const info = tizenGlobals().tizen?.systeminfo;
        if (!info || !info.getPropertyValue) return resolve(undefined);
        info.getPropertyValue(
          'STORAGE',
          (s) => {
            const internal = s.units.filter((u) => u.type === 'INTERNAL')[0] ?? s.units[0];
            resolve(internal ? internal.availableCapacity : undefined);
          },
          () => resolve(undefined),
        );
      }),
  };
}
