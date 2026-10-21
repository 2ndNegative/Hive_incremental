#!/usr/bin/env node
/**
 * Prints 1 if the built outputs are older than the sources, 0 if they are
 * current. `--why` adds a line saying which file decided it.
 *
 * The launcher uses this so a normal start is instant, and a rebuild only
 * happens when something actually changed. Node is already required to run the
 * game, so leaning on it here keeps the batch file simple.
 *
 * BOTH OUTPUTS, which it used to get wrong. There are two builds — `dist/` for
 * the dev-ish launcher and `HiveIdle.html` for the portable one-file copy — and
 * this looked only at `dist/index.html`. So a repository whose `dist/` was
 * fresh and whose portable build was six commits old reported "nothing to do",
 * and `tests/single-test.mjs`, which opens that very file, then tested a
 * version of the game nobody was running. A test asserting against stale bytes
 * is worse than no test: it passes.
 *
 * AND `tools/`, for the same reason one step back. `build-single.mjs` IS the
 * portable build — it inlines the assets and strips the font links — so a
 * change to it changes the output while every watched source stays untouched.
 * That is exactly how the `__APP_VERSION__` fix shipped broken once.
 */

import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WATCH_DIRS = ['src', 'tools'];
const WATCH_FILES = ['index.html', 'package.json', 'vite.config.js'];
/** Every artefact a build produces that something later opens. */
const OUTPUTS = [path.join('dist', 'index.html'), 'HiveIdle.html'];

const why = process.argv.includes('--why');

/** The newest file under `target`, and which one it was. */
async function newest(target) {
  const info = await stat(target).catch(() => null);
  if (!info) return { at: 0, file: null };
  if (info.isFile()) return { at: info.mtimeMs, file: target };
  let best = { at: 0, file: null };
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const found = await newest(path.join(target, entry.name));
    if (found.at > best.at) best = found;
  }
  return best;
}

function say(stale, reason) {
  console.log(stale ? '1' : '0');
  if (why) console.error(reason);
  process.exit(0);
}

// Oldest output, because the staleness of the whole repository is the
// staleness of whichever build has fallen behind. An output that is missing
// entirely counts as infinitely old.
let oldest = { at: Infinity, file: null };
for (const out of OUTPUTS) {
  const info = await stat(path.join(root, out)).catch(() => null);
  if (!info) say(true, `${out} has never been built`);
  if (info.mtimeMs < oldest.at) oldest = { at: info.mtimeMs, file: out };
}

let source = { at: 0, file: null };
for (const target of [...WATCH_DIRS, ...WATCH_FILES]) {
  const found = await newest(path.join(root, target));
  if (found.at > source.at) source = found;
}

const stale = source.at > oldest.at;
say(stale, stale
  ? `${path.relative(root, source.file)} is newer than ${oldest.file}`
  : `${oldest.file} is current (newest source: ${path.relative(root, source.file ?? root)})`);
