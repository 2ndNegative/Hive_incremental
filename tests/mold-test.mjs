import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * What a drone costs to press, and what stops a chamber pressing one.
 *
 *   BANDWIDTH — a chamber will not make a drone the hive cannot hold coherent.
 *     This is the rule that stops a hive filling with two hundred drones it has
 *     fifteen cogits for.
 *   COST — a Forager is a larva and 5 g of fat; a Scavenger is a larva and 5 g
 *     of phosphorus the hive cannot see yet, so it pays 250 g of mineral mass
 *     instead until the assay is run.
 *   PACE — a full brood lays and presses faster than an empty one, never slower.
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
  await page.waitForTimeout(200);
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
// The Scavenger is behind Scavenging now, as its research always claimed. These
// checks are about molding and the Drones tab, not about the gate, so the tech
// is granted up front rather than leaving half the drone table invisible.
await p.evaluate(() => { hive.state.tech.scavenging = true; });
await p.waitForTimeout(250);
await p.evaluate(() => hive.loop.stop());

/**
 * A hive that can afford to press drones, with room for them.
 *
 * No Brood Chamber and no generators by default: this suite is about what the
 * MOLDING chamber does, and a brood laying in the background moves the larva
 * count under it while generators quietly burn the same fat the drones cost.
 * Energy comes out of a banked pool instead.
 */
async function fixture({ nodes = 10, larvae = 10, fat = 1000, ash = 100_000, brood = 0 } = {}) {
  await p.evaluate((o) => {
    const s = hive.state;
    s.structures.moldingChamber = 1;
    s.structures.broodChamber = o.brood;
    s.structures.nodeCluster = o.nodes;
    s.structures.glycogenGranule = 100;
    s.structures.lipidDroplet = 100;
    s.structures.proteinGranule = 100;
    s.structures.celluloseBale = 100;
    s.structures.vacuole = 200;
    s.structures.metabolicGenerator = 0;
    s.energyPool = 1e9;
    s.droneTypes.forager = 0;
    s.droneTypes.scavenger = 0;
    s.nutrients.carb = 20_000;
    s.nutrients.fat = o.fat;
    s.nutrients.protein = 20_000;
    s.nutrients.ash = o.ash;
    s.larvae = o.larvae;
    s.molding = {};
    s.brood = {};
    s.larvaeHunger = 0;
    s.larvaeDying = 0;
    hive.drones.setMolding('forager', false);
    hive.drones.setMolding('scavenger', false);
    for (const id of hive.drones.typeOrder) hive.drones.setMoldTarget(id, '');
    hive.tick(0.1);
  }, { nodes, larvae, fat, ash, brood });
}

/* ================================================= 1. the bandwidth ceiling */

await fixture({ nodes: 1, larvae: 40 });
const ceiling = await p.evaluate(() => {
  const s = hive.state;
  hive.drones.setMolding('forager', true);
  const before = hive.cognition();
  hive.tick(600, 1); // ten minutes of pressing
  const after = hive.cognition();
  return {
    capacity: after.capacity,
    used: after.used,
    over: after.over,
    drones: s.droneTypes.forager,
    larvaeLeft: s.larvae,
    status: hive.drones.moldStatus('forager'),
  };
});
check('a chamber stops at the hive\'s bandwidth instead of running away',
  ceiling.drones === ceiling.capacity && !ceiling.over,
  `${ceiling.drones} drones against ${ceiling.capacity} Cg`);
check('and the row says why it stopped',
  ceiling.status === 'no bandwidth', ceiling.status);
check('the larvae it could not use are still in the brood',
  ceiling.larvaeLeft === 40 - ceiling.drones, `${ceiling.larvaeLeft} left of 40`);

const widened = await p.evaluate(() => {
  const s = hive.state;
  s.structures.nodeCluster = 4; // +15 Cg
  hive.tick(300, 1);
  return { drones: s.droneTypes.forager, capacity: hive.cognition().capacity, over: hive.cognition().over };
});
check('growing a Nerve Node lets it start again',
  widened.drones === widened.capacity && !widened.over,
  `${widened.drones} drones against ${widened.capacity} Cg`);

/* ======================================================== 2. what one costs */

await fixture({ nodes: 10, larvae: 20, fat: 1000 });
const forager = await p.evaluate(() => {
  const s = hive.state;
  const def = hive.drones.types.forager;
  hive.drones.setMolding('forager', true);
  const fatBefore = s.nutrients.fat;
  const larvaeBefore = s.larvae;
  hive.tick(100, 1); // five presses at 20 s
  return {
    declared: def.cost,
    made: s.droneTypes.forager,
    fatSpent: fatBefore - s.nutrients.fat,
    larvaeSpent: larvaeBefore - s.larvae,
  };
});
check('a Forager costs 5 g of fat', forager.declared.fat === 5, JSON.stringify(forager.declared));
check('and the fat actually leaves the store',
  forager.made > 0 && Math.abs(forager.fatSpent - forager.made * 5) < 1e-6,
  `${forager.made} drones, ${forager.fatSpent.toFixed(1)} g of fat`);
check('one larva each, as before',
  forager.larvaeSpent === forager.made, `${forager.larvaeSpent} larvae for ${forager.made} drones`);

// No fat, no drone — and the attempt is lost rather than banked.
const broke = await p.evaluate(() => {
  const s = hive.state;
  s.nutrients.fat = 0;
  const before = s.droneTypes.forager;
  hive.tick(120, 1);
  const m = hive.derived().molding[0];
  return { made: s.droneTypes.forager - before, broke: m.broke, active: m.active, demand: hive.derived().energy.demand };
});
check('with the store empty it presses nothing', broke.made === 0, `${broke.made} made`);
check('and idles rather than drawing its working watts',
  broke.broke && !broke.active, `broke ${broke.broke}, active ${broke.active}`);

/* ========================================== 3. a cost the hive cannot see yet */

const locked = await p.evaluate(() => {
  const s = hive.state;
  const def = hive.drones.types.scavenger;
  return {
    declared: def.cost,
    payable: hive.payableCost(def.cost),
    multiplier: hive.lockedCostMultiplier,
    revealed: hive.discovery ? undefined : undefined,
    gather: def.gather,
    cogits: def.cogitDraw,
  };
});
check('a Scavenger is declared in phosphorus',
  locked.declared.phosphorus === 5, JSON.stringify(locked.declared));
check('which the hive cannot see, so it pays 250 g of mineral mass instead',
  locked.payable.ash === 250 && locked.payable.phosphorus === undefined,
  JSON.stringify(locked.payable));
check('at fifty times the amount', locked.multiplier === 50, `×${locked.multiplier}`);
check('it works the scavenging table', locked.gather === 'scavenger', locked.gather);
check('and occupies a cogit like anything else', locked.cogits === 1, `${locked.cogits} Cg`);

await fixture({ nodes: 10, larvae: 20, ash: 100_000 });
const scavenged = await p.evaluate(() => {
  const s = hive.state;
  hive.drones.setMolding('scavenger', true);
  const ashBefore = s.nutrients.ash;
  hive.tick(100, 1);
  return { made: s.droneTypes.scavenger, ashSpent: ashBefore - s.nutrients.ash };
});
check('and the mineral mass actually leaves the store',
  scavenged.made > 0 && Math.abs(scavenged.ashSpent - scavenged.made * 250) < 1e-6,
  `${scavenged.made} scavengers, ${scavenged.ashSpent.toFixed(0)} g of mineral mass`);

// Once the assay is run it pays the real price instead.
const assayed = await p.evaluate(() => {
  const s = hive.state;
  s.tech.bulkMineralAssay = true;
  const payable = hive.payableCost(hive.drones.types.scavenger.cost);
  return { payable, revealed: true };
});
check('running the assay cuts the cost to the real five grams',
  assayed.payable.phosphorus === 5 && assayed.payable.ash === undefined,
  JSON.stringify(assayed.payable));
await p.evaluate(() => { hive.state.tech.bulkMineralAssay = false; });

/* ==================================================== 4. a scavenger forages */

const working = await p.evaluate(() => {
  const s = hive.state;
  s.structures.caecum = 1;
  s.droneTypes.scavenger = 6;
  s.droneTypes.forager = 0;
  hive.forage.resetForage(s);
  hive.tick(1);
  hive.tick(1);
  const f = hive.derived().droneForage.scavenger;
  // Patches live on the CREW now — one drone type on one biome — rather than
  // being pooled under the type, because a drone works the ground it was put
  // on and the type may be on several.
  const patches = hive.derived().crews
    .filter((c) => c.droneId === 'scavenger')
    .flatMap((c) => c.patches);
  return {
    rate: f?.rate,
    items: patches.filter((q) => q.itemId).map((q) => q.itemId),
    inPool: hive.poolFor('scavenger', 'temperateForest').map((e) => e.itemId),
  };
});
check('a Scavenger brings things in', working.rate > 0, `${working.rate?.toFixed(1)} g/s`);
check('and what it finds comes off the scavenging table, not the forager one',
  working.items.every((id) => working.inPool.includes(id)), working.items.join(', '));

/* ================================================= 5. a full brood works faster */

const pace = await p.evaluate(() => {
  const at = (larvae) => {
    hive.state.larvae = larvae;
    return hive.larvaPace();
  };
  return { empty: at(0), five: at(5), twenty: at(20), eighty: at(80), thousand: at(1000) };
});
check('an empty brood is exactly normal speed', pace.empty === 1, `×${pace.empty}`);
check('five larvae doubles it', Math.abs(pace.five - 2) < 1e-9, `×${pace.five}`);
check('and it keeps climbing, slowly',
  Math.abs(pace.twenty - 3) < 1e-9 && Math.abs(pace.eighty - 5) < 1e-9,
  `×${pace.twenty} at 20, ×${pace.eighty} at 80`);
check('never runaway: a thousand larvae is fifteen times, not two hundred',
  pace.thousand > 14 && pace.thousand < 16, `×${pace.thousand.toFixed(1)}`);
check('and never below one', pace.empty >= 1);

const applied = await p.evaluate(() => {
  const s = hive.state;
  s.structures.broodChamber = 1;
  // Both samples have larvae in them: at zero the chamber is not pressing at
  // all, so there is no rate to compare.
  const run = (larvae) => {
    s.larvae = larvae;
    s.molding = {};
    s.brood = {};
    s.droneTypes.forager = 0;
    s.nutrients.fat = 10_000;
    s.nutrients.protein = 20_000;
    hive.drones.setMolding('forager', true);
    hive.drones.setMolding('scavenger', false);
    const d = hive.derived();
    return { mold: d.moldRate, brood: d.broodRate, pace: d.molding[0].pace };
  };
  return { cold: run(5), warm: run(20) };
});
check('the molding rate carries the pace',
  Math.abs(applied.warm.mold / applied.cold.mold - 1.5) < 1e-6,
  `${applied.cold.mold.toFixed(3)} → ${applied.warm.mold.toFixed(3)} drones/s`);
check('and so does the brood rate',
  Math.abs(applied.warm.brood / applied.cold.brood - 1.5) < 1e-6,
  `${applied.cold.brood.toFixed(3)} → ${applied.warm.brood.toFixed(3)} larvae/s`);

// And it is the simulation, not just the readout.
const real = await p.evaluate(() => {
  const s = hive.state;
  const run = (larvae) => {
    s.larvae = larvae;
    s.molding = {};
    s.droneTypes.forager = 0;
    s.nutrients.fat = 10_000;
    s.structures.nodeCluster = 60;
    hive.drones.setMolding('forager', true);
    hive.tick(60, 1);
    return s.droneTypes.forager;
  };
  return { cold: run(100), warm: run(1000) };
});
check('a packed brood really does press more drones in the same minute',
  real.warm > real.cold * 2, `${real.cold} cold vs ${real.warm} warm, in 60s`);

/* ==================================================== 6. the screen says so */

await fixture({ nodes: 10, larvae: 20 });
await openTab(p, 'Drones');
await p.waitForTimeout(250);
const rows = await p.evaluate(() => {
  const out = {};
  for (const r of document.querySelectorAll('.job-row')) {
    const name = r.querySelector('.job-name')?.textContent.trim();
    out[name] = r.innerText.replace(/\s+/g, ' ').trim();
  }
  return out;
});
check('the Drones tab lists a Scavenger', Boolean(rows.Scavenger), Object.keys(rows).join(', '));
check('the Forager row states its cost',
  /costs 5 g fat a press/.test(rows.Forager || ''), (rows.Forager || '').slice(0, 160));
// The sentence that used to follow this ("really built out of phosphorus…") is
// gone on purpose: a bulk resource standing in for an unassayed element is
// marked by COLOUR now, the same yellow on every screen that quotes a price.
// See substitutedEntries in definitions/nutrients.js.
check('and the Scavenger row quotes the parent it is actually paying in',
  /costs 250 g mineral mass a press/.test(rows.Scavenger || ''),
  (rows.Scavenger || '').slice(-150));
const scavengerMark = await p.evaluate(() => {
  const row = [...document.querySelectorAll('.job-desc')]
    .find((r) => /costs .*mineral mass/.test(r.innerText));
  const mark = row?.querySelector('.cost-unassayed');
  return { text: mark?.innerText.trim() ?? '', title: mark?.getAttribute('title') ?? '' };
});
check('with that figure marked as standing in for something',
  /mineral mass/i.test(scavengerMark.text) && /assay/i.test(scavengerMark.title),
  scavengerMark.text || 'nothing marked');

/* ============================== 7. the target field, with the clock running */

// THE BUG: this tab repaints ten times a second, and a bound `value` is patched
// by comparing it with what is in the DOM — so while someone was typing, Vue
// put the old target back on every frame. Typing did nothing and the spinner
// only "took" on a click that landed between two renders.
await p.evaluate(() => hive.loop.start());
await p.waitForTimeout(400);

// Playwright's :has()/:text-is() are engine selectors, not CSS — so the page
// side finds the row by walking the DOM instead.
const field = '.job-row .mold-target input';
const readField = () =>
  p.evaluate(() => {
    const row = [...document.querySelectorAll('.job-row')].find((r) =>
      /Forager/.test(r.querySelector('.job-name')?.textContent ?? ''),
    );
    return {
      shown: row?.querySelector('.mold-target input')?.value ?? null,
      stored: hive.state.droneMolding.forager.target,
    };
  });
await p.fill(field, '');
await p.waitForTimeout(300);
await p.type(field, '42', { delay: 60 });
await p.waitForTimeout(400);
const typed = await readField();
check('a target can be typed while the hive is running',
  typed.shown === '42' && typed.stored === 42, `field "${typed.shown}", stored ${typed.stored}`);

// And the spinner: ten presses should be ten steps, not one.
await p.evaluate(() => {
  const row = [...document.querySelectorAll('.job-row')].find((r) =>
    /Forager/.test(r.querySelector('.job-name')?.textContent ?? ''),
  );
  const el = row.querySelector('.mold-target input');
  el.value = '0';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await p.waitForTimeout(250);
for (let i = 0; i < 10; i += 1) {
  await p.press(field, 'ArrowUp');
  await p.waitForTimeout(90);
}
const stepped = await readField();
check('and stepped, ten clicks for ten steps rather than one',
  stepped.stored === 10, `field "${stepped.shown}", stored ${stepped.stored}`);

await p.evaluate(() => {
  hive.loop.stop();
  hive.drones.setMoldTarget('forager', '');
});

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
