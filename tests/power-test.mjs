import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * Brownout, recovery, and the order energy is handed out in.
 *
 * The claims under test:
 *   1. a building that cannot get its watts loses its output LINEARLY over
 *      thirty seconds, and gets it back the same way
 *   2. what it loses is its BENEFITS; its costs do not shrink, which is the
 *      only reason it can ever come back
 *   3. energy goes band by band down the Hive tab, and left to right inside a
 *      band, so a shortfall always lands on the bottom of the list
 *   4. the Anthill lands with a lit Hivecore, and therefore with a problem
 *   5. the gather button's odds are obfuscated off the same discovery log the
 *      Territory tab reads, and the two move together
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
  await page.waitForTimeout(140);
}


// ---------------------------------------------------------------- test larder
// The hive holds nothing on its own any more: every gram of room comes from
// something built, and the Anthill's only storage is its Hivecore at a tenth of
// the reference scale per level. A test that wants somewhere to put fifteen
// kilos of anything has to build the room first — and a fixture rather than a
// Hivecore, because a Hivecore would also drag a megawatt of upkeep into the
// measurement.
async function giveStorage(page, share = 1) {
  await page.evaluate((mult) => {
    // Mirrors the Hivecore's own flat storage map, scaled — so the proportions
    // between nutrients stay exactly what the game uses.
    const store = {};
    for (const [k, v] of Object.entries(hive.structureDefs.hivecore.storage)) store[k] = v * mult;
    hive.structureDefs.__larder = {
      id: '__larder', name: 'Test larder', category: 'storage', time: 'short',
      unlock: () => false, cost: () => ({ protein: 1 }),
      storage: store, itemStorage: 200 * mult,
    };
    if (!hive.structureOrder.includes('__larder')) hive.structureOrder.push('__larder');
    hive.state.structures.__larder = 1;
  }, share);
}

const base = BASE;
const browser = await chromium.launch(LAUNCH);

const fail = [];
const parked = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};
const park = (label, why) => {
  console.log(`PARK  ${label} — ${why}`);
  parked.push(label);
};

const errors = [];
const p = await browser.newPage({ viewport: { width: 1480, height: 1000 } });
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await p.goto(base, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
// Read rather than pinned: a save-format bump is not a reason for four suites
// that are about storage, territory and discovery to start failing.
const SAVE_VERSION = await p.evaluate(() => hive.saveVersion);
// Take the clock. Every sample below is then exactly the simulation time asked
// for, rather than that plus however long a round-trip took.
await p.waitForTimeout(300);
await p.evaluate(() => hive.loop.stop());

/* ============================================ 4. the Anthill lands with a core */

const beforeLanding = await p.evaluate(() => ({
  hivecore: hive.state.structures.hivecore,
  origin: hive.state.origin,
}));
check('nothing is built before a site is chosen',
  !beforeLanding.origin && beforeLanding.hivecore === 0);

await ensureLanded(p);

const landed = await p.evaluate(() => {
  const seed = hive.state.energyPool;
  // The site hands over a banked 240 MJ so the player is not browning out
  // while they are still reading the screen. Everything below this point is
  // about what happens when that runs out, so spend it.
  hive.state.energyPool = 0;
  const d = hive.derived();
  return {
    level: hive.state.structures.hivecore,
    charge: d.power.hivecore.charge,
    satisfied: d.power.hivecore.satisfied,
    direction: d.power.hivecore.direction,
    cogits: d.cognition.capacity,
    demand: d.energy.demand,
    generated: d.energy.generated,
    generators: hive.state.structures.metabolicGenerator,
    nutrients: Object.values(hive.state.nutrients).reduce((a, b) => a + b, 0),
    drones: hive.state.drones,
    seed,
  };
});
check('the Anthill lands with a level 1 Hivecore', landed.level === 1, `Lv ${landed.level}`);
check('and with a gigajoule of grace in the seed — half an hour of Hivecore',
  landed.seed === 1e9, `${(landed.seed / 1e6).toFixed(0)} MJ`);
check('and with nothing else at all',
  landed.generators === 0 && landed.nutrients === 0 && landed.drones === 0,
  `${landed.generators} generators, ${landed.nutrients} g, ${landed.drones} drones`);
check('it lands LIT, at full charge', landed.charge === 1, landed.charge.toFixed(3));
check('it supplies its full 5 Cg on the first frame', landed.cogits === 5, `${landed.cogits} Cg`);
check('but nothing is paying for it', landed.demand === 50e3 && landed.generated === 0,
  `${hiveFmt(landed.demand)} demanded, ${hiveFmt(landed.generated)} made`);
check('so it is already failing', !landed.satisfied && landed.direction === 'failing',
  landed.direction);

function hiveFmt(w) {
  return w >= 1e6 ? `${(w / 1e6).toFixed(0)} MW` : `${(w / 1e3).toFixed(0)} kW`;
}

/* ====================================================== 1. the decay is linear */

const BROWNOUT = await p.evaluate(() => hive.brownoutSeconds);
check('the fade takes thirty seconds', BROWNOUT === 30, `${BROWNOUT}s`);

const curve = await p.evaluate(() => {
  // Driven by hand with the loop stopped, so the sample points are exact:
  // seven and a half seconds of simulation is a quarter of the charge.
  // Deliberately NOT refuelled — this one is the fade to dark.
  const out = [];
  for (let step = 0; step < 4; step += 1) {
    out.push(hive.derived().power.hivecore.charge);
    hive.tick(7.5);
  }
  out.push(hive.derived().power.hivecore.charge);
  return out;
});
check('charge falls in a straight line',
  curve.every((c, i) => Math.abs(c - Math.max(0, 1 - i * 0.25)) < 1e-9),
  curve.map((c) => c.toFixed(2)).join(' → '));
check('and stops at zero rather than going negative',
  curve[4] === 0, curve[4].toFixed(3));

const dark = await p.evaluate(() => {
  const d = hive.derived();
  return { cogits: d.cognition.capacity, used: d.cognition.used, watts: d.power.hivecore.watts };
});
check('a dark building supplies nothing', dark.cogits === 0, `${dark.cogits} Cg`);
check('but it still asks for every watt', dark.watts === 50e3, hiveFmt(dark.watts));

/* ============================================ 2. benefits scale, costs do not */

const scaled = await p.evaluate(() => {
  const s = hive.state;
  s.nutrients.carb = 5e6;
  // One generator: 10 g/s of carbohydrate is nowhere near 1 MW, so the core
  // keeps failing while the generator itself is untouched.
  s.structures.metabolicGenerator = 1;
  s.power.hivecore = 0.4;
  const d = hive.derived();
  return {
    cogits: d.cognition.capacity,
    massRate: d.energy.massRate,
    generatorCharge: d.power.metabolicGenerator.charge,
    generatorSatisfied: d.power.metabolicGenerator.satisfied,
    coreWatts: d.power.hivecore.watts,
    label: d.cognition.supply[0]?.label ?? '',
  };
});
check('a building at 40% supplies 40% of its cogits',
  Math.abs(scaled.cogits - 2) < 1e-9, `${scaled.cogits} Cg of 5`);
check('and its upkeep is still the full figure',
  scaled.coreWatts === 50e3, hiveFmt(scaled.coreWatts));
check('the breakdown says it is running short',
  /40%/.test(scaled.label), scaled.label);
check('a generator has no upkeep, so nothing can starve it',
  scaled.generatorSatisfied && scaled.generatorCharge === 1,
  `charge ${scaled.generatorCharge}`);
// 30, not 10: this one is pointed at sugar, which goes through three times as
// fast. The rate reported is the rate the SHELF loses, which is the only one a
// player can check a store against.
check('and it metabolises at its full rate', scaled.massRate === 30, `${scaled.massRate} g/s`);

/* ======================================================= 1b. recovery is linear */

/*
 * SELF-CONTAINED, deliberately. This used to inherit whatever the two sections
 * above had left behind — emptied stores, `state.active` still reading
 * `{ hivecore: 1 }` so the four hundred generators it set were never switched
 * on, and no metabolism tech to open a store with. Generation was flatly zero,
 * and what the check was actually watching climb was the old two-way energy
 * bank feeding the core out of a surplus accumulated earlier in the run. The
 * bank is gone — a reserve only ever drains now — and the fixture had nothing
 * left to stand on.
 */
const back = await p.evaluate(() => {
  const s = hive.state;
  s.tech = { ...s.tech, glycolysis: true, lipolysis: true };
  // FOUR, not four hundred. A generator makes about 324 kW, so four cover the
  // core's 50 kW several times over — and four hundred cannot be FED: they want
  // twelve kilos of fuel a second out of a larder that caps around two, so
  // generation collapses the moment the shelf is drained. That used not to
  // matter, because the shortfall came out of the banked surplus. There is no
  // bank any more, so the fixture has to be physically possible.
  s.structures = { hivecore: 1, metabolicGenerator: 4 };
  s.active = { ...s.structures };
  s.power = { hivecore: 0, metabolicGenerator: 1 };
  s.energyPool = 0; // nothing banked: every watt below is made this step
  const fuel = () => { s.nutrients.carb = 5e5; s.nutrients.fat = 5e5; };

  const out = [];
  for (let step = 0; step < 4; step += 1) {
    fuel();
    out.push(hive.derived().power.hivecore.charge);
    hive.tick(7.5);
  }
  fuel();
  const d = hive.derived();
  out.push(d.power.hivecore.charge);
  return {
    curve: out,
    direction: d.power.hivecore.direction,
    cogits: d.cognition.capacity,
    generated: d.energy.generated,
    pool: s.energyPool,
  };
});

check('nothing is banked, so the recovery is paid for as it happens',
  back.pool === 0 && back.generated > 0,
  `${Math.round(back.generated)} W generated, ${Math.round(back.pool)} J in reserve`);
check('power restored climbs back in a straight line',
  back.curve.every((c, i) => Math.abs(c - Math.min(1, i * 0.25)) < 1e-9),
  back.curve.map((c) => c.toFixed(2)).join(' → '));
check('and stops at full rather than overshooting', back.curve[4] === 1);
check('a fully powered building reads as steady', back.direction === 'steady', back.direction);
check('and supplies everything again', back.cogits === 5, `${back.cogits} Cg`);

const halfway = await p.evaluate(() => {
  hive.state.power.hivecore = 0.5;
  const d = hive.derived();
  return { direction: d.power.hivecore.direction, left: d.power.hivecore.secondsLeft };
});
check('a building on its way back says so, and says how long',
  halfway.direction === 'recovering' && Math.abs(halfway.left - 15) < 1e-9,
  `${halfway.direction}, ${halfway.left}s`);

/* ============================================== a new building starts lit */

const fresh = await p.evaluate(() => {
  const s = hive.state;
  s.structures.metabolicGenerator = 0;
  hive.tick(0.1); // the tick is what forgets a charge
  const forgotten = s.power.metabolicGenerator;
  s.structures.metabolicGenerator = 1;
  return { forgotten, charge: hive.derived().power.metabolicGenerator.charge };
});
check('pulling the last one down forgets its charge', fresh.forgotten === undefined,
  String(fresh.forgotten));
check('so the next one built starts lit, not dead', fresh.charge === 1, fresh.charge.toFixed(2));

/* ==================================================== 3. the priority order */

const order = await p.evaluate(() => ({
  queue: hive.powerPriority(),
  bands: hive.powerPriority().map((id) => hive.structureDefs[id].category),
  bandOrder: hive.buildingCategoryOrder,
}));
// Asserted as a RULE rather than a fixed list, so adding a building to a band
// does not break this — only putting one in the wrong place does.
const rank = (c) => order.bandOrder.indexOf(c);
check('the queue is band order, then display order',
  order.bands.every((c, i) => i === 0 || rank(order.bands[i - 1]) <= rank(c)),
  order.queue.map((id, i) => `${id} (${order.bands[i]})`).join(' > '));

const bandOrder = await p.evaluate(() => {
  // Band order has to be tested with more than one band's worth of buildings,
  // and during the rebuild there are only two live ones — so two are injected
  // in deliberately BACKWARDS declaration order. If the rule were simply
  // STRUCTURE_ORDER, the storage building would be billed before the cognition
  // building; it must not be.
  const STRUCTURES = hive.structureDefs;
  const STRUCTURE_ORDER = hive.structureOrder;
  STRUCTURES.__vault = {
    id: '__vault', name: 'Test vault', category: 'storage', time: 'short',
    unlock: () => true, cost: () => ({ protein: 1 }), upkeepWatts: 400,
  };
  STRUCTURES.__ganglion = {
    id: '__ganglion', name: 'Test ganglion', category: 'cognition', time: 'short',
    unlock: () => true, cost: () => ({ protein: 1 }), upkeepWatts: 400,
  };
  STRUCTURE_ORDER.push('__vault', '__ganglion');
  return hive.powerPriority();
});
check('a later-declared cognition building outranks an earlier storage one',
  bandOrder.indexOf('__ganglion') < bandOrder.indexOf('__vault'),
  bandOrder.join(' > '));

await giveStorage(p, 50);
const shortfall = await p.evaluate(() => {
  const s = hive.state;
  // The banked pool is a battery, and a full one covers any shortfall until it
  // runs out — correct, but it is not what is being tested here.
  s.energyPool = 0;
  s.structures.hivecore = 0; // out of the way: a megawatt swamps everything
  s.structures.__ganglion = 1;
  s.structures.__vault = 1;
  s.power.__ganglion = 1;
  s.power.__vault = 1;
  s.nutrients.carb = 5e6;
  // 600 W of supply against 800 W of demand: enough for the cognition
  // building and not enough for the storage one.
  s.structures.metabolicGenerator = 1; // 10 g/s carb ≈ 170 W... scale it
  const d0 = hive.derived();
  return {
    generated: d0.energy.generated,
    demand: d0.energy.demand,
    keys: d0.demands.map((x) => x.key),
  };
});
check('the demand list is billed in priority order',
  shortfall.keys.join(',') === 'structure:__ganglion,structure:__vault',
  shortfall.keys.join(' | '));

const landing = await p.evaluate(() => {
  const s = hive.state;
  s.energyPool = 0;
  // Tune the supply to sit between the two: whatever one generator makes,
  // enough to pay the first building and not the second.
  const per = hive.derived().energy.generated;
  s.structures.__ganglion = 1;
  s.structures.__vault = 1;
  hive.structureDefs.__ganglion.upkeepWatts = per * 0.9;
  hive.structureDefs.__vault.upkeepWatts = per * 0.9;
  const d = hive.derived();
  return {
    ganglion: d.power.__ganglion.satisfied,
    vault: d.power.__vault.satisfied,
    generated: d.energy.generated,
    demand: d.energy.demand,
  };
});
check('a shortfall lands on the bottom of the list, not the top',
  landing.ganglion && !landing.vault,
  `cognition ${landing.ganglion ? 'lit' : 'dark'}, storage ${landing.vault ? 'lit' : 'dark'}`);

const cascade = await p.evaluate(() => {
  hive.state.energyPool = 0;
  for (let i = 0; i < 40; i += 1) hive.tick(1);
  const d = hive.derived();
  return {
    ganglion: d.power.__ganglion.charge,
    vault: d.power.__vault.charge,
    starved: d.starvedCount,
    faded: d.fadedCount,
  };
});
check('the one that lost out settles at the scraps it gets, not at zero',
  cascade.vault > 0 && cascade.vault < 0.5, cascade.vault.toFixed(3));
check('the one above it is untouched', cascade.ganglion === 1, cascade.ganglion.toFixed(2));
check('the count of starving buildings is reported', cascade.starved === 1, String(cascade.starved));
check('as is the count running at less than full', cascade.faded === 1, String(cascade.faded));

await p.evaluate(() => {
  const STRUCTURES = hive.structureDefs;
  const STRUCTURE_ORDER = hive.structureOrder;
  STRUCTURE_ORDER.splice(STRUCTURE_ORDER.indexOf('__vault'), 1);
  STRUCTURE_ORDER.splice(STRUCTURE_ORDER.indexOf('__ganglion'), 1);
  delete STRUCTURES.__vault;
  delete STRUCTURES.__ganglion;
  delete hive.state.structures.__vault;
  delete hive.state.structures.__ganglion;
  delete hive.state.power.__vault;
  delete hive.state.power.__ganglion;
});

/* ================================================== charge survives a reload */

await p.evaluate(() => {
  const s = hive.state;
  s.structures.hivecore = 1;
  s.structures.metabolicGenerator = 0;
  s.power.hivecore = 0.6;
  s.nutrients.carb = 0;
  s.energyPool = 0;
  hive.save();
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await p.evaluate(() => hive.loop.stop());
const reloaded = await p.evaluate(() => ({
  charge: hive.state.power.hivecore,
  version: hive.state.version,
}));
check('a half-dead building is still half dead after a reload',
  reloaded.charge > 0.2 && reloaded.charge < 0.65,
  reloaded.charge?.toFixed(3));
check('and the save round-trips at the current version',
  reloaded.version === SAVE_VERSION, `v${reloaded.version}`);

/* ================================================ the interface says all this */

await openTab(p, 'Hive');
await p.evaluate(() => {
  const s = hive.state;
  s.power.hivecore = 0.33;
  s.nutrients.carb = 0;
  s.structures.metabolicGenerator = 0;
  s.energyPool = 0;
  hive.tick(0.1); // one step, so the deficit is live in the derived state
});
await p.waitForTimeout(250);
const shown = await p.evaluate(() => {
  const card = [...document.querySelectorAll('.action-card')]
    .find((c) => c.textContent.includes('Hivecore'));
  const power = card?.querySelector('.action-power');
  const bar = power?.querySelector('.power-bar > span');
  const notice = document.querySelector('.notice.is-warn')?.textContent.replace(/\s+/g, ' ').trim();
  const bands = [...document.querySelectorAll('.band-desc')].map((b) => b.textContent.trim());
  return {
    power: power?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    barWidth: bar?.style.width ?? null,
    notice,
    bands,
  };
});
check('the card says it is losing power, and how much is left',
  /Losing power/.test(shown.power || '') && /% output/.test(shown.power || '') &&
  /dark in \d+s/.test(shown.power || ''),
  shown.power);
check('the bar matches the charge', shown.barWidth && parseFloat(shown.barWidth) < 40,
  shown.barWidth);
check('the deficit notice explains the order',
  /band by band/.test(shown.notice || ''), (shown.notice || '').slice(0, 120));
check('and names what is short and where it will settle',
  /Hivecore/.test(shown.notice || '') && /settle at/.test(shown.notice || '') &&
  /0%/.test(shown.notice || ''),
  (shown.notice || '').slice(-180));
check('the Core band flags it even folded shut',
  shown.bands.some((b) => /short of power/.test(b)), shown.bands[0]);

/* ======================= 6. partial supply holds a partial building, not a dark one */

// The reported bug: a Hivecore that had gone to 0% stayed at 0% even once the
// hive was making 340 kW of its megawatt. It should sit at 34%.
const partial = await p.evaluate(() => {
  const s = hive.state;
  s.structures.hivecore = 1;
  s.structures.metabolicGenerator = 1;
  // Both running and NOTHING ELSE, explicitly. An absent `active` entry means
  // "all of them", so clearing the map would leave every structure an earlier
  // section built still drawing — and a Hivecore nobody is billing for makes
  // this whole measurement meaningless either way.
  // And nothing lined up: the build queue grows buildings mid-tick now, so a
  // leftover entry from an earlier section would quietly double the generator
  // count halfway through a sixty-second measurement.
  s.buildQueue = [];
  s.active = {};
  for (const id of hive.structureOrder) s.active[id] = 0;
  s.active.hivecore = 1;
  s.active.metabolicGenerator = 1;
  s.power.hivecore = 0;
  s.power.metabolicGenerator = 1;
  s.energyPool = 0;
  // PROTEIN, not carbohydrate. Sugar now runs a generator at three times the
  // rate (see nutrients.js carb), so a tenth-charge generator on sugar makes
  // 46 kW — nearly the whole Hivecore, and nothing browns out at all. Protein
  // is the same 17 kJ/g with no multiplier, so a tenth of 10 g/s is 1 g/s is
  // 17 kW, which is 34% of a fifty-kilowatt Hivecore: the fraction this test
  // was written around.
  s.energy.preferred = 'protein';
  s.energy.fallback = 'protein';
  s.nutrients.protein = 5e6;
  const step = (n) => {
    for (let i = 0; i < n; i += 1) {
      s.power.metabolicGenerator = 0.1;
      hive.tick(1);
    }
  };

  s.power.metabolicGenerator = 0.1;
  const before = hive.derived();
  step(60); // long enough for a full swing either way
  s.power.metabolicGenerator = 0.1; // the last tick let it start climbing again
  const after = hive.derived();
  return {
    generated: before.energy.generated,
    demand: before.energy.demand,
    target: before.power.hivecore.target,
    startCharge: 0,
    charge: after.power.hivecore.charge,
    direction: after.power.hivecore.direction,
    cogits: after.cognition.capacity,
    ratio: after.energy.ratio,
  };
});
const share = partial.generated / partial.demand;
check('a part-paid building targets the share it is paid',
  Math.abs(partial.target - share) < 0.02,
  `${(partial.generated / 1000).toFixed(0)} kW of ${(partial.demand / 1e6).toFixed(0)} MW = ${(partial.target * 100).toFixed(0)}%`);
// Measured against the share it is actually being paid rather than a figure
// written here: protein recovers 70% of its 17 kJ/g now, so the fraction moved
// when the efficiency model landed and a hard-coded one would only ever be
// testing how recently somebody updated it.
check('and climbs OUT of the dark to get there, rather than staying at zero',
  partial.charge > 0.05 && Math.abs(partial.charge - share) < 0.02,
  `0% -> ${(partial.charge * 100).toFixed(0)}%, paid ${(share * 100).toFixed(0)}%`);
check('then holds there instead of drifting',
  partial.direction === 'holding', partial.direction);
check('and supplies that share of its cogits',
  Math.abs(partial.cogits - 5 * partial.charge) < 1e-9,
  `${partial.cogits.toFixed(2)} Cg of 5`);

const settleTime = await p.evaluate(() => {
  // Falling to a target takes proportionally less than a full swing: cutting a
  // building to a third should take two thirds of BROWNOUT_SECONDS, not all of it.
  const s = hive.state;
  s.power.hivecore = 1;
  const out = [];
  // Seven samples, not five: the target is lower than it was before the
  // efficiency model, so the fall has further to go and five five-second steps
  // no longer reach it. Sampled past the landing on purpose, so the check is
  // "it stops" rather than "it happens to be there at sample five".
  for (let i = 0; i < 7; i += 1) {
    out.push(hive.derived().power.hivecore.charge);
    for (let t = 0; t < 5; t += 1) {
      s.power.metabolicGenerator = 0.1;
      hive.tick(1);
    }
  }
  s.power.metabolicGenerator = 0.1;
  return { curve: out, target: hive.derived().power.hivecore.target };
});
check('the fall is linear and stops dead on the target',
  settleTime.curve[0] === 1
  && Math.abs(settleTime.curve[1] - (1 - 5 / 30)) < 1e-9
  && Math.abs(settleTime.curve.at(-1) - settleTime.target) < 1e-9,
  `${settleTime.curve.map((c) => c.toFixed(2)).join(' -> ')} against a target of ${settleTime.target.toFixed(2)}`);

/* ====================== 7. only generators choose a fuel */

const fuelUi = await p.evaluate(() => {
  const s = hive.state;
  s.structures.metabolicGenerator = 2;
  s.structures.hivecore = 1;
  const d = hive.derived();
  return {
    generators: d.generators.map((g) => ({ id: g.id, key: g.key, count: g.count, drew: g.drew })),
    consumerKeys: d.demands.map((x) => x.key),
  };
});
check('the generator is the only thing with a fuel choice',
  fuelUi.generators.length === 1 && fuelUi.generators[0].id === 'metabolicGenerator',
  fuelUi.generators.map((g) => g.key).join(', '));
check('and it is keyed per structure, not globally',
  fuelUi.generators[0].key === 'structure:metabolicGenerator', fuelUi.generators[0].key);
check('the Hivecore is a consumer, not a fuel chooser',
  fuelUi.consumerKeys.includes('structure:hivecore') &&
  !fuelUi.generators.some((g) => g.id === 'hivecore'));

const override = await p.evaluate(() => {
  const s = hive.state;
  s.nutrients.carb = 1e6;
  s.nutrients.fat = 1e6;
  s.energy.preferred = 'carb';
  s.energy.fallback = 'fat';
  const byDefault = Object.keys(hive.derived().generators[0].drew);
  hive.setFuelOverride('structure:metabolicGenerator', 'fat', 'carb');
  const overridden = hive.derived().generators[0];
  hive.clearFuelOverride('structure:metabolicGenerator');
  const cleared = Object.keys(hive.derived().generators[0].drew);
  return { byDefault, overridden: Object.keys(overridden.drew), flag: overridden.overridden, cleared };
});
check('a generator follows the hive default', override.byDefault.join() === 'carb',
  override.byDefault.join());
check('an override points it somewhere else',
  override.overridden.join() === 'fat' && override.flag, override.overridden.join());
check('and resetting gives the default back', override.cleared.join() === 'carb',
  override.cleared.join());

await openTab(p, 'Metabolism');
const metaUi = await p.evaluate(() => {
  const text = document.body.innerText;
  return {
    selects: document.querySelectorAll('.fuel-select').length,
    rows: [...document.querySelectorAll('.fuel-row .field-label')].map((e) =>
      e.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)),
    queue: /Where it goes/i.test(text),
    onlyGenerators: !/Hivecore/.test(
      [...document.querySelectorAll('.fuel-row')].map((e) => e.textContent).join(' '),
    ),
  };
});
check('the Metabolism tab offers a fuel choice only to generators',
  metaUi.onlyGenerators && metaUi.rows.some((r) => /Metabolic Generator/.test(r)),
  metaUi.rows.join(' | '));
check('two rows, two selects each: the hive default and the generator',
  metaUi.selects === 4, `${metaUi.selects} selects`);
check('and the consumers are listed read-only under their own heading', metaUi.queue);

/* ====================== 8. a mouthful is not always the same mouthful */

const mouthfuls = await p.evaluate(() => {
  const grams = [];
  for (let i = 0; i < 400; i += 1) {
    // Held cold: this block is about the SIZE of a mouthful, and a run of fast
    // presses multiplies it by up to three. The combo has its own suite.
    hive.state.clickHeat = 0;
    hive.consumeBiomass();
    // The press adds its own first step of heat, so divide it back out: what
    // is under test here is the mouthful, not the multiplier on it.
    grams.push(hive.state.lastGather.grams / hive.state.lastGather.multiplier);
  }
  hive.state.clickHeat = 0;
  return { grams, intake: hive.manualIntake };
});
const g = mouthfuls.grams;
const mean = g.reduce((a, b) => a + b, 0) / g.length;
const lo = Math.min(...g);
const hi = Math.max(...g);
check('a click no longer returns the same weight every time',
  new Set(g.map((x) => x.toFixed(4))).size > 300, `${new Set(g).size} distinct in 400`);
check('every mouthful is inside the declared band',
  lo >= mouthfuls.intake.min - 1e-9 && hi <= mouthfuls.intake.max + 1e-9,
  `${lo.toFixed(1)}-${hi.toFixed(1)} g in ${mouthfuls.intake.min}-${mouthfuls.intake.max}`);
check('and the band is centred on 40 g', Math.abs(mean - 40) < 1.2, `mean ${mean.toFixed(2)} g`);
check('the spread is a triangle, not a flat band: the middle is commonest',
  g.filter((x) => Math.abs(x - 40) < 4).length > g.filter((x) => Math.abs(x - 40) > 8).length,
  `${g.filter((x) => Math.abs(x - 40) < 4).length} near the middle vs ${g.filter((x) => Math.abs(x - 40) > 8).length} out at the edges`);

const tipRange = await p.evaluate(() => {
  const tip = [...document.querySelectorAll('.tip-body')]
    .find((t) => t.textContent.includes("hive's own territory"));
  return tip?.textContent.replace(/\s+/g, ' ').trim() ?? null;
});
check('the tooltip advertises the range rather than a fixed figure',
  /28 g to 52 g/.test(tipRange || ''), tipRange);

/* ================================= 5. the gather odds are obfuscated likewise */

const odds0 = await p.evaluate(() => {
  hive.state.found = {};
  return { odds: hive.manualOdds(4), summary: hive.manualOddsSummary() };
});
check('nothing a click could turn up has a name yet',
  odds0.odds.length > 0 && odds0.odds.every((o) => o.label === '???'),
  odds0.odds.map((o) => o.label).join(', '));
check('and nothing has a rate',
  odds0.odds.every((o) => o.rate === '?%' && o.level === 'unknown'),
  odds0.odds.map((o) => o.rate).join(', '));
check('the summary counts what is known', odds0.summary.named === 0 && odds0.summary.exact === 0,
  `${odds0.summary.named} of ${odds0.summary.total}`);

const synced = await p.evaluate(() => {
  const target = hive.manualOdds(1)[0].itemId;
  // One find, recorded exactly as a click records it.
  hive.discovery.recordFind(hive.state, 'temperateForest', target);
  return {
    target,
    real: hive.items[target].name,
    odds: hive.manualOdds(1)[0],
    // The territory table reads the very same log.
    territoryNamed: hive.discovery.isNamed(hive.state, target),
  };
});
check('one find names it on the gather button',
  synced.odds.label === synced.real && synced.odds.named,
  `${synced.odds.label} (${synced.odds.rate})`);
check('and names it in the territory table in the same breath',
  synced.territoryNamed, synced.target);
check('a name does not hand over the rate', synced.odds.rate === '?%', synced.odds.rate);

// Counted off the real thresholds rather than written out as 9 and 15. They
// moved by an order of magnitude when a forage roll stopped being a patch and
// became a drone (see discovery.js), and a suite that hard-codes them goes red
// on a tuning change rather than on a broken one.
const bracketed = await p.evaluate(() => {
  const { RANGE_AT, EXACT_AT } = hive.discovery;
  const target = hive.manualOdds(1)[0].itemId;
  const find = (n) => {
    for (let i = 0; i < n; i += 1) {
      hive.discovery.recordFind(hive.state, 'temperateForest', target);
    }
  };
  find(RANGE_AT - 1); // one already banked from the roll above
  const ten = hive.manualOdds(1)[0];
  find(EXACT_AT - RANGE_AT);
  const twentyFive = hive.manualOdds(1)[0];
  return { ten, twentyFive, RANGE_AT, EXACT_AT };
});
check('enough finds bracket the rate on the gather button',
  bracketed.ten.level === 'range' && /^\d+–\d+%$/.test(bracketed.ten.rate),
  `${bracketed.RANGE_AT} finds → ${bracketed.ten.rate}`);
check('and enough more pin it down',
  bracketed.twentyFive.level === 'exact' && /^\d+%$/.test(bracketed.twentyFive.rate),
  `${bracketed.EXACT_AT} finds → ${bracketed.twentyFive.rate}`);
check('the bracket contains the truth',
  (() => {
    const [lo, hi] = bracketed.ten.rate.replace('%', '').split('–').map(Number);
    const pct = bracketed.ten.chance * 100;
    return pct >= lo && pct <= hi;
  })(),
  `${(bracketed.ten.chance * 100).toFixed(1)}% in ${bracketed.ten.rate}`);

const blended = await p.evaluate(() => {
  // Two biomes with one item in BOTH. Knowing the forest exactly is not knowing
  // what a click will do once half the hive is street the drones have never
  // walked, because the click might land there instead.
  const here = new Set(
    [...hive.poolFor('forager', 'temperateForest'), ...hive.poolFor('scavenger', 'temperateForest')]
      .map((e) => e.itemId),
  );
  const shared = [...hive.poolFor('forager', 'denseUrban'), ...hive.poolFor('scavenger', 'denseUrban')]
    .map((e) => e.itemId)
    .find((id) => here.has(id));
  if (!shared) return { shared: null };

  // Learn it to the hilt in the forest, and only in the forest.
  for (let i = 0; i <= hive.discovery.EXACT_AT; i += 1) {
    hive.discovery.recordFind(hive.state, 'temperateForest', shared);
  }
  const before = hive.manualOdds(Infinity).find((o) => o.itemId === shared);
  hive.run.grantTerritory('denseUrban', 36);
  const after = hive.manualOdds(Infinity).find((o) => o.itemId === shared);
  return { shared, beforeLevel: before.level, after, biomes: after?.biomeIds ?? [] };
});
if (blended.shared && blended.biomes.length > 1) {
  check('the name survives taking on new ground', blended.after.named, blended.after.label);
  check('but a rate that was exact goes vague again',
    blended.beforeLevel === 'exact' && blended.after.level === 'unknown',
    `${blended.beforeLevel} → ${blended.after.level} across ${blended.biomes.length} biomes`);
  check('because a blend is only as known as its worst-known ground',
    blended.after.rate === '?%', blended.after.rate);
} else {
  park('a rate blended across new ground goes vague again',
    'no item is shared between temperate forest and dense urban');
}

const tooltip = await p.evaluate(() => {
  const tip = [...document.querySelectorAll('.tip-body')]
    .find((t) => t.textContent.includes("hive's own territory"));
  return tip?.textContent.replace(/\s+/g, ' ').trim() ?? null;
});
check('the gather tooltip shows obfuscated rows',
  tooltip && (/\?%/.test(tooltip) || /–\d+%/.test(tooltip)) && /named/.test(tooltip),
  (tooltip || '').slice(0, 120));

/* ===================================================================== wrap */

check('no console errors anywhere in all that', errors.length === 0, errors.slice(0, 3).join(' / '));

await browser.close();
console.log(`\n${fail.length ? `FAILURES (${fail.length}): ${fail.join(', ')}` : 'All checks passed.'}`);
if (parked.length) console.log(`Parked: ${parked.length}`);
process.exit(fail.length ? 1 : 0);
