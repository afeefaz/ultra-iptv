# Plan: remote playlist editing and sync

Status: plan only, nothing built yet.

## Goals

1. **Remote editing:** add or change a playlist on a TV from a phone or computer, without typing on the remote.
2. **Sync:** favourites, watch progress, playlists and some settings follow you between your devices.

Both must work on Samsung TVs, Android, iPhones and computers, across networks, with no accounts.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Transport | A small encrypted relay on Cloudflare's free plan | A TV app can't accept incoming connections, and it's the only option that covers every device and network |
| Product rule | "No backend" becomes "no backend that can read your data, and only if you pair" | The relay holds scrambled data and never sees a key |
| Accounts | None. Devices pair with a QR or short code | Nothing to sign up for or lose |
| Default | Off. Nothing leaves the device until you pair | Keeps the promise for everyone who never uses it |
| Logins in sync | Yes, encrypted, between paired devices only | A new device works straight away |
| Parental PIN and locks | Not synced at first | Unlocking on one device shouldn't weaken another |
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

- **Keys never reach the relay.** The QR code holds the key in the URL's `#fragment`, which browsers don't send to servers.
- **Encryption:** AES-GCM with WebCrypto. The app already needs it to store logins, so every device that can save a playlist has it.
- **Box ids** are derived from the key, so they can't be guessed and don't reveal it.
- **Short code,** for anyone who can't scan: about 10 characters, stretched with PBKDF2, valid for 10 minutes and rate limited. It only starts a pairing, which then swaps to a full-strength random key.
- **The TV shows what was received** before saving a new playlist.
- **Removing a device** changes the shared key, so a lost phone can't read new data.
- **What the relay can still see:** that a box exists, its size, when it's used, and the IP addresses that use it.

## Remote editing

1. On the TV, **Add playlist → Use my phone or computer** shows a QR and a short code.
2. The web page opens on any device, and the form looks like the app's.
3. The page encrypts the details and puts them in the box. The TV polls about every 3 s, only while this screen is open, for up to 10 minutes.
4. The TV tests the login and writes the result back, and the page shows it. The TV has to test it, because a secure web page can't call a plain `http` provider.
5. **Editing an existing playlist:** the TV sends the encrypted playlist to the page, the page sends changes back, and the same test runs.

## Sync

Paired devices share one encrypted state, kept in one box.

1. **When:** on launch, after changes (grouped over about 30 s), and when the app goes to the background. There's no constant polling.
2. **How:** read the box, merge, write it back only if nobody else wrote in between, and retry otherwise.
3. **Merging:** the newest change wins per item, with the device id as a tie-break. Deletions are kept as markers for a while so they don't come back.

| Data | Identified by | Merge |
|---|---|---|
| Playlists and logins | Hash of server and username, shared by all devices | Newest wins |
| Favourites | Playlist id + item `key` | Added or removed, newest wins |
| Watch progress | Playlist id + item `key` | Newest wins |
| Recently watched | Playlist id + item `key` | Newest wins, capped |
| Pinned and hidden categories | Playlist id + section | Newest wins per list |
| Settings, later | Name | Only ones that make sense everywhere |

**Already in our favour:** item `key`s come from a hash of the name and category, so they match across devices on the same provider.

**The real work:** each device gives a playlist its own random id today, so synced data needs a shared id mapped to the local one.

**Stay per device:** text size, memory readout, buffering, stream format and subtitle size.

## Cost and limits

- The free plan allows 100,000 Worker requests a day. A paired device should use a few dozen, and a pairing up to about 200, so this should cover a couple of thousand paired devices. That's an estimate to check once it's running.
- If the relay is down or over its limit, the app carries on as normal and tries again later. Nothing depends on it except pairing and sync.
- The relay's address travels with each pairing, so moving it later is possible.

## Milestones

| # | What | How we know it works |
|---|---|---|
| 0 | Empty Worker deployed, with small tests | Samsung TV, phone and emulator all reach it over `https`; encryption round trip works on the TV |
| 1 | Relay, pairing and adding a playlist | Add a playlist to the TV from an iPhone and a computer, on another network |
| 2 | Editing an existing playlist from the page | Change a password from the page, and the TV tests it |
| 3 | Sync: favourites and progress | Start a movie on the phone, resume on the TV |
| 4 | Sync: playlists, recents, pins, hidden categories | A newly paired device is ready straight away |
| 5 | Paired devices screen, remove a device, settings | Removing a device stops it reading new data |

Each milestone gets unit tests for its logic, and `perf`, `track` and logging without any secrets, per `docs/engineering.md`. A device that never pairs must make no relay requests at all, and a test will check that.

## Still to confirm

- D1's limits on row size, for the sync box. The first version keeps state small and may split it.
- That Samsung TVs reach Cloudflare over `https` from the app, which milestone 0 tests. Older TVs may have older certificates, and only Tizen 9 is available to test on.
- How large sync state gets with a real account's favourites and history.
