import { createEffect, createSignal, on, Show, type JSX } from 'solid-js';

/**
 * Lazy logo; shows the channel's initials when there is no logo or it fails to load.
 * Only visible rows exist, so no lazy-loading API is needed.
 */
export function ChannelLogo(props: { src?: string; name?: string; large?: boolean }): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  createEffect(on(() => props.src, () => setFailed(false), { defer: true }));
  return (
    <span class={props.large ? 'logo logo-large' : 'logo'}>
      <Show when={props.src && !failed()} fallback={<span dir="auto">{initials(props.name)}</span>}>
        <img src={props.src} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </Show>
    </span>
  );
}

/** "News 1 HD" → "N1", "BBC One" → "BO", "قناة أخبار 8" → "ق8". */
export function initials(name: string | undefined): string {
  if (!name) return '';
  const words = name
    .replace(/[^0-9a-zA-ZÀ-ɏ؀-ۿ ]+/g, ' ')
    .split(' ')
    .filter((w) => w && !/^(hd|fhd|uhd|sd|4k|hevc|raw)$/i.test(w));
  if (!words.length) return name.slice(0, 2).toUpperCase();
  const digits = words.filter((w) => /^\d+$/.test(w))[0];
  const first = words.filter((w) => !/^\d+$/.test(w))[0] ?? words[0];
  const second = digits ?? words.filter((w) => w !== first)[0] ?? '';
  return (first.charAt(0) + (/^\d+$/.test(second) ? second.slice(0, 2) : second.charAt(0))).toUpperCase();
}
