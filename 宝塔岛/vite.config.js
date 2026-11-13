import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// One self-contained HTML file: React, three.js, react-three-fiber and the post-processing are all inlined.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [viteSingleFile()],
  esbuild: { jsx: 'automatic' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 4000, assetsInlineLimit: 100000000 },
  server: { port: 4195 },
});
