import { chromium } from 'playwright';
import { BASE, LAUNCH, ensureLanded, checker, openPage, finish, settle } from './harness.mjs';
import { HISTORICAL_SAVES, encodeSave } from './fixtures/saves.mjs';

/**
 * OLD SAVES STILL LOAD, AND STILL HOLD WHAT THEY HELD.
 *
 * `save-test.mjs` round-trips a save written by this build, which proves v24
 * reads v24 — the one case that cannot break. There are twenty-two migrations
 * in front of that, every one of them written against a hive nobody can open
 * any more, and until now not one of them had ever been run on anything but an
 * empty object in somebody's head.
 *
 * The claims:
 *   1. a save from each era loads at all — the migrations run, `assertLoadable`
 *      accepts the shape, and `mergeDefaults` does not reject it
 *   2. it loads WITHOUT REPAIRS. A migration that leaves a field in a shape the
 *      validator then has to fix is a migration that did not finish, and it
 *      reaches the player as a bug report rather than as a loaded hive
 *   3. everything the player had is still there. This is the quiet failure: a
 *      hive that loads cleanly and comes back poorer
 *   4. each migration produced what it is documented to produce — including the
 *      awkward ones, where the right answer is to THROW DATA AWAY (the
 *      pre-rewrite patches) or to multiply it by ten (the discovery counts)
 *   5. and the loaded hive then runs. A save that loads into a state the engine
 *      cannot tick is not a loaded save.
 *
 * Driven through `importSave` rather than by writing localStorage directly,
 * because that is the door a player's exported string comes through, and it is
 * the path that validates, migrates, merges and rolls back. See
 * tests/fixtures/saves.mjs for what the fixtures are and what they are not.
 */

const browser = await chromium.launch(LAUNCH);
const { check, fail } = checker();
const { page: p, errors } = await openPage(browser);

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
await settle(p);
await p.evaluate(() => hive.loop.stop());

const CURRENT = await p.evaluate(() => hive.saveVersion);
check('the build under test is at the version the fixtures were written against',
  CURRENT === 24, `v${CURRENT}`);

for (const fixture of HISTORICAL_SAVES) {
  console.log(`\n--- ${fixture.name} ---`);

  const encoded = encodeSave(fixture.state);

  /*
   * THE LOG IS READ AS WELL AS THE STATE. `importSave` reports a failure by
   * returning false AND pushing a line; `reportRepairs` reports a half-success
   * by pushing a line and returning nothing at all. Only the log can tell the
   * difference between "loaded" and "loaded, and here is what had to be fixed
   * on the way in", and the second one is the interesting answer.
   */
  const loaded = await p.evaluate(({ text, own }) => {
    hive.state.log.length = 0;
    const ok = hive.importSave(text);
    // The fixture's OWN log comes back with it — that is one of the things a
    // migration must not lose — so what the import had to say is whatever is
    // left once those lines are taken out.
    const mine = new Set(own);
    return {
      ok,
      lines: hive.state.log
        .filter((e) => !mine.has(e.text))
        .map((e) => `${e.type}: ${e.text}`),
      version: hive.state.version,
    };
  }, { text: encoded, own: (fixture.state.log ?? []).map((e) => e.text) });

  check(`${fixture.name}: loads`, loaded.ok === true,
    loaded.ok ? '' : loaded.lines.join(' | ') || 'importSave returned false silently');
  if (!loaded.ok) continue;

  check(`${fixture.name}: comes forward to v${CURRENT}`,
    loaded.version === CURRENT, `v${loaded.version}`);

  const repairs = loaded.lines.filter((l) => !/^info: Save imported/.test(l));
  check(`${fixture.name}: needed no repairs on the way in`,
    repairs.length === 0, repairs.join(' | '));

  // Pulled out once and inspected in node, so a failing expectation can say
  // which field and what was in it rather than just `false`.
  const after = await p.evaluate(() => JSON.parse(JSON.stringify(hive.state)));

  for (const [label, holds] of Object.entries(fixture.holds)) {
    let ok = false;
    let detail = '';
    try {
      ok = Boolean(holds(after));
    } catch (err) {
      detail = `threw: ${err.message}`;
    }
    check(`${fixture.name}: keeps ${label}`, ok, detail);
  }

  for (const [label, becomes] of Object.entries(fixture.becomes)) {
    let ok = false;
    let detail = '';
    try {
      ok = Boolean(becomes(after));
    } catch (err) {
      detail = `threw: ${err.message}`;
    }
    check(`${fixture.name}: gains ${label}`, ok, detail);
  }

  /*
   * AND IT RUNS. Ten minutes at one-second steps, through the real tick, which
   * is what catches a migrated field that is the right shape and the wrong
   * type — `"6"` where the engine wanted `6` does not throw on load, it
   * propagates into a NaN somewhere three systems away.
   */
  const ran = await p.evaluate(() => {
    const before = hive.state.playtime;
    try {
      hive.tick(600, 1);
    } catch (err) {
      return { threw: err.message };
    }
    const d = hive.derived();
    const numbers = [
      d.energy?.supply, d.energy?.demand, d.moldRate,
      ...Object.values(d.net ?? {}),
      ...Object.values(d.capsMax ?? {}),
    ];
    return {
      threw: null,
      advanced: hive.state.playtime - before,
      allFinite: numbers.every((n) => n === undefined || Number.isFinite(n)),
      worst: numbers.find((n) => n !== undefined && !Number.isFinite(n)),
    };
  });
  check(`${fixture.name}: ticks ten minutes without throwing`,
    ran.threw === null, ran.threw ?? '');
  check(`${fixture.name}: and the clock moved`, ran.advanced >= 590, `${ran.advanced}s`);
  check(`${fixture.name}: with no non-finite number anywhere in the derived state`,
    ran.allFinite === true, ran.allFinite ? '' : `found ${ran.worst}`);
}

/* ===================================== and a save from the FUTURE is refused */

/*
 * The other half of forward tolerance. A v999 save cannot be migrated — the
 * migrations only ever run forward — so loading one would silently drop
 * whatever a later build added and then overwrite it with the result. Better
 * to refuse it and leave the hive alone, which is what `assertLoadable` does;
 * this is the check that it still does.
 */
const future = await p.evaluate((text) => {
  const held = hive.state.playtime;
  hive.state.log.length = 0;
  const ok = hive.importSave(text);
  return { ok, untouched: hive.state.playtime === held, lines: hive.state.log.map((e) => e.text) };
}, encodeSave({ ...HISTORICAL_SAVES[0].state, version: 999 }));
check('a save from a newer build is refused', future.ok === false);
check('and says so, naming the version', /v999/.test(future.lines.join(' ')),
  future.lines.join(' | ').slice(0, 110));
check('and the hive that was open is still open', future.untouched);

await finish({ name: 'old saves', fail, errors, browser });
