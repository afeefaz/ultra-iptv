// Fast non-cryptographic 64-bit hash (two independent 32-bit FNV-1a lanes) for stable keys and ids.
export function hash64(text: string): string {
  let a = 0x811c9dc5;
  let b = 0xcbf29ce4;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x0100019d);
  }
  return hex32(a) + hex32(b);
}

function hex32(n: number): string {
  const s = (n >>> 0).toString(16);
  return '00000000'.slice(s.length) + s;
}

// Arabic diacritics (tashkeel) and tatweel; ignored when comparing names.
const ARABIC_MARKS = /[ً-ٰٟـ]/g;
const COMBINING = /[̀-ͯ]/g;

/** Lowercased, accent/diacritic-free, single-spaced text for keys and search. */
export function normalizeText(text: string): string {
  let s = text.toLowerCase();
  if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(COMBINING, '');
  return s.replace(ARABIC_MARKS, '').replace(/\s+/g, ' ').trim();
}
