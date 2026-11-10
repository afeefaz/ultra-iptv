/**
 * Text files outside the web database, for devices whose database is small (a Samsung TV gives it
 * 80 MB, while a large provider's catalogue is hundreds of MB). The worker can't reach the TV's
 * file API itself, so the implementation set here forwards each call to the page.
 */
export interface CatalogFileStore {
  write(path: string, text: string): Promise<void>;
  /** Adds to the end of a file; `start` empties it first. */
  append(path: string, text: string, start: boolean): Promise<void>;
  /** `count` code points from `byteOffset` (UTF-8 bytes), the way the TV reads them; null if missing. */
  readSlice(path: string, byteOffset: number, count: number): Promise<string | null>;
  /** Null when the file doesn't exist. */
  read(path: string): Promise<string | null>;
  removeDir(path: string): Promise<void>;
  freeBytes(): Promise<number | undefined>;
}

let store: CatalogFileStore | null = null;

export function setCatalogFiles(files: CatalogFileStore | null): void {
  store = files;
}

/** The file store, or null where the catalogue lives in the web database. */
export function catalogFiles(): CatalogFileStore | null {
  return store;
}

/** In memory, for tests and the dev server. */
export function memoryFiles(): CatalogFileStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    write: async (path, text) => {
      files.set(path, text);
    },
    read: async (path) => (files.has(path) ? (files.get(path) as string) : null),
    append: async (path, text, start) => {
      files.set(path, (start ? '' : (files.get(path) ?? '')) + text);
    },
    readSlice: async (path, byteOffset, count) => (files.has(path) ? sliceLikeTv(files.get(path) as string, byteOffset, count) : null),
    removeDir: async (path) => {
      for (const key of Array.from(files.keys())) if (key === path || key.indexOf(`${path}/`) === 0) files.delete(key);
    },
    freeBytes: async () => undefined,
  };
}

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const NON_ASCII = /[\u0080-\uffff]/;

/** UTF-8 size of a text and how many code points it has: what the TV's file API counts. */
export function measure(text: string): { bytes: number; points: number } {
  // The browser's own encoder and a pattern search: far faster than a loop over every character.
  // Plain ASCII: one byte and one point per character, nothing to count.
  if (!NON_ASCII.test(text)) return { bytes: text.length, points: text.length };
  if (encoder) return { bytes: encoder.encode(text).length, points: text.length - (text.match(/[\ud800-\udbff][\udc00-\udfff]/g) ?? []).length };
  return measureSlowly(text);
}

export function measureSlowly(text: string): { bytes: number; points: number } {
  let bytes = 0;
  let points = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    points++;
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return { bytes, points };
}

/** What the TV returns for `seek(byteOffset)` then `readString(count)`, for tests and the dev server. */
export function sliceLikeTv(text: string, byteOffset: number, count: number): string {
  let bytes = 0;
  let i = 0;
  while (i < text.length && bytes < byteOffset) {
    const m = measure(text.charAt(i) + (isHigh(text.charCodeAt(i)) ? text.charAt(i + 1) : ''));
    bytes += m.bytes;
    i += isHigh(text.charCodeAt(i)) ? 2 : 1;
  }
  let j = i;
  for (let n = 0; n < count && j < text.length; n++) j += isHigh(text.charCodeAt(j)) ? 2 : 1;
  return text.slice(i, j);
}

const isHigh = (c: number) => c >= 0xd800 && c < 0xdc00;

/** What the catalogue worker needs of a worker it starts (a `Worker`, or a stand-in in tests). */
export interface SectionWorkerLike {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  terminate(): void;
}

let startSection: (() => SectionWorkerLike) | null = null;

/** Lets a big section be processed in a worker of its own (on another core). Null: all in one. */
export function setSectionWorkers(start: (() => SectionWorkerLike) | null): void {
  startSection = start;
}

export function sectionWorkers(): (() => SectionWorkerLike) | null {
  return startSection;
}
