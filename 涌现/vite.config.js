import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// One self-contained HTML file: three.js, the shaders and the font subset are all inlined.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [viteSingleFile()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000, assetsInlineLimit: 100000000 },
  server: { port: 4194 },
});
