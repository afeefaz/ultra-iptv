#!/usr/bin/env node
// Writes the file the app's Check for updates reads, for the release APK just built.
//   node scripts/release-manifest.mjs notes.json [apk]
// notes.json: { "en": ["What changed"], "ar": ["ما الذي تغيّر"] }
// Then deploy the website (pnpm relay:deploy) after publishing the GitHub release: see docs/sideloading.md.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [notesPath, apkPath = 'apps/android/android/app/build/outputs/apk/release/app-release.apk'] = process.argv.slice(2);
if (!notesPath) {
  console.error('usage: node scripts/release-manifest.mjs notes.json [apk]');
  process.exit(1);
}
const gradle = readFileSync('apps/android/android/app/build.gradle', 'utf8');
const versionCode = Number(/versionCode (\d+)/.exec(gradle)?.[1]);
const versionName = /versionName "([^"]+)"/.exec(gradle)?.[1];
const notes = JSON.parse(readFileSync(notesPath, 'utf8'));
if (!versionCode || !versionName || !notes.en?.length || !notes.ar?.length) {
  console.error('Needs a version in build.gradle, and notes in both languages.');
  process.exit(1);
}
const apk = readFileSync(apkPath);
const latest = {
  versionCode,
  versionName,
  url: `https://github.com/afeefaz/ultra-iptv/releases/download/v${versionName}/UltraIPTV.apk`,
  sha256: createHash('sha256').update(apk).digest('hex'),
  size: apk.length,
  notes,
};
writeFileSync('apps/relay/page/public/latest.json', `${JSON.stringify(latest, null, 2)}\n`);
console.log(`latest.json: ${versionName} (${versionCode}), ${apk.length} bytes`);
