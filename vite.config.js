import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// ONE VERSION, FROM package.json. The header said v0.2 and the package said
// 0.1.0, which is two sources of truth for a string whose whole job is to
// identify which build somebody is looking at when they report something.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
