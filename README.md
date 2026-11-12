# Ultra IPTV

A free IPTV player for Android phones, Android TV, Fire TV, Samsung TVs and the web, with English and Arabic.
No accounts and no ads. Scan the QR code on a TV to manage its playlists from your phone, or push everything from one device to another, through a relay that only ever holds encrypted data. It doesn't include any channels or content: you add your own IPTV playlist.
LG webOS is planned. The design is in `docs/spec.md`.

## Download

**[Download the latest Android version](https://github.com/afeefaz/ultra-iptv/releases/latest/download/UltraIPTV.apk)**

This link always gets the newest version. On Android TV or Fire TV, enter it in the Downloader app.
Android asks you to allow installs from the app you download with, and Play Protect may warn about an unknown app.

**Mac (Apple Silicon, macOS 13+):** [download the latest Mac version](https://github.com/afeefaz/ultra-iptv/releases/latest/download/UltraIPTV-mac.dmg), open it and drag Ultra IPTV into Applications. It isn't signed by Apple yet, so the first time, open it and allow it in System Settings → Privacy & Security (Open Anyway).

For Samsung TVs, see [docs/sideloading.md](docs/sideloading.md).

## Setup

Needs Node 22+ and pnpm (via Corepack, bundled with Node):

```sh
corepack enable pnpm      # once; or prefix every command with `corepack`
pnpm install
```

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Web app with hot reload at http://localhost:5173 (`pnpm dev --port 5180` if 5173 is taken) |
| `pnpm dev:lan` | Same, reachable from your phone on the local network |
| `pnpm test` | Unit tests (redaction, logger, ring buffer, focus geometry, key map) |
| `pnpm typecheck` / `pnpm lint` | TypeScript and ESLint |
| `pnpm build` | Modern web build → `apps/web/dist` |
| `pnpm build:legacy` | TV/Android bundle for Chrome 53+ → `apps/web/dist-legacy`, then checks it can run there |
| `pnpm android` / `pnpm android:install` | Android APK (phone, Android TV, Fire TV) and optional `adb install`; see `docs/sideloading.md` |
| `pnpm desktop` / `pnpm desktop:check` | Mac app (`Ultra IPTV.app`, needs Rust) and its Rust checks; see `docs/sideloading.md` |
| `pnpm preview:legacy` | Serve the legacy bundle locally |
| `pnpm check` | All of the above, in order |

Keyboard stands in for the remote in the browser: arrows, Enter = OK, Backspace/Esc = Back,
digits, F1–F4 = red/green/yellow/blue, PageUp/PageDown = CH+/CH−.

- `/?tv=1` behaves like a TV: text fields use the on-screen keyboard.
- Hidden debug screen: Settings → System → press Enter on the version 5 times (or open `/?debug=1`).

### Test data (dev server only)

`pnpm dev` also serves a fake provider under `/__fixtures`. It is never part of a build.

| What | Value |
|---|---|
| Xtream server | `http://localhost:<port>/__fixtures/xtream` |
| Accounts | `demo` / `demo` (300 channels) · `big` / `big` (50,000 channels, 20,000 movies) · `slow` / `slow` (2.5 s per request) |
| M3U | `http://localhost:<port>/__fixtures/m3u/demo.m3u` (or `big.m3u`) |
| Renumber everything | open `/__fixtures/bump`, then Refresh: every stream id changes, a few channels go and come, favourites should stay |
| Drop every stream | open `/__fixtures/outage?seconds=20`: playback shows "Reconnecting (n)…" and resumes by itself |
| Movies & series | every mock movie and episode is the same 5-minute video (seekable MP4); series have 1–3 seasons of 6 episodes; every 7th series has 120 episodes per season, for testing long lists |
| Catch-up | every 5th channel (News 1 HD, …) has 3 days of archive; Live → focus it → **Catch-up** |
| Provider that blocks browsers | open the app at `http://localhost:<port>` and use server `http://127.0.0.1:<port>/__fixtures/xtream`: the API allows cross-origin requests but streams don't (like many real providers), so live TV falls back to Chrome's built-in HLS player |

Playable test streams need local media, generated once with ffmpeg (`brew install ffmpeg`):

```sh
node scripts/make-test-media.mjs      # ~5 min, ~155 MB in apps/web/dev/media (gitignored); --force to rebuild
```

Xtream accounts play HLS through hls.js (video + English/Arabic audio + English/Arabic subtitles);
the M3U lists play raw MPEG-TS through mpegts.js. Every 7th mock channel has no guide data.

Real providers work in the browser only if they allow cross-origin requests; otherwise the form says so.

#### Testing a real provider in Chrome

Many providers serve streams over plain `http://` from Cloudflare hosts that publish a DNS HTTPS
record. Chrome (and other Chromium browsers, and Safari) then switch to `https://` by themselves, which
those hosts can't serve: playback fails with `net::ERR_SSL_VERSION_OR_CIPHER_MISMATCH` in the console and
"couldn't connect to the provider's video server" in the app. TVs and Android don't do this. For testing on
the Mac, start a separate Chrome profile with that behaviour off (your normal Chrome is untouched; use this
window only for testing):

```sh
open -na "Google Chrome" --args --user-data-dir="$HOME/.ultra-dev-chrome" --disable-features=UseDnsHttpsSvcb,UseDnsHttpsSvcbAlpn
```

If the provider also blocks cross-origin stream requests, live TV uses Chrome's built-in HLS player, which
may not offer audio/subtitle track switching.

### Remote keys in Live TV / full screen

| Key | Live TV | Full screen |
|---|---|---|
| OK | play in preview; again = full screen | channel list |
| Up/Down, CH± (PgUp/PgDn) | move / page | previous / next channel |
| 0–9 | jump to channel number | jump to channel number |
| Yellow (F3) | favourite | favourite |
| Red (F1) | lock category/channel (creates the PIN the first time) | – |
| Green (F2) | pin / unpin the focused category (or click 📌) | audio & subtitles |
| Blue (F4) / Info | – | playback details |
| Back (Esc) | back | back to Live (keeps playing) |

### Remote keys for movies, episodes and catch-up

| Key | Grid / detail | Full screen |
|---|---|---|
| OK | open / play | pause & play |
| Left/Right | move | back / forward 10 s |
| REW/FF | – | back / forward 30 s |
| CH± (PgUp/PgDn) | page through the grid | – |
| Yellow (F3) | favourite | – |
| Green (F2) | pin / unpin the focused category (or click 📌) | audio & subtitles |
| Back (Esc) | back | back (position is saved; resume offered after 2 min) |

## Layout

```
apps/web            Vite entry for the browser and for Android (picks the platform at start-up)
apps/android        Capacitor project; native ExoPlayer plugin in android/app/src/main/java/com/ultraiptv/player
apps/desktop        Mac app: Tauri shell (src-tauri, Rust) with the mpv player view (native/mpv_view.m)
  build/            legacy worker transpiling;  dev/  fake provider for `pnpm dev`
packages/core       framework-free logic: logger + redaction, Xtream/M3U sources, catalogue
                    (IndexedDB, diff writes, favourites, search), encrypted credentials
packages/worker     the catalogue worker (all fetching, parsing and writes) + its client
packages/platform   platform interfaces + adapters (web, tizen, android, desktop)
packages/ui         SolidJS screens, focus/spatial navigation, virtual lists, on-screen keyboard,
                    i18n (English, Arabic RTL)
scripts/            build checks
docs/               spec, debugging, sideloading
```

## Contributing

Read [docs/engineering.md](docs/engineering.md) for the rules, conventions and new feature checklist, and [docs/performance.md](docs/performance.md) for the speed budgets and how to measure them.

## License

MIT, see [LICENSE](LICENSE). The Android APK includes a GPL-3.0 audio decoder, so the APK as a whole is under GPL-3.0: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
