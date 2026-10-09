import { chromium } from 'playwright';
import { BASE, LAUNCH, shot } from './harness.mjs';

/**
 * Discovery, the metabolism rewrite, and levelled buildings.
 *
 * The claim that matters most here is that the hive cannot see the forage table
 * until it has earned it — and that "earned" means a count of observations, not
 * a count of grams.
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
      id: '__larder', name: 'Test larder', category: 'storage',
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
// Read rather than pinned: a save-format bump is not a reason for four suites
// that are about storage, territory and discovery to start failing.
const SAVE_VERSION = await p.evaluate(() => hive.saveVersion);
await ensureLanded(p);

/* ===================================================== 1. the hive knows nothing */

const fresh = await p.evaluate(() => ({
  found: hive.state.found,
  named: hive.discovery.isNamed(hive.state, 'leaf_litter'),
  label: hive.discovery.nameLabel(hive.state, 'leaf_litter', 'Leaf litter'),
  rate: hive.discovery.rateLabel(hive.state, 'temperateForest', 'leaf_litter', 0.17),
}));
check('a landed hive has found nothing',
  Object.keys(fresh.found).length === 0 && !fresh.named);
check('what it has not met has no name', fresh.label === '???', fresh.label);
check('and no rate', fresh.rate === '?%', fresh.rate);

/* ================================================== 2. finding teaches the name */

const named = await p.evaluate(() => {
  hive.discovery.recordFind(hive.state, 'temperateForest', 'hazelnut');
  return {
    here: hive.discovery.isNamed(hive.state, 'hazelnut'),
    count: hive.discovery.timesFound(hive.state, 'temperateForest', 'hazelnut'),
    // The same nut in ground the hive has never set foot on.
    elsewhere: hive.discovery.nameLabel(hive.state, 'hazelnut', 'Hazelnut'),
    rateStill: hive.discovery.rateLabel(hive.state, 'temperateRainforest', 'hazelnut', 0.08),
    other: hive.discovery.isNamed(hive.state, 'walnut'),
  };
});
check('finding something once names it', named.here && named.count === 1);
check('the name carries to every other biome it occurs in',
  named.elsewhere === 'Hazelnut', 'a hazelnut is a hazelnut anywhere');
check('but the rate on ground it has not worked is still unknown',
  named.rateStill === '?%', named.rateStill);
check('naming one thing names nothing else', !named.other);

/* ============================================== 3. rates sharpen with evidence */

const sharpening = await p.evaluate(() => {
  const s = hive.state;
  const out = [];
  const take = (n) => ({
    at: n,
    level: hive.discovery.rateConfidence(s, 'grassland', 'pasture_grass'),
    label: hive.discovery.rateLabel(s, 'grassland', 'pasture_grass', 0.173),
  });
  out.push(take(0));
  for (let i = 0; i < 9; i += 1) hive.discovery.recordFind(s, 'grassland', 'pasture_grass');
  out.push(take(9));
  hive.discovery.recordFind(s, 'grassland', 'pasture_grass');
  out.push(take(10));
  for (let i = 0; i < 14; i += 1) hive.discovery.recordFind(s, 'grassland', 'pasture_grass');
  out.push(take(24));
  hive.discovery.recordFind(s, 'grassland', 'pasture_grass');
  out.push(take(25));
  return out;
});
const [at0, at9, at10, at24, at25] = sharpening;
check('nine finds is still not enough to say anything',
  at0.label === '?%' && at9.label === '?%', `${at9.at} finds -> ${at9.label}`);
check('the tenth find brackets the rate',
  at10.level === 'range' && at10.label === '10–25%', `${at10.at} finds -> ${at10.label}`);
check('the bracket holds until the twenty-fifth',
  at24.label === '10–25%', `${at24.at} finds -> ${at24.label}`);
check('the twenty-fifth resolves it exactly',
  at25.level === 'exact' && at25.label === '17%', `${at25.at} finds -> ${at25.label}`);

const bands = await p.evaluate(() => [0.004, 0.015, 0.03, 0.08, 0.17, 0.4, 0.9]
  .map((c) => hive.discovery.bandFor(c).join('–')));
check('the brackets are the ones people actually estimate in',
  bands.join(' ') === '0–1 1–2 2–5 5–10 10–25 25–50 50–100', bands.join(' '));

const honest = await p.evaluate(() => {
  // Whatever the true rate, the bracket reported must contain it.
  for (let i = 0; i < 2000; i += 1) {
    const c = Math.random();
    const [lo, hi] = hive.discovery.bandFor(c);
    if (c * 100 < lo || c * 100 > hi) return false;
  }
  return true;
});
check('a bracket always contains the true rate', honest, '2000 random rates');

/* =========================================== 4. the roll is what gets counted */

const counted = await p.evaluate(() => {
  const s = hive.state;
  s.found = {};
  s.territory = { temperateForest: 100 };
  for (let i = 0; i < 300; i += 1) hive.forage.rollForage(s, 'forager');
  const log = s.found.temperateForest || {};
  const total = Object.values(log).reduce((a, b) => a + b, 0);
  return { distinct: Object.keys(log).length, total };
});
check('every forage roll is logged as one observation',
  counted.total === 300, `${counted.total} observations over ${counted.distinct} items`);

const clicked = await p.evaluate(() => {
  const s = hive.state;
  s.found = {};
  const before = Object.keys(s.found).length;
  hive.consumeBiomass();
  const biome = s.lastGather.biomeId;
  return { before, logged: (s.found[biome]?.[s.lastGather.itemId] || 0) };
});
check('gathering by hand teaches the hive too', clicked.logged === 1);

const prey = await p.evaluate(() => {
  const s = hive.state;
  s.found = {};
  s.territory = { grassland: 100 };
  for (let i = 0; i < 200; i += 1) hive.forage.rollForage(s, 'hunter');
  const log = s.found.grassland || {};
  const preyKeys = Object.keys(log).filter((k) => k.startsWith('@'));
  return {
    preyKeys: preyKeys.length,
    named: preyKeys.length ? hive.discovery.isNamed(s, preyKeys[0]) : false,
    noClash: preyKeys.every((k) => !hive.items[k]),
  };
});
check('prey is learned separately from items and cannot collide with one',
  prey.preyKeys > 0 && prey.named && prey.noClash, `${prey.preyKeys} species learned`);

/* =============================================== 5. the tab keeps the secret */

await p.evaluate(() => {
  hive.state.found = {};
  hive.state.territory = { temperateForest: 36 };
});
await openTab(p, 'Territory');
await p.waitForSelector('.offer-chip');
const hidden = await p.evaluate(() => {
  const chips = [...document.querySelectorAll('.offer-chip')];
  return {
    count: chips.length,
    allUnknown: chips.every((c) => c.textContent.includes('???')),
    allVague: chips.every((c) => c.querySelector('.offer-pct').textContent.trim() === '?%'),
    noRealNames: !document.querySelector('.offer-list').textContent.match(/Leaf litter|Hazelnut/),
  };
});
check('unworked ground shows what is there but not what it is',
  hidden.count > 5 && hidden.allUnknown && hidden.allVague,
  `${hidden.count} entries, all ??? at ?%`);
check('no real name leaks into the list', hidden.noRealNames);

await p.evaluate(() => {
  for (let i = 0; i < 12; i += 1) hive.discovery.recordFind(hive.state, 'temperateForest', 'leaf_litter');
  hive.discovery.recordFind(hive.state, 'temperateForest', 'wood');
});
await p.waitForTimeout(300);
const partly = await p.evaluate(() => {
  const chips = [...document.querySelectorAll('.offer-chip')];
  const text = (n) => chips.find((c) => c.textContent.includes(n))?.querySelector('.offer-pct').textContent.trim();
  return {
    litter: text('Leaf litter'),
    wood: text('Wood'),
    stillHidden: chips.filter((c) => c.textContent.includes('???')).length,
  };
});
check('twelve finds brackets that one entry', /^\d+–\d+%$/.test(partly.litter || ''), partly.litter);
check('one find names it without revealing its rate', partly.wood === '?%', partly.wood);
check('everything else stays hidden', partly.stillHidden > 3, `${partly.stillHidden} still ???`);
await p.screenshot({ path: shot('discovery.png') });

await giveStorage(p, 50);

/* ====================================== 6. nothing metabolises on its own */

const noGenerator = await p.evaluate(() => {
  const s = hive.state;
  s.energyPool = 0;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  // Within the fat store's 20 kg cap — more than that just spills, which would
  // look exactly like the hive eating it.
  s.nutrients.fat = 15_000;
  s.structures.hivecore = 1; // 1 MW of demand, no generator
  s.structures.metabolicGenerator = 0;
  hive.tick(1);
  const d = hive.derived();
  return {
    stored: d.energy.stored,
    pool: d.energy.pool,
    generated: d.energy.generated,
    demand: d.energy.demand,
    delivered: d.energy.delivered,
    fatLeft: s.nutrients.fat,
  };
});
check('a hive standing on fat with no generator has no usable energy',
  noGenerator.stored > 5e8 && noGenerator.pool === 0 && noGenerator.generated === 0,
  `${(noGenerator.stored / 1e9).toFixed(1)} GJ in store, ${noGenerator.pool} J spendable`);
check('and nothing burns itself to meet demand',
  noGenerator.delivered === 0 && noGenerator.fatLeft === 15_000,
  `${noGenerator.demand / 1e6} MW demanded, none delivered, no fat touched`);

/* ========================================= 7. the generator is the only way */

const withGenerator = await p.evaluate(() => {
  const s = hive.state;
  s.energyPool = 0;
  s.structures.hivecore = 0;
  s.structures.metabolicGenerator = 1;
  s.nutrients.fat = 15_000;
  s.energy.preferred = 'fat';
  const before = s.nutrients.fat;
  hive.tick(1);
  const d = hive.derived();
  return {
    massRate: d.energy.massRate,
    generated: d.energy.generated,
    pool: s.energyPool,
    ate: before - s.nutrients.fat,
  };
});
check('a generator processes its rated mass', Math.abs(withGenerator.massRate - 10) < 1e-9,
  `${withGenerator.massRate} g/s`);
// NOT the full 370 kW the mass contains. An untaught hive recovers 70% of fat
// and loses the rest — efficiency research buys that waste back and can never
// take a gram past what the gram holds. See computeEfficiency.
check('it converts that mass at the fraction it can actually recover',
  Math.abs(withGenerator.generated - 259_000) < 1,
  `10 g/s of fat at 37 kJ/g, 70% recovered = ${(withGenerator.generated / 1000).toFixed(0)} kW`);
check('the mass is gone whatever was got out of it',
  Math.abs(withGenerator.ate - 10) < 1e-6,
  `${withGenerator.ate.toFixed(1)} g eaten for ${(withGenerator.generated / 1000).toFixed(0)} kW`);
check('and what was recovered is banked',
  withGenerator.pool > 258_000,
  `${(withGenerator.pool / 1000).toFixed(0)} kJ banked`);
const ceiling = await p.evaluate(() => {
  // The whole point of the inversion: no amount of research takes a gram past
  // its own energy. Every tech in the ladder, then check nothing exceeds 1.
  const s = hive.state;
  for (const id of hive.researchOrder ?? []) s.tech[id] = true;
  const eff = hive.derived().efficiency;
  const over = Object.entries(eff).filter(([, v]) => v > 1).map(([n, v]) => `${n}=${v}`);
  return { over, fat: eff.fat, carb: eff.carb };
});
check('with every tech in hand, nothing recovers more than a gram contains',
  ceiling.over.length === 0, ceiling.over.join(', ') || `fat ${ceiling.fat}, carb ${ceiling.carb}`);
check('and fat reaches the limit exactly', ceiling.fat === 1, `fat at ${ceiling.fat}`);

const drains = await p.evaluate(() => {
  const s = hive.state;
  s.energyPool = 5_000_000;
  s.structures.hivecore = 1;
  s.structures.metabolicGenerator = 0;
  s.nutrients.fat = 0;
  hive.tick(1);
  const d = hive.derived();
  return { pool: s.energyPool, delivered: d.energy.delivered, ratio: d.energy.ratio };
});
check('banked energy is spent down by demand',
  Math.abs(drains.pool - 4_950_000) < 1 && Math.abs(drains.delivered - 50e3) < 1,
  `5 MJ banked, ${(drains.delivered / 1e3).toFixed(0)} kW drawn, ${(drains.pool / 1e6).toFixed(1)} MJ left`);

const starves = await p.evaluate(() => {
  const s = hive.state;
  s.energyPool = 0;
  s.nutrients.fat = 0;
  hive.tick(1);
  return hive.derived().energy.ratio;
});
check('an empty pool with no generation starves the hive', starves === 0, `ratio ${starves}`);

/* =============================================== 8. levelled buildings */

const levels = await p.evaluate(() => {
  const s = hive.state;
  s.structures.hivecore = 0;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e9;
  const built = hive.build('hivecore', 1);
  const lvl1 = { level: s.structures.hivecore, cogits: hive.cognition().capacity };
  hive.build('hivecore', 3);
  const lvl4 = { level: s.structures.hivecore, cogits: hive.cognition().capacity };
  // Ask for far more than the cap allows.
  hive.build('hivecore', 999);
  const capped = { level: s.structures.hivecore, max: hive.maxLevelOf('hivecore') };
  const refused = hive.build('hivecore', 1);
  return { built, lvl1, lvl4, capped, refused, leveled: hive.structureDefs.hivecore.leveled };
});
check('a levelled building is declared as one', levels.leveled);
check('building it sets its level', levels.built === 1 && levels.lvl1.level === 1);
check('a Hivecore supplies 5 Cg a level',
  levels.lvl1.cogits === 5 && levels.lvl4.cogits === 20,
  `level 1 -> ${levels.lvl1.cogits} Cg, level 4 -> ${levels.lvl4.cogits} Cg`);
check('upgrading stops at the cap rather than overshooting',
  levels.capped.level === levels.capped.max, `level ${levels.capped.level} of ${levels.capped.max}`);
check('and refuses to go further', levels.refused === 0);

const upkeep = await p.evaluate(() => {
  const s = hive.state;
  s.structures.hivecore = 1;
  return hive.derived().energy.demand;
});
check('a Hivecore costs fifty kilojoules every second', Math.abs(upkeep - 50e3) < 1,
  `${(upkeep / 1e3).toFixed(0)} kW`);

const counted2 = await p.evaluate(() => {
  const s = hive.state;
  s.structures.metabolicGenerator = 0;
  hive.build('metabolicGenerator', 4);
  return { count: s.structures.metabolicGenerator, massRate: hive.derived().energy.massRate };
});
check('a counted building still stacks', counted2.count === 4 && counted2.massRate === 40,
  `${counted2.count} generators, ${counted2.massRate} g/s`);

await openTab(p, 'Hive');
await p.waitForTimeout(300);
const tab = await p.evaluate(() => {
  const txt = document.querySelector('.main-col, .band-stack')?.innerText ?? document.body.innerText;
  return {
    showsLevel: /Lv \d+/.test(txt),
    showsUpgrade: /Upgrade to level|At maximum level/.test(txt),
    core: /Hivecore/.test(txt),
    gen: /Metabolic Generator/.test(txt),
  };
});
check('the Hive tab lists both new buildings in their bands', tab.core && tab.gen);
check('a levelled building reads as a level, not a count', tab.showsLevel && tab.showsUpgrade);
await p.screenshot({ path: shot('buildings.png') });

/* ================================================= 9. it all survives a save */

// Saved with nothing demanding and nothing generating, because a running hive
// spends its pool immediately — "survives a reload" has to be asked of a hive
// that is not busy emptying it.
await p.evaluate(() => {
  const s = hive.state;
  s.found = { temperateForest: { hazelnut: 14 } };
  s.energyPool = 1234;
  s.structures.hivecore = 0;
  s.structures.metabolicGenerator = 3;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  hive.save();
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
const kept = await p.evaluate(() => ({
  found: hive.state.found?.temperateForest?.hazelnut,
  pool: hive.state.energyPool,
  generators: hive.state.structures.metabolicGenerator,
  version: hive.state.version,
}));
check('what the hive learned survives a reload',
  kept.found === 14 && kept.pool === 1234 && kept.generators === 3 && kept.version === SAVE_VERSION,
  `14 finds, ${kept.pool} J banked, 3 generators, save v${kept.version}`);

// A level is structural, so it round-trips whatever the hive is doing to its
// energy in the meantime.
await p.evaluate(() => { hive.state.structures.hivecore = 7; hive.save(); });
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
check('a building keeps its level across a reload',
  await p.evaluate(() => hive.state.structures.hivecore === 7), 'Hivecore still level 7');

console.log(`\nconsole errors: ${errors.length ? errors.slice(0, 4).join(' | ') : 'none'}`);
console.log(fail.length ? `\n=== ${fail.length} CHECK(S) FAILED: ${fail.join('; ')} ===` : '\n=== discovery, metabolism and levels verified ===');
await browser.close();
console.log('=== rebuild test finished ===');
