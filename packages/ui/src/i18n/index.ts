import { createSignal } from 'solid-js';
import { ar } from './ar';
import { en, type MessageKey } from './en';

export type Locale = 'en' | 'ar';
export type { MessageKey };

const LOCALE_KEY = 'ultraiptv.locale';
const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, ar };

function savedLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    if (v === 'en' || v === 'ar') return v;
  } catch {
    // ignore
  }
  return 'en'; // English by default on every device (spec §12)
}

const [locale, setLocaleSignal] = createSignal<Locale>(savedLocale());
export { locale };

/** Layout direction: always left to right. Arabic is a translation only (the user's choice); text inside labels still reads right to left. */
export const direction = (): 'ltr' | 'rtl' => 'ltr';

export function applyLocaleToDocument(): void {
  document.documentElement.lang = locale();
  document.documentElement.dir = direction();
}

export function setLocale(next: Locale): void {
  setLocaleSignal(next);
  applyLocaleToDocument();
  try {
    localStorage.setItem(LOCALE_KEY, next);
  } catch {
    // ignore
  }
}

// First-strong isolate / pop: inserted values (dates, URLs, provider names) keep their own
// direction instead of being reordered by the surrounding Arabic or English text.
const FSI = '\u2068';
const PDI = '\u2069';

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = dictionaries[locale()][key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? FSI + String(params[name]) + PDI : m));
}

/** Locale-aware number formatting (Latin digits in both languages, matching provider data). */
export function formatNumber(n: number): string {
  return n.toLocaleString(locale() === 'ar' ? 'ar-u-nu-latn' : 'en');
}
