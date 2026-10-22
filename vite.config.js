import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:single` bundles everything (including three.js) into one HTML file.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: mode === 'single'
    ? { outDir: 'dist-single', emptyOutDir: true, chunkSizeWarningLimit: 2000 }
    : { chunkSizeWarningLimit: 2000 },
}));
