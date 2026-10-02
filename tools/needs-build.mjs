#!/usr/bin/env node
/**
 * Prints 1 if dist/ is older than the sources, 0 if it is current.
 *
 * The launcher uses this so a normal start is instant, and a rebuild only
 * happens when something actually changed. Node is already required to run the
 * game, so leaning on it here keeps the batch file simple.
 */

import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WATCH_DIRS = ['src'];
const WATCH_FILES = ['index.html', 'package.json', 'vite.config.js'];

async function newestMtime(target) {
  let newest = 0;
  const info = await stat(target).catch(() => null);
  if (!info) return 0;
  if (info.isFile()) return info.mtimeMs;
  for (const entry of await readdir(target, { withFileTypes: true })) {
    newest = Math.max(newest, await newestMtime(path.join(target, entry.name)));
  }
  return newest;
}

const built = await stat(path.join(root, 'dist', 'index.html')).catch(() => null);
if (!built) {
  console.log('1'); // never built
  process.exit(0);
}

let newestSource = 0;
for (const dir of WATCH_DIRS) newestSource = Math.max(newestSource, await newestMtime(path.join(root, dir)));
for (const file of WATCH_FILES) newestSource = Math.max(newestSource, await newestMtime(path.join(root, file)));

console.log(newestSource > built.mtimeMs ? '1' : '0');
