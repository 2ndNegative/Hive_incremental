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

/**
 * WAIT FOR THE SCREEN TO CATCH UP, rather than for a number of milliseconds.
 *
 * Two hundred and three of the waits in these suites were `waitForTimeout` with
 * something between 100 and 300 in it, and every one of them meant the same
 * thing: "Vue has not re-rendered yet." A clock is the wrong instrument for
 * that. It is too long when the render took four milliseconds, which is nearly
 * always, and too SHORT exactly when it matters — on a loaded machine, which is
 * now the normal case, because the runner runs several suites at once. A suite
 * that passes alone and fails in company is the worst kind of red.
 *
 * Two frames, because one is not enough. Vue flushes its render queue in a
 * microtask, so the first `requestAnimationFrame` callback runs after the DOM
 * has been patched; the second runs after the browser has laid that out, which
 * is what a suite measuring `getBoundingClientRect` is actually waiting for.
 *
 * `ms` is there for the handful of waits that are not about rendering at all —
 * a CSS transition, or the live game loop ticking at 100ms. Those are waits for
 * time passing, and time is the right instrument for them.
 */
export async function settle(page, ms = 0) {
  await page.evaluate(() => new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  }));
  if (ms > 0) await page.waitForTimeout(ms);
}

/**
 * A SUITE'S OWN TALLY: `check(label, ok, detail)` and the `fail` array it fills.
 *
 * Twenty-four files held a byte-for-byte copy of these five lines. That is not
 * expensive to maintain — it is a copy nobody has to touch — but it is five
 * lines of noise at the top of every suite before the first thing the suite is
 * actually about, and `check` is the one name every suite already shares. The
 * call sites read exactly as they did.
 *
 * Still per-suite state, not module state: `fail` belongs to the file that
 * made it, so a suite cannot be affected by another one, and the destructure
 * at the call site makes that obvious.
 */
export function checker() {
  const fail = [];
  const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) fail.push(label);
  };
  return { check, fail };
}

/**
 * Watch a page's console and collect anything that went wrong on it.
 *
 * Both halves matter and one of them is easy to leave out. `console` catches
 * what the game logged; `pageerror` catches what it THREW, which never reaches
 * `console` at all — an uncaught exception in a Vue render shows up only here.
 * A suite that wired one and not the other looked like it was watching.
 */
export function watch(page, errors = []) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/**
 * A watched page, which is the only kind a suite should be opening.
 *
 * `options` goes straight to `browser.newPage`, so a suite that needs a
 * particular window says `{ viewport: { width, height } }` exactly as it did
 * before — and anything else Playwright takes there keeps working without this
 * having to know about it.
 */
export async function openPage(browser, options = { viewport: { width: 1480, height: 1000 } }) {
  const page = await browser.newPage(options);
  return { page, errors: watch(page) };
}

/**
 * END A SUITE, AND MAKE ITS VERDICT REACH THE RUNNER.
 *
 * Every suite collects failed checks in an array and prints them. Nine of them
 * then fell off the end of the file, which in Node means exit code 0 — so a
 * suite could print "9 CHECK(S) FAILED" and the runner, which judges by exit
 * code and has no other way to judge, would report it green.
 *
 * That is not a hypothetical. `rebuild-test` had nine red assertions sitting
 * behind a green `npm run check` across three separate feature changes, and
 * the only reason anybody found out was a review that read the files instead
 * of running them. A test you cannot trust to fail is worse than no test: it
 * is a test plus a false sense of security.
 *
 * BROWSER ERRORS COUNT AS FAILURES, for the same reason. Twelve suites
 * captured `console.error` and `pageerror` and then printed them as a footnote
 * — so an exception could be thrown on every single tick and the suite would
 * still pass, having asserted nothing about it. A page that threw is a page
 * whose behaviour nobody has established, whatever the assertions above say.
 *
 * Takes the browser so the suite cannot exit with it still open, which is the
 * other thing that kept going wrong: a bare `await browser.close()` after the
 * last check leaks the process on any throw above it.
 */
export async function finish({ name, fail = [], errors = null, browser = null }) {
  const bad = [...fail];
  // `null` means this suite has no page to watch — the pure-node ones. An
  // EMPTY ARRAY means it watched one and nothing happened, which is worth
  // printing; "console errors: none" under a suite that never opened a browser
  // is a reassurance about something nobody checked.
  if (!Array.isArray(errors)) {
    // nothing to say
  } else if (errors.length) {
    console.log(`\nconsole errors (${errors.length}):`);
    for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
    if (errors.length > 8) console.log(`  …and ${errors.length - 8} more`);
    bad.push(`${errors.length} browser error${errors.length === 1 ? '' : 's'}`);
  } else {
    console.log('\nconsole errors: none');
  }

  console.log(bad.length
    ? `\n=== ${bad.length} CHECK(S) FAILED: ${bad.join('; ')} ===`
    : `\n=== ${name} verified ===`);

  // Closed before the exit, and never allowed to take the verdict with it: a
  // browser that refuses to close must not turn a red run green.
  if (browser) {
    try { await browser.close(); } catch (err) {
      console.log(`(browser did not close: ${err.message})`);
    }
  }
  process.exit(bad.length ? 1 : 0);
}
