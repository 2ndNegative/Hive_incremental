import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * Drones that cost something and do something.
 *
 *   1. Every drone occupies bandwidth. A Forager is one cogit, held whether it
 *      is working or not, and the hive's cognition load has to say so.
 *   2. A Forager forages: the same two-stage roll the castes used, on the same
 *      twelve-second cycle, except that what comes home weighs 12 to 20 grams
 *      and the weight is rolled fresh every trip.
 *
 * The weight is the part worth being careful about. A range is not a thing one
 * sample can prove, so the rolls are taken by the hundred and checked for
 * bounds, for spread, and for actually MOVING — a "random" weight that returns
 * its midpoint every time would pass any single-sample test ever written.
 */

async function ensureLanded(page) {
  const card = await page.$('.origin-card:not(.is-locked):not(.is-placeholder)');
  if (!card) return false;
  await card.click();
  await page.waitForSelector('.origin-backdrop', { state: 'detached', timeout: 5000 });
  return true;
}
async function openTab(page, label) {
  await page.click(`.tab-bar button:text-is("${label}")`);
  await page.waitForTimeout(160);
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

/**
 * Kept watered and fed throughout.
 *
 * A thirsty or hungry colony works at a fraction of its rate — see engine.js
 * computeHydration — and these checks are about what the LAND is worth, so the
 * two things that would scale every figure in them are taken off the table.
 * 15 kg sits under the Hivecore's own 20 kg water shelf, so it never floods the
 * shared pool and starves the other stores.
 */
const comfortable = () => p.evaluate(() => {
  hive.state.nutrients.water = 15_000;
  hive.state.nutrients.carb = Math.max(hive.state.nutrients.carb || 0, 2_000);
});
await comfortable();

/* ================================================= 1. the type declares it */

const decl = await p.evaluate(() => {
  const def = hive.drones.types.forager;
  return {
    cogitDraw: def.cogitDraw,
    gather: def.gather,
    load: def.load,
    foraging: hive.drones.foraging(),
    range: def.range,
    crowding: def.crowding,
    slots: hive.land.slots('temperateForest', 'forager'),
    cycle: hive.forage.FORAGE_CYCLE,
  };
});

check('a Forager declares one cogit of upkeep', decl.cogitDraw === 1, `${decl.cogitDraw}`);
check('and the forager gather route', decl.gather === 'forager', decl.gather);
check('and a 20–45 g load per trip',
  decl.load?.min === 20 && decl.load?.max === 45, JSON.stringify(decl.load));
check('it is listed as a foraging type', decl.foraging.includes('forager'), decl.foraging.join(','));
check('it declares a range and how badly it minds company',
  decl.range === 4 && decl.crowding > 0 && decl.crowding < 1,
  `${decl.range} m², crowding ${decl.crowding}`);
check('and the 36 m² landing site carries nine of them',
  decl.slots === 9, `${decl.slots} slots`);
check('the trip cycle is the one the castes used', decl.cycle === 12, `${decl.cycle}`);

/* ================================================= 2. cogit upkeep is paid */

const load = await p.evaluate(() => {
  const before = hive.cognition();
  hive.state.droneTypes.forager = 7;
  const after = hive.cognition();
  const line = after.load.find((l) => l.key === 'drone:forager');
  return {
    beforeUsed: before.used,
    afterUsed: after.used,
    line: line ? { label: line.label, amount: line.amount } : null,
    capacity: after.capacity,
  };
});

check('seven Foragers add seven cogits of load',
  Math.abs(load.afterUsed - load.beforeUsed - 7) < 1e-9,
  `${load.beforeUsed} → ${load.afterUsed}`);
check('and the load is itemised by type',
  load.line?.amount === 7 && /Forager ×7/.test(load.line.label), JSON.stringify(load.line));

// A cost, not a benefit: a dark hive still holds its drones in mind. Idling the
// Hivecore cuts the CAPACITY and leaves the drone load exactly where it was.
const dark = await p.evaluate(() => {
  const lit = hive.cognition();
  hive.state.power.hivecore = 0;
  const out = hive.cognition();
  return {
    capacityFell: out.capacity < lit.capacity - 1e-9,
    droneLoad: out.load.find((l) => l.key === 'drone:forager')?.amount,
    over: out.over,
  };
});
check('a brownout shrinks bandwidth but not the drones in it',
  dark.capacityFell && dark.droneLoad === 7, JSON.stringify(dark));
check('and an over-budget hive says so', dark.over === true, `${dark.over}`);

await p.evaluate(() => { hive.state.power.hivecore = 1; hive.state.droneTypes.forager = 0; });

/* ======================================================== 3. the trip roll */

const rolls = await p.evaluate(() => {
  const out = [];
  for (let i = 0; i < 400; i += 1) {
    const patch = hive.forage.rollPatch(hive.state, 'forager', 'temperateForest', {});
    if (patch.itemId) out.push(patch.grams);
  }
  return out;
});

const min = Math.min(...rolls);
const max = Math.max(...rolls);
const mean = rolls.reduce((a, b) => a + b, 0) / rolls.length;
const distinct = new Set(rolls.map((g) => g.toFixed(6))).size;

check('400 rolls all found something', rolls.length === 400, `${rolls.length} landed`);
check('no trip comes home under 20 g', min >= 20 - 1e-9, `lightest ${min.toFixed(2)} g`);
check('and none over 45 g', max <= 45 + 1e-9, `heaviest ${max.toFixed(2)} g`);
check('the weight actually varies', distinct > 350, `${distinct} distinct weights`);
check('it uses the whole range, not just the middle',
  min < 22 && max > 43, `${min.toFixed(2)}–${max.toFixed(2)} g`);
check('and averages near the midpoint', Math.abs(mean - 32.5) < 1.5, `mean ${mean.toFixed(2)} g`);

/* ============================================= 4. what that is worth a second */

// Three Foragers are now three PATCHES, one each, rather than three drones
// sharing one. So the rate is the sum of three separate trips rather than one
// trip multiplied — and each drone may be on a different find, which is what
// the per-item check has to account for.
const flow = await p.evaluate(() => {
  hive.state.droneTypes.forager = 3;
  hive.forage.resetForage(hive.state);
  hive.tick(0.1); // one tick rolls the first trips
  const patches = hive.state.crews['forager:temperateForest'];
  const d = hive.derived();
  const entry = d.droneForage.forager;
  const grams = patches.reduce((a, q) => a + (q.grams || 0), 0);
  const one = patches.find((q) => q.itemId);
  const onIt = patches.filter((q) => q.itemId === one.itemId);
  const source = (d.itemSources?.[one.itemId] || []).find((s) => s.droneId === 'forager');
  return {
    patches: patches.length,
    grams,
    itemId: one.itemId,
    count: entry?.count,
    rate: entry?.rate,
    expected: grams / hive.forage.FORAGE_CYCLE,
    label: source?.label,
    itemFlow: d.itemFlow?.[one.itemId],
    expectedItem: onIt.reduce((a, q) => a + q.grams, 0) / hive.forage.FORAGE_CYCLE,
  };
});

check('three Foragers work three patches, one each', flow.patches === 3, `${flow.patches}`);
check('and the rate is their three trips over the cycle',
  Math.abs(flow.rate - flow.expected) < 1e-9,
  `${flow.rate?.toFixed(3)} g/s on ${flow.grams?.toFixed(2)} g of trips`);
check('the mass arrives as the items they found',
  Math.abs(flow.itemFlow - flow.expectedItem) < 1e-9,
  `${flow.itemId} at ${flow.itemFlow?.toFixed(3)} g/s`);
check('and the inflow is attributed to them by name',
  /^Forager in /.test(flow.label || ''), flow.label);

// It has to land in the stores, not merely be reported — which now takes a gut,
// since a hive with no Digestive Caecum cannot break raw matter down at all.
const grew = await p.evaluate(() => {
  hive.state.structures.caecum = 1;
  const before = hive.state.items[hive.state.crews['forager:temperateForest'][0].itemId] || 0;
  const nutrientsBefore = Object.values(hive.state.nutrients).reduce((a, b) => a + b, 0);
  hive.tick(30);
  const nutrientsAfter = Object.values(hive.state.nutrients).reduce((a, b) => a + b, 0);
  return { before, nutrientsBefore, nutrientsAfter, ingested: hive.state.stats.ingested };
});
check('thirty seconds of foraging, with a gut, puts matter in the hive',
  grew.nutrientsAfter > grew.nutrientsBefore,
  `${grew.nutrientsBefore.toFixed(1)} → ${grew.nutrientsAfter.toFixed(1)} g`);

/* ============================================ 5. a hive with no foragers idles */

const none = await p.evaluate(() => {
  hive.state.droneTypes.forager = 0;
  hive.forage.resetForage(hive.state);
  const foundBefore = JSON.stringify(hive.state.found);
  hive.tick(60);
  return {
    slot: hive.state.crews?.['forager:temperateForest'] ?? null,
    crewKeys: Object.keys(hive.state.crews || {}),
    rate: hive.derived().droneForage?.forager ?? null,
    learnedNothing: JSON.stringify(hive.state.found) === foundBefore,
  };
});
check('no Foragers means no trips rolled', !none.slot, JSON.stringify(none.crewKeys));
check('and nothing in the forage readout', none.rate === null);
check('and the hive learns nothing about ground it never walked', none.learnedNothing);

/* ================================================== 6. and it reads correctly */

await p.evaluate(() => {
  hive.state.droneTypes.forager = 4;
  hive.state.ui.droneBands = {};
  hive.forage.resetForage(hive.state);
  hive.tick(1);
});
await openTab(p, 'Drones');
await p.waitForTimeout(220);

const tab = await p.evaluate(() => {
  const main = document.querySelector('.main-col') || document.body;
  const row = [...document.querySelectorAll('.job-row')].find((r) => /Forager/.test(r.innerText));
  return { text: main.innerText, row: row?.innerText || '' };
});

check('the Drones tab counts the standing drones', /4 drones standing/.test(tab.text), tab.text.split('\n')[0]);
check('and says what bandwidth they are holding', /cognition/.test(tab.text));
check('the row states the cogit upkeep', /cognition each/i.test(tab.row), tab.row.replace(/\n/g, ' | '));
check('and the trip weight', /20–45\s*g/.test(tab.row));
check('and what is coming in right now', /coming in/.test(tab.row));

await openTab(p, 'Territory');
await p.waitForTimeout(220);
// Two panels on this tab mention Foragers now and they say different things:
// "Who works what" is the PLAN and "Out now" is what is actually happening. The
// assertions belong on the second one.
const terr = await p.evaluate(() => {
  const box = [...document.querySelectorAll('.panel-box')]
    .find((b) => /^out now/i.test(b.innerText));
  return {
    crew: [...(box?.querySelectorAll('.crew-line') ?? [])].map((n) => n.innerText).join(' | '),
    // The trip weight is a COLUMN now, not a clause in a help line under every
    // find — "each trip", fourth across.
    trips: [...(box?.querySelectorAll('.out-find-row') ?? [])]
      .map((n) => n.children[3]?.innerText.trim() ?? '').join(' | '),
  };
});
check('Territory shows the Foragers out on the land', /Forager\s*×4/.test(terr.crew), terr.crew);
// The crew summary carries the headcount and how hard the ground is being
// leaned on; the rows underneath carry the trips. Both used to be stamped on
// every patch row, alongside a drones-per-patch figure identical on all of them.
check('and how much room they have', /%\s*each/.test(terr.crew), terr.crew);
check('and what a trip is worth', /\d\s*g$/m.test(terr.trips),
  terr.trips.slice(0, 120));

/* ===================================================== 7. a save round-trips */

const round = await p.evaluate(() => {
  hive.save();
  const raw = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /hive/i.test(k))));
  return {
    version: raw?.version ?? raw?.state?.version ?? null,
    forager: raw?.droneTypes?.forager ?? raw?.state?.droneTypes?.forager ?? null,
    slot: (raw?.crews ?? raw?.state?.crews)?.['forager:temperateForest']?.[0] ?? null,
  };
});
const SAVE_VERSION = await p.evaluate(() => hive.saveVersion);
check('the save carries the drone count', round.forager === 4, `${round.forager}`);
check('and the patch, weight and all',
  round.slot && typeof round.slot.grams === 'number', JSON.stringify(round.slot));
check('at the current save version', round.version === SAVE_VERSION, `${round.version}`);

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
