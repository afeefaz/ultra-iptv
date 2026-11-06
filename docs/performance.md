# Performance

How fast the app must be, how that's measured, and what the latest measurements say. Rules for writing fast code are in `docs/engineering.md`.

All measurements stay on the device. Nothing is sent anywhere: `scripts/perf` reads them over a debugging connection, and the debug screen can export them to a file.

## The plan

1. **Instrument** the app: startup, screens, keys, frames, network, database, caches, player, memory, usage. Done.
2. **Baseline** on every device, with a real catalogue. Done: Samsung TV, phone, and both emulators.
3. **Fix what the numbers point to,** worst first, on the slowest real device. Two rounds done; see [What to fix](#what-to-fix) for the rest.
4. **Hold the line:** run `pnpm perf` before and after speed-sensitive changes, and compare against the budgets.

## Budgets

For a catalogue of about 47,000 items. The slowest supported device decides, so these are checked on the Samsung TV.

| Measure | Budget |
|---|---|
| First frame after launch | 1 s |
| Home with its data | 2 s |
| Library, first open | 2 s |
| Library, returning from a player or page | 100 ms |
| Key press to next frame (p95) | 100 ms |
| Main thread blocked by any one task | 200 ms |
| Channel change (p95) | 1.5 s |
| Movie start | 3 s |
| Full catalogue refresh | 15 s |
| Search, per key | 50 ms |
| Frames dropped while scrolling | Under 10% |

## Running the tests

```sh
pnpm perf --adb <serial> --label phone        # Android
pnpm perf --tizen <tv-ip> --label samsung-tv  # Samsung TV
pnpm perf:report                              # compares the newest run per device
```

Options: `--cold <n>` cold starts (default 3), `--skip-playback`, `--skip-speed`, `--skip-refresh`, `--refresh-only`.

- **It uses the playlist already active on the device,** and never types or reads a login.
- **One device at a time:** it plays real channels, and providers limit connections. Don't watch on that account during a run.
- **It leaves traces:** a few channels and one movie end up in Recently watched and Continue watching.
- **Debug access:** Android needs a debug build, or for a device with the release build, `node scripts/android.mjs --release --perf --install -s <serial>`. That one keeps the app's data, but put the normal release back afterwards and never publish it. Quit Apps2Samsung if the TV won't connect.
- **Results** go to `perf-results/`, which is gitignored.

The debug screen (Settings → About → press OK on the version 5 times) can export the same data with **Export performance report**.

## What's measured

| Name | Meaning |
|---|---|
| `startup.*`, `nav.*` | Marks from page load: scripts ran, app mounted, first frame, playlists read, worker ready, Home data, first paint |
| `screen.<route>` | Route change until the screen is painted |
| `input.toFrame` | Key press until the next painted frame |
| `frame.gap`, `frame.dropped` | Frame timing, only while a test asks for it |
| `main.longTask` | Anything blocking the main thread for over 50 ms |
| `db.*` | Database reads and sorts, per section |
| `library.*` | Loading a section, parsing its copy in chunks, building lookups and search names, sorting |
| `cache.*` | Hits and misses for the library and sort caches |
| `filter.*` | Search filtering, per key |
| `rpc.<method>`, `worker.<method>` | Worker calls as seen by the page and by the worker; the gap is queueing and copying |
| `net.ttfb.<op>`, `net.total.<op>`, `net.parse.<op>`, `net.chars.<op>` | Provider requests: first byte, whole request, JSON parsing, size |
| `net.image`, `net.imageFailed` | Posters and logos |
| `refresh.*` | Catalogue refresh: total, building rows, saving, per section |
| `player.*` | Channel change, movie start, rebuffering, errors, reconnects, resolutions seen |
| `memory.*` | Device RAM and the app's memory, every 5 s |
| `usage.*` | Feature counts: screens, playback, search, pins and settings changed |

Usage is kept in `localStorage` as counts and active time, with no titles, channel names or typed text.

**Reading the numbers**

- `frame.dropped` assumes 60 Hz. Phones lower their refresh rate when idle, so idle "drops" there aren't real. Only trust it during scrolling.
- "App memory" is approximate. Android adds the main process to the page's JavaScript memory.
- Samsung TVs round JavaScript memory, so the readout there shows device RAM only.
- Emulators run on a fast Mac, so they show what the code does, not how a real TV feels.

## Baseline

Measured 2026-11-04 with a real catalogue of about 16,500 channels, 20,700 movies and 10,700 series. Provider lists total 35 MB of JSON. The phone passes every budget. The Samsung TV, the slowest device, is the one to fix for.

### Samsung TV against the budgets

| Measure | Budget | Samsung TV | Result |
|---|---|---|---|
| First frame after launch | 1 s | 2.2 s | Over |
| Home with its data | 2 s | 6.4 s | Over |
| Library, first open | 2 s | 3.4–4.8 s | Over |
| Library, returning from a player or page | 100 ms | 300–590 ms | Over |
| Key press to next frame (p95) | 100 ms | Live 43 ms, posters 197 ms | Over on posters |
| Main thread blocked by any one task | 200 ms | Up to 1.55 s | Over |
| Channel change (p95) | 1.5 s | 2.1 s (typical 1.6 s) | Over |
| Movie start | 3 s | 1.4 s | Within |
| Full catalogue refresh | 15 s | 16.4 s | Slightly over |
| Search, per key | 50 ms | 33–43 ms | Within |
| Frames dropped while scrolling | Under 10% | Posters run at about 20 fps | Over |

### Devices

| Metric | android-tv-emulator | phone-emulator | phone-s24-ultra | samsung-tv |
|---|---|---|---|---|
| Platform | android | android | android | tizen |
| Model | sdk_google_atv64_arm64 | sdk_gphone64_arm64 | SM-S928B | UE75CU7100UXSQ |
| OS | Android 16 | Android 16 | Android 17 | Tizen 9.0 |
| Web engine | WebView 133.0.6943.137 | WebView 150.0.7871.181 | WebView 156.0.8078.47 | Chromium 120 |
| Screen (CSS px) | 960×540 | 944×448 | 798×384 | 1920×1080 |
| Device RAM | 1.9 GB | 2.9 GB | 10.8 GB | 1.5 GB |

### Cold start (median)

| Metric | android-tv-emulator | phone-emulator | phone-s24-ultra | samsung-tv |
|---|---|---|---|---|
| OS launch to first activity draw | 509 ms | 558 ms | 181 ms | – |
| Scripts ran | 180 ms | 249 ms | 146 ms | 902 ms |
| Platform ready | 187 ms | 255 ms | 151 ms | 936 ms |
| App mounted | 193 ms | 258 ms | 157 ms | 1,475 ms |
| First frame | 206 ms | 281 ms | 167 ms | 2,192 ms |
| First contentful paint | 236 ms | 288 ms | 168 ms | 2,318 ms |
| Playlists read | 230 ms | 325 ms | 224 ms | 2,399 ms |
| Worker ready | 245 ms | 340 ms | 243 ms | 2,984 ms |
| Home data ready | 561 ms | – | 441 ms | 6,365 ms |
| Home: read all channels | 289 ms | – | 189 ms | 2,800 ms |
| App memory after start | 137 MB | 149 MB | 177 MB | 9.5 MB |

### Screens (ms until content shows)

| Metric | android-tv-emulator | phone-emulator | phone-s24-ultra | samsung-tv |
|---|---|---|---|---|
| Live, first open | 308 ms | 166 ms | 188 ms | 3,424 ms |
| Live, back from player | 27 ms | 17 ms | 41 ms | 589 ms |
| Movies, first open | 224 ms | 176 ms | 278 ms | 4,780 ms |
| Movies, open a title | 38 ms | 33 ms | 15 ms | 161 ms |
| Movies, back to grid | 51 ms | 22 ms | 22 ms | 301 ms |
| Series, first open | 154 ms | 147 ms | 145 ms | 4,428 ms |
| Series, open a title | 14 ms | 14 ms | 19 ms | 146 ms |
| Settings | 30 ms | 7 ms | 20 ms | 266 ms |

### Main thread blocked (long tasks: total, count)

| Metric | android-tv-emulator | phone-emulator | phone-s24-ultra | samsung-tv |
|---|---|---|---|---|
| Live, first open | 0 | 0 | 50 ms (1) | 1,433 ms (5) |
| Live, open category | 0 | 0 | 0 | 296 ms (3) |
| Live, back from player | 0 | 0 | 0 | 375 ms (4) |
| Movies, first open | 58 ms (1) | 0 | 51 ms (1) | 2,562 ms (5) |
| Movies, sort by name | 0 | 0 | 0 | 532 ms (3) |
| Series, first open | 61 ms (1) | 0 | 50 ms (1) | 3,206 ms (8) |

### Database and memory cache

| Metric | android-tv-emulator | phone-emulator | phone-s24-ultra | samsung-tv |
|---|---|---|---|---|
| Read all channels | 265 ms | 139 ms | 148 ms | 2,827 ms |
| Read all movies | 188 ms | 130 ms | 218 ms | 3,904 ms |
| Read all series | 130 ms | 114 ms | 119 ms | 3,945 ms |
| Sort all movies | 4.5 ms | 5.6 ms | 4.4 ms | 148 ms |
| Sort by name (cold) | 12.9 ms | 16.9 ms | 16.9 ms | 295 ms |
| Sort back (cache hits) | 1 | 1 | 1 | 1 |
| Build search names, channels | 14.1 ms | 10.2 ms | 11.2 ms | 208 ms |
| Build search names, movies | 12.4 ms | 19.4 ms | 22.2 ms | 240 ms |
| Filter channels, per key | 4.5 ms | 1.4 ms | 3.7 ms | 32.6 ms |
| Filter movies, per key | 20.6 ms | 3.7 ms | 11.1 ms | 43.3 ms |
| Library cache hits on return | 1 | 1 | 1 | 1 |

### Remote feel

| Metric | android-tv-emulator | phone-emulator | phone-s24-ultra | samsung-tv |
|---|---|---|---|---|
| Key to frame, Live scroll (p50) | 24.6 ms | 23.9 ms | 12 ms | 31.1 ms |
| Key to frame, Live scroll (p95) | 32 ms | 31.4 ms | 13.6 ms | 43 ms |
| Frame gap, Live scroll (p95) | 16.7 ms | 16.8 ms | 8.4 ms | 33.4 ms |
| Frames dropped, Live scroll | 4 | 12 | 0 | 65 |
| Key to frame, grid scroll (p50) | 40.7 ms | 17.3 ms | 13.5 ms | 106 ms |
| Key to frame, grid scroll (p95) | 60.2 ms | 31.7 ms | 15.2 ms | 197 ms |
| Frames dropped, grid scroll | 106 | 1 | 1 | 521 |
| Poster load (p50) | 209 ms | 74.7 ms | 98.1 ms | 104 ms |
| Poster load (p95) | 295 ms | 95.3 ms | 154 ms | 237 ms |

### Playback

| Metric | android-tv-emulator | phone-emulator | phone-s24-ultra | samsung-tv |
|---|---|---|---|---|
| Channels started | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 |
| Zap (p50) | 625 ms | 614 ms | 760 ms | 1,573 ms |
| Zap (max) | 729 ms | 980 ms | 1,208 ms | 2,143 ms |
| Movie start | 1,883 ms | 1,908 ms | 1,944 ms | 1,363 ms |
| Rebuffering events | 0 | 0 | 0 | 0 |
| Resolutions seen | 1080p | 1080p | 1080p | 1080p |

### Network and catalogue refresh

| Metric | android-tv-emulator | phone-emulator | phone-s24-ultra | samsung-tv |
|---|---|---|---|---|
| Full refresh | 2,860 ms | 2,544 ms | 3,347 ms | 16,414 ms |
| Live list: first byte | 249 ms | 251 ms | 394 ms | 429 ms |
| Live list: download | 616 ms | 591 ms | 817 ms | 840 ms |
| Live list: parse | 37.8 ms | 11.2 ms | 19.1 ms | 316 ms |
| Live: build rows | 230 ms | 80.2 ms | 97.9 ms | 1,550 ms |
| Live: save | 595 ms | 126 ms | 190 ms | 4,449 ms |
| Movies list: download | 1,265 ms | 1,151 ms | 1,847 ms | 3,973 ms |
| Movies: save | 628 ms | 139 ms | 208 ms | 4,121 ms |
| Series list: download | 1,375 ms | 1,752 ms | 2,238 ms | 2,809 ms |
| Series: save | 554 ms | 76.3 ms | 113 ms | 6,378 ms |

### Memory

| Metric | android-tv-emulator | phone-emulator | phone-s24-ultra | samsung-tv |
|---|---|---|---|---|
| App, on Home after start | 137 MB | 149 MB | 177 MB | 9.5 MB |
| App, Live open | 136 MB | 154 MB | 177 MB | 10 MB |
| App, Movies open | 166 MB | 193 MB | 236 MB | 10 MB |
| App, Series open | 168 MB | 190 MB | 467 MB | 10 MB |
| App, all libraries held | 167 MB | 189 MB | 446 MB | 10 MB |

The Samsung's full refresh took 16.4 s: 1–2 s building rows and 4–6 s saving each section, in overlapping background work.

## After two rounds of fixes

Samsung TV, 2026-11-04, one run each, so small differences are noise. Bold means it now meets the budget.

| Measure | Budget | Baseline | Now |
|---|---|---|---|
| Live, first open | 2 s | 3.4 s | **1.0 s** |
| Movies, first open | 2 s | 4.8 s | **1.5 s** |
| Series, first open | 2 s | 4.4 s | **0.9 s** |
| Logo on screen after launch | | 2.3 s | **0.75 s** |
| First frame of the app after launch | 1 s | 2.2 s | 2.3 s |
| Home with its data | 2 s | 6.4 s | 3.6 s |
| Back to Live from full screen | 100 ms | 0.59 s | 0.33 s |
| Back to a movie's page from the player | 100 ms | 0.51 s | 0.73 s |
| Key press to frame, scrolling posters (p95) | 100 ms | 197 ms | 90–120 ms |
| Key press to frame, scrolling Live (p95) | 100 ms | 43 ms | **33 ms** |
| Longest freeze anywhere | 200 ms | 1.55 s | 0.55 s |
| Longest freeze opening Movies | 200 ms | 1.44 s | 0.33 s |
| Longest freeze opening a movie's page | 200 ms | 1.48 s | **Under 50 ms** |
| Frames dropped, scrolling posters | | 521 | 177 |
| Frames dropped, scrolling Live | | 65 | **1** |
| Full refresh | 15 s | 16.4 s | **2.7 s** if nothing changed, 10.8 s if only Live did |
| Channel change, typical | | 1.6 s | 1.4–1.5 s |
| Channel change, worst of 5 | 1.5 s | 2.1 s | 2.2–2.9 s, varies by channel |
| Movie start | 3 s | **1.4 s** | **1.5–1.7 s** |
| Search, per key | 50 ms | **33–43 ms** | **31–40 ms** |

**What did it:**

- **Libraries:** a JSON copy of each section. Reading it took 0.4–0.6 s on the TV, against 1.7–3.4 s for reading rows from IndexedDB, and it parses in chunks of about 40 ms.
- **Back from the player:** the screen below stays alive instead of being rebuilt.
- **Scrolling:** no animated borders or shadows on the TV. Profiling showed JavaScript took about 650 ms of an 8.9 s scroll, and graphics 4 s.
- **Home:** finds its channels by key instead of reading all of them.
- **Launch:** the logo is in the HTML, so it paints before the JavaScript starts. That's only what you see first: the app itself is no faster. A warm reload reaches its first frame in 0.41 s, so most of the 2.3 s is the TV starting the app engine.

**What didn't:** reducing AVPlay's start buffer from 4 s to 2 s made no measurable difference, so it was put back. On a channel change, about 0.3 s is closing the old stream and 1.2 s (up to 2.6 s) is AVPlay opening the new one.

## Network and catalogue refresh

| Metric | android-tv-emulator | phone-emulator | phone-s24-ultra | samsung-tv |
|---|---|---|---|---|
| Full refresh | 2,860 ms | 2,544 ms | 3,347 ms | 16,414 ms |
| Live list: first byte | 249 ms | 251 ms | 394 ms | 429 ms |
| Live list: download | 616 ms | 591 ms | 817 ms | 840 ms |
| Live list: parse | 37.8 ms | 11.2 ms | 19.1 ms | 316 ms |
| Live: build rows | 230 ms | 80.2 ms | 97.9 ms | 1,550 ms |
| Live: save | 595 ms | 126 ms | 190 ms | 4,449 ms |
| Movies list: download | 1,265 ms | 1,151 ms | 1,847 ms | 3,973 ms |
| Movies: save | 628 ms | 139 ms | 208 ms | 4,121 ms |
| Series list: download | 1,375 ms | 1,752 ms | 2,238 ms | 2,809 ms |
| Series: save | 554 ms | 76.3 ms | 113 ms | 6,378 ms |

### Memory

| Metric | android-tv-emulator | phone-emulator | phone-s24-ultra | samsung-tv |
|---|---|---|---|---|
| App, on Home after start | 137 MB | 149 MB | 177 MB | 9.5 MB |
| App, Live open | 136 MB | 154 MB | 177 MB | 10 MB |
| App, Movies open | 166 MB | 193 MB | 236 MB | 10 MB |
| App, Series open | 168 MB | 190 MB | 467 MB | 10 MB |
| App, all libraries held | 167 MB | 189 MB | 446 MB | 10 MB |

The Samsung's full refresh took 16.4 s: 1–2 s building rows and 4–6 s saving each section, in overlapping background work.

## After the first round of fixes

Samsung TV, 2026-11-04, one run each, so small differences are noise.

| Measure | Budget | Before | After |
|---|---|---|---|
| Home with its data | 2 s | 6.4 s | **3.4 s** |
| Movies, first open | 2 s | 4.8 s | 4.0 s |
| Series, first open | 2 s | 4.4 s | **2.1 s** |
| Live, first open | 2 s | 3.4 s | 2.9 s |
| Key press to frame, scrolling posters (p95) | 100 ms | 197 ms | **90 ms** |
| Main thread blocked, scrolling posters | | 5.5 s | **2.2 s** |
| Frames dropped, scrolling posters | | 521 | **162** |
| Frames dropped, scrolling Live | | 65 | **5** |
| Longest freeze opening a movie's page | 200 ms | 1.48 s | **Under 50 ms** |
| Longest freeze anywhere | 200 ms | 1.55 s | 1.34 s |
| Full refresh | 15 s | 16.4 s | **2.7 s** if nothing changed, 7.4 s if only Live did |
| First frame after launch | 1 s | 2.2 s | 2.2 s |
| Back from a player | 100 ms | 0.59 s | 0.61 s |
| Channel change, worst of 5 | 1.5 s | 2.1 s | 2.2 s |
| Search, per key | 50 ms | 33–43 ms | 31–40 ms |

## Network

What the app asks the provider for, and how often.

| Request | When | Notes |
|---|---|---|
| Login, 3 category lists, 3 full lists | Every 12 hours, 15 s after launch if due | 35 MB once unpacked, sent gzipped. A section whose lists are identical skips parsing and saving, and stays in memory |
| `get_short_epg` (now and next) | One per channel row that stays on screen for 0.3 s, or only the selected channel (Settings → Browsing) | Reused until it runs out of programmes, or for 6 hours; also for channels with no guide |
| `get_vod_info`, `get_series_info` | First time a title is opened | Stored on the device |
| Posters and logos | A poster that stays on screen for 0.12 s | No provider API; browser cache only |
| Video | One stream at a time | |

**Not done:** one bulk guide file (XMLTV) instead of a request per channel. It's one request and would allow a full schedule grid, but the file may be too big for a TV. Measure its size first.

## What to fix

Worst first, by what you'd feel on the Samsung TV.

| # | Finding | Evidence on the TV | Fix to try |
|---|---|---|---|
| 1 | Home takes 3.6 s to show its data | It waits on playlists (2.5 s) and the worker (2.9 s), not on reading channels any more | Find out what holds those back on a cold start |
| 2 | First frame is 2.3 s after launch | 0.9 s until scripts run, 0.65 s to mount, 0.8 s to the first frame | A modern bundle for newer TVs, without the polyfills and module loader. Must not break older TVs, and only Tizen 9 is available to test on |
| 3 | Back to a movie's page freezes for 0.55 s | Measured leaving the player, around saving progress | Trace it |
| 4 | Channel changes depend on AVPlay and the channel | 1.2 s average to open a stream, up to 2.6 s | Little left on our side: skip extra calls during a change, and test HLS against TS |
| 5 | Poster scrolling still blocks | 33 long tasks and 2.2 s in the test | Fewer effects on posters; measure holding a key, since the test presses slowly |
| 6 | Searching is uneven | Long tasks up to 0.3 s while typing; 206 ms building names on the first search | Do it in the worker |
| 7 | Posters use a lot of memory on the phone | 177 MB up to about 530 MB. Fine with 10.8 GB | Limit decoded posters if it matters on smaller phones |
