// Material Symbols (Apache-2.0), bundled as inline SVG so nothing loads from the internet and
// only the icons used here end up in the app.
import i_add from '@material-symbols/svg-400/outlined/add.svg?raw';
import i_back from '@material-symbols/svg-400/outlined/arrow_back.svg?raw';
import i_backspace from '@material-symbols/svg-400/outlined/backspace.svg?raw';
import i_bookmark from '@material-symbols/svg-400/outlined/bookmark_add.svg?raw';
import i_bookmarked from '@material-symbols/svg-400/outlined/bookmark_added.svg?raw';
import i_calendar from '@material-symbols/svg-400/outlined/calendar_today.svg?raw';
import i_cc from '@material-symbols/svg-400/outlined/closed_caption.svg?raw';
import i_check from '@material-symbols/svg-400/outlined/check.svg?raw';
import i_checkCircle from '@material-symbols/svg-400/outlined/check_circle-fill.svg?raw';
import i_chevronLeft from '@material-symbols/svg-400/outlined/chevron_left.svg?raw';
import i_chevronRight from '@material-symbols/svg-400/outlined/chevron_right.svg?raw';
import i_close from '@material-symbols/svg-400/outlined/close.svg?raw';
import i_delete from '@material-symbols/svg-400/outlined/delete.svg?raw';
import i_dns from '@material-symbols/svg-400/outlined/dns.svg?raw';
import i_down from '@material-symbols/svg-400/outlined/keyboard_arrow_down.svg?raw';
import i_edit from '@material-symbols/svg-400/outlined/edit.svg?raw';
import i_forward from '@material-symbols/svg-400/outlined/arrow_forward.svg?raw';
import i_forward10 from '@material-symbols/svg-400/outlined/forward_10.svg?raw';
import i_grid from '@material-symbols/svg-400/outlined/grid_view.svg?raw';
import i_history from '@material-symbols/svg-400/outlined/history.svg?raw';
import i_info from '@material-symbols/svg-400/outlined/info.svg?raw';
import i_key from '@material-symbols/svg-400/outlined/key.svg?raw';
import i_language from '@material-symbols/svg-400/outlined/language.svg?raw';
import i_layers from '@material-symbols/svg-400/outlined/layers.svg?raw';
import i_link from '@material-symbols/svg-400/outlined/link.svg?raw';
import i_list from '@material-symbols/svg-400/outlined/format_list_bulleted.svg?raw';
import i_live from '@material-symbols/svg-400/outlined/live_tv.svg?raw';
import i_lock from '@material-symbols/svg-400/outlined/lock-fill.svg?raw';
import i_movie from '@material-symbols/svg-400/outlined/movie.svg?raw';
import i_pause from '@material-symbols/svg-400/outlined/pause-fill.svg?raw';
import i_person from '@material-symbols/svg-400/outlined/person.svg?raw';
import i_pin from '@material-symbols/svg-400/outlined/keep.svg?raw';
import i_pinFill from '@material-symbols/svg-400/outlined/keep-fill.svg?raw';
import i_play from '@material-symbols/svg-400/outlined/play_arrow-fill.svg?raw';
import i_playlist from '@material-symbols/svg-400/outlined/playlist_play.svg?raw';
import i_radioOff from '@material-symbols/svg-400/outlined/radio_button_unchecked.svg?raw';
import i_radioOn from '@material-symbols/svg-400/outlined/radio_button_checked.svg?raw';
import i_replay from '@material-symbols/svg-400/outlined/replay.svg?raw';
import i_replay10 from '@material-symbols/svg-400/outlined/replay_10.svg?raw';
import i_restart from '@material-symbols/svg-400/outlined/restart_alt.svg?raw';
import i_schedule from '@material-symbols/svg-400/outlined/schedule.svg?raw';
import i_search from '@material-symbols/svg-400/outlined/search.svg?raw';
import i_series from '@material-symbols/svg-400/outlined/video_library.svg?raw';
import i_settings from '@material-symbols/svg-400/outlined/settings.svg?raw';
import i_shield from '@material-symbols/svg-400/outlined/shield.svg?raw';
import i_sort from '@material-symbols/svg-400/outlined/swap_vert.svg?raw';
import i_star from '@material-symbols/svg-400/outlined/star.svg?raw';
import i_starFill from '@material-symbols/svg-400/outlined/star-fill.svg?raw';
import i_subtitles from '@material-symbols/svg-400/outlined/subtitles.svg?raw';
import i_sync from '@material-symbols/svg-400/outlined/sync.svg?raw';
import i_tune from '@material-symbols/svg-400/outlined/tune.svg?raw';
import i_tv from '@material-symbols/svg-400/outlined/tv.svg?raw';
import i_up from '@material-symbols/svg-400/outlined/keyboard_arrow_up.svg?raw';
import i_volume from '@material-symbols/svg-400/outlined/volume_up.svg?raw';
import type { JSX } from 'solid-js';

const ICONS = {
  add: i_add,
  back: i_back,
  backspace: i_backspace,
  bookmark: i_bookmark,
  bookmarked: i_bookmarked,
  calendar: i_calendar,
  cc: i_cc,
  check: i_check,
  checkCircle: i_checkCircle,
  chevronLeft: i_chevronLeft,
  chevronRight: i_chevronRight,
  close: i_close,
  delete: i_delete,
  dns: i_dns,
  down: i_down,
  edit: i_edit,
  forward: i_forward,
  forward10: i_forward10,
  grid: i_grid,
  history: i_history,
  info: i_info,
  key: i_key,
  language: i_language,
  layers: i_layers,
  link: i_link,
  list: i_list,
  live: i_live,
  lock: i_lock,
  movie: i_movie,
  pause: i_pause,
  person: i_person,
  pin: i_pin,
  pinFill: i_pinFill,
  play: i_play,
  playlist: i_playlist,
  radioOff: i_radioOff,
  radioOn: i_radioOn,
  replay: i_replay,
  replay10: i_replay10,
  restart: i_restart,
  schedule: i_schedule,
  search: i_search,
  series: i_series,
  settings: i_settings,
  shield: i_shield,
  sort: i_sort,
  star: i_star,
  starFill: i_starFill,
  subtitles: i_subtitles,
  sync: i_sync,
  tune: i_tune,
  tv: i_tv,
  up: i_up,
  volume: i_volume,
};

export type IconName = keyof typeof ICONS;

/** Inline SVG icon, sized by the surrounding font size and coloured with currentColor. */
export function Icon(props: { name: IconName; class?: string }): JSX.Element {
  return <span class={props.class ? `icon ${props.class}` : 'icon'} aria-hidden="true" innerHTML={ICONS[props.name]} />;
}
