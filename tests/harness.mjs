// WHAT EVERY SUITE NEEDS FROM OUTSIDE ITSELF, and nothing else.
//
// The suites are deliberately NOT built on a shared framework. Each one is a
// standalone script that opens a browser, drives the real game and prints
// PASS/FAIL lines, and that is worth keeping: a failing suite can be run on its
// own with `node tests/<name>.mjs` and read top to bottom with no indirection,
// which is how most of them got written in the first place.
//
// What they did share was three hard-coded facts about one particular machine —
// a port, a path to a Chromium binary, and an absolute import path. That is the
// whole of this file.

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Where the game is being served.
 *
 * `npm test` starts its own `vite preview` and sets this, so the usual case
 * needs no thought. Point it somewhere else to run a suite against a server you
 * already have up:
 *
 *   HIVE_URL=http://localhost:5173 node tests/queue-test.mjs
 */
export const BASE = process.env.HIVE_URL ?? 'http://localhost:4173';

/**
 * How to launch Chromium.
 *
 * Empty by default, which is what you want after `npx playwright install
 * chromium` — Playwright finds its own browser. `PW_CHROMIUM` overrides it for
 * environments that ship a browser somewhere else and do not want a second
 * copy downloaded.
 */
export const LAUNCH = process.env.PW_CHROMIUM
  ? { executablePath: process.env.PW_CHROMIUM }
  : {};

/** The repository root, whatever directory the suite was started from. */
export const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Where a suite's screenshots go: `tests/.shots/`, gitignored.
 *
 * Several suites take one at the end of a section. They are evidence for a
 * human reading a failure, not assertions, so they are never checked and never
 * committed — but a suite that cannot write one should not crash, hence the
 * directory is created on first use rather than assumed.
 */
export function shot(name) {
  const dir = new URL('.shots/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  return fileURLToPath(new URL(name, dir));
}

/**
 * Lands the hive on the first site a fresh save is offered, if the chooser is
 * up. Returns false when it was not — a suite that reloads mid-run calls this
 * again and should not care.
 *
 * Copied into most suites already; exported here for new ones.
 */
export async function ensureLanded(page) {
  const card = await page.$('.origin-card:not(.is-locked):not(.is-placeholder)');
  if (!card) return false;
  await card.click();
  await page.waitForSelector('.origin-backdrop', { state: 'detached', timeout: 5000 });
  return true;
}

/** Switch tabs by the label the player sees. */
export async function openTab(page, label) {
  await page.click(`.tab-bar button:text-is("${label}")`);
  await page.waitForTimeout(200);
}
