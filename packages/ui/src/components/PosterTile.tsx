import { createEffect, createSignal, on, Show, type JSX } from 'solid-js';

export interface PosterTileProps {
  title: string;
  poster?: string;
  sub?: string;
  /** 0–1; nothing drawn at 0. */
  progress?: number;
  favorite?: boolean;
  watched?: boolean;
}

/** Cover, title and optional progress for grids and rows (layout only; focus is on the parent). */
export function PosterTile(props: PosterTileProps): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  createEffect(on(() => props.poster, () => setFailed(false), { defer: true }));
  return (
    <div class="poster">
      <div class="poster-art">
        <Show when={props.poster && !failed()} fallback={<span class="poster-initial">{props.title.slice(0, 1)}</span>}>
          <img src={props.poster} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        </Show>
        <Show when={props.favorite}>
          <span class="poster-fav">★</span>
        </Show>
        <Show when={props.watched}>
          <span class="poster-watched">✓</span>
        </Show>
        <Show when={(props.progress ?? 0) > 0 && !props.watched}>
          <span class="progress poster-progress">
            <span class="progress-fill" style={{ width: `${Math.round((props.progress ?? 0) * 100)}%` }} />
          </span>
        </Show>
      </div>
      <span class="poster-title">
        <bdi>{props.title}</bdi>
      </span>
      <Show when={props.sub}>
        <span class="poster-sub">
          <bdi>{props.sub}</bdi>
        </span>
      </Show>
    </div>
  );
}
