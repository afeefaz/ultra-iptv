import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The pairing page: plain static files, served by the Worker. Nothing here runs on a server.
export default defineConfig({
  root: fileURLToPath(new URL('./page', import.meta.url)),
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
  },
});
