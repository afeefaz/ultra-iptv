#!/usr/bin/env node
// Builds the Android APK (web legacy build → Capacitor sync → Gradle) and optionally installs it.
//
//   node scripts/android.mjs                 debug APK
//   node scripts/android.mjs --install       … and install on the connected device/emulator
//   node scripts/android.mjs --install -s emulator-5554   pick a device (adb serial)
//   node scripts/android.mjs --release       signed release APK, for sharing (docs/sideloading.md)
//
// Gradle needs Java 17–21; Android Studio's bundled JDK is used when JAVA_HOME isn't set.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const release = args.includes('--release');
const install = args.includes('--install');
const serialAt = args.indexOf('-s');
const serial = serialAt >= 0 ? args[serialAt + 1] : undefined;

const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
const studioJdk = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
if (!env.JAVA_HOME && existsSync(studioJdk)) env.JAVA_HOME = studioJdk;

const run = (cmd, cmdArgs, cwd = root) => {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
  execFileSync(cmd, cmdArgs, { cwd, env, stdio: 'inherit' });
};

if (release) {
  // No source maps in anything shared publicly: they would contain the source code.
  run('corepack', ['pnpm', 'exec', 'vite', 'build', '--config', 'apps/web/vite.config.ts', '--mode', 'legacy', '--sourcemap', 'false']);
  run('node', ['scripts/check-legacy.mjs', 'apps/web/dist-legacy']);
} else {
  run('corepack', ['pnpm', 'build:legacy']);
}
run('corepack', ['pnpm', 'exec', 'cap', 'sync', 'android'], join(root, 'apps/android'));
run('./gradlew', [release ? 'assembleRelease' : 'assembleDebug', '--console=plain', '-q'], join(root, 'apps/android/android'));

const apk = join(
  root,
  'apps/android/android/app/build/outputs/apk',
  release ? 'release/app-release.apk' : 'debug/app-debug.apk',
);
console.log(`\nAPK: ${apk}`);
if (install) run('adb', [...(serial ? ['-s', serial] : []), 'install', '-r', apk]);
