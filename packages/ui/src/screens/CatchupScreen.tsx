import { getItem, log, type ChannelRow, type EpgEntry } from '@ultra/core';
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js';
import { ChannelLogo } from '../components/ChannelLogo';
import { FocusButton } from '../components/FocusButton';
import { VirtualList, type VirtualListApi } from '../components/VirtualList';
import { catalog } from '../data/catalog';
import { formatClock } from '../data/epg';
import { watch } from '../data/media';
import { ensureUnlocked, isChannelLocked } from '../data/parental';
import { activePlaylist } from '../data/playlists';
import { FocusZone } from '../focus';
import { errorText, formatDate } from '../format';
import { t } from '../i18n';

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_DAYS = 7;

interface Programme {
  /** Display times (guide offset applied). */
  start: number;
  stop: number;
  title: string;
  description?: string;
  /** What goes into the URL. */
  entry: EpgEntry;
}

/**
 * Catch-up (spec §5): past programmes by day for Xtream archive channels; M3U channels have
 * no guide in v1, so they get hourly slots instead.
 */
export function CatchupScreen(props: { channelId: string }): JSX.Element {
  const [channel, setChannel] = createSignal<ChannelRow | null | undefined>(undefined);
  const [items, setItems] = createSignal<Programme[] | null>(null);
  const [error, setError] = createSignal('');
  const [day, setDay] = createSignal<string | null>(null);
  let list: VirtualListApi | undefined;

  createEffect(
    on([() => activePlaylist(), () => props.channelId], async ([p, id]) => {
      if (!p) return setChannel(null);
      const ch = await getItem(p.id, 'live', id);
      setChannel(ch ?? null);
      if (!ch) return;
      const days = Math.min(MAX_DAYS, ch.catchupDays || 1);
      const offset = (p.epgOffsetHours ?? 0) * HOUR_MS;
      if (ch.stream.t === 'x' && p.type === 'xtream') {
        try {
          const entries = await catalog().call('catchupListings', p.id, ch.stream.id, days);
          setItems(entries.map((e) => ({ start: e.start + offset, stop: e.stop + offset, title: e.title, description: e.description, entry: e })));
        } catch (e) {
          log.warn('catchup', 'listings failed', { error: e });
          setError(errorText(e));
          setItems([]);
        }
      } else {
        setItems(hourlySlots(days));
      }
    }),
  );

  const days = createMemo(() => {
    const out: string[] = [];
    for (const p of items() ?? []) {
      const d = dayKey(p.start);
      if (out.indexOf(d) < 0) out.push(d);
    }
    return out;
  });
  const currentDay = () => day() ?? days()[0];
  const shown = createMemo(() => (items() ?? []).filter((p) => dayKey(p.start) === currentDay()));

  const play = async (p: Programme) => {
    const ch = channel();
    const pid = activePlaylist()?.id;
    if (!ch || !pid) return;
    if (isChannelLocked(ch) && !(await ensureUnlocked())) return;
    watch(
      {
        playlistId: pid,
        kind: 'catchup',
        key: `${ch.key}|${p.entry.start}`,
        title: p.title,
        subtitle: `${ch.name} · ${formatDate(p.start)} ${formatClock(p.start)}–${formatClock(p.stop)}`,
        poster: ch.logo,
        ref: {
          t: 'catchup',
          stream: ch.stream,
          start: p.entry.start,
          durationMin: Math.round((p.entry.stop - p.entry.start) / 60_000),
          serverStart: p.entry.serverStart,
          catchup: ch.catchup,
        },
      },
      'live',
    );
  };

  return (
    <div class="screen catchup">
      <Show when={channel() !== undefined} fallback={<p class="hint">{t('detail.loading')}</p>}>
        <Show when={channel()} fallback={<p class="hint">{t('detail.notFound')}</p>}>
          {(ch) => (
            <>
              <div class="catchup-header">
                <ChannelLogo src={ch().logo} large />
                <div>
                  <h1 class="screen-title">{t('catchup.title', { channel: ch().name })}</h1>
                  <Show when={ch().stream.t !== 'x'}>
                    <p class="hint">{t('catchup.hourly')}</p>
                  </Show>
                </div>
              </div>
              <FocusZone id="catchup-days" remember>
                <div class="button-row wrap season-tabs">
                  <For each={days()}>
                    {(d, i) => (
                      <FocusButton
                        id={`cday-${i()}`}
                        class="chip-button"
                        selected={currentDay() === d}
                        onSelect={() => {
                          setDay(d);
                          setTimeout(() => list?.focusIndex(0), 0);
                        }}
                      >
                        {dayLabel(d)}
                      </FocusButton>
                    )}
                  </For>
                </div>
              </FocusZone>
              <FocusZone id="catchup-list" remember>
                <div class="episode-list">
                  <VirtualList
                    id="cprog"
                    label={t('catchup.open')}
                    items={shown()}
                    rowHeight={3.6}
                    autofocusIndex={0}
                    ref={(api) => (list = api)}
                    rowClass={() => 'list-item'}
                    onSelect={(p) => void play(p)}
                    empty={<p class="hint pane-empty">{items() === null ? t('catchup.loading') : error() || t('catchup.empty')}</p>}
                    renderRow={(p) => (
                      <>
                        <span class="nn-time catchup-time" dir="ltr">
                          {formatClock(p.start)}–{formatClock(p.stop)}
                        </span>
                        <span class="list-label">
                          <bdi>{p.title}</bdi>
                        </span>
                      </>
                    )}
                  />
                </div>
              </FocusZone>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}

/** Finished hours, newest first. */
function hourlySlots(days: number): Programme[] {
  const now = Date.now();
  const lastEnd = Math.floor(now / HOUR_MS) * HOUR_MS;
  const out: Programme[] = [];
  for (let end = lastEnd; end > now - days * DAY_MS; end -= HOUR_MS) {
    const start = end - HOUR_MS;
    const title = `${formatClock(start)}–${formatClock(end)}`;
    out.push({ start, stop: end, title, entry: { start, stop: end, title } });
  }
  return out;
}

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

function dayLabel(key: string): string {
  if (key === dayKey(Date.now())) return t('catchup.today');
  if (key === dayKey(Date.now() - DAY_MS)) return t('catchup.yesterday');
  const [y, m, d] = key.split('-').map(Number);
  return formatDate(new Date(y, m, d).getTime());
}
