import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  // Relative base so the built game also runs from a file:// path or a
  // project subfolder on GitHub Pages, the way Evolve is hosted.
  base: './',
  plugins: [vue()],
  server: {
    port: 4400,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
