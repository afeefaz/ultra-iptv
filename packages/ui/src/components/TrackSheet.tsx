import { Index, Show, type JSX } from 'solid-js';
import { playerTracks, selectAudio, selectText } from '../data/playback';
import { FocusZone } from '../focus';
import { formatNumber, t } from '../i18n';
import { useKeys } from '../keys';
import { FocusButton } from './FocusButton';
import { Icon } from './Icon';

/** Audio and subtitle choices in one side sheet (spec §5). Choices are remembered. */
export function TrackSheet(props: { onClose: () => void }): JSX.Element {
  useKeys((p) => {
    if (p.key !== 'back' && p.key !== 'green') return false;
    props.onClose();
    return true;
  });
  const anySubtitle = () => playerTracks().text.some((x) => x.selected);
  return (
    <div class="side-sheet" role="dialog" aria-modal="true" aria-label={t('player.audioSubs')}>
      <FocusZone id="track-sheet" trap>
        <div class="sheet-head">
          <Icon name="tune" />
          <div>
            <h2>{t('player.audioSubs')}</h2>
            <div class="sheet-sub">{t('player.tracksSub')}</div>
          </div>
        </div>
        <div class="sheet-label">
          <span>{t('player.audio')}</span>
          <Show when={playerTracks().audio.length > 0}>
            <span class="count">{t('player.available', { n: formatNumber(playerTracks().audio.length) })}</span>
          </Show>
        </div>
        <Show when={playerTracks().audio.length > 0} fallback={<p class="hint">{t('player.noTracks')}</p>}>
          {/* Index, not For: track objects are re-created on every change, the buttons must persist. */}
          <Index each={playerTracks().audio}>
            {(track, i) => (
              <FocusButton id={`track-a-${i}`} class="list-item track-row" selected={track().selected} autofocus={i === 0} onSelect={() => selectAudio(track())}>
                <Icon name="volume" />
                <span class="list-label">
                  <bdi>{track().label}</bdi>
                  <Show when={track().lang}>
                    <span class="track-lang">{track().lang}</span>
                  </Show>
                </span>
                <Icon name={track().selected ? 'radioOn' : 'radioOff'} />
              </FocusButton>
            )}
          </Index>
        </Show>
        <div class="sheet-label">
          <span>{t('player.subtitles')}</span>
        </div>
        <FocusButton
          id="track-t-off"
          class="list-item track-row"
          selected={!anySubtitle()}
          autofocus={playerTracks().audio.length === 0}
          onSelect={() => selectText(null)}
        >
          <Icon name="close" />
          <span class="list-label">{t('player.off')}</span>
          <Icon name={!anySubtitle() ? 'radioOn' : 'radioOff'} />
        </FocusButton>
        <Index each={playerTracks().text}>
          {(track, i) => (
            <FocusButton id={`track-t-${i}`} class="list-item track-row" selected={track().selected} onSelect={() => selectText(track())}>
              <Icon name="cc" />
              <span class="list-label">
                <bdi>{track().label}</bdi>
                <Show when={track().lang}>
                  <span class="track-lang">{track().lang}</span>
                </Show>
              </span>
              <Icon name={track().selected ? 'radioOn' : 'radioOff'} />
            </FocusButton>
          )}
        </Index>
      </FocusZone>
    </div>
  );
}
