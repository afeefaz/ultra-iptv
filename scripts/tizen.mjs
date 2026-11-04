#!/usr/bin/env node
// Builds the Samsung TV package (web legacy build with relative paths → config.xml → .wgt).
//
//   node scripts/tizen.mjs     writes apps/tizen/dist-tizen/UltraIPTV.wgt
//
// The package is unsigned: Apps2Samsung (or Tizen Studio) signs it with your Samsung certificate
// when installing. See docs/sideloading.md.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(root, 'apps/tizen');
const out = join(appDir, 'dist-tizen');
const web = join(out, 'web');
const wgt = join(out, 'UltraIPTV.wgt');

const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
const run = (cmd, args, cwd = root) => {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd, env, stdio: 'inherit' });
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// Relative paths: the TV loads the page from the package, not from a web server root.
run('corepack', ['pnpm', 'exec', 'vite', 'build', '--config', 'apps/web/vite.config.ts', '--mode', 'legacy', '--base', './', '--outDir', web, '--sourcemap', 'false']);
run('node', ['scripts/check-legacy.mjs', web]);

// $WEBAPIS is resolved by the TV; it defines webapis.avplay and must load before the app.
const page = join(web, 'index.html');
const html = readFileSync(page, 'utf8');
if (!html.includes('<head>')) throw new Error('index.html has no <head>');
// Package files have no web origin, so a CORS-mode request for them (crossorigin) could be refused.
// color-scheme dark would paint a dark base under the page and hide the video plane.
writeFileSync(
  page,
  html
    .replace('<head>', '<head>\n    <script src="$WEBAPIS/webapis/webapis.js"></script>')
    .replace(/ crossorigin(?=[ >])/g, '')
    .replace(/\s*<meta name="color-scheme"[^>]*>/, ''),
);

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(join(web, 'config.xml'), readFileSync(join(appDir, 'config.xml'), 'utf8').replace('__VERSION__', version));
copyFileSync(join(appDir, 'icon.png'), join(web, 'icon.png'));

run('zip', ['-q', '-X', '-r', wgt, '.'], web);
console.log(`\nPackage: ${wgt}`);
