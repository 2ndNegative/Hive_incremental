#!/usr/bin/env node
/**
 * WHAT IN `dist/assets/` IS STILL REACHABLE, and what is just taking up room.
 *
 * Every build writes `index-<hash>.js` and `.css` under a NEW name and nothing
 * removes the old one, so six builds in that folder is mostly files nothing can
 * reach. Harmless, until somebody is looking for the bundle that is live and
 * there are nine of them.
 *
 * THE RULE: a file is live if its name appears in `dist/index.html`. A
 * sourcemap is live if the file it belongs to is — `index.html` never names a
 * `.map`, so the extension is stripped before looking.
 *
 * Why this exists as a script when a batch file already did it: the rule above
 * was written in `cmd`, where it could not be read without counting
 * exclamation marks and could not be run at all on anything but Windows. The
 * rule is the part worth getting right, so it lives somewhere it can be read
 * and `npm run clean` can reach it. The batch file is still the front door on
 * Windows and is welcome to stay one.
 *
 * SAFE BY DEFAULT: it lists and exits. `--delete` is the only thing that
 * removes anything, and it only ever removes files under `dist/assets/` —
 * `dist/` is gitignored and Pages builds from source, so nothing here can
 * affect what is live even when it is wrong.
 */

import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(root, 'dist', 'index.html');
const ASSETS = path.join(root, 'dist', 'assets');

const doDelete = process.argv.includes('--delete');

const html = await readFile(INDEX, 'utf8').catch(() => null);
if (html === null) {
  // Not an error worth a non-zero exit: "there is nothing to measure against"
  // is a perfectly ordinary state for a fresh clone.
  console.log('No dist/index.html, so there is nothing to measure the rest against.');
  console.log('Run `npm run build` first.');
  process.exit(0);
}

const entries = await readdir(ASSETS, { withFileTypes: true }).catch(() => null);
if (!entries) {
  console.log('No dist/assets folder. Nothing to do.');
  process.exit(0);
}

const live = [];
const stale = [];
for (const entry of entries) {
  if (!entry.isFile()) continue;
  const needle = entry.name.endsWith('.map') ? entry.name.slice(0, -4) : entry.name;
  (html.includes(needle) ? live : stale).push(entry.name);
}

if (!stale.length) {
  console.log(`dist/assets is already clean — all ${live.length} file(s) are referenced.`);
  process.exit(0);
}

let bytes = 0;
for (const name of stale) {
  const info = await stat(path.join(ASSETS, name)).catch(() => null);
  bytes += info?.size ?? 0;
}
const mb = (bytes / 1024 / 1024).toFixed(1);

console.log(`Not referenced by dist/index.html (${stale.length} file(s), ${mb} MB):`);
for (const name of stale.sort()) console.log(`  ${name}`);
console.log(`\n${live.length} file(s) in use.`);

if (!doDelete) {
  console.log('\nNothing deleted. Pass --delete to remove them.');
  process.exit(0);
}

let gone = 0;
const stuck = [];
for (const name of stale) {
  try {
    await unlink(path.join(ASSETS, name));
    gone += 1;
  } catch (err) {
    stuck.push(`${name} (${err.code ?? err.message})`);
  }
}
console.log(`\nDeleted ${gone} of ${stale.length}.`);
if (stuck.length) {
  console.log('Still there — most likely open in another program:');
  for (const s of stuck) console.log(`  ${s}`);
}
// A file that could not be deleted is not a failed run: the folder is still
// smaller and the next attempt will get it. Only report it.
process.exit(0);
