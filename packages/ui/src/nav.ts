import { log, type ContentKind } from '@ultra/core';
import { createSignal } from 'solid-js';

export type Tab = 'home' | 'live' | 'movies' | 'series' | 'settings';
export type Route =
  | { name: Exclude<Tab, 'live'> }
  | { name: 'live'; focusKey?: string }
  | { name: 'about' }
  | { name: 'debug' }
  | { name: 'playlists' }
  | { name: 'hidden-categories'; kind: ContentKind }
  | { name: 'rename-categories' }
  | { name: 'playlist-form'; id?: string }
  | { name: 'player'; tab?: Tab }
  | { name: 'vod-detail'; id: string }
  | { name: 'series-detail'; id: string }
  | { name: 'catchup'; channelId: string };

export const TABS: Tab[] = ['home', 'live', 'movies', 'series'];

function initialStack(): Route[] {
  const debug = typeof location !== 'undefined' && /[?&]debug=1(&|$)/.test(location.search);
  return debug ? [{ name: 'home' }, { name: 'debug' }] : [{ name: 'home' }];
}

const [stack, setStack] = createSignal<Route[]>(initialStack());

export const currentRoute = (): Route => {
  const s = stack();
  return s[s.length - 1];
};

/** The screen to show: the player opens on top of whatever was there, which stays alive under it. */
export const screenRoute = (): Route => {
  const s = stack();
  for (let i = s.length - 1; i >= 0; i--) if (s[i].name !== 'player') return s[i];
  return s[0];
};

/** The tab a route belongs to, for highlighting the top bar. */
export function tabOf(route: Route): Tab {
  switch (route.name) {
    case 'about':
    case 'debug':
    case 'playlists':
    case 'hidden-categories':
    case 'rename-categories':
    case 'playlist-form':
      return 'settings';
    case 'player':
      return route.tab ?? 'live';
    case 'catchup':
      return 'live';
    case 'vod-detail':
      return 'movies';
    case 'series-detail':
      return 'series';
    default:
      return route.name;
  }
}

export function navigate(route: Route): void {
  setStack((s) => [...s, route]);
  log.debug('nav', 'push', { route: route.name });
}

/** Replaces the whole stack, e.g. top bar tabs or "open this channel in Live". */
export function openRoot(route: Route): void {
  setStack([route]);
  log.debug('nav', 'root', { route: route.name });
}

export function switchTab(tab: Tab): void {
  if (currentRoute().name === tab && stack().length === 1) return;
  openRoot({ name: tab } as Route);
}

let afterBack: ((route: Route) => void) | null = null;

/** Runs after any Back navigation (key or button), e.g. to restore focus. */
export function onBackNavigated(fn: (route: Route) => void): void {
  afterBack = fn;
}

/** Returns false at the root so the caller can decide (e.g. exit dialog on TVs later). */
export function goBack(): boolean {
  const s = stack();
  if (s.length <= 1) {
    if (s[0].name === 'home') return false;
    setStack([{ name: 'home' }]);
  } else {
    setStack(s.slice(0, -1));
  }
  log.debug('nav', 'back', { route: currentRoute().name });
  afterBack?.(currentRoute());
  return true;
}
