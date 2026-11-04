import type { ContentKind } from '@ultra/core';
import { resetSorts } from './settings';

let currentLibrary: ContentKind | null = null;
const searches = new Map<string, string>();

/**
 * Searches and sort orders last while you stay in a library (through players, detail pages, Home
 * or Settings). Opening a different library starts it fresh, with the default sort from Settings.
 */
export function enterLibrary(kind: ContentKind): void {
  if (kind === currentLibrary) return;
  if (currentLibrary) {
    searches.clear();
    resetSorts();
  }
  currentLibrary = kind;
}

export const rememberedSearch = (key: string): string => searches.get(key) ?? '';
export const rememberSearch = (key: string, text: string): void => void searches.set(key, text);
