import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';
import { readFileSync } from 'node:fs';

/**
 * The storage/idling/larvae pass.
 *
 * The claims:
 *   1. the repository says plainly that a machine wrote most of it
 *   2. the gather button no longer talks about drones that do not exist
 *   3. the hive holds NOTHING on its own — every gram of room is built
 *   4. and the first of it comes from the Hivecore, a tenth of the reference
 *      scale per level
 *   5. larvae are a store in the top bar, and one of them is a larva
 *   6. nothing grows a drone by itself any more
 *   7. a building can be idled, which is the only way back out of having
 *      overbuilt something that eats
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

const base = BASE;
const browser = await chromium.launch(LAUNCH);

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};

/* ===================================================== 1. the AI disclaimer */

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
check('the README says a machine helped write this',
  /generative ai/i.test(readme),
  (readme.match(/^#+ .*generative ai.*$/im) || ['(no heading)'])[0]);
check('it says so in its own section, not a footnote',
  /^##+ .*generative ai/im.test(readme));
check('and it is above the fold, not buried at the bottom',
  readme.toLowerCase().indexOf('generative ai') < readme.length / 2,
  `${Math.round((readme.toLowerCase().indexOf('generative ai') / readme.length) * 100)}% in`);
check('it also credits where the food data came from',
  /USDA|FoodData/i.test(readme));

const errors = [];
const p = await browser.newPage({ viewport: { width: 1480, height: 1020 } });
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await p.goto(base, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
await p.waitForTimeout(200);
await p.evaluate(() => hive.loop.stop());

/* ============================================ 2. the gather button's wording */

const button = await p.evaluate(() => {
  const btn = document.querySelector('.gather-btn');
  const tip = [...document.querySelectorAll('.tip-body')]
    .find((t) => t.textContent.includes("hive's own territory"));
  return {
    label: btn?.textContent.trim() ?? null,
    tip: tip?.textContent.replace(/\s+/g, ' ').trim() ?? null,
  };
});
check('the button still says what it always said',
  button.label === 'Consume biomass', button.label);
check('the tooltip names the territory rather than its area in m²',
  /territory/i.test(button.tip || '') && !/m²/.test(button.tip || ''),
  (button.tip || '').slice(0, 70));
check('and it does not claim a drone does it — there are none',
  !/\bdrone\b/i.test(button.tip || ''), (button.tip || '').slice(0, 90));
check('it still states the size of a mouthful',
  /28 g to 52 g/.test(button.tip || ''),
  (button.tip || '').slice(-60));

/* ============================== 3 & 4. storage is built, and starts with the core */

const caps = await p.evaluate(() => {
  const s = hive.state;
  const at = (level) => {
    s.structures.hivecore = level;
    const d = hive.derived();
    return { protein: d.caps.protein, water: d.caps.water, potassium: d.caps.potassium, item: d.itemCap };
  };
  return {
    none: at(0), one: at(1), two: at(2), nine: at(9),
    declared: hive.structureDefs.hivecore.storage,
    declaredItem: hive.structureDefs.hivecore.itemStorage,
    baseCaps: hive.biomeIds && Object.keys(hive.nutrients).map((id) => hive.nutrients[id].baseCap),
  };
});
check('every nutrient has a base cap of zero — storage is built, never innate',
  caps.baseCaps.every((c) => c === 0), `${caps.baseCaps.filter((c) => c !== 0).length} non-zero`);
check('a hive with nothing built can hold nothing at all',
  caps.none.protein === 0 && caps.none.water === 0 && caps.none.item === 0,
  `${caps.none.protein} g protein, ${caps.none.item} g per item`);
check('a Hivecore brings a flat amount of room with it',
  caps.one.protein === caps.declared.protein &&
  caps.one.water === caps.declared.water &&
  caps.one.potassium === caps.declared.potassium,
  `${caps.one.protein} g protein, ${caps.one.water} g water, ${caps.one.potassium} g potassium`);
check('which is a tenth of what the old base caps were',
  caps.one.protein === 2_000 && caps.one.water === 20_000,
  `${caps.one.protein} / ${caps.one.water} g`);
check('and it brings a small larder for raw matter with it',
  caps.one.item === 500, `${caps.one.item} g of larder`);
check('and it does NOT grow with the level — the first one is all of it',
  caps.two.protein === caps.one.protein && caps.nine.protein === caps.one.protein,
  `level 1 ${caps.one.protein} g, level 2 ${caps.two.protein} g, level 9 ${caps.nine.protein} g`);
check('whole matter obeys the same rule',
  caps.one.item === caps.declaredItem && caps.nine.item === caps.one.item && caps.none.item === 0,
  `${caps.one.item} g of larder, flat`);

const capsVsCharge = await p.evaluate(() => {
  const s = hive.state;
  s.structures.hivecore = 4;
  s.power.hivecore = 1;
  const lit = hive.derived().caps.protein;
  s.power.hivecore = 0; // completely dark
  const dark = hive.derived();
  return { lit, dark: dark.caps.protein, cogits: dark.cognition.capacity };
});
check('STORAGE does not fade when the power does — a sac is a sac',
  capsVsCharge.dark === capsVsCharge.lit,
  `${capsVsCharge.lit} g lit, ${capsVsCharge.dark} g dark`);
check('while everything that is a process still does',
  capsVsCharge.cogits === 0, `${capsVsCharge.cogits} Cg from a dark core`);

/* ============================================================== 5. larvae */

const larvae = await p.evaluate(() => {
  const out = {};
  const read = () => {
    const top = document.querySelector('.topbar').innerText.replace(/\s+/g, ' ');
    return /Larvae\s+(\d+)/.exec(top)?.[1] ?? null;
  };
  out.initial = hive.state.larvae;
  out.shownZero = read();
  out.words = [0, 1, 2, 7].map((n) => hive.formatLarvae(n));
  return out;
});
check('a hive starts with no larvae', larvae.initial === 0);
check('the top bar carries them', larvae.shownZero === '0', larvae.shownZero);
check('one larva, two larvae',
  larvae.words.join(' / ') === '0 larvae / 1 larva / 2 larvae / 7 larvae',
  larvae.words.join(' / '));

await p.evaluate(() => { hive.state.larvae = 1; });
await p.waitForTimeout(200);
const oneLarva = await p.evaluate(() => {
  const top = document.querySelector('.topbar').innerText.replace(/\s+/g, ' ');
  return /Larvae\s+(\d+)/.exec(top)?.[1] ?? null;
});
check('and the count follows the store', oneLarva === '1', oneLarva);

const isStore = await p.evaluate(() => {
  const top = document.querySelector('.topbar').innerText.replace(/\s+/g, ' ');
  // A capacity reads "n / m". A store does not.
  return /Larvae\s+\d+\s*\/\s*\d+/.test(top);
});
check('it is a store, not a capacity: no "of" figure beside it', !isStore);

/* ================================================ 6. nothing grows by itself */

const growth = await p.evaluate(() => {
  const s = hive.state;
  s.structures.hivecore = 10;
  s.structures.metabolicGenerator = 400;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.nutrients.protein = 19_000;
  s.nutrients.carb = 19_000;
  s.drones = 0;
  s.castes.dormant = 0;
  s.growth = 0;
  const before = { drones: s.drones, protein: s.nutrients.protein };
  const rate = hive.derived().growthRate;
  for (let i = 0; i < 300; i += 1) hive.tick(1);
  return { rate, before, drones: s.drones, cap: hive.derived().droneCap };
});
check('the growth rate is flat zero', growth.rate === 0, String(growth.rate));
check('five minutes of plenty grows no drones at all',
  growth.drones === 0,
  `${growth.drones} drones after 300s with ${growth.before.protein} g protein and room for ${growth.cap}`);

/* ============================================================== 7. idling */

const idle = await p.evaluate(() => {
  const s = hive.state;
  s.structures.metabolicGenerator = 4;
  delete s.active.metabolicGenerator;
  const all = hive.derived();
  hive.setActive('metabolicGenerator', 1);
  const one = hive.derived();
  hive.setActive('metabolicGenerator', 'none');
  const none = hive.derived();
  hive.setActive('metabolicGenerator', 'all');
  const back = hive.derived();
  return {
    all: all.energy.massRate,
    one: one.energy.massRate,
    none: none.energy.massRate,
    back: back.energy.massRate,
    noneIdle: none.generators[0]?.idle,
    noneRunning: none.generators[0]?.running,
    noneOwned: none.generators[0]?.owned,
  };
});
check('untouched means all of them running', idle.all === 40, `${idle.all} g/s from 4`);
check('idling three leaves one working', idle.one === 10, `${idle.one} g/s`);
check('idling all of them stops it dead', idle.none === 0, `${idle.none} g/s`);
check('and switching them back on restores it', idle.back === 40, `${idle.back} g/s`);
check('an idled generator still has its fuel setting, but is marked idle',
  idle.noneRunning === 0 && idle.noneIdle === 4 && idle.noneOwned === 40,
  `${idle.noneRunning} running, ${idle.noneIdle} idle, ${idle.noneOwned} g/s owned`);

const idleCost = await p.evaluate(() => {
  const s = hive.state;
  s.structures.hivecore = 2;
  s.active.hivecore = 1;
  s.power.hivecore = 1; // the block above left it dark; this is about idling
  const on = hive.derived();
  hive.setActive('hivecore', 'none');
  const off = hive.derived();
  // A full swing's worth of time while idle. It must not drift down.
  for (let i = 0; i < 40; i += 1) hive.tick(1);
  const restedCharge = hive.derived().power.hivecore.charge;
  hive.setActive('hivecore', 'all');
  return {
    onDemand: on.energy.demand,
    onCogits: on.cognition.capacity,
    onCap: on.caps.protein,
    offDemand: off.energy.demand,
    offCogits: off.cognition.capacity,
    offCap: off.caps.protein,
    offCharge: restedCharge,
    backOn: hive.derived().energy.demand,
  };
});
check('a levelled building is on or off, never partly: level 2 runs at level 2',
  idleCost.onDemand === 100e3 && idleCost.onCogits === 10,
  `${idleCost.onDemand / 1e6} MW, ${idleCost.onCogits} Cg`);
check('switched off it is billed for nothing', idleCost.offDemand === 0,
  `${idleCost.offDemand} W`);
check('and it supplies nothing — not bandwidth',
  idleCost.offCogits === 0, `${idleCost.offCogits} Cg`);
check('nor storage', idleCost.offCap === 0, `${idleCost.offCap} g`);
check('an idled building is resting, not starving: it comes back ready',
  idleCost.offCharge === 1, idleCost.offCharge.toFixed(2));
check('switching it back on bills it again', idleCost.backOn === 100e3,
  `${idleCost.backOn / 1e6} MW`);

/* ------------------------------------------------- the softlock it exists to fix */

const softlock = await p.evaluate(() => {
  const s = hive.state;
  // Room to hold the ten kilos this is about to burn through: a Hivecore alone
  // holds 2 kg of carbohydrate, which is not enough to show the shape of it.
  const store = {};
  for (const [k, v] of Object.entries(hive.structureDefs.hivecore.storage)) store[k] = v * 20;
  hive.structureDefs.__larder = {
    id: '__larder', name: 'Test larder', category: 'storage',
    unlock: () => false, cost: () => ({ protein: 1 }), storage: store, itemStorage: 4000,
  };
  if (!hive.structureOrder.includes('__larder')) hive.structureOrder.push('__larder');
  s.structures.__larder = 1;
  s.structures.hivecore = 10;
  delete s.active.hivecore;
  s.structures.metabolicGenerator = 40; // 400 g/s, wildly overbuilt
  delete s.active.metabolicGenerator;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.nutrients.carb = 10_000;
  s.energyPool = 0;

  const eating = hive.derived().energy.massRate;
  for (let i = 0; i < 20; i += 1) hive.tick(1);
  const burntThrough = s.nutrients.carb;

  // The way out: idle most of them.
  s.nutrients.carb = 10_000;
  hive.setActive('metabolicGenerator', 2);
  const nowEating = hive.derived().energy.massRate;
  for (let i = 0; i < 20; i += 1) hive.tick(1);
  return { eating, burntThrough, nowEating, left: s.nutrients.carb };
});
// Forty generators are 400 g/s of nominal capacity — and they are pointed at
// sugar, which goes through three times as fast, so the shelf actually empties
// at 1200 g/s. The reported rate has to be the one the store feels, or a player
// checking "how long will this last" gets an answer three times too long.
check('overbuilding generators eats the stores alive',
  softlock.eating === 1200 && softlock.burntThrough <= 2000,
  `${softlock.eating} g/s took 10 kg down to ${softlock.burntThrough.toFixed(0)} g in 20s`);
check('and the figure it reports is the one the shelf feels',
  softlock.eating === 400 * 3, `${softlock.eating} g/s against 400 g/s of nominal capacity`);
check('idling them down is the way back out',
  softlock.nowEating === 60 && softlock.left > 8000,
  `${softlock.nowEating} g/s leaves ${softlock.left.toFixed(0)} g after the same 20s`);

/* --------------------------------------------------------- and it is reachable */

await openTab(p, 'Hive');
await p.evaluate(() => {
  hive.state.structures.metabolicGenerator = 4;
  hive.setActive('metabolicGenerator', 2);
});
await p.waitForTimeout(250);
const ui = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.switch-row')].map((r) =>
    r.textContent.replace(/\s+/g, ' ').trim());
  return { rows, count: rows.length };
});
check('the Hive tab shows the switch beside the building it belongs to',
  ui.rows.some((r) => /2 of 4 active/.test(r)), ui.rows.join(' | ').slice(0, 120));
check('it says how many are idle', ui.rows.some((r) => /2 idle/.test(r)));
check('and a levelled building gets a shutdown instead of a counter',
  ui.rows.some((r) => /Running|Shut down/.test(r)),
  ui.rows.find((r) => /Running|Shut down/.test(r)) || '(none)');

await p.click('.action-slot .switch-row .btn:text-is("All")');
await p.waitForTimeout(200);
const clicked = await p.evaluate(() => hive.activeCount('metabolicGenerator'));
check('the buttons actually work', clicked === 4, `${clicked} of 4 active`);


/* ================================ 8. the two-tier store: shelves and the pool */

// Dedicated room is a shelf cut to one nutrient's shape. General room is one
// shared volume that catches what will not fit, last in and first out.

const tiers = await p.evaluate(() => {
  const s = hive.state;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.general = {};
  s.structures.hivecore = 1;
  delete s.active.hivecore;
  s.structures.metabolicGenerator = 0;
  s.structures.proteinGranule = 0;
  s.structures.vacuole = 0;
  delete s.structures.__larder;
  hive.structureOrder.splice(hive.structureOrder.indexOf('__larder') >>> 0, 0);

  const read = (n) => {
    const d = hive.derived();
    return {
      held: s.nutrients[n] || 0,
      pooled: s.general[n] || 0,
      cap: d.caps[n],
      shelf: d.storage.dedicated[n],
      pool: d.storage.general,
      used: d.storage.generalUsed,
    };
  };
  const put = (n, g) => {
    const st = hive.openStore(s, hive.derived().storage);
    const lost = st.apply(n, g);
    st.reconcile();
    return lost;
  };

  const out = {};
  out.noPool = read('fat');
  s.structures.vacuole = 1;
  out.withPool = read('fat');
  put('fat', 2000);
  out.shelfFull = read('fat');
  put('fat', 200);
  out.overflowed = read('fat');
  put('protein', 2500);
  out.shared = { fat: read('fat'), protein: read('protein') };
  out.lostWhenFull = put('fat', 1000);
  out.bothFull = read('fat');
  put('fat', -150);
  out.afterDraw = read('fat');
  put('fat', -400);
  out.poolEmptied = read('fat');
  return out;
});

check('a hive with no Vacuole has no general room at all',
  tiers.noPool.pool === 0, `${tiers.noPool.pool} g`);
check('a Vacuole adds a flat kilo of it',
  tiers.withPool.pool === 1000 && tiers.withPool.shelf === 2000,
  `${tiers.withPool.pool} g pooled room beside a ${tiers.withPool.shelf} g fat shelf`);
check('the pool is invisible until it is used: a full shelf reads as full',
  tiers.shelfFull.held === 2000 && tiers.shelfFull.cap === 2000 && tiers.shelfFull.pooled === 0,
  `${tiers.shelfFull.held} / ${tiers.shelfFull.cap}`);
check('200 g more overflows into the pool, and the ceiling grows to match',
  tiers.overflowed.held === 2200 && tiers.overflowed.cap === 2200 &&
  tiers.overflowed.pooled === 200,
  `${tiers.overflowed.held} g of ${tiers.overflowed.cap} g, ${tiers.overflowed.pooled} g of it pooled`);
check('the pool is SHARED — another nutrient overflowing eats into the same kilo',
  tiers.shared.protein.pooled === 500 && tiers.shared.fat.used === 700,
  `${tiers.shared.protein.pooled} g protein + ${tiers.shared.fat.pooled} g fat = ${tiers.shared.fat.used} g of 1000`);
check('once shelf and pool are both full the rest is lost',
  tiers.lostWhenFull === 700 && tiers.bothFull.used === 1000,
  `${tiers.lostWhenFull} g of 1000 g spilled with the pool at ${tiers.bothFull.used} g`);
check('LAST IN, FIRST OUT: a draw empties the pool before the shelf',
  tiers.afterDraw.pooled === 350 && tiers.afterDraw.held === 2350 &&
  tiers.afterDraw.cap === 2350,
  `${tiers.afterDraw.pooled} g still pooled, showing ${tiers.afterDraw.held}/${tiers.afterDraw.cap}`);
check('and once the pool is clear the shelf starts going down',
  tiers.poolEmptied.pooled === 0 && tiers.poolEmptied.held === 1950 &&
  tiers.poolEmptied.cap === 2000,
  `${tiers.poolEmptied.held} g of ${tiers.poolEmptied.cap} g, nothing pooled`);

const granule = await p.evaluate(() => {
  const s = hive.state;
  const before = hive.derived().storage.dedicated.protein;
  s.structures.proteinGranule = 3;
  const d = hive.derived();
  return { before, after: d.storage.dedicated.protein, fat: d.storage.dedicated.fat, general: d.storage.general };
});
check('a Protein Granule adds 200 g of protein room and nothing else',
  granule.after === granule.before + 600 && granule.fat === 2000,
  `${granule.before} → ${granule.after} g protein, fat untouched at ${granule.fat} g`);

const shrink = await p.evaluate(() => {
  const s = hive.state;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.general = {};
  s.structures.proteinGranule = 0;
  s.structures.vacuole = 1;
  const st = hive.openStore(s, hive.derived().storage);
  st.apply('fat', 2600);
  st.reconcile();
  const before = { held: s.nutrients.fat, pooled: s.general.fat };
  // Idle the Vacuole: the room it was lending goes with it.
  hive.setActive('vacuole', 'none');
  hive.tick(0.1);
  return { before, held: s.nutrients.fat, pooled: s.general.fat || 0, spilled: s.spilled.fat };
});
check('idling the Vacuole takes its room back, and what it held is lost',
  shrink.before.pooled === 600 && shrink.held === 2000 && shrink.pooled === 0,
  `${shrink.before.held} g with ${shrink.before.pooled} g pooled → ${shrink.held} g on the shelf`);

/* ------------------------------------------------ and the interface says so */

await p.evaluate(() => {
  const s = hive.state;
  hive.setActive('vacuole', 'all');
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.general = {};
  const st = hive.openStore(s, hive.derived().storage);
  st.apply('fat', 2300);
  st.reconcile();
});
await p.waitForTimeout(250);
const panel = await p.evaluate(() => {
  const row = [...document.querySelectorAll('.res-row')]
    .find((r) => r.querySelector('.res-name')?.textContent.trim() === 'Fat');
  const amount = row?.querySelector('.res-amount')?.textContent.replace(/\s+/g, ' ').trim();
  const tip = row?.querySelector('.tip-body')?.textContent.replace(/\s+/g, ' ') ?? '';
  const general = [...document.querySelectorAll('.res-row')]
    .find((r) => r.querySelector('.res-name')?.textContent.trim() === 'General storage');
  return {
    amount,
    shelf: /On its own shelf\s*([\d.]+ k?g \/ [\d.]+ k?g)/.exec(tip)?.[1] ?? null,
    pooled: /Overflowed into general storage\s*([\d.]+ k?g)/.exec(tip)?.[1] ?? null,
    generalRow: general?.textContent.replace(/\s+/g, ' ').trim() ?? null,
  };
});
check('the row shows the grown ceiling, not the shelf',
  /2\.3 kg/.test(panel.amount || ''), panel.amount);
check('the tooltip says what is on the shelf', panel.shelf === '2 kg / 2 kg', panel.shelf);
check('and what overflowed into general storage', panel.pooled === '300 g', panel.pooled);
check('the pool itself gets a row of its own once there is one',
  /General storage/.test(panel.generalRow || '') && /300 g/.test(panel.generalRow || ''),
  panel.generalRow);

const hidden = await p.evaluate(() => {
  hive.setActive('vacuole', 'none');
  return null;
});
await p.waitForTimeout(250);
const gone = await p.evaluate(() => [...document.querySelectorAll('.res-name')]
  .some((n) => n.textContent.trim() === 'General storage'));
check('and no row at all when the hive has none', !gone);

const quiet = await p.evaluate(() => {
  hive.setActive('vacuole', 'all');
  const effects = (id) => {
    const card = [...document.querySelectorAll('.action-card')]
      .find((c) => c.textContent.includes(hive.structureDefs[id].name));
    return card?.querySelector('.effect-list')?.textContent.replace(/\s+/g, ' ').trim() ?? null;
  };
  hive.state.ui.tab = 'hive';
  return { effects };
});
await p.waitForTimeout(250);
const effectLines = await p.evaluate(() => {
  const out = {};
  for (const [id, name] of [['hivecore', 'Hivecore'], ['vacuole', 'Vacuole'], ['proteinGranule', 'Protein Granule']]) {
    const card = [...document.querySelectorAll('.action-card')]
      .find((c) => c.textContent.includes(name));
    out[id] = card?.querySelector('.effect-list')?.textContent.replace(/\s+/g, ' ').trim() ?? null;
  }
  return out;
});
check('the Hivecore no longer advertises the room it brings',
  effectLines.hivecore && !/storage/i.test(effectLines.hivecore), effectLines.hivecore);
check('a Vacuole does, because that is the whole of it',
  /1 kg general storage/.test(effectLines.vacuole || ''), effectLines.vacuole);
check('and so does a Protein Granule, for the one thing it holds',
  /200 g protein storage/.test(effectLines.proteinGranule || ''), effectLines.proteinGranule);


/* ============================= 9. the brood, and what the generators can reach */

const reach = await p.evaluate(() => {
  const s = hive.state;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.general = {};
  s.structures.hivecore = 1;
  s.structures.vacuole = 20;
  s.structures.proteinGranule = 0;
  s.structures.broodChamber = 0;
  delete s.active.vacuole;
  s.structures.metabolicGenerator = 1;
  s.nutrients.carb = 1_000;
  s.nutrients.fat = 1_000;
  s.nutrients.protein = 1_000; // not a fuel, must never be counted

  const at = (preferred, fallback) => {
    s.energy.preferred = preferred;
    s.energy.fallback = fallback;
    const d = hive.derived();
    return { fuels: [...d.energy.fuels].sort(), usable: d.energy.usable, stored: d.energy.stored };
  };
  const both = at('carb', 'fat');
  const fatOnly = at('fat', 'fat');
  const carbOnly = at('carb', 'carb');
  s.structures.metabolicGenerator = 0;
  const none = at('carb', 'fat');
  s.structures.metabolicGenerator = 1;
  hive.setActive('metabolicGenerator', 'none');
  const idled = at('carb', 'fat');
  hive.setActive('metabolicGenerator', 'all');
  return { both, fatOnly, carbOnly, none, idled, generated: hive.derived().energy.generated };
});
const kj = (n, g) => g * n * 1000;
check('usable energy counts only what a generator is pointed at',
  reach.both.fuels.join() === 'carb,fat' &&
  Math.abs(reach.both.usable - (kj(17, 1000) + kj(37, 1000))) < 1,
  `${reach.both.fuels.join(' + ')} = ${(reach.both.usable / 1e6).toFixed(1)} MJ`);
check('repointing it changes the figure',
  reach.fatOnly.fuels.join() === 'fat' &&
  Math.abs(reach.fatOnly.usable - kj(37, 1000)) < 1 &&
  reach.carbOnly.fuels.join() === 'carb' &&
  Math.abs(reach.carbOnly.usable - kj(17, 1000)) < 1,
  `fat only ${(reach.fatOnly.usable / 1e6).toFixed(1)} MJ, carb only ${(reach.carbOnly.usable / 1e6).toFixed(1)} MJ`);
check('a store nothing reaches for is not fuel, however much of it there is',
  reach.fatOnly.usable < reach.fatOnly.stored,
  `${(reach.fatOnly.usable / 1e6).toFixed(1)} MJ in reach of ${(reach.fatOnly.stored / 1e6).toFixed(1)} MJ stored`);
check('and protein is never counted — it is not a fuel at all',
  !reach.both.fuels.includes('protein'));
check('no generator means nothing is in reach',
  reach.none.usable === 0 && reach.none.fuels.length === 0,
  `${reach.none.usable} J`);
check('nor does an idled one reach anything',
  reach.idled.usable === 0, `${reach.idled.usable} J`);

const topbar = await p.evaluate(() => {
  const top = document.querySelector('.topbar').innerText.replace(/\s+/g, ' ');
  return { text: top, generated: hive.derived().energy.generated };
});
check('the top bar leads on what is being GENERATED, per second',
  /Energy\s+[\d.]+\s*[kMG]?W\b/.test(topbar.text) && topbar.generated > 0,
  /Energy\s+\S+\s*\S*/.exec(topbar.text)?.[0] ?? topbar.text.slice(0, 40));

/* --------------------------------------------------------------- the chamber */

const brood = await p.evaluate(() => {
  const s = hive.state;
  s.energy.preferred = 'fat';
  s.energy.fallback = 'fat';
  s.structures.metabolicGenerator = 5; // ~1.85 MW, enough for core + chamber
  s.structures.broodChamber = 1;
  // The block above pinned the active count at one generator. Raising
  // `structures` does not raise it, by design — so clear it.
  delete s.active.metabolicGenerator;
  delete s.active.broodChamber;
  s.nutrients.fat = 20_000;
  s.nutrients.protein = 1_000;
  s.nutrients.carb = 1_000;
  s.larvae = 0;
  s.brood = {};
  s.power.broodChamber = 1;
  s.energyPool = 0;

  const def = hive.structureDefs.broodChamber;
  const out = { seconds: def.brood.seconds, cost: def.brood.cost, category: def.category };
  const proteinBefore = s.nutrients.protein;
  for (let i = 0; i < 190; i += 1) hive.tick(0.1); // 19s — not quite a cycle
  out.beforeFirst = s.larvae;
  for (let i = 0; i < 20; i += 1) hive.tick(0.1); // 21s total
  out.afterFirst = s.larvae;
  out.proteinSpent = proteinBefore - s.nutrients.protein;
  for (let i = 0; i < 600; i += 1) hive.tick(0.1); // 81s total
  out.afterMinute = s.larvae;
  const d = hive.derived();
  out.carbDraw = d.larvae.want;
  out.carbSource = (d.flowSources.carb || []).find((x) => /Larvae/.test(x.label)) || null;
  out.rate = d.broodRate;
  out.pace = hive.larvaPace();
  return out;
});
check('the Brood Chamber is a Core building', brood.category === 'core', brood.category);
check('one lays a larva every 20 s, and not before',
  brood.seconds === 20 && brood.beforeFirst === 0 && brood.afterFirst === 1,
  `0 at 19s, ${brood.afterFirst} at 21s`);
check('and it costs 60 g of protein to do it',
  brood.cost.protein === 60 && Math.abs(brood.proteinSpent - 60) < 1,
  `${brood.proteinSpent.toFixed(0)} g spent`);
// MORE than four, because a brood that has something in it lays faster — see
// engine.js larvaPace. Five more rather than four is the pace compounding on
// itself over the minute, which is the whole point of the rule.
check('and more in the next minute than the first, because a full brood is faster',
  brood.afterMinute > 4, `${brood.afterMinute} larvae at 81s`);
check('the rate reads as the base rate times the pace',
  Math.abs(brood.rate * 60 - 3 * brood.pace) < 1e-9,
  `${(brood.rate * 60).toFixed(1)}/min at ×${brood.pace.toFixed(2)}`);
check('every larva eats a tenth of a gram of carbohydrate a second',
  Math.abs(brood.carbDraw - brood.afterMinute * 0.1) < 1e-9,
  `${brood.afterMinute} larvae → ${brood.carbDraw} g/s`);
check('and it shows up against the carbohydrate, by name',
  brood.carbSource && new RegExp(`Larvae ×${brood.afterMinute}`).test(brood.carbSource.label) &&
  Math.abs(brood.carbSource.amount + brood.afterMinute * 0.1) < 1e-9,
  `${brood.carbSource?.label} ${brood.carbSource?.amount}`);

const broke = await p.evaluate(() => {
  const s = hive.state;
  s.nutrients.protein = 0;
  const before = s.larvae;
  for (let i = 0; i < 600; i += 1) hive.tick(0.1);
  const stalled = s.larvae;
  // Protein arrives: it must lay what one cycle is worth at the pace it is
  // running at, not three minutes' worth of banked backlog.
  s.nutrients.protein = 2_000;
  const pace = hive.larvaPace();
  for (let i = 0; i < 210; i += 1) hive.tick(0.1);
  return { before, stalled, after: s.larvae, pace };
});
check('an attempt with no protein lays nothing',
  broke.stalled === broke.before, `${broke.before} → ${broke.stalled} over a minute`);
check('and a failed attempt is lost, not banked as a backlog',
  broke.after - broke.stalled === Math.floor(21 / (20 / broke.pace)),
  `${broke.stalled} → ${broke.after} in the 21 s after protein arrived, at ×${broke.pace.toFixed(2)}`);

const unfed = await p.evaluate(() => {
  const s = hive.state;
  s.nutrients.carb = 0;
  const d = hive.derived();
  return {
    want: d.larvae.want,
    drain: d.larvae.drain,
    starving: d.larvae.starving,
    label: (d.flowSources.carb || []).find((x) => /Larvae/.test(x.label))?.label ?? null,
  };
});
check('larvae with no sugar read as unfed rather than as free',
  unfed.starving && unfed.drain === 0 && unfed.want > 0 && /unfed/.test(unfed.label || ''),
  `${unfed.label}: wants ${unfed.want} g/s, getting ${unfed.drain}`);

const broodUi = await p.evaluate(() => {
  hive.state.ui.tab = 'hive';
  return null;
});
await p.waitForTimeout(250);
const broodCard = await p.evaluate(() => {
  const card = [...document.querySelectorAll('.action-card')]
    .find((c) => c.textContent.includes('Brood Chamber'));
  return card?.querySelector('.effect-list')?.textContent.replace(/\s+/g, ' ').trim() ?? null;
});
check('the card says what it lays and what it costs',
  /1 larva every 20s/.test(broodCard || '') && /60 g protein/.test(broodCard || ''),
  broodCard);


/* ============================ 10. a brood that is not fed does not stay a brood */

const starve = await p.evaluate(() => {
  const s = hive.state;
  s.energy.preferred = 'fat';
  s.energy.fallback = 'fat';
  s.structures.vacuole = 30;
  s.structures.metabolicGenerator = 6;
  s.structures.broodChamber = 0; // nothing laying: this is about dying
  for (const k of ['vacuole', 'metabolicGenerator', 'broodChamber']) delete s.active[k];
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.general = {};
  s.nutrients.fat = 25_000;
  s.nutrients.carb = 2_000;
  s.larvae = 10;
  s.larvaeHunger = 0;
  s.larvaeDying = 0;
  s.stats.larvaeLost = 0;
  s.log.length = 0; // count only this section's notices

  const snap = () => {
    const d = hive.derived();
    return {
      larvae: s.larvae,
      hunger: d.larvae.hunger,
      starving: d.larvae.starving,
      dying: d.larvae.dying,
      next: d.larvae.secondsToNext,
      rate: d.larvae.deathRate,
    };
  };
  const run = (seconds) => { for (let i = 0; i < seconds * 2; i += 1) hive.tick(0.5); };

  const out = {};
  out.fed = snap();
  s.nutrients.carb = 0; // the sugar stops

  run(2);
  out.at2 = snap();
  run(3); // 5s
  out.at5 = snap();
  run(1.5); // 6.5s — past grace, not yet two seconds in
  out.at65 = snap();
  run(5.5); // 12s — grace plus seven
  out.at12 = snap();

  s.nutrients.carb = 1_000; // fed again
  run(1);
  out.fedAgain = snap();
  run(30);
  out.longFed = snap();

  s.nutrients.carb = 0;
  run(40);
  out.wiped = snap();
  out.lost = s.stats.larvaeLost;
  out.log = s.log.map((l) => l.text);
  return out;
});

check('a fed brood is not starving and has no clock on it',
  !starve.fed.starving && starve.fed.hunger === 0 && starve.fed.next === null,
  `starving ${starve.fed.starving}, hunger ${starve.fed.hunger}`);
check('the first two seconds unfed cost nothing',
  starve.at2.larvae === 10 && starve.at2.starving && !starve.at2.dying,
  `${starve.at2.larvae} larvae, ${starve.at2.hunger.toFixed(1)}s hungry`);
check('and it counts down to the first death',
  Math.abs(starve.at2.next - 3) < 1e-9, `${starve.at2.next.toFixed(1)}s to go`);
check('five seconds is the whole of the grace',
  starve.at5.larvae === 10 && starve.at5.dying,
  `${starve.at5.larvae} larvae at ${starve.at5.hunger.toFixed(1)}s`);
check('the first death lands two seconds after that, not at five',
  starve.at65.larvae === 10, `${starve.at65.larvae} at ${starve.at65.hunger.toFixed(1)}s`);
check('then one every two seconds',
  starve.at12.larvae === 7 && Math.abs(starve.at12.rate - 0.5) < 1e-9,
  `10 → ${starve.at12.larvae} over 12s unfed (grace 5 + 7 = 3 dead), at ${starve.at12.rate}/s`);
check('feeding them again stops it dead',
  !starve.fedAgain.starving && starve.fedAgain.hunger === 0 && starve.fedAgain.larvae === 7,
  `${starve.fedAgain.larvae} larvae, hunger reset to ${starve.fedAgain.hunger}`);
check('and the clock does not carry over to the next time',
  starve.longFed.larvae === 7, `${starve.longFed.larvae} after half a minute fed`);
check('left unfed long enough the brood goes entirely',
  starve.wiped.larvae === 0 && starve.lost === 10,
  `${starve.lost} starved in all`);
// Two episodes of starvation, so two warnings and two "they are dying" lines —
// not one line every two seconds, which is twelve.
check('the log says it once per episode, not once per death',
  starve.log.filter((t) => /dying of hunger/.test(t)).length === 2 &&
  starve.log.filter((t) => /going unfed/.test(t)).length === 2 &&
  starve.log.some((t) => /brood is gone/i.test(t)),
  `${starve.log.filter((t) => /dying of hunger/.test(t)).length} death notices for 10 deaths`);

const starveUi = await p.evaluate(() => {
  const s = hive.state;
  s.larvae = 6;
  s.larvaeHunger = 0;
  s.larvaeDying = 0;
  s.nutrients.carb = 0;
  for (let i = 0; i < 14; i += 1) hive.tick(0.5); // 7s unfed: dying
  return null;
});
await p.waitForTimeout(250);
const warned = await p.evaluate(() => {
  const top = document.querySelector('.topbar').innerText.replace(/\s+/g, ' ');
  return { text: top, larvae: hive.state.larvae, dying: hive.derived().larvae.dying };
});
check('the top bar says the brood is dying, without needing a hover',
  warned.dying && /Larvae\s+\d+\s*·?\s*dying/.test(warned.text),
  /Larvae[^|]{0,18}/.exec(warned.text)?.[0]);

check('no console errors anywhere in all that', errors.length === 0, errors.slice(0, 3).join(' / '));

await browser.close();
console.log(`\n${fail.length ? `FAILURES (${fail.length}): ${fail.join(', ')}` : 'All checks passed.'}`);
process.exit(fail.length ? 1 : 0);
