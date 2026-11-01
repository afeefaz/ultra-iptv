import { createContext, onCleanup, onMount, useContext, type JSX } from 'solid-js';
import { FocusManager, type ZoneSpec } from './manager';

export const focusManager = new FocusManager();

const ZoneContext = createContext('root');

export function FocusZone(props: Omit<ZoneSpec, 'parent'> & { children: JSX.Element }): JSX.Element {
  const parent = useContext(ZoneContext);
  // Registered synchronously so the zone exists before its children register.
  const off = focusManager.registerZone({
    id: props.id,
    parent,
    remember: props.remember,
    wrap: props.wrap,
    trap: props.trap,
  });
  onCleanup(off);
  return <ZoneContext.Provider value={props.id}>{props.children}</ZoneContext.Provider>;
}

export interface FocusableOptions {
  id: string;
  onSelect?: () => void;
  onFocus?: () => void;
  autofocus?: boolean;
}

/** Returns a `ref` that makes the element focusable within the surrounding zone. */
export function useFocusable(opts: FocusableOptions): (el: HTMLElement) => void {
  const zone = useContext(ZoneContext);
  let el: HTMLElement | undefined;
  onMount(() => {
    if (!el) return;
    const off = focusManager.register({
      id: opts.id,
      zone,
      el,
      autofocus: opts.autofocus,
      onSelect: () => opts.onSelect?.(),
      onFocus: () => opts.onFocus?.(),
    });
    onCleanup(off);
  });
  return (e) => (el = e);
}
