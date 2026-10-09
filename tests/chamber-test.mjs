import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * The card-level pass: cycle bars, the opening grace period, the brownout
 * wording, and the two new dedicated stores.
 *
 * All four are things the player reads rather than things the simulation does,
 * so this suite mostly looks at rendered text — the arithmetic behind each one
 * is checked in power-test and storage-test.
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
/** The Hive tab card for a structure, as text. */
async function cardText(page, name) {
  return page.evaluate((want) => {
    const card = [...document.querySelectorAll('.action-slot')].find((c) =>
      c.querySelector('.action-name')?.textContent.trim().startsWith(want),
    );
    return card?.innerText.replace(/\s+/g, ' ').trim() ?? null;
  }, name);
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

/* =============================================== 1. the opening grace period */

const seed = await p.evaluate(() => {
  const start = hive.state.energyPool;
  const d = hive.derived();
  return {
    start,
    demand: d.energy.demand,
    charge: d.power.hivecore.charge,
    direction: d.power.hivecore.direction,
    seconds: start / d.energy.demand,
  };
});
// Within a megajoule: the live loop runs for a moment after landing before the
// test stops it, and a Hivecore spends a megajoule a second.
check('the site hands over a gigajoule', Math.abs(seed.start - 1e9) < 2e6,
  `${(seed.start / 1e6).toFixed(1)} MJ`);
// Hours, since the Hivecore came down to fifty kilowatts. Checked as a ratio
// rather than a figure, so moving either number fails this honestly.
check('which is the whole of the seed divided by what a Hivecore eats',
  Math.abs(seed.seconds - seed.start / seed.demand) < 1 && seed.seconds > 3600,
  `${(seed.seconds / 3600).toFixed(1)} hours of grace`);
check('so the hive lands lit and stays lit',
  seed.charge === 1 && seed.direction === 'steady', seed.direction);

const spent = await p.evaluate(() => {
  const out = {};
  hive.tick(10_000);
  out.half = { pool: hive.state.energyPool, charge: hive.derived().power.hivecore.charge };
  hive.tick(10_005); // just past the end of it
  out.gone = {
    pool: hive.state.energyPool,
    charge: hive.derived().power.hivecore.charge,
    direction: hive.derived().power.hivecore.direction,
  };
  return out;
});
check('half way through, half of it is gone and nothing has dimmed',
  Math.abs(spent.half.pool - 500e6) < 2e6 && spent.half.charge === 1,
  `${(spent.half.pool / 1e6).toFixed(0)} MJ left at ${(spent.half.charge * 100).toFixed(0)}%`);
check('and when it runs out the hive starts browning out',
  spent.gone.pool < 1 && spent.gone.direction === 'failing' && spent.gone.charge < 1,
  `${(spent.gone.charge * 100).toFixed(0)}% and ${spent.gone.direction}`);

/* ================================================== 2. the brownout now reads */

await openTab(p, 'Hive');
await p.waitForTimeout(250);

// Hold it at a steady fraction: a generator that covers part of the upkeep.
await p.evaluate(() => {
  const s = hive.state;
  // PROTEIN, and a tenth of a charge. Sugar runs a generator at three times the
  // rate now and fat is nearly twice as dense, so either one at a fifth of a
  // charge covers the whole Hivecore and nothing browns out at all. Protein is
  // 17 kJ/g with no multiplier: a tenth of 10 g/s is 1 g/s is 17 kW, which is
  // 34% of a fifty-kilowatt Hivecore — the fraction this block is written for.
  s.energy.preferred = 'protein';
  s.energy.fallback = 'protein';
  s.nutrients.protein = 5e6;
  s.structures.metabolicGenerator = 1;
  s.buildQueue = [];
  s.energyPool = 0;
  // Pinned every tick, because a generator's own charge climbs back on its own.
  for (let i = 0; i < 60; i += 1) {
    s.power.metabolicGenerator = 0.1;
    hive.tick(1);
  }
  s.power.metabolicGenerator = 0.1;
});
await p.waitForTimeout(250);

const brownout = await p.evaluate(() => {
  const d = hive.derived();
  const card = [...document.querySelectorAll('.action-slot')].find((c) =>
    c.querySelector('.action-name')?.textContent.trim().startsWith('Hivecore'),
  );
  return {
    line: card?.querySelector('.action-power')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    footer: card?.querySelector('.switch-label')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    charge: d.power.hivecore.charge,
    delivered: d.power.hivecore.delivered,
    direction: d.power.hivecore.direction,
  };
});

check('the Hivecore settles part-lit rather than dark',
  brownout.direction === 'holding' && brownout.charge > 0.01 && brownout.charge < 0.99,
  `${(brownout.charge * 100).toFixed(0)}% and ${brownout.direction}`);
check('the card says what it is getting, in watts',
  /\d+(\.\d+)?\s*[kM]W of the 50 kW it wants/.test(brownout.line), brownout.line);
check('and does not say the same percentage twice',
  (brownout.line.match(/(\d+)%/g) || []).length === 1, brownout.line);
check('the footer no longer just claims it is Running',
  /Running at \d+%/.test(brownout.footer), brownout.footer);

// Fully paid, and the footer goes back to the plain word.
const lit = await p.evaluate(() => {
  // Storage FIRST, then fuel: the tick clamps every store to its cap, so a
  // million grams of carbohydrate in a 2 kg granule is 2 kg a moment later and
  // the generators run dry mid-test.
  hive.state.structures.glycogenGranule = 400; // 80 kg of room
  hive.state.structures.metabolicGenerator = 2;
  hive.state.nutrients.carb = 80_000;
  delete hive.state.power.metabolicGenerator;
  hive.tick(60);
  const card = [...document.querySelectorAll('.action-slot')].find((c) =>
    c.querySelector('.action-name')?.textContent.trim().startsWith('Hivecore'),
  );
  return {
    charge: hive.derived().power.hivecore.charge,
    power: card?.querySelector('.action-power') ? true : false,
    footer: card?.querySelector('.switch-label')?.innerText.trim() ?? '',
  };
});
await p.waitForTimeout(220);
const litFooter = await p.evaluate(() =>
  [...document.querySelectorAll('.action-slot')]
    .find((c) => c.querySelector('.action-name')?.textContent.trim().startsWith('Hivecore'))
    ?.querySelector('.switch-label')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
);
check('a fully paid building says Running and nothing else',
  lit.charge > 0.999 && litFooter === 'Running', `${litFooter} at ${(lit.charge * 100).toFixed(0)}%`);

/* ================================================== 3. the chamber cycle bars */

await p.evaluate(() => {
  const s = hive.state;
  s.structures.broodChamber = 1;
  s.structures.moldingChamber = 1;
  s.structures.caecum = 1;
  s.nutrients.protein = 5_000;
  s.nutrients.carb = 5e6;
  s.brood = {};
  s.molding = {};
  hive.tick(6); // part-way through a 20s cycle
});
await p.waitForTimeout(250);

const brood = await p.evaluate(() => {
  const card = [...document.querySelectorAll('.action-slot')].find((c) =>
    c.querySelector('.action-name')?.textContent.trim().startsWith('Brood Chamber'),
  );
  const bar = card?.querySelector('.cycle-bar > span');
  return {
    text: card?.querySelector('.action-cycle')?.innerText.trim() ?? '',
    width: bar ? parseFloat(bar.style.width) : null,
    progress: hive.state.brood.broodChamber,
  };
});
check('a Brood Chamber shows a bar part-way along',
  brood.width > 20 && brood.width < 45, `${brood.width?.toFixed(0)}% wide`);
check('the bar matches the cycle underneath it',
  Math.abs(brood.width / 100 - brood.progress) < 0.02,
  `bar ${brood.width?.toFixed(1)}%, cycle ${(brood.progress * 100).toFixed(1)}%`);
check('and it says what is coming and when',
  /Larva in \d+s/.test(brood.text), brood.text);

const starved = await p.evaluate(() => {
  hive.state.nutrients.protein = 0;
  return null;
});
await p.waitForTimeout(220);
const starvedText = await p.evaluate(() =>
  [...document.querySelectorAll('.action-slot')]
    .find((c) => c.querySelector('.action-name')?.textContent.trim().startsWith('Brood Chamber'))
    ?.querySelector('.action-cycle')?.innerText.trim() ?? '',
);
check('a chamber that cannot pay says so rather than counting down',
  /Short of protein/.test(starvedText), starvedText);

await p.evaluate(() => { hive.state.nutrients.protein = 5_000; });

const molding = await p.evaluate(() => {
  hive.drones.setMolding('forager', true);
  hive.state.larvae = 5;
  // A Forager costs five grams of fat to press now, and this fixture has been
  // running generators on the stores.
  hive.state.nutrients.fat = 5_000;
  hive.state.structures.lipidDroplet = 100;
  hive.state.molding = {};
  hive.tick(4); // part-way through a cycle that five larvae make twice as fast
  return null;
});
await p.waitForTimeout(220);
const moldText = await p.evaluate(() => {
  const card = [...document.querySelectorAll('.action-slot')].find((c) =>
    c.querySelector('.action-name')?.textContent.trim().startsWith('Molding Chamber'),
  );
  return {
    text: card?.querySelector('.action-cycle')?.innerText.trim() ?? '',
    width: parseFloat(card?.querySelector('.cycle-bar > span')?.style.width ?? '0'),
  };
});
check('a Molding Chamber names what it is pressing',
  /Forager in \d+s/.test(moldText.text), moldText.text);
check('and says how much the brood is speeding it up',
  /×\d\.\d on a full brood/.test(moldText.text), moldText.text);
check('and its bar moves too', moldText.width > 20, `${moldText.width.toFixed(0)}% wide`);

const idleMold = await p.evaluate(() => {
  hive.drones.setMolding('forager', false);
  return null;
});
await p.waitForTimeout(220);
const idleText = await p.evaluate(() =>
  [...document.querySelectorAll('.action-slot')]
    .find((c) => c.querySelector('.action-name')?.textContent.trim().startsWith('Molding Chamber'))
    ?.querySelector('.action-cycle')?.innerText.trim() ?? '',
);
check('switching everything off says so on the card',
  /Nothing switched on/.test(idleText), idleText);

// A chamber with no power is not a chamber about to finish. "Larva in 0s"
// under a dark card reads as imminent, and it is the one thing that is
// certainly not about to happen.
await p.evaluate(() => {
  hive.drones.setMolding('forager', true);
  hive.state.power.broodChamber = 0;
  hive.state.power.moldingChamber = 0;
});
await p.waitForTimeout(220);
const darkCycle = await p.evaluate(() =>
  [...document.querySelectorAll('.action-slot')]
    .filter((c) => c.querySelector('.action-cycle'))
    .map((c) => c.querySelector('.action-cycle').innerText.trim()),
);
check('a dark chamber gives no countdown',
  darkCycle.length === 2 && darkCycle.every((t) => /Dark/.test(t)), darkCycle.join(' | '));
await p.evaluate(() => {
  hive.state.power.broodChamber = 1;
  hive.state.power.moldingChamber = 1;
  hive.drones.setMolding('forager', false);
});
await p.waitForTimeout(220);

// Nothing else grows a bar: a Vacuole is not doing anything over time.
const bars = await p.evaluate(() =>
  [...document.querySelectorAll('.action-slot')]
    .filter((c) => c.querySelector('.action-cycle'))
    .map((c) => c.querySelector('.action-name').textContent.trim()),
);
check('and only the chambers have one', bars.length === 2, bars.join(', '));

/* ============================================= 4. the new dedicated stores */

const stores = await p.evaluate(() => {
  const defs = hive.structureDefs;
  const s = hive.state;
  s.structures.lipidDroplet = 0;
  s.structures.glycogenGranule = 0; // the fuel test above left 400 standing
  s.structures.celluloseBale = 0;
  const before = hive.derived().caps;
  s.structures.lipidDroplet = 3;
  s.structures.glycogenGranule = 2;
  s.structures.celluloseBale = 2;
  const after = hive.derived().caps;
  return {
    fatDef: defs.lipidDroplet?.storage?.fat,
    carbDef: defs.glycogenGranule?.storage?.carb,
    fiberDef: defs.celluloseBale?.storage?.fiber,
    fatBand: defs.lipidDroplet?.category,
    carbBand: defs.glycogenGranule?.category,
    fiberBand: defs.celluloseBale?.category,
    fatUpkeep: defs.lipidDroplet?.upkeepWatts || 0,
    fiberUpkeep: defs.celluloseBale?.upkeepWatts || 0,
    // What one costs against what one holds — the only dedicated store that is
    // paid for in the thing it holds, so it has to come out ahead.
    firstCost: defs.celluloseBale?.cost(0).fiber,
    fat: after.fat - before.fat,
    carb: after.carb - before.carb,
    fiber: after.fiber - before.fiber,
    protein: after.protein - before.protein,
  };
});
check('there is a dedicated fat store', stores.fatDef === 200 && stores.fatBand === 'storage',
  `${stores.fatDef} g, ${stores.fatBand} band`);
check('and a dedicated carbohydrate store',
  stores.carbDef === 200 && stores.carbBand === 'storage', `${stores.carbDef} g`);
check('and a dedicated fibre store',
  stores.fiberDef === 500 && stores.fiberBand === 'storage', `${stores.fiberDef} g`);
check('which holds more fibre than it costs, or it would be a hole in the ground',
  stores.firstCost < stores.fiberDef, `${stores.firstCost} g to build, ${stores.fiberDef} g held`);
check('three of one and two of the others add exactly that much room',
  stores.fat === 600 && stores.carb === 400 && stores.fiber === 1_000 && stores.protein === 0,
  `+${stores.fat} g fat, +${stores.carb} g carb, +${stores.fiber} g fibre`);
check('and they cost nothing to keep',
  stores.fatUpkeep === 0 && stores.fiberUpkeep === 0, `${stores.fatUpkeep} W`);

await openTab(p, 'Hive');
await p.waitForTimeout(250);
const lipid = await cardText(p, 'Lipid Droplet');
const bale = await cardText(p, 'Cellulose Bale');
const crop = await cardText(p, 'Crop Chamber');
const core = await cardText(p, 'Hivecore');
check('the fat store says what it holds', /\+200 g fat storage/.test(lipid || ''), lipid?.slice(-80));
check('and the fibre store says what it holds',
  /\+500 g fibre storage/.test(bale || ''), bale?.slice(-80));
check('the Crop Chamber advertises its larder',
  /\+2 kg raw matter storage/.test(crop || ''), crop?.slice(-80));
check('and the Hivecore still says nothing about storage at all',
  !/storage/i.test(core || ''), core?.slice(-90));

/* ============================================= 5. the Cognition band is live */

const node = await p.evaluate(() => {
  const def = hive.structureDefs.nodeCluster;
  const s = hive.state;
  s.structures.nodeCluster = 0;
  const before = hive.cognition().capacity;
  const beforeDemand = hive.derived().energy.demand;
  s.structures.nodeCluster = 3;
  delete s.power.nodeCluster;
  const after = hive.cognition();
  return {
    band: def?.category,
    cogits: def?.cogitCapacity,
    watts: def?.upkeepWatts,
    before,
    capacity: after.capacity,
    supply: after.supply.find((x) => x.key === 'structure:nodeCluster'),
    demand: hive.derived().energy.demand - beforeDemand,
    parked: hive.structureOrder.includes('nodeCluster'),
  };
});
check('a Nerve Node supplies 5 Cg for 20 kW — a fraction of what those five drones earn',
  node.cogits === 5 && node.watts === 20_000, `${node.cogits} Cg, ${node.watts / 1000} kW`);
check('and it is filed under Cognition, so the band is no longer empty',
  node.band === 'cognition' && node.parked, node.band);
check('three of them widen the hive by fifteen',
  Math.abs(node.capacity - node.before - 15) < 1e-9,
  `${node.before} Cg → ${node.capacity} Cg`);
check('itemised by name, like every other supply',
  /Nerve Node ×3/.test(node.supply?.label ?? ''), node.supply?.label);
check('and billed for three times its upkeep',
  Math.abs(node.demand - 60_000) < 1, `${(node.demand / 1000).toFixed(0)} kW added`);

// Bandwidth is a benefit, so it browns out with everything else.
const dimmed = await p.evaluate(() => {
  hive.state.power.nodeCluster = 0.4;
  return hive.cognition();
});
check('a Nerve Node at 40% supplies 40% of its cogits',
  Math.abs(dimmed.capacity - node.before - 6) < 1e-9,
  `${(dimmed.capacity - node.before).toFixed(1)} Cg of 15`);

await openTab(p, 'Hive');
await p.waitForTimeout(250);
const nodeCard = await cardText(p, 'Nerve Node');
check('the card says what it gives and what it costs',
  /\+5 Cg cognition/.test(nodeCard || '') && /20 kW upkeep/.test(nodeCard || ''),
  nodeCard?.slice(-70));
await p.evaluate(() => { hive.state.structures.nodeCluster = 0; delete hive.state.power.nodeCluster; });

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
