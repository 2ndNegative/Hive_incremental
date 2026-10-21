# HiveIdle — The test suites

What `npm test` guarantees, how a suite is shaped, and why there is no framework under them.

The front door is [DESIGN.md](DESIGN.md).

## The test suites

Each one in `tests/` is a standalone script; most open a real browser, drive the real
game and print `PASS`/`FAIL` lines. There is no shared framework on purpose: a suite that
goes red can be run on its own with `node tests/<name>.mjs` and read top to bottom with no
indirection, which is how most of them got written.

```bash
npm test                  # build, serve, run all of them
npm test -- queue water   # just those two, by name
npm test -- --bail        # stop at the first red suite
npm test -- --jobs=1      # one at a time, for reading a failure in order
npm test -- --no-build    # against whatever dist/ already holds
npm run lint              # eslint over src, tools, tests and the configs
npm run validate          # the item database
npm run check             # lint, then validate, then the suites
npm run clean             # list the unreachable files in dist/assets (--delete to remove)
npm run needs-build       # 1 if the built outputs are stale, and which file said so
```

### What is in `tests/harness.mjs`, and why that is all

The suites share four things and no more. Each one exists because the copy-per-suite
version of it was wrong in some of the copies:

- **`checker()`** — `check(label, ok, detail)` and the `fail` array it fills. Twenty-four
  files held a byte-for-byte copy of those five lines.
- **`openPage(browser, options)`** — a page with its console *and* its `pageerror` watched.
  Both halves matter and one is easy to leave out: an uncaught exception in a Vue render
  never reaches `console`, so a suite that wired only the first looked like it was
  watching.
- **`settle(page)`** — wait for the screen to catch up, rather than for a number of
  milliseconds. Two hundred and three waits in these suites were `waitForTimeout` with
  something between 100 and 300 in it, and every one meant "Vue has not re-rendered yet".
  A clock is the wrong instrument for that: too long when the render took four
  milliseconds, which is nearly always, and too *short* exactly when it matters — on a
  loaded machine, which is now the normal case because the runner runs several suites at
  once. A suite that passes alone and fails in company is the worst kind of red.
  Two animation frames: the first lands after Vue has patched the DOM, the second after
  the browser has laid it out, which is what a suite measuring `getBoundingClientRect` is
  waiting for. `settle(page, ms)` keeps a real wait for the handful of cases that are
  about time passing — a CSS transition, or the live loop ticking at 100 ms.
- **`finish({ name, fail, errors, browser })`** — end the suite and make its verdict reach
  the runner. Nine suites used to fall off the end of the file, which in Node means exit
  code 0, so a suite could print `9 CHECK(S) FAILED` and be reported green; `rebuild-test`
  did exactly that across three feature changes. Browser errors are counted as failures
  for the same reason — twelve suites captured them and printed them as a footnote. And it
  takes the browser so a suite cannot exit with one still open.

Plus `BASE`, `LAUNCH`, `ensureLanded`, `openTab` and `shot` — the handful of facts a suite
needs about the world outside itself.

What `tests/run-all.mjs` guarantees, and why:

- **It builds and serves the game itself**, on port 4188 — not 4173 and not 5173, so a run
  started while `npm run dev` is open does not fight it for the port. A runner that assumed
  a server was already up would silently test a stale build, which is worse than testing
  nothing because it looks like it passed. `tests/harness.mjs` reads the URL from `HIVE_URL`,
  so a single suite can be pointed at a server you already have running instead.
- **It runs several at a time**, up to `cpus - 1`, capped at four. This used to say they
  had to run one at a time, because each suite clears `localStorage` for the origin and two
  at once would wipe each other mid-run — which is wrong, and cost about half the wall clock
  of every run until it was checked. A suite calls `chromium.launch()`, which starts its own
  browser process with its own temporary profile, so its storage is shared with nothing,
  same origin or not. Four suites were run at once against one server to confirm it before
  the runner was changed. `--jobs=1` puts it back, which is what to do when a failure needs
  reading in order; with more than one in flight the output arrives in *completion* order,
  so every line names its suite.
- **The order is cheap-and-foundational first**, so a break in something everything else
  depends on is the first line you read rather than the thirty-ninth. It is also the start
  order for the pool, and those two goals pull against each other — a forty-second suite
  started last is the tail the whole run waits on — so the long ones sit near the front
  whether or not anything depends on them. Anything not named in `ORDER` still runs, after
  those.
- **A dotfile is not a suite.** A throwaway `.probe.mjs`, written to reproduce a bug, got
  picked up as a suite called `.probe` and run on every `npm test` after.
- **It exits non-zero if anything is red**, and prints only the lines that say what went
  wrong — the suites print a `PASS` line per check and there are hundreds of them.

Playwright needs a browser. After `npx playwright install chromium` it finds its own and
nothing has to be configured. Set **`PW_CHROMIUM`** to an existing Chromium binary to point
it at that instead, for a machine that already ships one and does not want a second few
hundred megabytes downloaded.

`single-test.mjs` opens `HiveIdle.html`, so the runner rebuilds the portable one-file build
as well as `dist/` — otherwise it would be testing a version of the game nobody is running.
`tools/needs-build.mjs`, which the launcher uses to decide whether to rebuild, watches both
outputs and `tools/` for the same reason: it used to look only at `dist/index.html`, so a
repository with a fresh `dist/` and a six-commit-old portable build reported "nothing to
do" and `single-test` then tested stale bytes.

### The three that are about the player rather than the hive

- **`layout-test.mjs`** walks all ten tabs at four widths — 1480, 1100, 760 and 390 — and
  at each stop asks whether the page scrolls sideways, whether anything hangs off the
  right-hand edge, whether anything is clipped with nowhere to scroll, and whether the
  screen is still there at all. Everything else in the suite drives the game at 1480×1000,
  the one size that was ever looked at, so a panel that did not fit on a laptop and a table
  that pushed the page sideways on a phone were both invisible. It found three real faults
  the first time it ran. The fourth question is the cheapest to forget: a layout that
  collapses to nothing passes every geometric check ever written, because an empty box
  overflows nothing.
- **`access-test.mjs`** is the game without a mouse, and on a small window — see
  [The interface](INTERFACE.md). The rest of the suite drives the game with `page.click`,
  which is a mouse, so a tab bar with no roles and a dialog that does not take the keyboard
  read as perfectly fine to it.
- **`history-test.mjs`** loads a save from each era and checks that it still holds what it
  held. `save-test.mjs` round-trips a save written by this build, which proves v24 reads
  v24 — the one case that cannot break; there are twenty-two migrations in front of that
  and not one of them had ever run on anything but an empty object. The fixtures in
  `tests/fixtures/saves.mjs` are reconstructed rather than captured, since the builds that
  wrote a v4 save are gone, and that file says plainly what they can and cannot catch. The
  quiet failure they exist for is a hive that loads cleanly and comes back poorer.
