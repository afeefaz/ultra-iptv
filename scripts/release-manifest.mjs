#!/usr/bin/env node
// Writes the files the apps' Check for updates read, for the release just built.
//   node scripts/release-manifest.mjs notes.json [apk]      Android: apps/relay/page/public/latest.json
//   node scripts/release-manifest.mjs --desktop notes.json  Mac: public/desktop/latest.json (ours, for the
//                                                           check) and public/desktop/update.json (Tauri's,
//                                                           for the install), after `pnpm desktop --release`
// notes.json: { "en": ["What changed"], "ar": ["ما الذي تغيّر"] }
// Then deploy the website (pnpm relay:deploy) after publishing the GitHub release: see docs/sideloading.md.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const desktop = args.includes('--desktop');
const [notesPath, apkPath = 'apps/android/android/app/build/outputs/apk/release/app-release.apk'] = args.filter((a) => a !== '--desktop');
if (!notesPath) {
  console.error('usage: node scripts/release-manifest.mjs [--desktop] notes.json [apk]');
  process.exit(1);
}
const notes = JSON.parse(readFileSync(notesPath, 'utf8'));
if (!notes.en?.length || !notes.ar?.length) {
  console.error('Needs notes in both languages.');
  process.exit(1);
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const release = (name) => `https://github.com/afeefaz/ultra-iptv/releases/download/v${versionName}/${name}`;

let versionName;
if (desktop) {
  versionName = JSON.parse(readFileSync('package.json', 'utf8')).version;
  // The same number the app works out from its version (src-tauri/src/updater.rs version_code).
  const [major, minor, patch] = versionName.split('.').map((n) => parseInt(n, 10) || 0);
  const versionCode = major * 1_000_000 + minor * 1000 + patch;
  const bundle = 'apps/desktop/src-tauri/target/release/bundle/macos/Ultra IPTV.app.tar.gz';
  const archive = readFileSync(bundle);
  const signature = readFileSync(`${bundle}.sig`, 'utf8').trim();
  // Published under these names: docs/sideloading.md, "Releasing the Mac app".
  const url = release('UltraIPTV-mac.app.tar.gz');
  mkdirSync('apps/relay/page/public/desktop', { recursive: true });
  const latest = { versionCode, versionName, url, sha256: sha256(archive), size: archive.length, notes };
  writeFileSync('apps/relay/page/public/desktop/latest.json', `${JSON.stringify(latest, null, 2)}\n`);
  const update = {
    version: versionName,
    notes: notes.en.join('\n'),
    pub_date: new Date().toISOString(),
    platforms: { 'darwin-aarch64': { url, signature } },
  };
  writeFileSync('apps/relay/page/public/desktop/update.json', `${JSON.stringify(update, null, 2)}\n`);
  console.log(`desktop/latest.json + update.json: ${versionName} (${versionCode}), ${archive.length} bytes`);
} else {
  const gradle = readFileSync('apps/android/android/app/build.gradle', 'utf8');
  const versionCode = Number(/versionCode (\d+)/.exec(gradle)?.[1]);
  versionName = /versionName "([^"]+)"/.exec(gradle)?.[1];
  if (!versionCode || !versionName) {
    console.error('Needs a version in build.gradle.');
    process.exit(1);
  }
  const apk = readFileSync(apkPath);
  const latest = { versionCode, versionName, url: release('UltraIPTV.apk'), sha256: sha256(apk), size: apk.length, notes };
  writeFileSync('apps/relay/page/public/latest.json', `${JSON.stringify(latest, null, 2)}\n`);
  console.log(`latest.json: ${versionName} (${versionCode}), ${apk.length} bytes`);
}
