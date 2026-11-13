# Third-party notices

The code in this repository is under the MIT License (see `LICENSE`). The apps also include
these libraries, under their own licenses.

## Android app: GPL-3.0

The Android APK includes `org.jellyfin.media3:media3-ffmpeg-decoder` (audio decoding), which is
licensed under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.txt).
Because of it, **the Android APK as a whole is distributed under GPL-3.0**. Its complete source is
this repository, and the decoder's version is set in `apps/android/android/variables.gradle`.

The Samsung and web versions don't include this library.

## Mac app: LGPL libraries

The Mac app plays video with **libmpv 0.36.0** (LGPL-2.1-or-later) and **FFmpeg 6.0**
(LGPL-3.0-or-later), from media-kit's prebuilt
[libmpv-darwin-build v0.7.3](https://github.com/media-kit/libmpv-darwin-build) ("full" decoders, no
GPL parts). They ship as separate, dynamically linked libraries in `Contents/Frameworks`, so the
app stays MIT and the libraries can be replaced. The app carries their licence texts and a list of
every bundled library and its licence in `Contents/Resources/licenses`
(`apps/desktop/licenses/NOTICE.txt`). The build pins the archive's SHA-256 in
`scripts/desktop-libmpv.mjs`.

## Windows app: LGPL libraries

The Windows app plays video with **libmpv 0.42** and FFmpeg, from zhongfly's LGPL build
([mpv-winbuild](https://github.com/zhongfly/mpv-winbuild), `mpv-dev-lgpl-x86_64`, built with
`-Dgpl=false`). It ships as one dynamically linked `libmpv-2.dll` next to the program, so the app
stays MIT and the library can be replaced. The archive's SHA-256 is pinned in
`scripts/desktop-libmpv.mjs`, and the licence texts travel in the installed app's `licenses` folder.

The window is [Tauri](https://tauri.app) (MIT or Apache-2.0), with Rust crates under MIT or
Apache-2.0, on both the Mac and Windows.

## Other libraries

| License | Libraries |
|---|---|
| Apache-2.0 | hls.js, mpegts.js, Material Symbols, AndroidX Media3 |
| SIL OFL 1.1 | Cairo, Outfit and Space Grotesk fonts |
| MIT | SolidJS, Capacitor, qrcode-generator and smaller dependencies |
| ISC | idb |
