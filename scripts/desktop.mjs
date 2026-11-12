#!/usr/bin/env node
// Builds the Mac app (web build → Tauri bundle) or runs it against the dev server.
//
//   node scripts/desktop.mjs             "Ultra IPTV.app" (apps/desktop/src-tauri/target/release/bundle/macos)
//   node scripts/desktop.mjs --release   the same plus the .dmg and the signed update (needs the
//                                        updater key in ~/.ultra-iptv, docs/sideloading.md)
//   node scripts/desktop.mjs --debug     a debug build of the app (Web Inspector on, test hook)
//   node scripts/desktop.mjs --dev       run against the dev server on port 5181 (start it first:
//                                        pnpm exec vite --config apps/web/vite.config.ts --port 5181)
//
// Needs Rust (rustup) and the bundled libmpv (node scripts/desktop-libmpv.mjs, run here if missing).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dev = args.includes('--dev');
const debug = args.includes('--debug');
const release = args.includes('--release');
const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', PATH: `${join(homedir(), '.cargo/bin')}:${process.env.PATH}` };

const run = (cmd, cmdArgs, cwd = root, extraEnv = {}) => {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
  execFileSync(cmd, cmdArgs, { cwd, env: { ...env, ...extraEnv }, stdio: 'inherit' });
};

if (!existsSync(join(root, 'apps/desktop/src-tauri/vendor/libmpv/lib/libmpv.dylib'))) run('node', ['scripts/desktop-libmpv.mjs']);

const tauri = join(root, 'apps/desktop/node_modules/.bin/tauri');
const appDir = join(root, 'apps/desktop');
if (dev) {
  run(tauri, ['dev', '--no-watch'], appDir);
} else {
  // The modern build: the Mac's WebKit is recent (macOS 13+), no legacy bundle needed.
  // No source maps in anything shared: they would contain the source code.
  run('corepack', ['pnpm', 'exec', 'vite', 'build', '--config', 'apps/web/vite.config.ts', ...(debug ? [] : ['--sourcemap', 'false'])]);
  if (release) {
    // The update is signed with our updater key; the app only installs updates signed with it.
    const keyDir = join(homedir(), '.ultra-iptv');
    const key = join(keyDir, 'desktop-updater.key');
    if (!existsSync(key)) throw new Error(`No updater key at ${key} (see docs/sideloading.md)`);
    run(tauri, ['build', '--bundles', 'app,dmg'], appDir, {
      TAURI_SIGNING_PRIVATE_KEY: readFileSync(key, 'utf8'),
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: readFileSync(join(keyDir, 'desktop-updater.password'), 'utf8').trim(),
    });
  } else {
    // Everyday builds aren't signed for updating, so they need no key.
    run(tauri, ['build', ...(debug ? ['--debug'] : []), '--bundles', 'app', '--config', '{"bundle":{"createUpdaterArtifacts":false}}'], appDir);
  }
}
