import { log, nowNext, type EpgEntry, type NowNext } from '@ultra/core';
import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from 'solid-js';
import { catalog } from './catalog';
import { activePlaylist } from './playlists';

const MAX_PARALLEL = 3;
/** Rows passed while scrolling never ask: only a row still on screen after this does. */
const ROW_SETTLE_MS = 300;
/** The same for the channel under the cursor, which is worth asking about sooner. */
const SELECTED_SETTLE_MS = 150;

// Results per `${playlistId}|${streamId}`; the worker keeps the persistent cache (spec §7).
const entries = new Map<string, EpgEntry[]>();
const [version, setVersion] = createSignal(0);
const queue: string[] = [];
const queued = new Set<string>();
let running = 0;

/** Ticks every 30 s so progress bars and "now" move without re-fetching. */
const [clock, setClock] = createSignal(Date.now());
setInterval(() => setClock(Date.now()), 30_000);
export { clock };

function pump(): void {
  while (running < MAX_PARALLEL && queue.length) {
    const key = queue.shift()!;
    queued.delete(key);
    const [playlistId, streamId] = key.split('|');
    running++;
    catalog()
      .call('shortEpg', playlistId, streamId)
      .then(
        (items) => {
          entries.set(key, items);
          setVersion((v) => v + 1);
        },
        (e) => log.debug('epg', 'short epg failed', { error: e }),
      )
      .then(() => {
        running--;
        pump();
      });
  }
}

/** Asks for a channel's now/next. Visible rows enqueue; rows scrolled away cancel. */
export function requestEpg(playlistId: string, streamId: string, front = false): void {
  const key = playlistId + '|' + streamId;
  if (entries.has(key) && !isStale(entries.get(key)!)) return;
  if (queued.has(key)) {
    if (front) {
      queue.splice(queue.indexOf(key), 1);
      queue.unshift(key);
    }
    return;
  }
  queued.add(key);
  if (front) queue.unshift(key);
  else queue.push(key);
  pump();
}

export function cancelEpg(playlistId: string, streamId: string): void {
  const key = playlistId + '|' + streamId;
  if (!queued.has(key)) return;
  queued.delete(key);
  queue.splice(queue.indexOf(key), 1);
}

/** Out of programmes to show. The worker decides whether that means asking the provider. */
function isStale(items: EpgEntry[]): boolean {
  return items.length > 0 && Date.now() >= items[Math.max(0, items.length - 2)].stop;
}

/** Reactive now/next for one channel of the active playlist (Xtream only; M3U has no EPG in v1). */
export function useNowNext(streamId: Accessor<string | null | undefined>, priority = false): Accessor<NowNext> {
  const playlist = activePlaylist;
  createEffect(
    on([() => playlist()?.id, () => playlist()?.type, streamId], ([pid, type, sid]) => {
      if (!pid || !sid || type !== 'xtream') return;
      const settle = setTimeout(() => requestEpg(pid, sid, priority), priority ? SELECTED_SETTLE_MS : ROW_SETTLE_MS);
      onCleanup(() => {
        clearTimeout(settle);
        cancelEpg(pid, sid);
      });
    }),
  );
  return createMemo(() => {
    version();
    const p = playlist();
    const sid = streamId();
    if (!p || !sid) return {};
    const items = entries.get(p.id + '|' + sid);
    return items ? nowNext(items, clock(), p.epgOffsetHours ?? 0) : {};
  });
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
}
