import { createEffect, createSignal, on, Show, type JSX } from 'solid-js';

/** Lazy logo; hides itself when the URL fails. Only visible rows exist, so no lazy-loading API needed. */
export function ChannelLogo(props: { src?: string; large?: boolean }): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  createEffect(on(() => props.src, () => setFailed(false), { defer: true }));
  return (
    <span class={props.large ? 'logo logo-large' : 'logo'}>
      <Show when={props.src && !failed()}>
        <img src={props.src} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </Show>
    </span>
  );
}
