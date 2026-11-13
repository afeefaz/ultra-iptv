#!/usr/bin/env node
// Fetches the libmpv the Mac app bundles into apps/desktop/src-tauri/vendor/libmpv (gitignored).
//
//   node scripts/desktop-libmpv.mjs             the Mac's (vendor/libmpv)
//   node scripts/desktop-libmpv.mjs --windows   Windows x64 (vendor/libmpv-win/libmpv-2.dll)
//
// The libraries are media-kit's LGPL "video-full" macOS arm64 build (mpv 0.36.0, FFmpeg 6.0 with
// every decoder, LGPL-3.0: https://github.com/media-kit/libmpv-darwin-build), checked against a
// pinned SHA-256. The headers are mpv's own, from the same release. Windows: zhongfly's LGPL
// x86_64 build (mpv 0.42, -Dgpl=false: https://github.com/zhongfly/mpv-winbuild), one DLL with
// everything built in, also pinned by SHA-256. Build time only: the app
// itself never downloads anything but its own updates.
/* global fetch, Buffer */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'apps/desktop/src-tauri/vendor/libmpv');

const LIBS = {
  url: 'https://github.com/media-kit/libmpv-darwin-build/releases/download/v0.7.3/libmpv-libs_v0.7.3_macos-arm64-video-full.tar.gz',
  sha256: '9bb168ec908b4801f4231f411e3278a0aea644a2b03ce375c880d2813ab7f949',
};
const MPV_TAG = 'v0.36.0';
const HEADERS = ['client.h', 'render.h', 'render_gl.h'];

const WINDOWS = {
  url: 'https://github.com/zhongfly/mpv-winbuild/releases/download/2026-11-13-fe753a7824/mpv-dev-lgpl-x86_64-20261113-git-fe753a7824.7z',
  sha256: 'd4f9e4ae675685d1a35d926aac65573cc05e71ea7391c344a91f325f73e4386e',
};

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

if (process.argv.includes('--windows')) {
  const dir = join(root, 'apps/desktop/src-tauri/vendor/libmpv-win');
  const winStamp = join(dir, 'VERSION');
  if (existsSync(winStamp) && readFileSync(winStamp, 'utf8').trim() === WINDOWS.sha256) {
    console.log('libmpv for Windows already in place:', dir);
    process.exit(0);
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  console.log('Downloading libmpv for Windows…');
  const archive = await get(WINDOWS.url);
  if (sha(archive) !== WINDOWS.sha256) throw new Error(`libmpv (Windows) archive checksum mismatch: ${sha(archive)}`);
  const file = join(dir, 'dev.7z');
  writeFileSync(file, archive);
  // bsdtar reads 7z on the Mac; Windows' tar may not, so 7-Zip (on GitHub's runners) is the fallback.
  try {
    execFileSync('tar', ['-xf', file, '-C', dir, 'libmpv-2.dll']);
  } catch {
    execFileSync('7z', ['e', file, `-o${dir}`, 'libmpv-2.dll', '-y']);
  }
  rmSync(file);
  if (!existsSync(join(dir, 'libmpv-2.dll'))) throw new Error('libmpv-2.dll not found in the archive');
  writeFileSync(winStamp, `${WINDOWS.sha256}\n`);
  console.log('libmpv for Windows ready:', join(dir, 'libmpv-2.dll'));
  process.exit(0);
}

const stamp = join(vendor, 'VERSION');
if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === `${LIBS.sha256} ${MPV_TAG}`) {
  console.log('libmpv already in place:', vendor);
  process.exit(0);
}

rmSync(vendor, { recursive: true, force: true });
mkdirSync(join(vendor, 'lib'), { recursive: true });
mkdirSync(join(vendor, 'include/mpv'), { recursive: true });

console.log('Downloading libmpv…');
const archive = await get(LIBS.url);
if (sha(archive) !== LIBS.sha256) throw new Error(`libmpv archive checksum mismatch: ${sha(archive)}`);
const tarPath = join(vendor, 'libs.tar.gz');
writeFileSync(tarPath, archive);
execFileSync('tar', ['-xzf', tarPath, '-C', join(vendor, 'lib')]);
rmSync(tarPath);
// The archive holds one folder; flatten it.
for (const dir of readdirSync(join(vendor, 'lib'))) {
  const inner = join(vendor, 'lib', dir);
  if (!dir.endsWith('.dylib')) {
    for (const f of readdirSync(inner)) renameSync(join(inner, f), join(vendor, 'lib', f));
    rmSync(inner, { recursive: true });
  }
}

for (const h of HEADERS) {
  writeFileSync(join(vendor, 'include/mpv', h), await get(`https://raw.githubusercontent.com/mpv-player/mpv/${MPV_TAG}/libmpv/${h}`));
}

// The licences that travel with the app (THIRD_PARTY_NOTICES.md lists the sources).
writeFileSync(stamp, `${LIBS.sha256} ${MPV_TAG}\n`);
console.log('libmpv ready:', readdirSync(join(vendor, 'lib')).join(', '));
