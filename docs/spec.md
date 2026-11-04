# Ultra IPTV: product and technical spec (v0.3)

Status: **all decisions recorded (§12), waiting for approval before any app code is written.**

## 1. Goals

- **Name:** Ultra IPTV.
- **IDs:** Android package and webOS app ID `com.ultraiptv.player`; Tizen package ID `ULTRAIPTV1` (app ID `ULTRAIPTV1.UltraIPTV`).
- **Free forever:** no activation, no MAC-address management, no payments, no ads.
- **No backend:** no servers, accounts, hosted services or third-party services. Everything runs on the device and talks only to the user's own playlist providers.
- **Targets:** one shared UI codebase with a platform layer for:
  - Samsung Tizen (`.wgt`)
  - LG webOS (`.ipk`)
  - Android phone + Android TV + Fire TV (one APK, Capacitor)
  - the web (development and direct-reachable playback)
- **Remote-first UI:** categories, channels and a preview side by side.
- **Multiple playlists per device,** each cached separately, switched instantly, never wiped on switch.
- **Fast:** shown instantly from cache, refreshed in the background, heavy work off the UI thread, quick channel zapping.
- **Debuggable on every device with local tools only.** Credentials are always redacted and provider hostnames hashed in every log.
- **Languages:** English and Arabic. The layout stays left to right in both (decided 2026-11-04: Arabic is a translation only; text inside labels still reads right to left).
- **Oldest supported TVs:** Samsung Tizen 4.0 and LG webOS 4.0 (2018 models).

### Not in v1
- **Out of scope:**
  - Sync between devices; accounts; any server component
  - Radio; TMDB or any other metadata enrichment
  - XMLTV; server-side EPG
  - DRM, recording/DVR, casting
  - App-store releases (sideload first)
- **Lower priority (later phase):** the full EPG guide grid (§11, phase 8).

## 2. Supported inputs

| Source | Support |
|---|---|
| Xtream Codes | Entered as server + username + password, or pasted as a URL. `get.php?username&password…`, `player_api.php?username&password` and `/playlist/<u>/<p>/…` are all recognised and treated as Xtream (parsed with `URL`/`URLSearchParams`, never by position) |
| M3U / M3U8 (extended) | `#EXTM3U` header attributes; `#EXTINF` attributes (`tvg-id`, `tvg-name`, `tvg-logo`, `tvg-chno`, `group-title`, `catchup`, `catchup-days`, `catchup-source`, and the `xxx-tvg` spellings); `#EXTGRP`; `#EXTVLCOPT` `http-user-agent` / `http-referrer` (applied where the platform player allows custom headers). `#KODIPROP` is parsed and ignored (no DRM) |
| EPG | Xtream only: `get_short_epg` (now/next) and `get_simple_data_table` (listings for catch-up and the channel programme list), fetched by the device and cached locally (§7). Titles and descriptions are base64-decoded. Plain M3U playlists have no EPG in v1 |

## 3. Architecture

```
┌──────────────────────── apps/ (one per target) ─────────────────────────┐
│ tizen (.wgt)   webos (.ipk)   android (Capacitor, phone+TV+Fire TV)  web │
│ build config + manifest + platform adapter registration only            │
└──────────────────────────────┬───────────────────────────────────────────┘
┌─────────────── packages/ui (SolidJS) ────────────────────────────────────┐
│ screens, components, focus/spatial-navigation module, virtualised lists, │
│ on-screen keyboard, i18n (en, ar + RTL), debug screen                    │
└──────────────────────────────┬───────────────────────────────────────────┘
┌─────────────── packages/core (framework-free TS) ────────────────────────┐
│ playlist sources (xtream, m3u), parsers, catalogue index, search,        │
│ EPG cache, favourites/progress/PIN, settings, logger + redaction         │
└──────────────────────────────┬───────────────────────────────────────────┘
┌─────────────── packages/platform (interfaces + adapters) ────────────────┐
│ Keys · Pointer · Player · Storage · SecureKey · Device · Lifecycle ·     │
│ Network · FileExport — adapters: tizen | webos | android | web           │
└──────────────────────────────────────────────────────────────────────────┘
packages/worker  – classic Web Worker: fetch + stream-parse M3U/Xtream JSON, diff, IndexedDB writes, search index
```

- **Monorepo:** pnpm workspaces; Vite for every target; TypeScript strict; Vitest for unit tests.
- **No SSR.** Single-page app; screens code-split where the target supports it; player adapters load only on their own platform.

### 3.1 Build targets
| Target | Oldest engine | Bundle |
|---|---|---|
| LG webOS 4.x | Chromium 53 | **legacy** |
| Samsung Tizen 4.0 | Chromium 56 | **legacy** |
| Android (incl. Fire TV) | System WebView (can be old on Fire TV / older Android TV) | **legacy** |
| Web (development on the Mac) | current Chrome / Safari / Firefox | modern |

**The legacy bundle targets Chrome 53:**
- **Build:** `@vitejs/plugin-legacy` with `targets: ['chrome >= 53']` and `renderModernChunks: false`. Chrome 53 has no ES modules, async/await or object spread, so everything is transpiled and loaded as a non-module (SystemJS) bundle.
- **Polyfills** (core-js, only what's used): `Object.entries/values`, `Promise.prototype.finally`, `AbortController`, `ResizeObserver`.
- **Worker:** built as a separate classic (non-module) bundle.
- **CSS rules for Chrome 53:**
  - Flexbox only: no CSS Grid (arrives in Chrome 57) and no flex `gap` (Chrome 84); use margins.
  - No logical properties (`margin-inline-*`). RTL comes from `dir="rtl"` plus mirrored rules generated by PostCSS (`postcss-rtlcss`).
  - CSS custom properties are fine (Chrome 49+).
- **Input events:** no Pointer Events on Chrome 53 (they arrive in Chrome 55), so Magic Remote and mouse input use mouse events.
- **CI check:** the legacy bundle is loaded in a headless Chromium 53-compatible environment (or at least syntax-checked with `es-check es2015` plus a polyfill audit). Real-device checks happen in phases 5–6.

## 4. Platform layer

Each adapter implements one shared TypeScript interface, and the UI only ever imports the interface.

### 4.1 Keys and pointer
Normalised key events: `up/down/left/right/ok/back/menu/info/playPause/play/pause/stop/ff/rew/chUp/chDown/digit0-9/red/green/yellow/blue`.

| Target | Mechanism |
|---|---|
| Tizen | `tizen.tvinputdevice.registerKey` for media, colour, channel and number keys; Back = 10009; exit with `tizen.application.getCurrentApplication().exit()` |
| webOS | keyCode map (Back 461, colour 403–406, CH 33/34, media keys). **Magic Remote:** the pointer moves focus on hover and clicks with OK; the app listens for webOS's `cursorStateChange` to switch between pointer and D-pad modes. Back is handled by the app (`disableBackHistoryAPI` in `appinfo.json`) |
| Android | Capacitor host forwards D-pad, media and colour `KeyEvent`s into the WebView. Touch on phones. Fire TV remote key codes (Menu, Rewind/FF, Play/Pause) included. Manifest: `LEANBACK_LAUNCHER` + banner, `touchscreen` and `leanback` features `required="false"` so one APK installs on phone, Android TV and Fire TV |
| Web | Keyboard (arrows, Enter, Esc/Backspace, digits, `F1`–`F4` as colour keys), mouse, touch |

### 4.2 Player
```ts
interface PlayerAdapter {
  load(src: StreamSource, opts: { startAt?: number; live: boolean; headers?: Record<string,string>;
                                  preferredAudio?: string[]; preferredText?: string[] }): Promise<void>
  play(): void; pause(): void; seek(sec: number): void; stop(): void
  setRect(rect: DOMRect | 'fullscreen'): void          // preview pane vs fullscreen
  tracks(): { audio: Track[]; text: Track[]; video: Track[] }
  selectAudio(id: string): void; selectText(id: string | null): void
  on(ev: 'state' | 'error' | 'tracks' | 'stats' | 'ended', fn): Unsubscribe
}
```

| Target | Engine | Notes |
|---|---|---|
| Tizen | **AVPlay** (`webapis.avplay`) | HLS and MPEG-TS natively; `setDisplayRect` for the preview pane; `setStreamingProperty` for buffering and user agent; tracks via `getTotalTrackInfo` / `setSelectTrack` |
| webOS | **`<video>`**, plus **hls.js where needed** | Native pipeline for HLS/TS first; hls.js for HLS streams the native player mishandles (decided per stream after a failed native attempt, then remembered per host) |
| Android | **Media3 ExoPlayer** in a small Capacitor plugin | `SurfaceView` behind a transparent WebView, rect synced from JS; FFmpeg audio extension (AC-3/E-AC-3/DTS); HW→SW decoder fallback |
| Web | **hls.js** for HLS, **mpegts.js** for raw `.ts` live | **Only streams the browser can reach directly** (CORS-enabled; `https` when the page is `https`). Unreachable streams show a clear message instead of failing silently |

**Shared player behaviour** (in `core`, not per adapter):
- **Fast zapping:** one player instance per screen, with the source swapped on zap; it's never rebuilt per channel. Previous/next channel URLs are resolved ahead of time.
- **Live auto-reconnect:** exponential backoff (0.5 s → 8 s, max 6 attempts), shown as "Reconnecting (n)". The container is switched once (TS ↔ HLS, Xtream) before giving up.
- **Remembered audio/subtitle choices:** preferred languages stored per device, applied on every load, updated whenever the user picks a track.
- **Watch progress:** VOD/episode position saved every 10 s and on pause/exit; resume prompt above 2 min; marked watched above 92 %. Feeds *Continue watching*.
- **External player (Android only):** an "Open with…" action and a default-player setting. Sends an `ACTION_VIEW` intent (`video/*`) with the stream URL and title. Not shown on Tizen, webOS or the web.
- **Stats overlay** (Info key): resolution, bitrate, buffer level, dropped frames. Also written to the logger at debug level.

### 4.3 Storage
- **IndexedDB** (via `idb`) on every target, namespaced by `playlistId`.
- **Cache Storage** for logos and posters: LRU, 50 MB on TVs, 200 MB elsewhere. Where Cache Storage isn't available (old WebViews) images fall back to the browser HTTP cache.

### 4.4 Secure key (credentials encrypted at rest)
- **What's encrypted:** playlist credentials (password, full source URL) and the parental PIN hash, with AES-GCM. They're decrypted only in memory when building requests.

| Target | Key storage |
|---|---|
| Android | AES key generated in and wrapped by the **Android Keystore** (small Capacitor plugin) |
| Tizen, webOS, web | **non-extractable WebCrypto `CryptoKey`** stored in IndexedDB |

- **Limits:** this protects against reading the database from an export, backup or casual inspection. It doesn't protect against someone with full control of the device (stated plainly in the debug docs).
- **Fallback:** if `crypto.subtle` is unavailable on a target (to be checked on real Tizen 4 / webOS 4), a pure-JS AES-GCM (`@noble/ciphers`) is used with the key kept in IndexedDB.

### 4.5 Device, lifecycle, network, file export
- **Device:** model, OS and engine version, screen size, input mode (remote / pointer / touch / mouse).
- **Lifecycle:** suspend/resume and visibility; stop or release the player when hidden (required on Tizen/webOS); flush the log buffer on hide.
- **Network:**

| Target | How requests are made |
|---|---|
| Android | Capacitor native HTTP (no CORS restrictions) |
| Tizen | `<access origin="*" subdomains="true"/>` in `config.xml` |
| webOS | packaged-app origin |
| Web | plain `fetch`; only providers that allow cross-origin requests work. **No proxy of any kind, including in development.** A blocked request shows "This provider can't be reached from a browser" and logs the reason (CORS / mixed content / network) |

  Each provider host gets at most 3 concurrent requests.
- **File export** (used by the debug screen):

| Target | Export method |
|---|---|
| Web | file download |
| Android | write to app storage + Android share sheet |
| Tizen | write to the `downloads` virtual root (`filesystem.write` privilege), then `sdb pull` |
| webOS | no user file system for web apps: export prints the log in numbered chunks to the console, captured with `ares-inspect` / `ares-log` (see `docs/debugging.md`) |

## 5. UI

### Shell and Home
- **Top tab bar:** Home · Live · Movies · Series · Search, with the playlist switcher and Settings on the right. Visible on every content screen, so any section is one key press away.
- **Home:** Continue watching, Favourite channels, Recently added (active playlist), playlist switcher.
- **No** expiry, MAC, activation or "buy" screens anywhere.

### Playlists (add/edit form designed for a remote)
- **Type:** segmented picker, Xtream / M3U URL.
- **Fields:** name, server (with quick-insert chips `http://`, `https://`, `:8080`, `.com`, `/`), username, password (masked, with a reveal toggle), or M3U URL; advanced: user agent.
- **Text entry on TV:** an on-screen keyboard with a URL row; the system keyboard on phone/web.
- **Paste a full Xtream URL** (Android/web): the form fills in server, username and password from it.
- **"Test & save":** for Xtream, runs the login call and shows provider status (account status, expiry, max connections) as information only. For M3U, fetches the header plus first entries.
- **Playlist list:** add, edit, delete (with confirmation), reorder, refresh now, set active. **Credentials are never shown in full**: host + username only.

### Live
- **Three panes:** Categories | Channels (number, logo, name, now-playing progress) | Preview (in-pane video) + now/next + actions (Favourite, Catch-up, Programme list).
- **Virtual categories first:** Favourites, Recent, All, then provider groups, honouring the user's hide/reorder.
- **OK on the playing channel** opens full screen.

### Full-screen player
- **Overlay:** channel number and name, now/next with progress, clock.
- **Zapping:** CH± and Up/Down; number entry with an on-screen buffer that jumps after 1.5 s; OK opens a mini channel list.
- **Tracks:** audio and subtitle pickers in one side sheet. Left/Right seek in catch-up/VOD.

### Catch-up
- **Where:** for channels with catch-up, the programme list (from `get_simple_data_table`, cached) marks past programmes as playable.
- **Xtream URLs:** `/timeshift/<u>/<p>/<durationMin>/<YYYY-MM-DD:HH-MM>/<id>.ts`, falling back to `/streaming/timeshift.php`.
- **M3U URLs:** `catchup` modes `default`, `append`, `shift`, `flussonic` and `xc`, with `catchup-source` placeholders (`{utc}`, `${start}`, `{duration}`, `{lutc}`, …).

### Movies / Series
- **Browse:** category rail + poster grid; sort by added, name, rating or year.
- **Detail page:** provider metadata only (no TMDB), with a **"versions" selector** when the same title appears in several categories, and resume/play.
- **Series:** season tabs and an episode list with per-episode progress.

### Search, favourites, parental PIN
- **Search:** global within the active playlist across Live/VOD/Series, grouped by type, incremental. Runs in the Worker so it never blocks input.
- **Favourites:** channels, movies and series, per playlist. Keyed by a stable key, so they **survive playlist refresh** and provider renumbering (§6).
- **Parental PIN:** 4 digits, set on first use of a lock. Stored as a PBKDF2 hash with salt, encrypted (§4.4).
  - **Locks** apply to categories and individual channels/titles, and are **only ever set by the user**; nothing is locked automatically (no adult-keyword detection). A locked item asks for the PIN once per session (or every time, as a setting).
  - **Changing or removing the PIN** asks for the current one.

### Settings
- **Playlists**, as above.
- **Playback:**
  - Preferred audio and subtitle languages; subtitle size, colour and background.
  - Stream format (auto / TS / HLS).
  - Buffer profile (low latency / balanced / stable).
  - External player (Android only).
- **Parental:** PIN and locks.
- **Appearance:** language (English / العربية), 12/24 h clock, list or grid for VOD.
- **Data:** clear watch history, clear image cache, clear one playlist's cache. All need confirmation.
- **About:** version and build. **The hidden debug screen** opens from here (§10).
- **Interaction rules:** toggles look like toggles; pickers open a list with OK/Cancel; destructive actions always need confirmation.

### Focus, lists and layout
- **One spatial-navigation module** used by every screen on every target:
  - `useFocusable`
  - focus zones per pane
  - remembered last focus per zone
  - optional wrap-around per list
  - pointer hover → focus for Magic Remote/mouse
- **RTL:** the module mirrors left/right.
- **Focus visibility:** the focused item always has a high-contrast ring/fill. Icon buttons have `aria-label`s.
- **Virtualised lists and grids** (`@tanstack/solid-virtual`, or a small in-house windowing component if it doesn't run on Chrome 53). Budget: smooth scrolling with 50k channels and 20k VOD items on a 2018 TV.
- **i18n:** English and Arabic from the first screen; the layout direction stays left to right in both (the RTL stylesheet mirror is kept but unused). **The default language is English on every device**, whatever the device language; Arabic is chosen in Settings → Appearance. Numbers and times are formatted per locale. Channel names stay as the provider sends them, with bidi isolation.
- **Form factors:** one responsive layout. Input mode toggles focus rings, hover and gestures; on phones the three panes collapse into stacked navigation.

## 6. Data model and caching

All data lives on the device. Nothing is synced.

| Store | Key | Contents |
|---|---|---|
| `playlists` | `playlistId` (random local ID) | name, type, host, encrypted credentials, user agent, refresh interval, lastSync, content hash |
| `categories` | `[playlistId, kind, id]` | name, order, hidden, locked |
| `channels` | `[playlistId, id]` | number, name, logo, categoryId, `tvgId`, catchup info, stream ref, **stable key** |
| `vod` / `series` / `episodes` | `[playlistId, id]` | provider metadata; details filled lazily via `get_vod_info` / `get_series_info` |
| `epg` | `[playlistId, streamId, kind]` | short EPG or full listings + `fetchedAt` |
| `favorites` / `progress` / `locks` | `[playlistId, stableKey]` | user data, kept separate from catalogue rows so a refresh never touches it |
| `searchIndex` | `[playlistId]` | prebuilt token index |
| `settings` | key | device settings, preferred languages |
| `logs` | auto (ring buffer) | §10 |

- **Stable key:** `hash(kind + normalised name + first group)`, plus a suffix for exact duplicates. Favourites, progress and locks are re-attached after every refresh by stable key, so they survive provider renumbering.
  - The tvg-id isn't part of the key, because providers often give the HD/FHD/SD variants of a channel the same EPG id.
  - If a key disappears (the channel moved group, say), the favourite is re-matched by tvg-id + name, then by a unique name.
  - Favourites for channels the provider removed are kept, and come back if the channel returns.

**Refresh strategy:**
1. **Open or switch playlist:** render from that playlist's own IndexedDB data immediately. **Other playlists' caches are never touched.**
2. **Background refresh:** when the cache is older than the playlist's interval (default 12 h, user-configurable), or on "Refresh now".
3. **Xtream:** the six catalogue calls run **in parallel** (max 3 per host). Live first, so the Live screen fills before VOD finishes.
4. **M3U:** the response body is stream-parsed line by line in the Worker; the whole file is never held as one string.
5. **Diff and write:** compare with stored rows and write only the changes. The UI receives change events and keeps its focus and scroll position.
6. **Failures:** a failed refresh keeps the cached data and shows a small "couldn't refresh" notice. The error goes to the logger (redacted).

## 7. EPG (device-side, Xtream only)

- **Now/next:** `get_short_epg` (limit 4) for channels **visible on screen** and the playing channel. Requests are batched with the per-host concurrency limit and cancelled when the user scrolls past.
- **Listings:** `get_simple_data_table` on demand: opening a channel's programme list, catch-up, and later the guide grid.
- **Cache:** IndexedDB per `[playlistId, streamId]`.
  - Short EPG is reused until the current programme ends, at most 30 min.
  - Listings are reused for 6 h.
  - Entries older than 7 days are cleaned up on startup.
- **Time handling:** Xtream timestamps converted to UTC. A user EPG offset (±hours) per playlist corrects providers with wrong time zones and applies to catch-up URLs too.
- **Guide grid (lower priority, phase 8):** channels × time, virtualised in both directions, built on the same cache.

## 8. Accounts and sync

None in v1. Each device is independent: playlists, favourites, progress, PIN and settings stay on that device.

## 9. Backend

None. No server, hosted service or third-party service. The only network traffic goes to the playlist providers the user enters (plus image/logo URLs from those playlists).

## 10. Logging and debugging (local only)

### Logger (`core/log`)
- **Format:** structured entries `{ ts (ISO), level (debug|info|warn|error), area, event, data, durMs? }`.
- **What's logged:**
  - **Requests:** method, redacted URL, hashed host, status, size, timing (DNS/connect not available in browsers, so total + time-to-first-byte where available).
  - **Player events:** load, first frame (gives zap time), buffering start/end, track changes, errors with engine codes, reconnect attempts.
  - **Errors:** with redacted stack traces.
  - **App start, playlist load phases, parse counts, IndexedDB timings.**
- **Levels:** `info` and above by default; `debug` can be turned on from the debug screen and persists until turned off.

**Console output** (every entry, so platform tools can read it):
- **Format:** each line is prefixed `[UltraIPTV] <level> <area>` so it can be filtered.
- **Android:** WebView console lines appear in logcat under the `Capacitor/Console` tag. The native player plugin logs under the tag `UltraIPTV`.
- **Media3's own logs** are set to warnings-only in release builds, and our plugin never passes URLs to `Log`.

**Ring buffer:**
- **Size:** the last **5,000 entries** (or 2 MB, whichever comes first) in the IndexedDB `logs` store.
- **Writing:** batched every 2 s and on hide, so logging never blocks the UI.

### Redaction (applied before anything reaches the console, buffer or export)
`core/redact.ts` is the **only** way a URL, header set or error message gets into a log entry. It:
- **Strips query parameters:** removes `username`, `password`, `pass`, `user`, `token`, `auth`, `key` and similar values.
- **Masks path segments:** replaces credential segments in `/live|movie|series|timeshift|playlist/<u>/<p>/…` and in `get.php`, `player_api.php`, `xmltv.php`, `timeshift.php` URLs.
- **Removes userinfo** (`scheme://user:pass@`) and drops the `Authorization` and `Cookie` headers.
- **Scrubs any free-text occurrence** of a saved playlist's username or password (an in-memory deny list, also checked inside error messages and stacks).
- **Hashes provider hostnames:** `host-<first 8 hex chars of HMAC-SHA256(host, per-install salt)>`. The same host always gives the same hash on one device, so problems can be grouped without revealing the provider. The debug screen can show the real host next to its hash **on the device only**, never in an export.

**Tests:**
- **Fixtures:** every URL form above, percent-encoded and double-encoded variants, and stack traces that contain URLs.
- **Property test:** the output never contains the input credentials or host.
- **Lint rule:** no `console.*` outside the logger module.

### Hidden debug screen
- **Open:** Settings → About, press OK on the version number 5 times. On the web, `?debug=1` also works.
- **Features:**
  - Live list of buffered entries; filter by level, area and text.
  - Pause/resume; set the log level; clear the buffer.
  - Show device and engine info.
  - **Export as a `.ndjson` file** using the per-platform method in §4.5.
- **Contents:** the screen only ever shows redacted data, except the on-device host lookup described above.

### Docs
- `docs/debugging.md`: exact commands to pull logs and attach DevTools on Android, Fire TV, Samsung and LG.
- `docs/sideloading.md`: installing on Samsung (developer mode), LG (Developer Mode app + ares CLI) and Android/Fire TV (adb).

## 11. Build plan

Develop and test in the browser on the Mac first, then build and sideload one platform at a time. Each phase ends with something you can test yourself.

**What the Mac browser can and can't test**
- **Phases 0–3 run entirely in Chrome on the Mac,** with the keyboard standing in for the remote (arrows, Enter, Backspace = Back, digits, F1–F4 = colour keys).
- **Window sizes:** Chrome's device toolbar covers phone and 1080p TV sizes.
- **Real playlists** load only if the provider allows browser requests (no proxy, §4.5).
- **Needs the real device:**
  - Samsung's AVPlay player and TV remote keys.
  - The TV's old browser engine. `pnpm build:legacy` produces the TV bundle and checks its syntax on the Mac, but only the TV runs Chromium 56.
  - ExoPlayer on Android.
- **Android TV without a TV:** Android Studio's Android TV emulator runs on Apple Silicon, so it covers TV layout and D-pad behaviour.
- **Samsung without the TV:** the Tizen TV emulator isn't expected to run on Apple Silicon (verify in phase 5), so the Samsung TV is the test device.

**Hardware available:** Samsung UE75CU7100 (2023, Tizen 7.0) and an Android phone. LG comes later, when hardware is available.

| # | Phase | What gets built | You can test |
|---|---|---|---|
| 0 | **Foundation** | pnpm monorepo; SolidJS + Vite; modern and legacy (Chrome 53) builds; logger + redaction (with tests) + IndexedDB ring buffer; hidden debug screen; i18n scaffolding with RTL; focus module | `pnpm dev` in Chrome: navigate a sample screen with the arrow keys in English and Arabic, open the debug screen, see and export logs; redaction tests pass; legacy bundle builds |
| 1 | **Web prototype: playlists and Live browsing** | playlist form (remote-friendly) + on-screen keyboard; encrypted credential storage; Xtream + M3U parsing in the Worker; parallel loading; per-playlist cache; background refresh/diff; Live three-pane UI with virtualised lists; search; favourites | Add 2+ playlists, switch between them instantly, refresh one and see favourites survive, scroll a large channel list smoothly with the keyboard |
| 2 | **Web prototype: playback** | web player adapter (hls.js / mpegts.js); preview pane + full screen; zapping that reuses the player; number zap; live auto-reconnect; track pickers with remembered choices; Xtream now/next EPG cache; parental PIN | Watch live channels in Chrome, zap with CH/arrow/number keys, unplug the network and watch it reconnect, see now/next, lock a category |
| 3 | **Web prototype: VOD, series, catch-up** | Movies/Series grids, detail, versions selector, resume + Continue watching; catch-up from programme lists (Xtream + M3U modes) | Resume a movie where you left it, play a past programme |
| 4 | **Android (phone + TV + Fire TV)** | Capacitor app; ExoPlayer plugin (preview rect + full screen, FFmpeg audio, decoder fallback); key forwarding; touch layout; external player; Keystore key; logcat output; sideload docs verified | Sideload the APK on your phone (touch layout) and run it in the Android TV emulator on the Mac (D-pad layout); follow `docs/debugging.md` to read logs with `adb logcat` and inspect with `chrome://inspect`. Real Android TV / Fire TV checks happen when hardware is available |
| 5 | **Samsung Tizen 4+** | AVPlay adapter; Tizen key registration; `config.xml` privileges; `.wgt` packaging + signing; file export to downloads | Install on your UE75CU7100 (Tizen 7) in developer mode; zap, play VOD, read logs with `sdb dlog` and the remote inspector. Tizen 4 compatibility is covered by build checks only (§12) |
| 6 | **LG webOS 4+** (deferred until LG hardware is available; can move after phase 7 or 8) | `<video>` adapter + hls.js fallback; webOS keys; Magic Remote pointer mode; `.ipk` packaging | Install with `ares-install`; use the Magic Remote pointer and the D-pad; read logs with `ares-inspect` |
| 7 | **Hardening and Arabic pass** | performance on 2018 TVs (targets: Live screen usable < 2 s from warm cache, zap < 1.5 s p95, no dropped input while scrolling 50k items); full Arabic/RTL review; empty/error states; accessibility labels | Run the checklist on each TV; switch the whole app to Arabic |
| 8 | **EPG guide grid** (lower priority) | channels × time grid on the existing EPG cache, catch-up from the grid | Open Guide, scroll through time and channels, play a past programme |

## 12. Decisions (resolved 2026-10-31)

| # | Question | Decision |
|---|---|---|
| 1 | App IDs | `com.ultraiptv.player` (Android, webOS); Tizen package `ULTRAIPTV1`, app `ULTRAIPTV1.UltraIPTV`. Can be changed freely until a store release |
| 2 | Loading playlists in the Mac browser | **No proxy.** Plain `fetch` in Chrome; if a provider blocks browser requests, the app says so clearly and real-playlist testing for that provider moves to Android (phase 4) |
| 3 | EPG for plain M3U | **None in v1** |
| 4 | Parental locks | **Manual only;** nothing is locked automatically |
| 5 | Test hardware | Samsung TV + Android phone + this Mac's Chrome. Android TV via the Android Studio emulator; Fire TV and LG when hardware is available |
| 6 | LG log export | Console dump via `ares-inspect` is fine; LG testing comes later |
| 7 | Default language | **English** on every device; Arabic chosen in Settings |

| 8 | Samsung test TV | **Samsung UE75CU7100 (75" Crystal UHD, 2023)**. 2023 models ship **Tizen 7.0** (web engine about Chromium 94); `sdb capability` reports `platform_version` 9.0 on this TV |

### Consequence of #8
- **The only Samsung test TV is Tizen 7,** so the **Tizen 4 (Chromium 56) floor can't be tested on real hardware.** The legacy bundle is still built for Chrome 53. It's guarded by build-time checks (`es-check`, polyfill audit, the CSS rules in §3.1).
- **Known gap:** compatibility with real 2018 TVs is unverified until someone tests on one.
- **Phase 5 tests:** AVPlay, remote keys, performance and packaging, all on the Tizen 7 TV.
