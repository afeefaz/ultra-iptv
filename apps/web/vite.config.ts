import legacy from '@vitejs/plugin-legacy';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import rtlcss from 'postcss-rtlcss';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { legacyWorker } from './build/legacy-worker.ts';
import { devFixtures } from './dev/fixtures.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

// `--mode legacy` builds the bundle used on TVs and Android (spec §3.1): Chrome 53 target,
// no ES modules, polyfills for what the code actually uses.
export default defineConfig(({ mode }) => {
  const isLegacy = mode === 'legacy';
  return {
    root,
    plugins: [
      solid(),
      devFixtures(),
      isLegacy &&
        legacy({
          targets: ['chrome >= 53'],
          renderModernChunks: false,
        }),
    ],
    css: {
      postcss: { plugins: [rtlcss()] },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      __LEGACY__: JSON.stringify(isLegacy),
    },
    // The catalogue worker is a classic script (Chrome 53 has no module workers), lowered by Babel
    // in legacy mode (see build/legacy-worker.ts); check-legacy verifies the result.
    worker: {
      format: 'iife',
      plugins: () => (isLegacy ? [legacyWorker()] : []),
    },
    build: {
      outDir: isLegacy ? 'dist-legacy' : 'dist',
      emptyOutDir: true,
      sourcemap: true,
      cssTarget: isLegacy ? 'chrome53' : undefined,
      // hls.js is one ~580 kB chunk, loaded only when HLS playback starts.
      chunkSizeWarningLimit: 700,
    },
    preview: {
      port: isLegacy ? 4174 : 4173,
    },
  };
});
