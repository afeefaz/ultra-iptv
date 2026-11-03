# Debugging Ultra IPTV

Ultra IPTV logs only to the device: the console plus an IndexedDB ring buffer. Nothing is sent anywhere. This page lists how to read those logs and attach DevTools on each platform.

> Status: written before the app exists. `pnpm` script names and output paths are the **planned** ones and get confirmed in phase 0. Commands marked **(verify)** depend on TV firmware and are checked in phases 4–6.

IDs used below (from `docs/spec.md` §12):

| Platform | ID |
|---|---|
| Android | package `com.ultraiptv.player` |
| webOS | app ID `com.ultraiptv.player` |
| Tizen | package `ULTRAIPTV1`, app ID `ULTRAIPTV1.UltraIPTV` |

`<TV_IP>` means the TV's IP address on your network.

## What the logs look like

Every line the app prints starts with `[UltraIPTV]`, then the level and area:

```
[UltraIPTV] info  net   GET http://host-3fa91c2b/player_api.php?action=get_live_streams&username=***&password=*** 200 1.84MB 2310ms
[UltraIPTV] info  player first-frame zapMs=812 engine=avplay
[UltraIPTV] warn  player reconnect attempt=2 delayMs=1000
```

- **Credentials** always show as `***`.
- **Provider hosts** appear as `host-<hash>`. The hash is the same for a given host on a given device. Only the device's own debug screen can show the real host next to its hash.
- **Other output:** messages from the operating system or TV firmware (not ours) may still contain stream URLs. Filter on `[UltraIPTV]` or our tags to avoid them.

## The hidden debug screen (all platforms)

- **Open it:** Settings → About → press **OK on the version number 5 times**. On the web, add `?debug=1` to the URL.
- **What you can do:** filter by level, area and text; pause; change the log level (`debug` persists until turned off); clear the buffer; **Export**.
- **Where Export goes** on each platform is described in the sections below.

---

## Web (Chrome on the Mac)

```sh
pnpm dev            # planned: starts the Vite dev server for apps/web
```

- Open the printed URL, then DevTools → Console, and type `[UltraIPTV]` in the filter box.
- **Export** downloads `ultra-iptv-logs-<timestamp>.ndjson`.
- **Legacy bundle check** (the one the TVs use):
  ```sh
  pnpm build:legacy && pnpm preview:legacy   # planned
  ```

---

## Android phone, Android TV, Fire TV

Debug builds have WebView debugging turned on (Capacitor's default for debug builds). Release builds don't.

### Connect
```sh
adb devices -l                          # USB (phone)

adb connect <TV_IP>:5555                # Android TV / Fire TV over the network
# Android 11+ with "Wireless debugging":
adb pair <TV_IP>:<pairing-port>         # enter the pairing code shown on screen
adb connect <TV_IP>:<debug-port>
```
- **Fire TV:** Settings → My Fire TV → Developer options → **ADB debugging: ON**. If Developer options is missing: Settings → My Fire TV → About → select the device name 7 times.
- **Android TV:** Settings → Device Preferences → About → select *Build* 7 times, then Developer options → **USB debugging** (or network debugging).

### Read logs
```sh
# Only our lines: the app's logger (via Capacitor/Console) + the native player plugin (UltraIPTV)
adb logcat -v time | grep UltraIPTV

# Everything from our process only
adb logcat -v time --pid="$(adb shell pidof -s com.ultraiptv.player)"

# Clear the log first if you want a clean capture
adb logcat -c
```

### Attach DevTools
1. Start the app on the device.
2. On the Mac, open **`chrome://inspect/#devices`** in Chrome. Network-connected devices appear once `adb connect` has worked.
3. Under the device, find the **Ultra IPTV** WebView and click **inspect**.

### Get an exported log file
**Export** opens the Android share sheet (send it to yourself). The file is also left in the app's cache, which you can pull from a debug build:
```sh
adb exec-out run-as com.ultraiptv.player ls cache
adb exec-out run-as com.ultraiptv.player cat cache/<file>.ndjson > ultra-iptv-logs.ndjson
```

### Evaluate code in the app from the Mac (no Chrome window needed)
```sh
PID=$(adb shell pidof com.ultraiptv.player)
adb forward tcp:9223 localabstract:webview_devtools_remote_$PID
curl -s http://localhost:9223/json          # lists the page and the catalogue worker
```
Any Chrome DevTools Protocol client can then attach to the page's `webSocketDebuggerUrl`.

### Things that look like bugs but aren't
- **Wrong "now playing" on an emulator:** emulator clocks can be far off; the guide is matched against the device clock.
- **A video box that stays black in the Live preview:** the native video view only moves on top of the page after its first frame; until then the page's own "Loading…" or error message shows. If it stays black with no message, check `UltraIPTV` lines for a playback error.

---

## Samsung Tizen TV

Needs Tizen Studio with the CLI tools (`sdb`, `tizen`) and the TV in Developer Mode with your Mac's IP set (see `docs/sideloading.md`).

```sh
export PATH="$HOME/tizen-studio/tools:$HOME/tizen-studio/tools/ide/bin:$PATH"
sdb connect <TV_IP>          # default port 26101
sdb devices                  # note the device name/serial
sdb capability | grep platform_version   # Tizen version (UE75CU7100 / 2023 models: expect 7.0)
```

### Read logs
```sh
# Web app console output on Tizen is logged under the ConsoleMessage tag (verify)
sdb dlog -v time ConsoleMessage:V

# Everything, filtered to our lines
sdb dlog -v time | grep '\[UltraIPTV\]'

# Clear the buffer
sdb dlog -c
```
Some retail TV firmwares limit `dlog` output for non-partner apps **(verify)**. If it's empty, use the Web Inspector console below.

### Attach the Web Inspector
```sh
# 1. Launch the app in debug mode; this prints a port number
sdb shell 0 debug ULTRAIPTV1.UltraIPTV
#    e.g. "... successfully launched pid = 12345 with debug 1 port: 34567"

# 2. Forward that port to the Mac
sdb forward tcp:34567 tcp:34567
```
3. Open `http://localhost:34567` in Chrome on the Mac and click the page link. Alternatively, add `localhost:34567` under `chrome://inspect` → *Configure…*.
4. The Tizen 4 engine is Chromium 56. If the current Chrome DevTools front end misbehaves with it, use the inspector page served on that port **(verify)**.

Tizen Studio's *Debug As → Tizen Web Application* does the same steps from the IDE.

### Get an exported log file
**Export** writes `ultra-iptv-logs-<timestamp>.ndjson` to the TV's Downloads folder (`filesystem.write` privilege):
```sh
sdb shell ls /opt/usr/home/owner/media/Downloads     # (verify path on your model)
sdb pull /opt/usr/home/owner/media/Downloads/ultra-iptv-logs-<timestamp>.ndjson .
```

---

## LG webOS TV

Needs the webOS CLI, and the TV in Developer Mode and registered with the CLI (see `docs/sideloading.md`).

```sh
npm install -g @webos-tools/cli
ares-setup-device --list        # confirm the TV (named "tv" below) is registered
```

### Attach the Web Inspector (main tool on webOS 4)
```sh
ares-inspect --device tv --app com.ultraiptv.player --open
```
This opens the inspector in your browser. Console output (filter `[UltraIPTV]`), network, elements and performance are all there.

### Read logs from the terminal
```sh
ares-log --device tv --follow          # newer CLI + newer webOS versions (verify on webOS 4)
ares-log --help                        # flags differ between CLI versions
```
If `ares-log` isn't supported on your TV's webOS version, use the inspector console above.

### Get an exported log
- **Why it's different:** webOS web apps can't save user-visible files.
- **What Export does on webOS:** prints the ring buffer to the console as numbered chunks (`[UltraIPTV] export 1/12 …`), framed by `export-begin` / `export-end` lines.
- **How to capture it:** with `ares-inspect` open, right-click in the Console → **Save as…**.

---

## Common checks

| Symptom | Where to look |
|---|---|
| Playlist won't load | `net` lines for the playlist's `host-…`: status code, timing, `cors`/`mixed-content` errors (web only) |
| Black screen / no video | `player` lines: `load`, `error` with engine code; try Settings → Playback → Stream format TS/HLS |
| Slow zapping | `player first-frame zapMs=` values; compare engines and stream formats |
| Keys not working | debug screen → area `keys` shows the raw key codes received |
