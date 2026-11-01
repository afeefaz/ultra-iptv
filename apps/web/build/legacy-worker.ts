import { transformAsync } from '@babel/core';
import type { Plugin } from 'vite';

/**
 * @vitejs/plugin-legacy only transpiles the main bundle, and workers ignore build.target, so the
 * catalogue worker would ship modern syntax (?., catch {}) to Chrome 53. This lowers worker chunks
 * with the same Babel preset. It runs in generateBundle, after minification, because the minifier
 * otherwise turns lowered code back into `?.`.
 *
 * No polyfills are injected: worker code must stick to built-ins Chrome 53 has
 * (scripts/check-legacy.mjs flags the usual offenders).
 */
export function legacyWorker(): Plugin {
  return {
    name: 'ultra-legacy-worker',
    async generateBundle(_options, bundle) {
      for (const file of Object.keys(bundle)) {
        const chunk = bundle[file];
        if (chunk.type !== 'chunk') continue;
        const result = await transformAsync(chunk.code, {
          babelrc: false,
          configFile: false,
          compact: true,
          sourceMaps: false,
          presets: [['@babel/preset-env', { targets: 'chrome >= 53', modules: false, bugfixes: true }]],
        });
        if (result?.code) {
          chunk.code = result.code;
          chunk.map = null;
        }
      }
    },
  };
}
