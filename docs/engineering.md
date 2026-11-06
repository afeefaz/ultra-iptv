# Engineering guide

How this codebase is built, and what every change has to respect. `docs/spec.md` says what the product is; `docs/performance.md` says how fast it must be and how that's measured.

## Product rules

These don't bend for a feature. If a feature seems to need one broken, raise it first.

1. **No third-party services, and no backend that can read your data.** The app talks to the user's IPTV provider, plus our relay (`apps/relay`), which holds encrypted data it has no key for. The app contacts it only when the user presses Refresh, Push, Pull or Link, or changes a playlist after having pressed Refresh once, and never on a timer. A device that has never pressed any of them sends nothing. No telemetry, crash reporting, CDNs or outside speed-test servers.
2. **Nothing readable leaves the device.** Logs, performance data and usage counts stay local until the user exports them.
3. **No content.** The app ships no channels, streams or provider details.
4. **One codebase.** Samsung, Android (phone, TV, Fire TV) and web share the UI. Differences live behind `Platform`, never in `if (samsung)` branches in screens.
5. **It's a sofa app first.** Everything must work with a remote, on old TVs, with 50,000-item catalogues.

## Architecture

```
apps/web        Entry point; picks the platform at runtime
apps/android    Capacitor shell and the native player plugin (Java)
apps/tizen      Samsung config.xml and icon
apps/relay      Cloudflare Worker: encrypted mailbox and the playlist website
packages/ui     Screens, components, focus, keys, translations, styles
packages/worker Catalogue worker and its typed RPC
packages/platform  One adapter per platform: player, keys, files, device info
packages/core   No UI: catalogue, sources, network, logging, tracing, encryption
```

Dependencies only point downward: `ui` → `worker`, `platform` → `core`. `core` imports none of them.

**Data flow**

- **The worker owns writes.** Network fetching, parsing and every database write go through `catalog().call(...)`. Adding a call means updating `WorkerApi` in `protocol.ts` and the map in `worker.ts`.
- **The page may read directly** through `core/catalog/queries.ts`, but big reads block it. Whole libraries go through `data/libraryCache.ts`, which uses a JSON copy of each section instead of reading rows one by one.
- **Screens stay alive under the player.** Returning from it doesn't rebuild them, so they react to the route (`currentRoute()`) rather than relying on being remounted, and `useKeyBarrier` stops them getting keys.
- **Device settings** live in `data/settings.ts` (`persisted`). Catalogue data lives in IndexedDB. Secrets are encrypted in the `secrets` store and never reach logs.
- **Playback** goes through the single `PlayerAdapter`, via `data/playback.ts`. Screens claim the video surface; they never touch a player.

**Changing the database:** raise `DB_VERSION` in `core/catalog/db.ts`. Adding an index rebuilds it over every row at the next launch: two indexes took about 30 s on the Samsung TV, during which nothing loads, and closing the app restarts the work. So add indexes rarely, and only for a measured reason.

**Adding a platform ability:** add an optional member to `Platform` in `platform/src/types.ts`, implement it per adapter, and have the UI handle its absence (`platform.download ?? fetchDownload`, or hide the feature).

## Conventions

**Code**

- TypeScript and SolidJS. Components are functions returning JSX; state is signals and memos.
- Comments explain *why*, and only where it isn't obvious. No commented-out code.
- Exact dependency versions in `package.json`.
- Files are named after what they export: `VodScreen.tsx`, `libraryCache.ts`.

**Solid pitfalls that have caused real bugs here**

- `createMemo` runs **immediately**, so anything expensive in one runs at mount. Keep work lazy (see `Library.normNames`).
- Module-level state outlives screens: it's how memory survives navigation, and also how it goes stale. Say in a comment what resets it.
- Screens unmount on every navigation. Anything to remember belongs in a module or `data/`, not a signal in the screen.

**Old browsers.** The Android and TV apps run the legacy bundle (Chrome 53 target). `check-legacy` fails the build on violations.

- CSS: flexbox only. No `gap`, grid, logical properties or `backdrop-filter`.
- JS: ES2016 after transpiling. The worker gets no polyfills, so it uses Chrome 53 built-ins only.
- Feature-detect newer APIs (`AbortController`, `PerformanceObserver`).

**Sizes and colours**

- Everything is in `rem`. One rem is 1/120 of the screen's width times the text-size setting, so a `rem` layout works from phones to 4K. `px` only for hairlines.
- A screen must survive text size 70–150%. Widths that hold text must grow: see `--text-scale` on `.pane-categories`.
- Colours come from the `:root` variables in `styles.css`.

**Text**

- Every string goes in **both** `i18n/en.ts` and `i18n/ar.ts`; the type check enforces it.
- Arabic is a translation only: the layout stays left to right.
- Write for viewers, not engineers. Say what happened and what they can do.

## UI rules

- **Every action works by remote, touch and mouse.** Use `FocusButton` or `useFocusable`, inside a `FocusZone`. Test with arrow keys and with a tap.
- **Moving focus never acts.** Only OK or a tap acts. Focus-triggered actions caused several bugs.
- **Every screen has an obvious first focus** (`autofocus`), and never lands on Back.
- **Back always works:** the remote key, the phone gesture, and `BackButton` on any page below a tab. It returns to the same place, with the same scroll, focus and search.
- **Lists use `VirtualList` or `VirtualGrid`** when they can be long, with fixed row heights.
- **Text input** goes through `TextField`, which handles the TV keyboard and the phone's.
- **Tapping outside closes** dialogs and sheets. Dialogs trap focus.
- **No text overflow.** Long provider names are normal, including Arabic: truncate them, and use `<bdi>` for anything from a provider.

## Logging, tracing and usage

Three tools, for three questions:

| Tool | Answers | Example |
|---|---|---|
| `log` | What happened, and why did it fail? | `log.warn('player', 'stalled', { seconds })` |
| `perf` | How long, how often, how big? | `perf.span('library.load.live')` |
| `track` | Which features are used? | `track('search.channels')` |

- **Never put in `perf` or `track`:** URLs, hosts, logins, channel or movie names, or anything typed. Use operations, kinds and numbers.
- `log` redacts, but still don't log what you don't need.
- **Names:** dotted lowercase, general to specific: `net.ttfb.get_live_streams`, `screen.movies`, `cache.library.hit.vod`.
- **What must be traced:** any new network call, big read, cache, expensive sort or filter, or screen. The dictionary is in `docs/performance.md`.
- Keep frame-by-frame measuring off unless asked: it stops the CPU from sleeping.

## Performance rules

Budgets and how to run the tests are in `docs/performance.md`.

- **The main thread is for the interface.** Parsing and writing belong in the worker.
- **No O(n) over a whole catalogue on mount.** Compute lazily, then cache in `Library`.
- **Don't re-read what's in memory.** Returning from a player or page must not touch the database.
- **Don't repaint everything.** No signal should make a whole list re-render.
- **Measure before and after** any optimisation, on the slowest real device.

## Testing

- `pnpm check` must pass before every commit: characters, types, lint, unit tests, both builds, legacy limits.
- **Unit tests** sit next to the code (`x.test.ts`) for logic: parsing, caching, player state, formatting. Anything that has broken once gets a test.
- **Real devices** for anything touching video, keys, layout or speed. Emulators and Chrome miss real problems.

| Change touches | Test on |
|---|---|
| Logic only | `pnpm check` |
| Screens or layout | Chrome (`?tv=1`), phone, Samsung TV; text size 70% and 150% |
| Keys or focus | Samsung TV remote, phone touch |
| Player | Samsung TV (AVPlay) and phone (ExoPlayer), live and movie |
| Android native code | Phone and Android TV emulator |
| Speed-sensitive code | `pnpm perf` before and after |

**The real account.** Performance tests run on the account already signed in on the devices. Tools must never type, read or print the login, must test one device at a time because of connection limits, and must keep channel names, hosts and logins out of the repo. Everyday development uses the mock provider (`pnpm dev`, see the README).

## New feature checklist

1. Does it respect the product rules? Does it fit an existing screen?
2. Does it work by remote, touch and mouse, with a sensible first focus and Back?
3. Strings in English and Arabic?
4. Does it work at text size 70–150%, on phone and TV?
5. New platform ability behind `Platform`, handled where absent?
6. On the legacy bundle (`check-legacy`)?
7. Traced with `perf`, and counted with `track` if it's a feature?
8. Does it hold up on a 50,000-item catalogue? Within budget?
9. Tests for the logic? Tried on the devices in the table above?
10. Docs updated if behaviour or commands changed?

## Git and releases

- **One branch, `main`,** for now. Use a short-lived branch for risky work, and delete it after merging.
- **Commit messages:** a short imperative first line, then what changed and why.
- **Never commit:** signing keys, `.env` files, `perf-results/`, or anything with a real provider's details. The repo is public, and history stays public.
- **Commits use the GitHub no-reply email,** set in this repo's git config.
- **Android releases:** raise `versionCode` and `versionName`, then follow `docs/sideloading.md`. Sign only with the release key in `~/.ultra-iptv/`; a different key forces everyone to reinstall.
- **Licensing:** the code is MIT. Check a new dependency's license and update `THIRD_PARTY_NOTICES.md`. GPL libraries affect how the APK can be shared.
