import { Index, Show, type JSX } from 'solid-js';
import { playerTracks, selectAudio, selectText } from '../data/playback';
import { FocusZone } from '../focus';
import { t } from '../i18n';
import { useKeys } from '../keys';
import { FocusButton } from './FocusButton';

/** Audio and subtitle choices in one side sheet (spec §5). Choices are remembered. */
export function TrackSheet(props: { onClose: () => void }): JSX.Element {
  useKeys((p) => {
    if (p.key !== 'back' && p.key !== 'green') return false;
    props.onClose();
    return true;
  });
  const anySubtitle = () => playerTracks().text.some((x) => x.selected);
  return (
    <div class="side-sheet" role="dialog" aria-modal="true" aria-label={t('player.audio')}>
      <FocusZone id="track-sheet" trap>
        <h2 class="section-title">{t('player.audio')}</h2>
        <Show when={playerTracks().audio.length > 0} fallback={<p class="hint">{t('player.noTracks')}</p>}>
          {/* Index, not For: track objects are re-created on every change, the buttons must persist. */}
          <Index each={playerTracks().audio}>
            {(track, i) => (
              <FocusButton id={`track-a-${i}`} class="list-item" selected={track().selected} autofocus={i === 0} onSelect={() => selectAudio(track())}>
                <span class="list-label">
                  <bdi>{track().label}</bdi>
                </span>
                <Show when={track().lang}>
                  <span class="list-count">{track().lang}</span>
                </Show>
              </FocusButton>
            )}
          </Index>
        </Show>
        <h2 class="section-title sheet-gap">{t('player.subtitles')}</h2>
        <FocusButton
          id="track-t-off"
          class="list-item"
          selected={!anySubtitle()}
          autofocus={playerTracks().audio.length === 0}
          onSelect={() => selectText(null)}
        >
          <span class="list-label">{t('player.off')}</span>
        </FocusButton>
        <Index each={playerTracks().text}>
          {(track, i) => (
            <FocusButton id={`track-t-${i}`} class="list-item" selected={track().selected} onSelect={() => selectText(track())}>
              <span class="list-label">
                <bdi>{track().label}</bdi>
              </span>
              <Show when={track().lang}>
                <span class="list-count">{track().lang}</span>
              </Show>
            </FocusButton>
          )}
        </Index>
      </FocusZone>
    </div>
  );
}
