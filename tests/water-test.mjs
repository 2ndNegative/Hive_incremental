import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * Thirst, food, and the sugar sprint.
 *
 * Three systems that all push on the same place: what a drone costs to keep.
 * The thing worth testing hardest is not any one of their numbers but the
 * shape of the whole — a hive that can be killed by a slow leak while nobody is
 * watching is a worse game than one that is slightly mistuned, so the floors,
 * the visibility and the recoverability get as much attention as the rates.
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
await p.waitForTimeout(250);
await p.evaluate(() => hive.loop.stop());

/** A quiet hive: known ground, known population, nothing else running. */
async function fixture({ biome = 'temperateForest', drones = 40, water = 15000 } = {}) {
  return p.evaluate(({ biome, drones, water }) => {
    const s = hive.state;
    s.territory = { [biome]: 200 };
    s.unclaimed = {};
    s.droneTypes = { forager: drones };
    s.drones = 0;
    s.castes = { dormant: 0 };
    s.buildQueue = [];
    s.structures = { hivecore: 1 };
    s.active = {};
    for (const id of hive.structureOrder) s.active[id] = 0;
    s.active.hivecore = 1;
    s.power = {};
    s.patches = {};
    for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
    s.nutrients.water = water;
    s.nutrients.carb = 2000;
    s.nutrients.fat = 2000;
    s.items = {};
    hive.tick(0.1);
    return null;
  }, { biome, drones, water });
}

/* ================================== 1. drones cost food, not watts */

await fixture();
const noWatts = await p.evaluate(() => {
  const d = hive.derived();
  return {
    demands: d.demands.map((x) => x.key),
    perDrone: d.energy.demand,
    ration: d.ration,
  };
});
check('no drone draws a watt any more',
  !noWatts.demands.some((k) => k === 'basal' || k.startsWith('caste:')),
  noWatts.demands.join(', ') || '(nothing billed)');
check('they eat instead, and it is counted off the live population',
  noWatts.ration.drones === 40, `${noWatts.ration.drones} drones`);
// 0.15 g/s a drone is the price of a BILLABLE drone, and a drone out on ground
// it can work is only half billable: it eats what it finds before it gets home
// — see SNACK_SHARE in castes.js. So the per-drone figure is checked against
// `billable` rather than the headcount, and the gap between the two is checked
// separately, because the gap is the mechanic.
check('the ration is 0.15 g of sugar per billable drone, as specified',
  Math.abs(noWatts.ration.wantGrams / noWatts.ration.billable - 0.15) < 1e-9,
  `${noWatts.ration.wantGrams.toFixed(2)} g/s of ${noWatts.ration.nutrient}`
  + ` for ${noWatts.ration.billable.toFixed(1)} of ${noWatts.ration.drones}`);
check('and the drones out on the ground are feeding themselves half of it',
  noWatts.ration.grazed > 0
  && Math.abs(noWatts.ration.billable - (40 - noWatts.ration.grazed * 0.5)) < 1e-9,
  `${noWatts.ration.grazed.toFixed(1)} fed on the job`);

const idleBill = await p.evaluate(() => {
  const s = hive.state;
  const territory = { ...s.territory };
  s.territory = {}; // nowhere to stand, so nobody grazes
  const bare = hive.ration();
  s.territory = territory;
  return { want: bare.wantGrams, billable: bare.billable };
});
check('a hive with nowhere to forage pays the full 6 g/s for forty drones',
  Math.abs(idleBill.want - 6) < 1e-9 && idleBill.billable === 40,
  `${idleBill.want.toFixed(2)} g/s for ${idleBill.billable}`);

const perFuel = await p.evaluate(() => {
  const s = hive.state;
  const out = {};
  for (const fuel of ['carb', 'fat', 'protein']) {
    s.energy.overrides.drones = { preferred: fuel, fallback: fuel };
    s.fuelLock = {};
    s.nutrients[fuel] = 5000;
    out[fuel] = +hive.ration().wantGrams.toFixed(3);
  }
  s.energy.overrides.drones = { preferred: 'carb', fallback: 'fat' };
  s.fuelLock = {};
  return out;
});
const billable = await p.evaluate(() => hive.ration().billable);
check('the same ration costs less of a denser fuel',
  perFuel.fat < perFuel.carb && Math.abs(perFuel.carb - billable * 0.15) < 0.01,
  `carb ${perFuel.carb} g/s · fat ${perFuel.fat} g/s · protein ${perFuel.protein} g/s`);
check('and the energy it comes to is the same whichever it is',
  Math.abs(perFuel.fat * 37 - perFuel.carb * 17) < 0.5,
  'the bill is fixed in joules, variable in grams');

/* =========================== 2. hydration: the dead zone, the slope, the floor */

const curve = await p.evaluate(() => {
  const s = hive.state;
  const target = 40 * 250; // WATER_PER_DRONE_TARGET
  const at = (frac) => {
    s.nutrients.water = target * frac;
    const h = hive.hydration();
    return { ratio: +h.ratio.toFixed(3), mult: +h.multiplier.toFixed(3) };
  };
  return {
    target: hive.hydration().target,
    over: at(2),
    full: at(1),
    threeQ: at(0.75),
    half: at(0.5),
    quarter: at(0.25),
    dry: at(0),
  };
});
check('the hive wants 250 g a drone', curve.target === 10000, `${curve.target} g for 40`);
check('being over the target is worth nothing extra',
  curve.over.mult === 1 && curve.full.mult === 1, 'a dead zone, so a healthy hive is never nagged');
check('and below it the penalty is a straight line',
  curve.threeQ.mult === 0.85 && curve.half.mult === 0.7 && curve.quarter.mult === 0.55,
  `75% → ${curve.threeQ.mult} · 50% → ${curve.half.mult} · 25% → ${curve.quarter.mult}`);
check('a bone-dry hive still manages four tenths, not nothing',
  curve.dry.mult === 0.4,
  'a hive that cannot forage cannot fetch water, and would never recover');

/* ========================= 3. what thirst actually slows, and what it must not */

const slowed = await p.evaluate(() => {
  const s = hive.state;
  s.structures = { hivecore: 1, metabolicGenerator: 1, caecum: 1, broodChamber: 1 };
  s.active = {};
  s.power = {};
  s.nutrients.fat = 50000;
  s.larvae = 5;
  const read = () => {
    hive.tick(0.5);
    const d = hive.derived();
    return {
      forage: +d.droneForage.forager.rate.toFixed(3),
      pace: +d.molding.concat(d.brood)[0]?.pace.toFixed(3),
      generated: Math.round(d.energy.generated),
      vigour: +d.vigour.toFixed(3),
    };
  };
  s.nutrients.water = 10000;
  for (let i = 0; i < 10; i += 1) { s.nutrients.water = 10000; hive.tick(1); }
  s.nutrients.water = 10000;
  const wet = read();
  for (let i = 0; i < 10; i += 1) { s.nutrients.water = 0; hive.tick(1); }
  s.nutrients.water = 0;
  const dry = read();
  return { wet, dry };
});
check('a parched colony forages more slowly',
  slowed.dry.forage < slowed.wet.forage * 0.75,
  `${slowed.wet.forage} g/s → ${slowed.dry.forage} g/s`);
check('and its chambers turn more slowly',
  slowed.dry.pace < slowed.wet.pace,
  `×${slowed.wet.pace} → ×${slowed.dry.pace}`);
check('but its GENERATORS do not, which is what makes it recoverable',
  slowed.dry.generated === slowed.wet.generated,
  `${Math.round(slowed.wet.generated / 1000)} kW either way`);

/* ====================== 4. the land decides how thirsty the hive is */

const land = await p.evaluate(() => {
  const s = hive.state;
  const out = {};
  for (const biome of ['wetland', 'temperateForest', 'grassland', 'denseUrban', 'desert']) {
    s.territory = { [biome]: 200 };
    const h = hive.hydration();
    out[biome] = { aridity: h.aridity, draw: +h.draw.toFixed(2) };
  }
  // The point of a weighted average rather than a worst case.
  s.territory = { desert: 100, wetland: 100 };
  out.mixed = { aridity: +hive.aridity().toFixed(2), draw: +hive.hydration().draw.toFixed(2) };
  return out;
});
check('wet ground is nearly free',
  land.wetland.aridity === 0.3 && land.wetland.draw === 4.8,
  `${land.wetland.draw} g/s across 40 drones`);
check('forest is the baseline', land.temperateForest.aridity === 1 && land.temperateForest.draw === 16);
check('paved ground is dear', land.denseUrban.aridity === 2.2);
check('and desert is four times the baseline',
  land.desert.aridity === 4 && land.desert.draw === 64,
  `${land.desert.draw} g/s — a 20 kg store gone in five minutes`);
check('holding both wet and dry ground averages out',
  Math.abs(land.mixed.aridity - 2.15) < 0.01,
  `desert and wetland together come to ×${land.mixed.aridity}, not ×4`);

/* ============================ 5. the desert actually bites, and the forest does not */

async function balance(biome) {
  await fixture({ biome, drones: 40, water: 15000 });
  return p.evaluate(() => {
    const s = hive.state;
    s.structures = { hivecore: 1, metabolicGenerator: 2, caecum: 1, crop: 2 };
    s.active = {};
    s.power = {};
    s.nutrients.fat = 20000;
    hive.tick(0.1);
    for (let i = 0; i < 90; i += 1) hive.tick(1);
    const d = hive.derived();
    return {
      net: +(d.net.water || 0).toFixed(1),
      draw: +d.hydration.draw.toFixed(1),
      ratio: +d.hydration.ratio.toFixed(2),
    };
  });
}
const forest = await balance('temperateForest');
const desert = await balance('desert');
check('a forest hive drinks its own food and stays wet',
  forest.net > 0 && forest.ratio === 1,
  `${forest.net > 0 ? '+' : ''}${forest.net} g/s`);
check('a desert hive cannot keep up, however well it forages',
  desert.net < 0, `${desert.net} g/s against a ${desert.draw} g/s draw`);
check('which is the whole point — the ground decides, not the balance table',
  desert.draw > forest.draw * 3.5,
  `${forest.draw} g/s in forest against ${desert.draw} g/s in desert`);

/* ===================================== 6. sugar is the sprint, fat is the tank */

const fuels = await p.evaluate(() => {
  const s = hive.state;
  s.structures = { hivecore: 1, metabolicGenerator: 1 };
  s.active = {};
  s.power = {};
  s.buildQueue = [];
  const run = (fuel) => {
    s.energy.preferred = fuel;
    s.energy.fallback = fuel;
    s.fuelLock = {};
    for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
    s.nutrients[fuel] = 1e6;
    s.nutrients.water = 15000;
    hive.tick(1);
    const d = hive.derived();
    return { watts: Math.round(d.energy.generated), mass: +d.energy.massRate.toFixed(1) };
  };
  return { fat: run('fat'), carb: run('carb'), protein: run('protein') };
});
// Fat is 37 kJ/g and an untaught hive recovers 70% of it: 259 kW, not the 370
// a perfect converter would give. 370 is now what Ketogenesis REACHES — it is
// the ceiling at the end of the fat line rather than the number you start on.
check('one generator on untaught fat makes 259 kW off 10 g/s',
  fuels.fat.watts === 259000 && fuels.fat.mass === 10,
  `${fuels.fat.watts / 1000} kW — 70% of the 370 kW in the mass`);
check('the same generator on sugar still makes more, by burning three times as much',
  fuels.carb.watts > fuels.fat.watts && fuels.carb.mass === 30,
  `${fuels.carb.watts / 1000} kW off ${fuels.carb.mass} g/s`);
check('sugar being worse per gram AND hasty is both losses at once',
  Math.abs(fuels.carb.watts - 30 * 17000 * 0.6 * 0.9) < 1,
  '30 g/s × 17 kJ/g × 60% recovered × 90% through the hurry');
check('nothing else gets the multiplier',
  fuels.protein.mass === 10, `${fuels.protein.mass} g/s of protein`);

const endurance = await p.evaluate(() => {
  // The same shelf of each, burned to nothing.
  const s = hive.state;
  const lasts = (fuel) => {
    s.energy.preferred = fuel;
    s.energy.fallback = fuel;
    s.fuelLock = {};
    for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
    s.nutrients[fuel] = 2000;
    s.nutrients.water = 15000;
    s.droneTypes = {}; // nothing eating it but the generator
    let t = 0;
    while ((s.nutrients[fuel] || 0) > 1e-6 && t < 600) { hive.tick(1); t += 1; }
    return t;
  };
  return { fat: lasts('fat'), carb: lasts('carb') };
});
check('2 kg of fat outlasts 2 kg of sugar by a wide margin',
  endurance.fat > endurance.carb * 2.5,
  `fat ${endurance.fat}s · sugar ${endurance.carb}s`);

/* ============================= 7. short rations, and that they are survivable */

const hungry = await p.evaluate(() => {
  const s = hive.state;
  s.droneTypes = { forager: 40 };
  s.nutrients.water = 15000;
  for (const n of ['carb', 'fat', 'protein', 'fiber']) s.nutrients[n] = 0;
  hive.tick(0.1);
  const d = hive.derived();
  return { ratio: d.ration.ratio, mult: d.ration.multiplier, hungry: d.ration.hungry, vigour: d.vigour };
});
check('a hive with nothing to eat is hungry', hungry.hungry && hungry.ratio === 0);
check('and slows rather than dying', hungry.mult === 0.4, `working at ${hungry.mult * 100}%`);

const both = await p.evaluate(() => {
  hive.state.nutrients.water = 0;
  hive.tick(0.1);
  return hive.derived().vigour;
});
check('thirst and hunger compound honestly',
  Math.abs(both - 0.16) < 1e-9, `0.4 × 0.4 = ${both.toFixed(2)}`);

/* ============================================= 8. it is visible */

await fixture({ drones: 40, water: 2000 });
await openTab(p, 'Hive');
await p.waitForTimeout(350);
const bar = await p.evaluate(() => {
  const cells = [...document.querySelectorAll('.topbar-cell, .bar-cell, .topbar .cell')];
  const text = document.querySelector('.topbar')?.innerText.replace(/\s+/g, ' ') ?? '';
  return { text, cells: cells.length };
});
check('hydration is on the top bar, unprompted', /Hydration/i.test(bar.text), bar.text.slice(0, 90));
check('and it says how bad it is', /\d+%/.test(bar.text));

await openTab(p, 'Metabolism');
await p.waitForTimeout(350);
const tab = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.fuel-row')];
  const drone = rows.find((r) => /Drones/.test(r.innerText));
  return {
    there: Boolean(drone),
    text: drone?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    selects: drone?.querySelectorAll('select').length ?? 0,
  };
});
check('the drones have a row on the Metabolism tab', tab.there, tab.text.slice(0, 80));
check('with a preferred fuel and a fallback, like a generator does', tab.selects === 2);

const switched = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.fuel-row')];
  const drone = rows.find((r) => /Drones/.test(r.innerText));
  const select = drone.querySelector('select');
  select.value = 'fat';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return null;
});
await p.waitForTimeout(300);
const fed = await p.evaluate(() => ({
  preferred: hive.state.energy.overrides.drones?.preferred,
  eating: hive.derived().ration.nutrient,
}));
check('and changing it changes what the colony lives on',
  fed.preferred === 'fat', `now on ${fed.preferred}`);

/* ============================================= 9. somewhere to keep it */

const store = await p.evaluate(() => {
  const s = hive.state;
  s.structures.cistern = 0;
  const before = hive.derived().storage.dedicated.water || 0;
  s.structures.cistern = 1;
  s.active.cistern = 1;
  const after = hive.derived().storage.dedicated.water || 0;
  return { before, after, gain: after - before, def: Boolean(hive.structureDefs.cistern) };
});
check('there is a building for water now', store.def);
check('and it holds 10 kg of it', store.gain === 10000, `${store.before} g → ${store.after} g`);

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
