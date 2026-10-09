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
 * Under the land rewrite a patch IS a drone and a crew works one biome, so the
 * estimate is
 *
 *   Σ over crews of  drones × efficiency × mean load × vigour / cycle × harvest
 *
 * with efficiency coming off the crowding curve. Nothing else in the suites
 * would catch that being wrong, because every OTHER figure on the tab comes
 * from the engine and would be wrong the same way.
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
  // Ground to spare, so nobody is crowded: the curve is checked separately and
  // what is being measured here is the per-drone yield.
  s.territory = { temperateForest: 600, grassland: 240, farmland: 120 };
  s.droneTypes = { forager: 8, scavenger: 3 };
  s.assign = {};
  s.crews = {};
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
check('every drone found ground on that much land', sim.estimate.idle === 0,
  `${sim.estimate.working} working`);

/* =========================== 2. the estimate honours the crowding curve */

const packed = await p.evaluate(() => {
  const s = hive.state;
  s.assign = {};
  const opts = { drones: { forager: 40, scavenger: 0 }, vigour: 1, harvest: 1 };
  return {
    // 40 m² is ten forager slots: four times the drones on the same ground.
    roomy: hive.landValue.expected({ farmland: 160 }, opts),
    tight: hive.landValue.expected({ farmland: 40 }, opts),
  };
});

check('the same drones on a quarter of the ground bring in less',
  packed.tight.total < packed.roomy.total,
  `${packed.roomy.total.toFixed(2)} → ${packed.tight.total.toFixed(2)} g/s`);
check('but not proportionally less — a forager is tolerant of company',
  packed.tight.total > packed.roomy.total / 4,
  `a quarter of the ground kept ${(packed.tight.total / packed.roomy.total * 100).toFixed(0)}%`);
check('and the estimate reports the squeeze it applied',
  packed.tight.crews.every((c) => c.efficiency < 1)
  && packed.roomy.crews.every((c) => c.efficiency === 1),
  `${(packed.tight.crews[0].efficiency * 100).toFixed(0)}% each when packed`);

/* ======================= 3. ground a route cannot work is honestly worthless */

const barren = await p.evaluate(() => {
  const s = hive.state;
  s.assign = {};
  // Find a biome that offers foragers nothing at all, if the tables have one.
  const empty = Object.keys(hive.biomes).find((id) => !hive.landValue.offers('forager', id));
  const opts = { drones: { forager: 4, scavenger: 0 }, vigour: 1, harvest: 1 };
  return {
    empty,
    good: hive.landValue.expected({ temperateForest: 400 }, opts).total,
    bad: empty ? hive.landValue.expected({ [empty]: 400 }, opts).total : null,
    offersForest: hive.landValue.offers('forager', 'temperateForest'),
  };
});

check('the forest offers a forager something', barren.offersForest === true);
check('and ground that offers it nothing is priced at nothing',
  barren.empty ? barren.bad === 0 : true,
  barren.empty ? `${barren.empty} → ${barren.bad} g/s` : 'no empty biome in the tables');
check('while the forest is not', barren.good > 0, `${barren.good.toFixed(2)} g/s`);

/* ================================== 4. the claim preview, and its honesty */

const preview = await p.evaluate(() => {
  const s = hive.state;
  s.assign = {};
  s.territory = { temperateForest: 400 };
  s.droneTypes = { forager: 4, scavenger: 0 };
  // 10 m² of wetland: not enough for one scavenger, enough for two foragers.
  s.unclaimed = { wetland: 400 };
  return {
    sliver: hive.landValue.preview('wetland', 10),
    proper: hive.landValue.preview('wetland', 200),
    familiar: hive.landValue.preview('temperateForest', 200),
  };
});

const scavOf = (pv) => pv.capacity.find((c) => c.droneId === 'scavenger');
const foragerOf = (pv) => pv.capacity.find((c) => c.droneId === 'forager');

check('a sliver carries foragers and not scavengers',
  foragerOf(preview.sliver).have >= 2 && scavOf(preview.sliver).none === true,
  `${foragerOf(preview.sliver).have} foragers, ${scavOf(preview.sliver).have} scavengers`);
check('and says how much further to the first scavenger',
  scavOf(preview.sliver).needed > 0,
  `${scavOf(preview.sliver).needed.toFixed(0)} m² short`);
check('a proper claim carries both', scavOf(preview.proper).have > 0,
  `${scavOf(preview.proper).have} scavengers on 200 m²`);
check('ground the hive has never stood on is flagged as new',
  preview.proper.fresh === true && preview.familiar.fresh === false);
check('claiming new ground pulls unassigned drones onto it',
  preview.proper.employs > 0,
  `${preview.proper.employs} would walk over`);
check('and shifts the mix in both directions',
  preview.proper.shifts.some((x) => x.delta > 1e-9)
  && preview.proper.shifts.some((x) => x.delta < -1e-9),
  `${preview.proper.shifts.length} finds moved`);

const pinned = await p.evaluate(() => {
  const s = hive.state;
  // Every drone pinned to ground it already holds: nobody walks over.
  s.droneTypes = { forager: 4, scavenger: 0 };
  hive.land.setTarget('temperateForest', 'forager', 4);
  return hive.landValue.preview('wetland', 200);
});
check('ground nobody is sent to grows nothing, and the preview says so',
  pinned.roomOnly === true && pinned.rateGain === 0,
  `+${pinned.rateGain.toFixed(4)} g/s`);
check('but it still reports the room it would buy',
  pinned.capacity.some((c) => c.gain > 0),
  pinned.capacity.map((c) => `${c.name} ${c.was}→${c.have}`).join(', '));

const relief = await p.evaluate(() => {
  const s = hive.state;
  // Forty foragers on ten slots' worth of farm. Doubling the farm cannot
  // employ anybody new — they are all already out — but it can un-crowd them,
  // and that is where the intake gain lives now.
  s.assign = {};
  s.territory = { farmland: 40 };
  s.droneTypes = { forager: 40, scavenger: 0 };
  return hive.landValue.preview('farmland', 120);
});
check('more of ground the hive is already crowded onto raises the intake',
  relief.rateGain > 0, `+${relief.rateGain.toFixed(2)} g/s with nobody new employed`);
check('by un-crowding them rather than by employing anyone',
  relief.employs === 0 && relief.after.crews[0].efficiency > relief.before.crews[0].efficiency,
  `${(relief.before.crews[0].efficiency * 100).toFixed(0)}%`
  + ` → ${(relief.after.crews[0].efficiency * 100).toFixed(0)}% each`);

const spoil = await p.evaluate(() => {
  const s = hive.state;
  s.found = {}; // the hive has never found anything, anywhere
  s.assign = {};
  s.territory = { temperateForest: 400 };
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
