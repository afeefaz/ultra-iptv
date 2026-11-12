# Sideloading Ultra IPTV

Distribution starts with sideloading; app stores come later. This page covers putting a build on a Samsung TV, an LG TV, Android phones, TVs and Fire TV, and a Mac.

> Status: the Android steps below were verified in phase 4 (Android TV and phone emulators). Samsung and LG steps are still the **planned** ones; steps marked **(verify)** get checked on real hardware in phases 5–6. App IDs come from `docs/spec.md` §12 (Android/webOS `com.ultraiptv.player`, Tizen `ULTRAIPTV1.UltraIPTV`); `<TV_IP>` is the TV's IP address.

Keep the Mac and the TV/device on the same network.

---

## Samsung (Tizen 4.0+, 2018 and newer)

### One-time setup on the Mac
1. Install **Tizen Studio** (with the CLI) from developer.samsung.com.
2. In the Tizen Studio **Package Manager**, install:
   - *Main SDK*: Tizen SDK tools (and a TV platform for the emulator, optional).
   - *Extension SDK*: **TV Extensions** and **Samsung Certificate Extension**.
3. Add the tools to your shell:
   ```sh
   export PATH="$HOME/tizen-studio/tools:$HOME/tizen-studio/tools/ide/bin:$PATH"
   ```

### Turn on Developer Mode on the TV
1. Open **Apps** on the TV.
2. Press **1 2 3 4 5** on the remote; the Developer Mode dialog opens.
3. Set **Developer mode: On** and enter your **Mac's IP address** as Host PC IP.
4. **Restart the TV** (fully power-cycle it, not just standby).
5. Back in **Apps**, a "Develop mode" banner should show at the top.

### Connect and create a certificate (once per TV)
```sh
sdb connect <TV_IP>
sdb devices                 # the TV shows as "<TV_IP>:26101  device  <model>"
```
1. Tizen Studio → **Tools → Certificate Manager** → **+** → **Samsung** → **TV** → create an **author** certificate (sign in with a Samsung account).
2. Then create the **distributor** certificate. With the TV connected, its **DUID** is added automatically.
3. Give the profile a name, e.g. `UltraIPTV`.

> A build signed with this distributor certificate installs **only on TVs whose DUID is in it**. Add each new TV to the certificate and rebuild.

### Build, package, install
```sh
pnpm build:tizen                                   # planned → apps/tizen/dist (with config.xml)
tizen package -t wgt -s UltraIPTV -- apps/tizen/dist
tizen install -n UltraIPTV.wgt -t <device-name-from-sdb-devices> -- apps/tizen/dist   # .wgt is written into dist
tizen run -p ULTRAIPTV1.UltraIPTV -t <device-name>
```
- **Uninstall:** `tizen uninstall -p ULTRAIPTV1.UltraIPTV -t <device-name>`.
- **Where it appears:** among the TV's apps; launch it from there afterwards.

---

## LG (webOS 4.0+, 2018 and newer)

### One-time setup
1. Create an account at **webostv.developer.lge.com**.
2. On the TV, install **Developer Mode** from the **LG Content Store**. Open it and sign in with that account.
3. Turn **Dev Mode Status: ON** (the TV restarts), then open the app again and turn **Key Server: ON**.
4. Note the **IP** and **passphrase** shown in the Developer Mode app.
5. Install the CLI on the Mac:
   ```sh
   npm install -g @webos-tools/cli
   ```
6. Register the TV and fetch its key:
   ```sh
   ares-setup-device -a tv -i "host=<TV_IP>" -i "port=9922" -i "username=prisoner"
   ares-novacom --device tv --getkey        # enter the passphrase from the TV
   ares-setup-device --list
   ```

> **Session time:** the Developer Mode session lasts a limited time (shown in the app, about 50 hours). Press **Extend** in the Developer Mode app before it runs out. When it expires, the TV leaves developer mode and **sideloaded apps are removed** **(verify on your model)**.

### Build, package, install
```sh
pnpm build:webos                                   # planned → apps/webos/dist (with appinfo.json, icons)
ares-package apps/webos/dist -o out/
ares-install --device tv out/com.ultraiptv.player_<version>_all.ipk
ares-launch  --device tv com.ultraiptv.player
```
- **List installed apps:** `ares-install --device tv --list`.
- **Uninstall:** `ares-install --device tv --remove com.ultraiptv.player`.

---

## Android phone, Android TV, Fire TV (one APK)

### Turn on debugging
- **Phone** (e.g. Galaxy S24 Ultra): Settings → About phone → Software information → tap **Build number** 7 times. Then Settings → Developer options → **USB debugging: On**.
- **Android TV / Google TV:** Settings → System (or Device Preferences) → About → select **Build** 7 times. Then Developer options → **USB debugging** / **Wireless debugging**.
- **Fire TV:** Settings → My Fire TV → Developer options → **ADB debugging: On**, and **Apps from Unknown Sources** (or *Install unknown apps*) for sideloading. If Developer options is hidden: My Fire TV → About → select the device name 7 times.

### Connect
```sh
adb devices -l                      # USB
adb connect <TV_IP>:5555            # Fire TV / Android TV over the network
# Android 11+ wireless debugging: adb pair <ip>:<pair-port>, then adb connect <ip>:<port>
```

### Build and install
```sh
pnpm android                        # legacy web build → cap sync → Gradle debug APK
pnpm android:install                # … and `adb install -r` on the connected device
node scripts/android.mjs --install -s <serial>   # pick a device when several are connected
```
The APK is `apps/android/android/app/build/outputs/apk/debug/app-debug.apk` (about 16 MB; most of it is the FFmpeg audio decoder for AC-3/E-AC-3/DTS). Gradle needs Java 17–21: the script uses Android Studio's bundled JDK when `JAVA_HOME` isn't set (Homebrew's newest OpenJDK is too new for Gradle).
- **More than one device connected:** add `-s <serial>`, e.g. `adb -s <TV_IP>:5555 install -r …`.
- **First launch on a phone:** Android shows a one-time "Viewing full screen" tip, because the app hides the status and navigation bars; swipe from an edge to bring them back.
- **Emulators:** `AndroidTV_4K` (D-pad, TV layout) and any phone image work on Apple Silicon. The dev server's fake provider is reachable from an emulator at `http://10.0.2.2:<port>/__fixtures/xtream` (run `pnpm dev` and keep the port in mind).
- **Launch on a TV from the Mac:**
  ```sh
  adb shell monkey -p com.ultraiptv.player -c android.intent.category.LEANBACK_LAUNCHER 1
  ```
- **Uninstall:** `adb uninstall com.ultraiptv.player`.
- **Without adb:** copy the APK to the device and open it with a file manager (allow *Install unknown apps* for that file manager). On Fire TV, use a downloader app.

**Release builds:** `node scripts/android.mjs --release` writes a signed `app-release.apk` without source maps. It reads `~/.ultra-iptv/keystore.properties`:

```properties
storeFile=ultra-iptv-release.jks
storePassword=...
keyAlias=ultra-iptv
keyPassword=...
```

The key file sits next to it, and neither goes in git. **Back both up:** every update must be signed with this key, or people have to uninstall the app (and lose their playlists) to install it.

**Sharing the APK:** releases go to the public repo `afeefaz/ultra-iptv` as `UltraIPTV.apk`. This link always gets the newest one, so a Downloader code made from it never needs changing:

```
https://github.com/afeefaz/ultra-iptv/releases/latest/download/UltraIPTV.apk
```

To publish an update, raise `versionCode` and `versionName` in `apps/android/android/app/build.gradle`, build, then:

```sh
cp apps/android/android/app/build/outputs/apk/release/app-release.apk UltraIPTV.apk
gh release create v0.1.1 UltraIPTV.apk --repo afeefaz/ultra-iptv --title "Ultra IPTV 0.1.1" --notes "What changed"
node scripts/release-manifest.mjs notes.json   # notes.json: {"en": ["What changed"], "ar": ["ما الذي تغيّر"]}
pnpm relay:deploy                              # only now does the app offer it
```

**Updates from inside the app:** Settings → System → Check for updates reads `latest.json` from our website when pressed, and installs from the release it names. Commit the new `latest.json`. Publish the release before deploying it, so the app is never offered a file that isn't there yet. The file is checked against its hash, only `github.com/afeefaz/ultra-iptv/releases/download/` is accepted, and Android refuses anything not signed with the release key. Android 12 and newer install without a confirmation, once the user has allowed the app to install updates. Older versions ask each time, and so does Android when an app updates itself twice within about 30 seconds. The app closes when it updates, and Android doesn't allow it to reopen itself, so the screen tells the user to open it again.

## Samsung TV (Tizen)

`pnpm tizen` writes `apps/tizen/dist-tizen/UltraIPTV.wgt`. The package is unsigned: a Samsung TV only
runs apps signed with a certificate made for that TV, and that takes a Samsung account login.

1. Put the TV in Developer Mode: open **Apps**, press **1 2 3 4 5** on the remote, turn it on, enter
   the Mac's IP address, then restart the TV fully.
2. In [Apps2Samsung](https://apps2samsung.madebypatrick.nl), choose the custom `.wgt` option and pick
   the package. It creates the certificate (sign in when asked), signs the package and installs it.

Apps2Samsung keeps the TV's developer connection while it runs. Quit it before using `sdb`.

## Mac (Apple Silicon, macOS 13+)

The Mac app is the same app in a [Tauri](https://tauri.app) window (`apps/desktop`), with mpv for
video (MKV, AC-3/E-AC-3/DTS, HEVC, every audio track) and native networking, so there are no
browser limits. Intel Macs aren't supported.

### Installing

1. Open `UltraIPTV-mac.dmg` from the release and drag **Ultra IPTV** into **Applications**. Updates
   from inside the app only work from there.
2. The app isn't signed by Apple, so the first launch is blocked. On macOS 15 and newer: open it
   once, then **System Settings → Privacy & Security → Open Anyway**. On macOS 13–14: Control-click
   the app, choose **Open**, then **Open**. Or, in Terminal:
   ```sh
   xattr -dr com.apple.quarantine "/Applications/Ultra IPTV.app"
   ```
   Updates installed from inside the app don't ask again.

### Building

Needs Rust (`curl https://sh.rustup.rs | sh`) and Xcode's command line tools. The build downloads
the bundled libmpv once (`scripts/desktop-libmpv.mjs`, a pinned LGPL build: see THIRD_PARTY_NOTICES.md).

```sh
pnpm desktop                 # apps/desktop/src-tauri/target/release/bundle/macos/Ultra IPTV.app
pnpm desktop -- --debug      # with Safari's Web Inspector and the test hook (docs/debugging.md)
pnpm desktop:check           # cargo fmt, clippy and tests for the Rust side
```

During development, run the dev server on port 5181 and `node scripts/desktop.mjs --dev`. The mock
provider's `.mkv` movies play a real HEVC/AC-3/E-AC-3/DTS file after
`node scripts/make-test-media.mjs --mkv`.

### Releasing the Mac app

Updates are signed with the updater key in `~/.ultra-iptv/desktop-updater.key` (its password is in
`desktop-updater.password` next to it; the public half is in `tauri.conf.json`). Neither goes in
git. **Back them up:** the app only installs updates signed with this key, so losing it means every
Mac has to install the next version by hand.

The version comes from the root `package.json` (all of them move together). Then:

```sh
pnpm desktop -- --release   # .app, .dmg, and the signed update (Ultra IPTV.app.tar.gz + .sig)
node scripts/release-manifest.mjs --desktop notes.json
cp "apps/desktop/src-tauri/target/release/bundle/dmg/Ultra IPTV_<version>_aarch64.dmg" UltraIPTV-mac.dmg
cp "apps/desktop/src-tauri/target/release/bundle/macos/Ultra IPTV.app.tar.gz" UltraIPTV-mac.app.tar.gz
gh release upload v<version> UltraIPTV-mac.dmg UltraIPTV-mac.app.tar.gz --repo afeefaz/ultra-iptv
pnpm relay:deploy           # only now does the app offer it
```

The manifest step writes `apps/relay/page/public/desktop/latest.json` (our format: the app checks
it when Check for updates is pressed) and `desktop/update.json` (Tauri's: the install reads it).
Commit both. Pressing Update downloads the archive from our GitHub release (nothing else is
accepted), checks its signature, replaces the app and restarts it. An app run from the disk image
or Downloads says to move it to Applications first.
