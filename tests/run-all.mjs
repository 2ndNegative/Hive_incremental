#!/usr/bin/env node
/**
 * RUN EVERY SUITE. `npm test`.
 *
 *   npm test                  # build, serve, run all of them
 *   npm test -- queue water   # just those two
 *   npm test -- --no-build    # against whatever dist/ already holds
 *   npm test -- --bail        # stop at the first red suite
 *   npm test -- --jobs=1      # one at a time, for reading a failure in order
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
 *   — It runs SEVERAL AT A TIME, up to a limit taken from the machine. This
 *     file used to say they had to run one at a time, because each suite clears
 *     localStorage for the origin and two at once would wipe each other
 *     mid-run. That is wrong, and it cost about half the wall clock of every
 *     run since: a suite calls `chromium.launch()`, which starts its own
 *     browser process with its own temporary profile, so its storage is not
 *     shared with anything — same origin or not. Four suites were run at once
 *     against one server to check, before this was changed.
 *
 *     The limit is `cpus - 1`, capped at four and floored at two. These are
 *     browsers: the ceiling is not politeness, it is that a machine swapping
 *     makes every suite slower and some of them flaky, since a suite waiting
 *     200ms for a render is waiting on a clock rather than on the render.
 *     `--jobs=1` puts it back to one at a time, which is what to do when a
 *     failure needs reading in order.
 *
 *   — It EXITS NON-ZERO if anything is red, so CI and a human reading `echo $?`
 *     get the same answer. The one thing a test runner must never do is finish
 *     quietly after a failure.
 */

import { spawn, spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const wanted = args.filter((a) => !a.startsWith('--'));
const bail = flags.has('--bail');

/**
 * How many suites may be in flight at once.
 *
 * `--jobs=N`, then `HIVE_JOBS`, then the machine. One is a legitimate answer
 * and the one to use when reading a failure: with several in flight the output
 * arrives in completion order, so a suite's own lines are no longer adjacent to
 * the line announcing it.
 */
const jobsFlag = args.find((a) => a.startsWith('--jobs='));
const JOBS = Math.max(1, Number(
  jobsFlag?.slice('--jobs='.length)
  ?? process.env.HIVE_JOBS
  ?? Math.min(4, Math.max(2, cpus().length - 1)),
) || 1);

// A port of its own, not 4173 and not 5173, so a runner started while the
// author has `npm run dev` open does not fight them for it.
const PORT = Number(process.env.HIVE_TEST_PORT) || 4188;
const URL_BASE = `http://localhost:${PORT}`;

/**
 * The order is deliberate: cheap and foundational first, so a break in
 * something everything else depends on is the first thing you read rather than
 * the thirty-ninth. Anything not named here still runs, after these.
 *
 * IT IS ALSO THE START ORDER FOR THE POOL, and those two goals pull against
 * each other: a suite that takes forty seconds and is started last is the tail
 * the whole run waits on. So the long ones — `verify`, `landvalue`, `layout`,
 * `ui` — sit near the front whether or not anything depends on them, and the
 * ten-second ones fill in behind.
 */
const ORDER = [
  'verify', 'landvalue', 'layout', 'ui', 'smoke', 'storage', 'rebuild', 'save',
  'history', 'run', 'origin', 'territory',
  'single', 'treemap', 'cogit', 'topbar', 'drone', 'fuel', 'click', 'chamber',
  'mold', 'land', 'explore', 'adjacency', 'general', 'focus', 'queue', 'water',
  'codex', 'cost', 'insight', 'economy', 'power', 'scaffold', 'buildtime',
  'modifier', 'storagewall', 'access', 'genes', 'format',
];

const NOT_SUITES = new Set(['run-all.mjs', 'harness.mjs']);

/*
 * A SUITE IS A `.mjs` FILE HERE THAT IS NOT PART OF THE MACHINERY.
 *
 * Dotfiles are excluded, which is not housekeeping: a throwaway `.probe.mjs`
 * written to reproduce a bug got picked up as a suite called ".probe" and run
 * on every `npm test` after. A file whose name starts with a dot is a scratch
 * file by universal convention, and `tests/.last-failure-*.log` already lives
 * here on that understanding.
 *
 * `fixtures/` is a directory, so `readdirSync` lists it and the extension
 * filter drops it; nothing in it is ever executed on its own.
 */
const files = readdirSync(HERE)
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('.') && !NOT_SUITES.has(f));

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
// A server that never starts would otherwise show up as every suite
// timing out on their first selector, which is a long way to travel to learn
// that one process did not launch.
server.on('error', (err) => {
  console.error(`\ncould not start the preview server (${npx}): ${err.message}`);
  process.exit(1);
});

/*
 * AND A SERVER THAT STARTS AND THEN DIES IS A FAILURE TOO.
 *
 * `error` fires when the process cannot be SPAWNED. It does not fire when vite
 * starts, finds port 4188 already held — by a stale preview from a run that
 * was killed badly, which `--strictPort` guarantees it will refuse rather than
 * move past — and exits. The readiness probe then fetched the OLD server, got
 * a 200, and every suite ran against whatever build that server was serving.
 *
 * Which is precisely the failure the header of this file says the runner
 * exists to prevent: "a runner that assumed a server was already up would
 * silently test a stale build, which is worse than testing nothing because it
 * looks like it passed."
 */
let serverExited = null;
server.on('exit', (code, signal) => {
  if (!stopped) serverExited = `the preview server exited early (code ${code}, signal ${signal})`;
});

let stopped = false;
function stopServer() {
  if (stopped) return;
  stopped = true;
  try {
    // The whole process group on POSIX: `vite preview` spawns an esbuild child
    // that outlives a plain kill and then holds the port against the next run.
    if (process.platform !== 'win32' && server.pid) process.kill(-server.pid, 'SIGTERM');
    else if (server.pid) {
      // Windows has no process groups, and `shell: true` means `server` is a
      // cmd.exe that dies without taking vite or its esbuild child with it —
      // which then holds --strictPort against the next run, i.e. exactly the
      // stale-server failure above. taskkill /T walks the tree.
      spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else server.kill();
  } catch { /* already gone */ }
}
process.on('exit', stopServer);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopServer(); process.exit(130); });

async function waitForServer(timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    // Checked every pass, not once at the end: the moment the process we
    // started is gone, a 200 from this port is somebody else's server.
    if (serverExited) return serverExited;
    try {
      const res = await fetch(URL_BASE, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => { setTimeout(r, 250); });
  }
  return 'the preview server never came up';
}

process.stdout.write(`serving ${URL_BASE} … `);
const ready = await waitForServer();
if (ready !== true) {
  console.log(`FAILED — ${ready}`);
  if (serverExited) {
    console.log(`  Something else is probably holding port ${PORT}. --strictPort means vite`);
    console.log('  refuses to move, which is deliberate: the alternative is testing a stale build.');
  }
  process.exit(1);
}
console.log('ok\n');

/* ------------------------------------------------------------------- run */

const results = [];
const started = Date.now();

/** One suite, in its own process. Resolves with what it did; never rejects. */
function runSuite(suite) {
  const began = Date.now();
  return new Promise((done) => {
    const child = spawn(process.execPath, [suite.file], {
      cwd: HERE,
      env: { ...process.env, HIVE_URL: URL_BASE },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    // The five-minute cap, kept from the serial version. `spawn` has no
    // `timeout` option that reports the way `spawnSync` does, so it is a timer
    // and a recorded signal — otherwise a hung suite is an exit code of null
    // with no explanation, which is the hardest failure to read.
    let timedOut = false;
    const cap = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 5 * 60_000);

    child.on('error', (err) => {
      clearTimeout(cap);
      done({
        ...suite, ok: false, secs: '0',
        out: { stdout, stderr: `${stderr}\ncould not start the suite: ${err.message}`, status: null, signal: null },
      });
    });
    child.on('close', (status, signal) => {
      clearTimeout(cap);
      done({
        ...suite,
        ok: status === 0,
        secs: ((Date.now() - began) / 1000).toFixed(0),
        out: { stdout, stderr, status, signal: timedOut ? 'SIGKILL (runner cap)' : signal },
      });
    });
  });
}

/*
 * A POOL, NOT A WAVE.
 *
 * Suites are started in ORDER and reported as they FINISH, which are two
 * different sequences once more than one is in flight — so every line names
 * its suite rather than relying on the position it was announced at. With
 * `--jobs=1` the two sequences are the same and the output is exactly what it
 * always was.
 *
 * `--bail` stops STARTING new ones. It cannot stop the ones already running,
 * and killing them would throw away results that are nearly in hand for no
 * gain.
 */
let next = 0;

async function worker() {
  for (;;) {
    // Read off `results` rather than a flag a worker sets after an await: the
    // flag is the textbook lost-update, and "has anything failed yet" is
    // already recorded.
    if (next >= suites.length) return;
    if (bail && results.some((r) => !r.ok)) return;
    const suite = suites[next];
    next += 1;
    const result = await runSuite(suite);
    results.push(result);
    report(result);
  }
}

function report({ name, file, ok, out, secs }) {
  console.log(`  ${name.padEnd(12)} ${ok ? `ok   ${secs}s` : `FAIL ${secs}s`}`);
  const suite = { name, file };
  if (!ok) {
    // Only the lines that say what went wrong. The suites print a PASS line per
    // check and there are hundreds; dumping all of it buries the one that
    // matters. The full output is one `node tests/<name>.mjs` away.
    const text = `${out.stdout ?? ''}\n${out.stderr ?? ''}`;
    // `=== N CHECK(S) FAILED: … ===` is the suites' own summary of WHICH
    // checks failed, and the old filter missed it — `^FAIL` is anchored and
    // that line starts with `===`. Stack frames were dropped too.
    const interesting = text.split('\n')
      .filter((l) => /^FAIL|FAILURES|CHECK\(S\) FAILED|Error|error:|Timeout|^\s+at /.test(l.trim()))
      .slice(0, 25);
    for (const line of interesting) console.log(`      ${line.trim()}`);
    // A timeout kills the suite with no output at all and `status === null`,
    // so it has to be named rather than left as "(exit null)".
    if (out.signal || out.status === null) {
      console.log(`      killed after ${secs}s (${out.signal ?? 'no exit code'}) — `
        + 'the runner\'s five-minute cap, or a crash');
    }
    if (!interesting.length && !out.signal) {
      console.log(`      (exit ${out.status}; run it alone to see why)`);
    }
    // The whole thing is kept regardless, so a failure is never a thing you
    // have to reproduce before you can read it.
    writeFileSync(new URL(`../tests/.last-failure-${suite.name}.log`, import.meta.url), text);
    console.log(`      full output: tests/.last-failure-${suite.name}.log`);
  }
}

if (JOBS > 1) console.log(`  (${JOBS} at a time; --jobs=1 to run them in order)\n`);
await Promise.all(Array.from({ length: Math.min(JOBS, suites.length) }, worker));

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
