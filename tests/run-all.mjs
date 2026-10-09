#!/usr/bin/env node
/**
 * RUN EVERY SUITE. `npm test`.
 *
 *   npm test                  # build, serve, run all of them
 *   npm test -- queue water   # just those two
 *   npm test -- --no-build    # against whatever dist/ already holds
 *   npm test -- --bail        # stop at the first red suite
 *
 * WHY THIS EXISTS. The suites were written one at a time and run by hand, one
 * at a time, against a `vite preview` somebody remembered to start. That is
 * fine while there are three of them and a disaster at thirty-two: the only way
 * to know the game still worked was to type thirty-one commands and read the
 * output of each, so in practice nobody did, and a suite could sit red for days
 * without anyone noticing. A test you will not run is not a test.
 *
 * WHAT IT GUARANTEES, and the reason for each decision:
 *
 *   — It builds and serves the game ITSELF, on a port of its own. A runner that
 *     assumed a server was already up would silently test a stale build, which
 *     is worse than testing nothing because it looks like it passed.
 *
 *   — It runs them STRICTLY ONE AT A TIME. Every suite clears localStorage for
 *     the origin and then drives a fresh hive through it; two running at once
 *     on the same origin would wipe each other mid-run and fail at random. The
 *     price is wall-clock time, which is the right thing to spend here.
 *
 *   — It EXITS NON-ZERO if anything is red, so CI and a human reading `echo $?`
 *     get the same answer. The one thing a test runner must never do is finish
 *     quietly after a failure.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const wanted = args.filter((a) => !a.startsWith('--'));
const bail = flags.has('--bail');

// A port of its own, not 4173 and not 5173, so a runner started while the
// author has `npm run dev` open does not fight them for it.
const PORT = Number(process.env.HIVE_TEST_PORT) || 4188;
const URL_BASE = `http://localhost:${PORT}`;

/**
 * The order is deliberate: cheap and foundational first, so a break in
 * something everything else depends on is the first thing you read rather than
 * the twenty-ninth. Anything not named here still runs, after these.
 */
const ORDER = [
  'verify', 'smoke', 'storage', 'rebuild', 'save', 'run', 'origin', 'territory',
  'single', 'treemap', 'cogit', 'topbar', 'drone', 'fuel', 'click', 'chamber',
  'mold', 'land', 'explore', 'adjacency', 'general', 'focus', 'queue', 'water',
  'codex', 'cost', 'insight', 'economy', 'power', 'scaffold', 'buildtime',
  'modifier',
  'storagewall',
  'landvalue',
  'ui',
];

const files = readdirSync(HERE)
  .filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs' && f !== 'harness.mjs');

const nameOf = (file) => file.replace(/(-test)?\.mjs$/, '');
const suites = files
  .map((file) => ({ file, name: nameOf(file) }))
  .sort((a, b) => {
    const ai = ORDER.indexOf(a.name);
    const bi = ORDER.indexOf(b.name);
    return (ai < 0 ? ORDER.length : ai) - (bi < 0 ? ORDER.length : bi)
      || a.name.localeCompare(b.name);
  })
  .filter((s) => !wanted.length || wanted.includes(s.name));

if (!suites.length) {
  console.error(`No suite matches ${wanted.join(', ')}. Known: ${files.map(nameOf).join(', ')}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ build */

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/**
 * Windows needs a shell to launch npx, and that is not a style choice.
 *
 * `npx` on Windows is `npx.cmd`, a batch file, and since the fix for
 * CVE-2024-27980 Node REFUSES to spawn a .cmd or .bat without `shell: true`.
 * The refusal arrives as `result.error`, with `status` null and both output
 * streams empty — so a handler that prints stdout and stderr prints two blank
 * lines and the reason is simply gone. That is exactly how this failed: a log
 * reading `building (build)… FAILED` and nothing else, on a machine where
 * `npx vite build` typed by hand worked perfectly.
 */
const SHELL = process.platform === 'win32';

if (!flags.has('--no-build')) {
  // single-test.mjs opens HiveIdle.html, the portable one-file build, so that
  // has to be current too or it tests a version of the game nobody is running.
  for (const [label, cmd] of [['build', ['vite', 'build']], ['single', ['node', 'tools/build-single.mjs']]]) {
    process.stdout.write(`building (${label})… `);
    const bin = cmd[0] === 'node' ? process.execPath : npx;
    const rest = cmd[0] === 'node' ? cmd.slice(1) : cmd;
    // Only the npx path needs the shell; `node` is an executable Node can
    // spawn directly, and going through a shell would only add quoting risk.
    const out = spawnSync(bin, rest, {
      cwd: ROOT,
      encoding: 'utf8',
      shell: bin === npx ? SHELL : false,
    });
    if (out.status !== 0) {
      console.log('FAILED');
      // `error` FIRST and unconditionally. A process that never started has no
      // output at all, and printing only its streams turns the most common
      // failure on a fresh machine into a blank screen.
      if (out.error) console.log(`could not run ${bin}: ${out.error.message}`);
      console.log(out.stdout?.slice(-4000) ?? '');
      console.log(out.stderr?.slice(-4000) ?? '');
      process.exit(1);
    }
    console.log('ok');
  }
}

/* ------------------------------------------------------------------ serve */

const server = spawn(npx, ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
  shell: SHELL, // same .cmd rule as the build above
  detached: process.platform !== 'win32',
});
// A server that never starts would otherwise show up as thirty-two suites
// timing out on their first selector, which is a long way to travel to learn
// that one process did not launch.
server.on('error', (err) => {
  console.error(`\ncould not start the preview server (${npx}): ${err.message}`);
  process.exit(1);
});

let stopped = false;
function stopServer() {
  if (stopped) return;
  stopped = true;
  try {
    // The whole process group on POSIX: `vite preview` spawns an esbuild child
    // that outlives a plain kill and then holds the port against the next run.
    if (process.platform !== 'win32' && server.pid) process.kill(-server.pid, 'SIGTERM');
    else server.kill();
  } catch { /* already gone */ }
}
process.on('exit', stopServer);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopServer(); process.exit(130); });

async function waitForServer(timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(URL_BASE, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => { setTimeout(r, 250); });
  }
  return false;
}

process.stdout.write(`serving ${URL_BASE} … `);
if (!await waitForServer()) {
  console.log('FAILED — the preview server never came up');
  process.exit(1);
}
console.log('ok\n');

/* ------------------------------------------------------------------- run */

const results = [];
const started = Date.now();

for (const suite of suites) {
  const label = suite.name.padEnd(12);
  process.stdout.write(`  ${label} `);
  const began = Date.now();
  const out = spawnSync(process.execPath, [suite.file], {
    cwd: HERE,
    encoding: 'utf8',
    env: { ...process.env, HIVE_URL: URL_BASE },
    timeout: 5 * 60_000,
  });
  const secs = ((Date.now() - began) / 1000).toFixed(0);
  const ok = out.status === 0;
  results.push({ ...suite, ok, out, secs });
  console.log(ok ? `ok   ${secs}s` : `FAIL ${secs}s`);
  if (!ok) {
    // Only the lines that say what went wrong. The suites print a PASS line per
    // check and there are hundreds; dumping all of it buries the one that
    // matters. The full output is one `node tests/<name>.mjs` away.
    const text = `${out.stdout ?? ''}\n${out.stderr ?? ''}`;
    const interesting = text.split('\n')
      .filter((l) => /^FAIL|FAILURES|Error|error:|Timeout/.test(l.trim()))
      .slice(0, 10);
    for (const line of interesting) console.log(`      ${line.trim()}`);
    if (!interesting.length) console.log(`      (exit ${out.status}; run it alone to see why)`);
    if (bail) break;
  }
}

stopServer();

/* ---------------------------------------------------------------- report */

const red = results.filter((r) => !r.ok);
const mins = ((Date.now() - started) / 60_000).toFixed(1);
console.log(`\n${results.length - red.length}/${results.length} green in ${mins} min`);
if (red.length) {
  console.log(`red: ${red.map((r) => r.name).join(', ')}`);
  console.log(`\nRun one on its own for the full output:  node tests/${red[0].file}`);
}
process.exit(red.length ? 1 : 0);
