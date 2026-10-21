#!/usr/bin/env node
/**
 * Build HiveIdle.html — one self-contained file you can double-click.
 *
 *   node tools/build-single.mjs
 *
 * WHY THIS EXISTS
 * A normal Vite build emits `<script type="module" src="...">`, and browsers
 * refuse to load external module scripts over file:// (opaque origin, CORS).
 * So this build does two things differently:
 *
 *   1. Emits a classic IIFE bundle instead of an ES module, which file:// is
 *      perfectly happy with.
 *   2. Inlines the JS, the CSS and the favicon into the HTML, so there is one
 *      file and no requests at all.
 *
 * The result runs with no Node, no server and no install — the browser alone.
 * Saves still work: localStorage is available on file:// and persists.
 *
 * The one caveat worth knowing: every file:// page in a browser shares a single
 * localStorage origin, so the portable build shares its save slot with any
 * other local HTML page that happens to use the same key. The launcher serves
 * over http://localhost instead, which gets its own isolated origin.
 */

import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.single-build');
const target = path.join(root, 'HiveIdle.html');

/** Text inlined into a <script> must not contain a literal closing tag. */
const escapeScript = (js) => js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const escapeStyle = (css) => css.replace(/<\/(style)/gi, '<\\/$1');

console.log('building single-file bundle…');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// `configFile: false` means NOTHING from vite.config.js applies here, which is
// deliberate — this build has its own output shape — but it also means every
// `define` has to be repeated. __APP_VERSION__ was not, and the portable build
// threw on boot: the header reads it during setup, so the whole app failed to
// mount. Anything added to `define` there belongs here too.
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

await build({
  root,
  configFile: false,
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [vue()],
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    // Inline every asset the bundler sees, so nothing is left beside the HTML.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      output: {
        // A classic script, not a module — this is the part that makes file:// work.
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});

let html = await readFile(path.join(outDir, 'index.html'), 'utf8');

// Inline the stylesheet.
const cssMatch = html.match(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
if (cssMatch) {
  const cssPath = path.join(outDir, cssMatch[1].replace(/^\.?\//, ''));
  const css = await readFile(cssPath, 'utf8');
  // Replacer FUNCTION, not a string: a string replacement expands $&, $1 and
  // friends, and minified bundles are full of `$&`. That silently splices the
  // matched tag into the middle of the code.
  html = html.replace(cssMatch[0], () => `<style>\n${escapeStyle(css)}\n</style>`);
}

// Inline the script.
const jsMatch = html.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>/);
if (!jsMatch) throw new Error('no bundled script tag found in the built HTML');
const jsPath = path.join(outDir, jsMatch[1].replace(/^\.?\//, ''));
const js = await readFile(jsPath, 'utf8');
// A module script is deferred until the document is parsed; a classic script is
// NOT. Leaving it in <head> would run the app before #app exists and paint a
// blank page with no error at all. So drop the original tag and re-insert the
// code as the last thing in <body>.
html = html.replace(jsMatch[0], () => '');
html = html.replace(
  '</body>',
  () => `  <script>\n${escapeScript(js)}\n  </script>\n</body>`,
);

// Inline the favicon so the file really is standalone.
const faviconSource = path.join(root, 'public', 'favicon.svg');
if (existsSync(faviconSource)) {
  const svg = await readFile(faviconSource, 'utf8');
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  html = html.replace(/href="\.?\/?favicon\.svg"/, () => `href="${dataUri}"`);
}

// A short note for anyone who opens the file in an editor.
html = html.replace(
  '<head>',
  () => `<head>\n    <!--\n      HiveIdle — self-contained build. No install, no server: open it in a browser.\n      Built ${new Date().toISOString()}. Regenerate with: node tools/build-single.mjs\n    -->`,
);

/*
 * THE WEB FONT GOES. It is the one thing in here that made "no requests at
 * all" untrue: a portable file opened on a plane fetched Lato from Google,
 * failed, and fell back — so the font was never reliable anyway, and the
 * request leaked which machine opened the file to a third party. The CSS has
 * carried 'Segoe UI', system-ui, sans-serif behind it from the beginning.
 */
const fontLinks = html.match(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g) ?? [];
for (const link of fontLinks) html = html.replace(link, '');

await writeFile(target, html, 'utf8');
await rm(outDir, { recursive: true, force: true });

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log(`\nwrote ${path.relative(root, target)}  (${kb} kB, everything inlined)`);
if (fontLinks.length) console.log(`dropped ${fontLinks.length} web-font link(s); the stack falls back to the system font`);

/*
 * AND THE CHECK FAILS RATHER THAN MUTTERING.
 *
 * It ran after the file was already written and printed a WARNING nobody was
 * going to read in a build that exited 0 — so a portable build that was not
 * portable shipped quietly. It also excluded `https:`, which is precisely the
 * category that breaks the promise. A file that still reaches outside itself
 * is not the artifact this script claims to produce, so the script says so and
 * exits non-zero; the file is left on disk to be inspected.
 */
const leftovers = html.match(/(src|href)="(?!data:|#)[^"]+"/g) ?? [];
if (leftovers.length) {
  console.error(`\nNOT PORTABLE: still reaches outside itself: ${leftovers.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('nothing outside the file is referenced — safe to move or copy anywhere');
}
console.log('=== single-file build finished ===');
