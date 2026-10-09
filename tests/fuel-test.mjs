import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * One fuel at a time, and a cooldown before changing back.
 *
 * The bug this is about: a generator whose preferred store is nearly empty
 * would take a crumb of it, run out, top up from the fallback, and do the whole
 * thing again on the next tick — ten times a second, forever, while digestion
 * dripped more crumbs in. Every number was correct and the screen was unusable.
 *
 * The rule now: a generator burns ONE store per step, flees an empty one
 * immediately, and waits out FUEL_SWITCH_SECONDS before it is allowed to go
 * back up its preference list — and only then for a store holding at least a
 * second of work.
 */

async function ensureLanded(page) {
  const card = await page.$('.origin-card:not(.is-locked):not(.is-placeholder)');
  if (!card) return false;
  await card.click();
  await page.waitForSelector('.origin-backdrop', { state: 'detached', timeout: 5000 });
  return true;
}

const base = BASE;
const browser = await chromium.launch(LAUNCH);

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};

const errors = [];
const p = await browser.newPage({ viewport: { width: 1480, height: 1000 } });
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await p.goto(base, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
await p.waitForTimeout(250);
await p.evaluate(() => hive.loop.stop());

const KEY = 'structure:metabolicGenerator';

/** A hive with one generator, room for both fuels, and nothing else running. */
async function fixture(carb, fat) {
  return p.evaluate(({ c, f, key }) => {
    const s = hive.state;
    s.structures.glycogenGranule = 200; // 40 kg of carbohydrate room
    s.structures.lipidDroplet = 200; // 40 kg of fat room
    s.structures.metabolicGenerator = 1; // 10 g/s
    s.structures.hivecore = 1;
    s.nutrients.carb = c;
    s.nutrients.fat = f;
    s.fuelLock = {};
    s.energyPool = 0;
    // Stated outright rather than leaning on the hive default, which is fat
    // first now: this block is about the SWITCHING, so which two fuels it
    // switches between has to be the fixture's decision and not a default's.
    s.energy.preferred = 'carb';
    s.energy.fallback = 'fat';
    delete s.energy.overrides[key];
    hive.tick(0.1);
    return hive.fuelLock(key);
  }, { c: carb, f: fat, key: KEY });
}

/* ================================================= 1. the preference still holds */

const rich = await fixture(10_000, 10_000);
check('a generator with both stores full burns the preferred one',
  rich.on === 'carb', `on ${rich.on}`);

const seconds = await p.evaluate(() => hive.fuelSwitchSeconds);
check('the cooldown is ten seconds', seconds === 10, `${seconds}s`);

/* ================================================== 2. one fuel, never a blend */

const blend = await p.evaluate(() => {
  const s = hive.state;
  s.nutrients.carb = 2; // a fifth of a second of work
  s.nutrients.fat = 10_000;
  s.fuelLock = {};
  hive.tick(1);
  const g = hive.derived().generators[0];
  return { drew: Object.keys(g.drew), using: g.using };
});
check('a step never draws on two stores at once',
  blend.drew.length <= 1, `drew from ${blend.drew.join(' + ') || 'nothing'}`);

/* ============================================ 3. fleeing an empty store is free */

// Three seconds of carbohydrate, then nothing. NINETY grams, not thirty: sugar
// goes through a generator at three times the rate of anything else now, so a
// 10 g/s generator pointed at it is really eating 30 g/s.
await fixture(90, 10_000);
const fled = await p.evaluate(() => {
  const out = [];
  for (let i = 0; i < 8; i += 1) {
    hive.tick(1);
    out.push(hive.fuelLock('structure:metabolicGenerator').on);
  }
  return out;
});
check('a generator leaves an emptied store at once, without waiting',
  fled.slice(0, 3).every((n) => n === 'carb') && fled[4] === 'fat',
  fled.join(' → '));

/* ======================================== 4. and does NOT come straight back */

// The exact shape of the old bug: the preferred store refilling a crumb at a
// time while the generator is on its fallback.
const drip = await p.evaluate(() => {
  const s = hive.state;
  s.nutrients.carb = 0;
  s.nutrients.fat = 100_000;
  s.fuelLock = { 'structure:metabolicGenerator': { on: 'fat', hold: 10 } };
  const seen = [];
  let switches = 0;
  let last = 'fat';
  for (let i = 0; i < 300; i += 1) {
    s.nutrients.carb += 0.05; // a drip, as digestion would deliver it
    hive.tick(0.1);
    const on = hive.fuelLock('structure:metabolicGenerator').on;
    if (on !== last) { switches += 1; last = on; }
    seen.push(on);
  }
  return { switches, ended: last, carb: s.nutrients.carb };
});
check('a trickle into the preferred store does not pull it back every tick',
  drip.switches <= 4, `${drip.switches} changes over 30s of dripping`);

// The same thirty seconds without the cooldown would have been three hundred.
check('and the crumbs are left alone rather than burned as they land',
  drip.carb > 1, `${drip.carb.toFixed(2)} g of carbohydrate accumulated`);

/* ========================================= 5. but it does go back, eventually */

const back = await p.evaluate(() => {
  const s = hive.state;
  s.nutrients.carb = 0;
  s.nutrients.fat = 100_000;
  s.fuelLock = { 'structure:metabolicGenerator': { on: 'fat', hold: 10 } };
  hive.tick(1);
  const early = hive.fuelLock('structure:metabolicGenerator');
  s.nutrients.carb = 5_000; // a full tank arrives
  hive.tick(1);
  const held = hive.fuelLock('structure:metabolicGenerator');
  hive.tick(10); // past the cooldown
  const after = hive.fuelLock('structure:metabolicGenerator');
  return { early: early.on, held: held.on, hold: held.hold, after: after.on };
});
check('a full preferred store does not interrupt the cooldown',
  back.held === 'fat' && back.hold > 0, `${back.held}, ${back.hold.toFixed(1)}s left`);
check('and once it expires the generator goes back to its preferred fuel',
  back.after === 'carb', `on ${back.after}`);

/* ================================================ 6. an override is obeyed */

const override = await p.evaluate(() => {
  const s = hive.state;
  s.nutrients.carb = 10_000;
  s.nutrients.fat = 10_000;
  s.fuelLock = {};
  hive.setFuelOverride('structure:metabolicGenerator', 'fat', 'carb');
  hive.tick(1);
  const g = hive.derived().generators[0];
  return { on: hive.fuelLock('structure:metabolicGenerator').on, overridden: g.overridden };
});
check('a per-generator override still decides which store is preferred',
  override.on === 'fat' && override.overridden, `on ${override.on}`);
await p.evaluate(() => hive.clearFuelOverride('structure:metabolicGenerator'));

/* ============================== 6b. being TOLD to change is not changing its mind */

const told = await p.evaluate(() => {
  const s = hive.state;
  s.nutrients.carb = 10_000;
  s.nutrients.fat = 10_000;
  s.fuelLock = {};
  hive.tick(1);
  const before = hive.fuelLock('structure:metabolicGenerator');
  // Mid-cooldown, the player picks the other store.
  s.fuelLock['structure:metabolicGenerator'] = { on: 'carb', hold: 9 };
  hive.setGlobalFuel('fat', 'carb');
  const cleared = hive.fuelLock('structure:metabolicGenerator');
  hive.tick(1);
  return { before: before.on, clearedHold: cleared.hold, after: hive.fuelLock('structure:metabolicGenerator').on };
});
check('changing the fuel by hand drops the cooldown instead of waiting it out',
  told.clearedHold === 0 && told.after === 'fat',
  `${told.before} → ${told.after}, ${told.clearedHold}s held`);
await p.evaluate(() => hive.setGlobalFuel('carb', 'fat'));

/* ================================================= 7. the screen says so */

await p.click('.tab-bar button:text-is("Metabolism")');
await p.waitForTimeout(250);
await p.evaluate(() => {
  const s = hive.state;
  s.nutrients.carb = 0;
  s.nutrients.fat = 100_000;
  s.fuelLock = { 'structure:metabolicGenerator': { on: 'fat', hold: 8 } };
  s.nutrients.carb = 5_000;
  hive.tick(0.1);
});
await p.waitForTimeout(250);
const shown = await p.evaluate(() => {
  const row = [...document.querySelectorAll('.fuel-row')].find((r) =>
    /Metabolic Generator/.test(r.innerText),
  );
  return row?.innerText.replace(/\s+/g, ' ').trim() ?? '';
});
check('the Metabolism tab says it is on its fallback and for how long',
  /on its fallback for another \d+s/.test(shown), shown.slice(0, 120));

/* ================================================== 8. a save keeps the lock */

const saved = await p.evaluate(() => {
  hive.save();
  const key = Object.keys(localStorage).find((k) => /hive/i.test(k));
  const raw = JSON.parse(localStorage.getItem(key));
  const state = raw?.state ?? raw;
  return { version: state?.version, lock: state?.fuelLock?.['structure:metabolicGenerator'] };
});
const SAVE_VERSION = await p.evaluate(() => hive.saveVersion);
check('the lock round-trips through a save',
  saved.lock?.on === 'fat' && typeof saved.lock.hold === 'number', JSON.stringify(saved.lock));
check('at the current save version', saved.version === SAVE_VERSION, `v${saved.version}`);

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
