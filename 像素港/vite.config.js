import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// One HTML file. three.js stays external and is loaded through the page's import map (jsDelivr, r160).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000,
    rollupOptions: { external: (id) => id === 'three' || id.startsWith('three/addons/') },
  },
  server: { port: 4192 },
});
