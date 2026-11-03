import { createEffect, createSignal, on, Show, type JSX } from 'solid-js';
import { Icon } from './Icon';

export interface PosterTileProps {
  title: string;
  poster?: string;
  year?: number;
  rating?: number;
  /** 0–1; nothing drawn at 0. */
  progress?: number;
  favorite?: boolean;
  watched?: boolean;
}

/** 2:3 cover, rating, title, year and quality tag (layout only; focus is on the parent). */
export function PosterTile(props: PosterTileProps): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  createEffect(on(() => props.poster, () => setFailed(false), { defer: true }));
  return (
    <div class="poster">
      <div class="poster-art">
        <Show when={props.poster && !failed()} fallback={<span class="poster-initial">{props.title.slice(0, 1)}</span>}>
          <img src={props.poster} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        </Show>
        <Show when={props.rating}>
          <span class="poster-rating" dir="ltr">
            <Icon name="starFill" /> {props.rating}
          </span>
        </Show>
        <Show when={props.watched} fallback={<Show when={props.favorite}><span class="poster-fav"><Icon name="starFill" /></span></Show>}>
          <span class="poster-watched">
            <Icon name="checkCircle" />
          </span>
        </Show>
        <Show when={(props.progress ?? 0) > 0 && !props.watched}>
          <span class="progress poster-progress">
            <span class="progress-fill" style={{ width: `${Math.round((props.progress ?? 0) * 100)}%` }} />
          </span>
        </Show>
      </div>
      <div class="poster-text">
        <span class="poster-title">
          <bdi>{props.title}</bdi>
        </span>
        <span class="poster-sub">
          <span>{props.year ?? ''}</span>
          <Show when={qualityOf(props.title)}>{(q) => <span class="quality">{q()}</span>}</Show>
        </span>
      </div>
    </div>
  );
}

/** Quality tag providers put in titles ("Dune 4K", "FHD | Film"); empty when there is none. */
export function qualityOf(title: string): string {
  const m = /\b(8k|4k|uhd|fhd|1080p|720p|hd|hevc)\b/i.exec(title);
  if (!m) return '';
  const q = m[1].toUpperCase();
  return q === '1080P' ? 'FHD' : q === '720P' ? 'HD' : q;
}
