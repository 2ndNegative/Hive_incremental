import { chromium } from 'playwright';
import { BASE, LAUNCH, shot, finish, settle } from './harness.mjs';

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
  await settle(page);
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

/*
 * READ OFF THE CONSTANTS, NOT OFF THE NUMBERS THEY HAPPENED TO BE.
 *
 * This section was written against RANGE_AT 10 and EXACT_AT 25 and hard-coded
 * both. The land rewrite moved them to 100 and 350 — a roll is a DRONE now
 * rather than a patch, so the hive learns an order of magnitude faster — and
 * these four checks have been red ever since, behind a suite that exited 0.
 * Every other suite in the project reads them symbolically; this one was
 * simply missed, which is the argument for never typing the number.
 */
const sharpening = await p.evaluate(() => {
  const s = hive.state;
  const { RANGE_AT, EXACT_AT } = hive.discovery;
  const take = (n) => ({
    at: n,
    level: hive.discovery.rateConfidence(s, 'grassland', 'pasture_grass'),
    label: hive.discovery.rateLabel(s, 'grassland', 'pasture_grass', 0.173),
  });
  const to = (n, from) => {
    for (let i = from; i < n; i += 1) hive.discovery.recordFind(s, 'grassland', 'pasture_grass');
    return take(n);
  };
  const out = { RANGE_AT, EXACT_AT };
  out.none = take(0);
  out.justShortOfRange = to(RANGE_AT - 1, 0);
  out.atRange = to(RANGE_AT, RANGE_AT - 1);
  out.justShortOfExact = to(EXACT_AT - 1, RANGE_AT);
  out.atExact = to(EXACT_AT, EXACT_AT - 1);
  return out;
});
check('a handful of finds is still not enough to say anything',
  sharpening.none.label === '?%' && sharpening.justShortOfRange.label === '?%',
  `${sharpening.justShortOfRange.at} finds -> ${sharpening.justShortOfRange.label}`);
check('the RANGE_AT-th find brackets the rate',
  sharpening.atRange.level === 'range' && sharpening.atRange.label === '10–25%',
  `${sharpening.atRange.at} finds -> ${sharpening.atRange.label}`);
check('the bracket holds until EXACT_AT',
  sharpening.justShortOfExact.label === '10–25%',
  `${sharpening.justShortOfExact.at} finds -> ${sharpening.justShortOfExact.label}`);
check('and EXACT_AT resolves it exactly',
  sharpening.atExact.level === 'exact' && sharpening.atExact.label === '17%',
  `${sharpening.atExact.at} finds -> ${sharpening.atExact.label}`);

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

// RANGE_AT finds on one entry and a single find on another, so the panel has
// to show a bracket beside a name beside a row that is still ???.
await p.evaluate(() => {
  const n = hive.discovery.RANGE_AT;
  for (let i = 0; i < n; i += 1) hive.discovery.recordFind(hive.state, 'temperateForest', 'leaf_litter');
  hive.discovery.recordFind(hive.state, 'temperateForest', 'wood');
});
await settle(p);
const partly = await p.evaluate(() => {
  const chips = [...document.querySelectorAll('.offer-chip')];
  const text = (n) => chips.find((c) => c.textContent.includes(n))?.querySelector('.offer-pct').textContent.trim();
  return {
    litter: text('Leaf litter'),
    wood: text('Wood'),
    stillHidden: chips.filter((c) => c.textContent.includes('???')).length,
  };
});
check('enough finds brackets that one entry', /^\d+–\d+%$/.test(partly.litter || ''), partly.litter);
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
    wasted: d.energy.wasted,
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
/*
 * AND NOTHING NOBODY ASKED FOR IS BANKED.
 *
 * This asserted the opposite — that the recovered 259 kJ landed in the pool —
 * and it was right until the reserve became one-way. There is no energy
 * storage building yet, so the pool can only ever be drawn down: a generator
 * running with nothing demanding its output is burning fat to heat the room.
 * The figure that says so is `wasted`, and it exists precisely so this is a
 * number on a screen rather than mass quietly vanishing.
 */
check('but with nothing demanding it, none of it is banked',
  withGenerator.pool === 0, `${withGenerator.pool} J in the pool`);
check('and the hive is told it was wasted rather than stored',
  Math.abs(withGenerator.wasted - withGenerator.generated) < 1,
  `${(withGenerator.wasted / 1000).toFixed(0)} kW of ${(withGenerator.generated / 1000).toFixed(0)} kW wasted`);
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

/*
 * LEVELS, AND THE QUEUE THAT DELIVERS THEM — two separate claims, tested
 * separately, because they used to be tested as one and the join broke.
 *
 * This section called `hive.build()` and then read the level on the next line.
 * That worked while building was instant; v22 gave every structure a build
 * time and `build()` became a thin alias for `queueBuild`, so the level now
 * arrives seconds later and all four of these checks have been red ever since
 * — behind a suite that exited 0.
 *
 * The level arithmetic is asserted against levels set directly, which is what
 * those checks were ever really about. The queue is asserted on its own below.
 */
const levels = await p.evaluate(() => {
  const s = hive.state;
  // Watered, fed and LIT. Bandwidth browns out with everything else — a
  // Hivecore at a third charge holds a third of the thoughts — and this check
  // is about what a level is worth, not about the power budget.
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e9;
  s.energyPool = 1e9;
  s.power = {};
  const at = (n) => {
    s.structures.hivecore = n;
    return hive.cognition().capacity;
  };
  return {
    leveled: hive.structureDefs.hivecore.leveled,
    one: at(1),
    four: at(4),
    max: hive.maxLevelOf('hivecore'),
  };
});
check('a levelled building is declared as one', levels.leveled);
check('a Hivecore supplies 5 Cg a level',
  levels.one === 5 && levels.four === 20,
  `level 1 -> ${levels.one} Cg, level 4 -> ${levels.four} Cg`);

const queued = await p.evaluate(() => {
  const s = hive.state;
  // From a standing Hivecore, because a hive at level 0 has no cognition and
  // therefore cannot start a build at all — a state the game never reaches,
  // since the landing seeds one.
  s.structures.hivecore = 1;
  s.buildQueue = [];
  s.building = null;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e9;
  s.energyPool = 1e9;

  const accepted = hive.build('hivecore', 1);
  const beforeTicking = s.structures.hivecore;
  hive.tick(5, 1);
  const onTheBench = s.building ? { id: s.building.id, remaining: s.building.remaining } : null;
  hive.tick(5, 1);
  const later = s.building ? s.building.remaining : 0;

  // At the cap it must refuse rather than queue a promise it cannot keep.
  s.buildQueue = [];
  s.building = null;
  s.structures.hivecore = hive.maxLevelOf('hivecore');
  const refused = hive.build('hivecore', 1);
  return { accepted, beforeTicking, onTheBench, later, refused };
});
check('asking for a level queues it rather than granting it', queued.accepted === 1
  && queued.beforeTicking === 1, `accepted ${queued.accepted}, level ${queued.beforeTicking}`);
check('and the queue puts it on the bench and works at it',
  queued.onTheBench?.id === 'hivecore' && queued.later < queued.onTheBench.remaining,
  `${queued.onTheBench?.remaining?.toFixed(0)} -> ${queued.later.toFixed(0)} of work left`);
check('at the cap it refuses rather than queueing the impossible',
  queued.refused === 0, `${queued.refused} accepted at level ${levels.max}`);

const upkeep = await p.evaluate(() => {
  const s = hive.state;
  s.structures.hivecore = 1;
  return hive.derived().energy.demand;
});
check('a Hivecore costs fifty kilojoules every second', Math.abs(upkeep - 50e3) < 1,
  `${(upkeep / 1e3).toFixed(0)} kW`);

// A COUNTED building stacks, as opposed to a levelled one. Set directly for
// the same reason as above: `build()` queues now, and what is being asserted
// here is that four generators process four times one generator's mass.
const counted2 = await p.evaluate(() => {
  const s = hive.state;
  s.structures.metabolicGenerator = 4;
  s.nutrients.fat = 1e6;
  s.energy.preferred = 'fat';
  hive.tick(1);
  return { count: s.structures.metabolicGenerator, massRate: hive.derived().energy.massRate };
});
check('a counted building still stacks', counted2.count === 4 && counted2.massRate === 40,
  `${counted2.count} generators, ${counted2.massRate} g/s`);

await openTab(p, 'Hive');
await settle(p);
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

await finish({ name: 'discovery, metabolism and levels', fail, errors, browser });
