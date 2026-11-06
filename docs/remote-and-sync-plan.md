# Plan: remote playlist editing and sync

Status: all built: a device ID and key, a website the TV fetches from, and on-demand sync.

## Goals

1. **Remote editing:** add or change a playlist on a TV from a phone or computer, without typing on the remote.
2. **Sync:** push everything from one device, and pull it on others.

Both must work on Samsung TVs, Android, iPhones and computers, across networks, with no accounts.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Transport | A small encrypted relay on Cloudflare's free plan | A TV app can't accept incoming connections, and it's the only option that covers every device and network |
| Product rule | "No backend" becomes "no backend that can read your data" | The relay holds scrambled data and never sees a key |
| Accounts | None. Each device has an ID in MAC format and a key, as IPTV players commonly do | Nothing to sign up for or lose |
| Default | The ID, key and QR code are always there, with nothing to turn on. The relay is only contacted when the user presses Refresh | No constant requests, and nothing leaves the device until someone asks |
| Logins in sync | Yes, encrypted, between paired devices only | A new device works straight away |
| Parental PIN and locks | Synced, because sync means everything. Pull asks for the PIN first | Otherwise pulling could remove a lock |
| Channel and movie lists | Never synced | Each device downloads its own, as now |

## Parts

```
apps/relay      Cloudflare Worker: a mailbox for encrypted data, and the web page as static files
packages/core   Encryption, pairing, sync merge (no UI, unit tested)
packages/ui     Pairing screen, paired devices in Settings, status messages
```

**Storage: D1.** Its free plan allows 5 million rows read and 100,000 written a day, with 5 GB in total. KV allows only 1,000 writes a day, which pairing and sync could use up. Durable Objects would also fit, but a single table is simpler and pairing polls don't need live connections.

**Web page:** served as static files by the same Worker. Cloudflare doesn't charge for static asset requests, so only relay calls count against the 100,000 requests a day.

**Relay API:** deliberately almost nothing.

- `PUT /v1/box/<id>`: store encrypted data, with an expiry.
- `GET /v1/box/<id>`: read it.
- `DELETE /v1/box/<id>`: remove it.

There are no accounts, and nothing is logged about the contents. It enforces size limits and rate limits, and expired rows are removed on a schedule.

## Security

- **Keys never reach the relay.** The QR code holds the ID and key in the URL's `#fragment`, which browsers don't send to servers.
- **Encryption:** AES-GCM with WebCrypto. The app already needs it to store logins, so every device that can save a playlist has it.
- **Box ids** are derived from the ID and key, so they can't be found without both and don't reveal them.
- **Device ID:** random, in MAC format. Apps can't read a real MAC on most devices (Android returns a fixed fake), and a real one is guessable from its maker's prefix. It's lost if the app is uninstalled, along with the playlists.
- **Device key:** 8 characters, about 39 bits, stretched with PBKDF2 together with the ID. A MAC alone would be the only thing protecting saved logins, and MACs are easy to copy, so both are needed.
- **The website** remembers the ID and key in `localStorage`, so anyone using that browser can manage the device.
- **The QR code is always on screen,** so anyone who can photograph it can read that device's logins, once something is saved. The owner decided against a way to replace the code, so reinstalling is the only way to get a new one.
- **Rate limit:** 120 requests a minute per address. Not seen to trigger in a burst of 135 requests, so it can't be relied on yet.
- **A TV's first Refresh uploads its playlists,** encrypted, including logins, so the website can show them while it's off.
- **The TV doesn't test a login before taking it,** by decision: the website is the source of truth. If it doesn't work, the TV says so and keeps its cached catalogue until it's fixed.
- **What the relay can still see:** that a box exists, its size, when it's used, and the IP addresses that use it.

## Remote editing

Decided: **the website is the database, and the TV fetches from it.** One person can manage several TVs in other homes, months apart, with those TVs off.

1. Each TV has a permanent ID in MAC format and a key, shown on Home (while there's no playlist), Playlists and **Settings → Remote access**, and a QR code that holds both. A QR code is on the Home, Live and Movies screens while there's no playlist, and always on Add playlist, Playlists and Settings.
2. On the website, log in with the ID and key, or scan the QR. The browser remembers each TV, with an optional name that stays in that browser.
3. Adding, editing or deleting on the website saves straight to the relay. Nothing needs the TV, and nothing waits for it.
4. **Refresh** on the TV makes it match: one request when nothing's new. It takes what's saved without testing it first. A new login reloads that playlist's catalogue, and a rename doesn't call the provider at all.
5. **Nothing goes back about what happened.** The website doesn't show channel counts or whether a login works. A wrong password shows on the TV, and gets fixed on the website.
6. **A playlist added on the TV is never deleted by Refresh.** The TV records what it last matched. A playlist that was on the relay and is gone was deleted there. One that never was gets uploaded, so a TV's first Refresh brings its existing playlists to the website.
7. **Changes made on the TV** (add, edit, delete) save to the relay too, once that TV has pressed Refresh. They read first and change only that playlist, so they can't undo the website's other changes. A TV that has never pressed Refresh sends nothing.

**Storage:** one encrypted box per TV, in D1, derived from the ID and key. It lasts 10 years from the last save, so a TV can be left alone for a long time. D1 allows 5 GB in total, and a box is typically a few KB.

**Known limit:** the website can't tell a mistyped ID or key from a new TV, because neither has anything saved. It says so, but a playlist saved under a mistyped ID won't reach any TV. Scanning avoids this.

**Not the same as MAC login:** some providers tie a subscription to a MAC (MAG boxes, Stalker portals). This ID identifies the app to our website, and isn't that. Stalker portals would be a separate source type.

## Sync

Decided: **on demand, and whoever pushes is the source of truth.** There is no merging and nothing automatic.

1. **Link once,** after that device has pushed. On a new device, enter the ID and key of any device in the group. The device left a link in its own box if it's itself linked, so this follows the chain to where the group's data lives. Linking two devices to each other doesn't loop. Linking only succeeds if it finds a push: a single mistyped character leads to an empty box, and would otherwise look like a working link.
2. **Push** gathers everything and saves it to the group's one box, in one request. It replaces the last push, whichever device made it.
3. **Pull** downloads it (one request) and asks to confirm, showing which device pushed and when. Nothing changes until then. Then this device matches the push exactly, and the app restarts so every screen shows it.

| Moves | Stays on the device |
|---|---|
| Playlists and logins, and their order | The device's own ID and key |
| Favourites, watch progress, recently watched | Downloaded catalogues and guide data |
| Pinned and hidden categories, locks | Usage counts and log settings |
| The parental PIN | |
| Every other setting, including ones added later | |

**Catalogues don't download again.** A playlist with the same account here keeps its local id, its channel lists and its place in the app, and everything else is mapped onto it. Only a new account, or a changed password, makes it load again, when it's next opened.

**The PIN:** Pull asks for it if this device has one, because otherwise pulling from a device with no PIN would remove the lock.

**The website:** a device that uses it gets its website copy updated by a Pull, so a later Refresh doesn't undo it.

**Limits:** a push can be about 1.9 MB encrypted, because a D1 row can be 2 MB. That's several thousand watch history entries, and a bigger one says so rather than saving part of it. Linking gives a device the group's key, so anyone with it can read that group's data.

## Cost and limits

- The free plan allows 100,000 Worker requests a day. A device only uses requests when someone presses Refresh, Push, Pull or Link, or changes a playlist, about 1 to 3 each time, so this should comfortably cover normal use.
- If the relay is down or over its limit, the app carries on as normal and tries again later. Nothing depends on it except remote access and sync.
- The relay's address travels with each pairing, so moving it later is possible.

## Milestones

| # | What | How we know it works |
|---|---|---|
| 0 | Empty Worker deployed, with small tests | Samsung TV, phone and emulator all reach it over `https`; encryption round trip works on the TV |
| 1 | Relay, device ID and key, and adding a playlist | Add a playlist to the TV from a phone and a computer, on another network |
| 2 | Editing and deleting a playlist from the page | Change a password from the page, with nobody at the TV, and the TV tests it |
| 3 | On-demand sync: Link, Push and Pull for everything | Push on one device, Pull on another, and it matches |

Each milestone gets unit tests for its logic, and `perf`, `track` and logging without any secrets, per `docs/engineering.md`.

## Still to confirm

- That older Samsung TVs reach Cloudflare over `https`. Tizen 9 does, but older TVs may have older certificates, and only Tizen 9 is available to test on.
- How large a push gets with a real account's favourites and history.
