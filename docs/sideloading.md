# Sideloading Ultra IPTV

Distribution starts with sideloading; app stores come later. This page covers putting a build on a Samsung TV, an LG TV, and Android phones, TVs and Fire TV.

> Status: written before the app exists. `pnpm` script names and output paths are the **planned** ones and get confirmed in phase 0. Steps marked **(verify)** get checked on real hardware in phases 4–6. App IDs come from `docs/spec.md` §12 (Android/webOS `com.ultraiptv.player`, Tizen `ULTRAIPTV1.UltraIPTV`); `<TV_IP>` is the TV's IP address.

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
pnpm build:android                  # planned: builds the legacy web bundle + `npx cap sync android`
cd apps/android/android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
- **More than one device connected:** add `-s <serial>`, e.g. `adb -s <TV_IP>:5555 install -r …`.
- **Launch on a TV from the Mac:**
  ```sh
  adb shell monkey -p com.ultraiptv.player -c android.intent.category.LEANBACK_LAUNCHER 1
  ```
- **Uninstall:** `adb uninstall com.ultraiptv.player`.
- **Without adb:** copy the APK to the device and open it with a file manager (allow *Install unknown apps* for that file manager). On Fire TV, use a downloader app.

**Release builds:** signing with your own keystore comes before any store release; the keystore and password stay out of git. Debug builds are fine for sideloading during development.
