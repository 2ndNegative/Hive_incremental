#!/usr/bin/env node
/**
 * THE WHOLE CHECK, AND A RECORD OF IT. `npm run check`.
 *
 * Lint, then the item database, then all the browser suites — the same three
 * things `npm run check` always ran, in the same order, stopping at the first
 * red one.
 *
 * WHY THIS IS A SCRIPT AND NOT THREE LINES OF SHELL. It used to be
 * `npm run lint && npm run validate && npm test`, which works and leaves
 * nothing behind. When a run failed on a machine the author could not see, the
 * only record was whatever was still on screen in a window that had probably
 * been closed — and "it said something about an error" is not a bug report.
 * Worse, on Windows the failure can happen in a shell that never shows the
 * output at all.
 *
 * So every run writes `check-log.txt` beside the project. Gitignored, one run
 * deep, overwritten each time. The console still gets everything live.
 *
 * WHY NODE AND NOT A .BAT. Three reasons, all learned the hard way:
 *
 *   — cmd has no `tee`, and piping through one breaks `errorlevel`: after a
 *     pipe it reports the exit code of the LAST command, so a failing lint
 *     piped into anything at all reads as a pass.
 *   — PowerShell has Tee-Object and also has an execution policy that blocks
 *     npm's own .ps1 shim on a default Windows install, so the obvious fix
 *     fails on exactly the machines that need it.
 *   — Node is already required to run any of this, so it is the one
 *     interpreter guaranteed to be there.
 *
 * It also calls the npm scripts through npm's platform-correct binary rather
 * than the bare name, for the same execution-policy reason.
 */

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOG = new URL('../check-log.txt', import.meta.url);
const log = createWriteStream(LOG, { flags: 'w' });

// npm.cmd on Windows, npm everywhere else. `npm` alone resolves to npm.ps1
// under PowerShell, which a default execution policy refuses to load.
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const both = (text) => {
  process.stdout.write(text);
  log.write(text);
};

/** Run one step, streaming to the console and the log. Resolves to its code. */
function step(label, args) {
  return new Promise((resolve) => {
    const banner = `\n${'='.repeat(62)}\n${label}\n${'='.repeat(62)}\n`;
    both(banner);
    const child = spawn(NPM, args, { cwd: ROOT, shell: process.platform === 'win32' });
    child.stdout.on('data', (d) => both(d.toString()));
    child.stderr.on('data', (d) => both(d.toString()));
    child.on('error', (err) => {
      // A spawn failure is its own kind of answer and the most likely one on a
      // fresh machine: npm not on PATH, or a shell refusing to launch it.
      both(`\nCould not start ${NPM}: ${err.message}\n`);
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const STEPS = [
  ['LINT', ['run', 'lint']],
  ['ITEM DATABASE', ['run', 'validate']],
  ['TEST SUITES', ['test']],
];

both(`HiveIdle check — ${new Date().toISOString()}\n`);
both(`node ${process.version} on ${process.platform}\n`);

let failed = null;
for (const [label, args] of STEPS) {
  const code = await step(label, args);
  if (code !== 0) { failed = { label, code }; break; }
}

if (failed) {
  both(`\n${'='.repeat(62)}\n${failed.label} FAILED (exit ${failed.code}).\n`);
  both('The output above says why. The whole run is in check-log.txt.\n');
  both(`${'='.repeat(62)}\n`);
} else {
  both(`\n${'='.repeat(62)}\nALL GREEN.\n${'='.repeat(62)}\n`);
}

// Let the log flush before the process goes away, or a crash report loses the
// last few lines — which are the ones that matter.
await new Promise((done) => { log.end(done); });
process.exit(failed ? 1 : 0);
