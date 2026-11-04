import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/dist-legacy/**', '**/dist-tizen/**', 'apps/*/dev/media/**', 'apps/android/android/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // Logs must go through the logger so redaction can't be bypassed (spec §10).
      'no-console': 'error',
    },
  },
  {
    files: ['packages/core/src/log/console-sink.ts', 'scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
