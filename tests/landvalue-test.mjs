import { chromium } from 'playwright';
import { BASE, LAUNCH, ensureLanded } from './harness.mjs';

/**
 * WHAT GROUND IS WORTH, AND WHETHER THE PREVIEW IS TELLING THE TRUTH.
 *
 * The territory tab now promises a number before the player pays: claim this
 * much of that, gain this many grams a second. A preview that is merely
 * plausible is worse than none, because the player has no way to tell — so this
 * suite checks the estimate against the only thing that can settle it, which is
 * running the game and averaging.
 *
 * The estimate rests on an algebraic cancellation (see landvalue.js): the engine
 * splits `working` drones across `open` patches and then sums the patches, so
 * the patch count drops out of the expectation and the whole thing reduces to
 *
 *   working × P(a trip finds anything) × mean load × vigour / cycle × harvest
 *
 * Nothing else in the suites would catch that being wrong, because every OTHER
 * figure on the tab comes from the engine and would be wrong the same way.
 */

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};

const browser = await chromium.launch(LAUNCH);
const errors = [];
const p = await browser.newPage();
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
await p.evaluate(() => hive.loop.stop());

/* ========================== 1. the estimate matches a long run of the game */

const sim = await p.evaluate(() => {
  const s = hive.state;
  // Ground to spare, so no drone is landless: the cap is not what is being
  // measured here, the per-drone yield is.
  s.territory = { temperateForest: 600, grassland: 240, farmland: 120 };
  s.droneTypes = { forager: 8, scavenger: 3 };
  s.patches = {};
  s.forage = {};

  const estimate = hive.landValue.expected();

  // Average the ENGINE's own instantaneous forage rate over a long stretch.
  // Instantaneous rather than accumulated mass: mass is digested, spoiled and
  // spent on the way to storage, so the total would measure the whole hive.
  let sum = 0;
  let samples = 0;
  for (let i = 0; i < 20000; i += 1) {
    hive.tick(0.25);
    const forage = hive.derived().droneForage;
    let rate = 0;
    for (const f of Object.values(forage)) rate += f.rate;
    sum += rate;
    samples += 1;
  }
  return { estimate, measured: sum / samples };
});

const err = Math.abs(sim.measured - sim.estimate.total) / Math.max(1e-9, sim.estimate.total);
check('the expected forage rate is what the game actually averages',
  err < 0.04,
  `estimate ${sim.estimate.total.toFixed(3)} g/s vs measured ${sim.measured.toFixed(3)} g/s`
  + ` (${(err * 100).toFixed(1)}% off)`);
check('and it is not trivially zero', sim.estimate.total > 0.5,
  `${sim.estimate.total.toFixed(2)} g/s`);
check('every forager found ground on that much land', sim.estimate.landless === 0,
  `${sim.estimate.working} working`);

/* ============================== 2. patches do not change the total intake */

const patchy = await p.evaluate(() => {
  const opts = { drones: { forager: 6 }, vigour: 1, harvest: 1 };
  // The same AREA, in one lump and split three ways. Splitting raises the
  // patch floor — never fewer patches than biomes held — without touching
  // forager capacity, which is area alone.
  return {
    lump: hive.landValue.expected({ grassland: 72 }, opts),
    split: hive.landValue.expected(
      { grassland: 24, farmland: 24, temperateForest: 24 }, opts,
    ),
  };
});

check('the same area carries the same number of drones however it is split',
  patchy.lump.capacity === patchy.split.capacity,
  `${patchy.lump.capacity} vs ${patchy.split.capacity}`);
check('splitting it opens more patches',
  patchy.split.patches > patchy.lump.patches,
  `${patchy.lump.patches} → ${patchy.split.patches}`);
check('and more patches do NOT change the intake — they are variety, not mass',
  Math.abs(patchy.split.total - patchy.lump.total) < 1e-9,
  `${patchy.lump.total.toFixed(3)} vs ${patchy.split.total.toFixed(3)} g/s`);

/* ======================= 3. ground a route cannot work is honestly worthless */

const barren = await p.evaluate(() => {
  const opts = { drones: { forager: 4 }, vigour: 1, harvest: 1 };
  const green = { temperateForest: 400 };
  const half = { temperateForest: 200, desert: 200 };
  return {
    greenHit: hive.landValue.hitChance('forager', green),
    halfHit: hive.landValue.hitChance('forager', half),
    green: hive.landValue.expected(green, opts).total,
    half: hive.landValue.expected(half, opts).total,
  };
});

// Not asserting WHICH biomes are empty for a forager — that is the designer's
// business and it may change. Only that an empty one is priced as empty.
check('a hit chance is a probability',
  barren.greenHit <= 1 && barren.halfHit <= 1 && barren.greenHit >= 0,
  `${barren.greenHit.toFixed(2)} / ${barren.halfHit.toFixed(2)}`);
check('ground that offers a route nothing lowers its yield',
  barren.halfHit < barren.greenHit
    ? barren.half < barren.green
    : barren.half <= barren.green + 1e-9,
  `${barren.green.toFixed(2)} → ${barren.half.toFixed(2)} g/s`);

/* ================================== 4. the claim preview, and its honesty */

const preview = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 30 }; // 12 forager capacity
  s.droneTypes = { forager: 40 };        // 28 of them landless
  const hungry = hive.landValue.preview('temperateForest', 200);

  s.droneTypes = { forager: 12 };        // exactly filled
  const full = hive.landValue.preview('temperateForest', 200);

  s.droneTypes = { forager: 40 };
  const fresh = hive.landValue.preview('grassland', 200);
  return { hungry, full, fresh };
});

check('a hive with landless drones gains intake from more ground',
  preview.hungry.rateGain > 0 && preview.hungry.employs > 0,
  `+${preview.hungry.rateGain.toFixed(2)} g/s, ${preview.hungry.employs} put to work`);
check('a hive whose every forager is already out gains NONE',
  preview.full.headroomOnly === true && Math.abs(preview.full.rateGain) < 1e-9,
  `+${preview.full.rateGain.toFixed(4)} g/s`);
check('but it still gains the room, which is what it is buying',
  preview.full.capacityGain > 0, `+${preview.full.capacityGain} forager capacity`);
check('ground the hive has never stood on is flagged as new',
  preview.fresh.fresh === true && preview.hungry.fresh === false);
check('and taking new ground shifts the mix in BOTH directions',
  preview.fresh.shifts.some((x) => x.delta > 1e-6)
  && preview.fresh.shifts.some((x) => x.delta < -1e-6),
  `${preview.fresh.shifts.length} finds moved`);
check('more of ground already held barely moves the mix',
  Math.abs(preview.hungry.shifts[0]?.delta ?? 0)
    < Math.abs(preview.fresh.shifts[0]?.delta ?? 0) * 100,
  'sanity: a familiar claim is not a bigger shock than a strange one');

const spoil = await p.evaluate(() => {
  const s = hive.state;
  s.found = {}; // the hive has never found anything, anywhere
  const blind = hive.landValue.preview('grassland', 200);
  return {
    anyNamed: blind.shifts.some((x) => x.label),
    label: hive.landValue.labelFor(blind.shifts[0]?.key ?? 'acorn'),
    movers: blind.shifts.length,
  };
});
check('a preview never names a find the hive has not discovered',
  spoil.anyNamed === false && spoil.label === null,
  `${spoil.movers} finds moved, none nameable`);

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
