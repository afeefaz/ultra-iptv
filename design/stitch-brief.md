# Ultra IPTV — redesign brief

Screenshots of every current screen are in `current-ui/` (iPhone 16 Pro Max landscape, 932 × 430).
Channel logos, posters and titles there are placeholder test data, not real content.

## The app
An IPTV player (like IBO / IB Player): the user adds their own provider (Xtream Codes login or an M3U
link) and watches live TV, movies and series. Free, no accounts, no ads. English and Arabic (full
right-to-left mirroring).

## Where it runs
- **TVs** (Samsung, LG, Android TV, Fire TV): 16:9, 1920 × 1080, used from a sofa with a **remote
  control only** (arrows, OK, Back, number keys, coloured keys). No mouse, no touch.
- **Phones**: **landscape only** (e.g. 932 × 430), touch.
- Same layout on both, scaled to the screen width.

## Must keep (functional requirements)
- Top-level sections: **Home, Live TV, Movies, Series, Settings**, plus a playlist switcher.
- **Every interactive element needs a very obvious focus state** (today: yellow fill). On a TV that is
  the only way to know where you are. Design the focused look of each component.
- Live TV: category list (with search + sort + pinned categories), channel list (number, logo, name,
  now-playing title + progress), preview video with now/next guide. OK on a channel plays it in the
  preview, OK again goes full screen.
- Full-screen players: minimal overlay that hides after a few seconds; live shows channel + now/next;
  movies show a seek bar with time; buttons usable by touch.
- Movies/Series: category list + poster grid, search, sort; detail page with Play / Resume / Start
  over, favourites, other versions; series have season tabs and an episode list with progress.
- Home: Continue watching, favourite channels; needs the most new ideas (e.g. hero/featured area,
  recently watched channels, quick access to Live/Movies/Series).
- Lists can hold 50,000 channels / 20,000 movies: rows and posters must have fixed sizes.
- Text must stay readable from 3 m away on a TV (minimum ~24 px at 1080p).

## Technical limits (old TV browsers)
- Avoid effects old TVs can't do: no backdrop blur / frosted glass, no heavy shadows or animated
  gradients behind long lists. Simple solid colours, gradients on overlays, borders and scale-on-focus
  are fine.
- Dark theme preferred (video app, living room).

## Ask
A modern, beautiful dark design for these screens, in landscape: Home, Live TV, full-screen live
player, Movies grid, Movie detail, movie player, Series detail, Catch-up list, Settings, Add playlist,
dialogs (PIN, pickers). Show focus states. Include one Arabic (RTL) example.
