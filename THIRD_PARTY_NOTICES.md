# Third-party notices

The code in this repository is under the MIT License (see `LICENSE`). The apps also include
these libraries, under their own licenses.

## Android app: GPL-3.0

The Android APK includes `org.jellyfin.media3:media3-ffmpeg-decoder` (audio decoding), which is
licensed under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.txt).
Because of it, **the Android APK as a whole is distributed under GPL-3.0**. Its complete source is
this repository, and the decoder's version is set in `apps/android/android/variables.gradle`.

The Samsung and web versions don't include this library.

## Other libraries

| License | Libraries |
|---|---|
| Apache-2.0 | hls.js, mpegts.js, Material Symbols, AndroidX Media3 |
| SIL OFL 1.1 | Cairo, Outfit and Space Grotesk fonts |
| MIT | SolidJS, Capacitor and smaller dependencies |
| ISC | idb |
