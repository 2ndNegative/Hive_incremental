import { chromium } from 'playwright';
import { BASE, LAUNCH, shot } from './harness.mjs';

// ---------------------------------------------------------------- test larder
// The hive holds nothing on its own any more: every gram of room comes from
// something built. A test that wants somewhere to put ten kilos of anything has
// to build the room first — a fixture rather than a Hivecore, because a
// Hivecore would also drag a megawatt of upkeep into the measurement.
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

/**
 * These suites were written before landing sites existed. A fresh save now
 * opens on the chooser and the hive stays inert until a site is picked, so
 * every test that expects a running game has to land first.
 */
async function ensureLanded(page) {
  const card = await page.$('.origin-card:not(.is-locked):not(.is-placeholder)');
  if (!card) return false;
  await card.click();
  await page.waitForSelector('.origin-backdrop', { state: 'detached', timeout: 5000 });
  return true;
}


/**
 * Open a tab by its label. Nth-child indices broke the moment a tab was
 * inserted in the middle of the bar, which is exactly what happened when
 * Storage arrived — so these address tabs by name instead.
 */
async function openTab(page, label) {
  await page.click(`.tab-bar button:text-is("${label}")`);
  await page.waitForTimeout(140);
}

const base = BASE;
const browser = await chromium.launch(LAUNCH);
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};

await page.goto(base, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.res-row');
  await ensureLanded(page);
  await giveStorage(page, 50);

/* 1. only macros are visible at the start */
const visible = await page.$$eval('.res-name', (els) => els.map((e) => e.textContent.trim()));
check('only macronutrients visible at start', visible.length === 7, visible.join(', '));

/* 2. micros accumulate while invisible */
for (let i = 0; i < 10; i += 1) await page.click('.gather-btn');
const hidden = await page.evaluate(() => ({
  potassium: hive.state.nutrients.potassium,
  calcium: hive.state.nutrients.calcium,
  vitaminA: hive.state.nutrients.vitaminA,
  shown: [...document.querySelectorAll('.res-name')].map((e) => e.textContent.trim()),
}));
check(
  'micros accumulate while still unresolved',
  hidden.potassium > 0 && hidden.calcium > 0 && !hidden.shown.includes('Potassium'),
  `K=${hidden.potassium.toFixed(3)}g held, not listed`,
);

/* 3. energy is derived from stored mass, not a separate pool */
const energyMath = await page.evaluate(() => {
  const d = hive.derived();
  const manual = Object.entries(hive.state.nutrients).reduce((sum, [n, g]) => {
    const def = hive.nutrients[n];
    return sum + g * def.kjPerGram * 1000;
  }, 0);
  return { stored: d.energy.stored, manual };
});
check(
  'stored energy equals the sum of nutrient energy',
  Math.abs(energyMath.stored - energyMath.manual) < 1,
  `${energyMath.stored.toFixed(0)} J`,
);

/* 4. burning fat costs far more energy per gram than burning a mineral */
const perGram = await page.evaluate(() => ({
  fat: hive.nutrients.fat.kjPerGram,
  carb: hive.nutrients.carb.kjPerGram,
  sodium: hive.nutrients.sodium.kjPerGram,
}));
check(
  '1 g of fat costs far more reserve than 1 g of salt',
  perGram.fat === 37 && perGram.sodium === 0,
  `fat ${perGram.fat} kJ/g vs sodium ${perGram.sodium} kJ/g`,
);

/* 5. preferred energy source actually decides which store drains.
      Demand no longer burns anything — only a Metabolic Generator turns stored
      matter into usable energy — so the fuel choice is now the generator's. */
await page.evaluate(() => {
  hive.state.structures.metabolicGenerator = 1;
  hive.state.nutrients.fat = 500; hive.state.nutrients.carb = 500;
  // Through the action, not by poking the state: a generator holds a cooldown
  // on the fuel it is already burning, and setGlobalFuel is what releases it.
  hive.setGlobalFuel('fat', 'carb');
});
const pref = await page.evaluate(() => {
  const d = hive.derived();
  return { fat: d.burn.fat || 0, carb: d.burn.carb || 0 };
});
check('preferred source is the one burned', pref.fat > 0 && pref.carb === 0, `fat ${pref.fat.toFixed(4)} g/s`);

/* 6. fallback takes over when the preferred store is empty */
await page.evaluate(() => { hive.state.nutrients.fat = 0; });
const fb = await page.evaluate(() => {
  const d = hive.derived();
  return { fat: d.burn.fat || 0, carb: d.burn.carb || 0 };
});
check('fallback takes over when preferred runs dry', fb.fat === 0 && fb.carb > 0, `carb ${fb.carb.toFixed(4)} g/s`);

/* 7. a zero-energy nutrient cannot be used as fuel */
const fuelList = await page.evaluate(() => hive.fuels.filter((f) => hive.nutrients[f].kjPerGram === 0));
check('no zero-energy nutrient is offered as fuel', fuelList.length === 0);

/* 8. unresearched fibre is stored but not burnable */
const fibre = await page.evaluate(() => {
  hive.state.nutrients.fiber = 1000;
  const d = hive.derived();
  return { stored: d.energy.stored, usable: d.energy.usable, locked: hive.state.tech.cellulolysis };
});
check(
  'locked fibre counts as stored energy but not as burnable',
  !fibre.locked && fibre.stored > fibre.usable,
  `${((fibre.stored - fibre.usable) / 1000).toFixed(0)} kJ locked`,
);

/* 9. hidden micro spillover is silent */
const spill = await page.evaluate(() => {
  const d = hive.derived();
  hive.state.nutrients.selenium = d.caps.selenium;
  const before = hive.state.spilled.selenium;
  // Fed directly rather than through a forager: the castes are parked for the
  // rebuild, and what this is testing is the spill, not who carried it.
  for (let i = 0; i < 40; i += 1) hive.ingestItem('kelp_fresh', 2000);
  return {
    before,
    after: hive.state.spilled.selenium,
    listed: [...document.querySelectorAll('.res-name')].map((e) => e.textContent.trim()).includes('Selenium'),
    logged: hive.state.log.some((l) => /selenium/i.test(l.text)),
  };
});
check(
  'hidden micro spills silently',
  spill.after > spill.before && !spill.listed && !spill.logged,
  `${(spill.after - spill.before).toFixed(4)} g discarded, nothing shown`,
);

/* 10. the assay reveals the stockpile that was already there */
await openTab(page, 'Research');
await page.waitForSelector('.action-card.is-research');
// Insight must be granted and spent inside one evaluate: the live loop clamps
// it to the current cap on the very next tick, which is correct behaviour and
// would otherwise race this test.
const revealed = await page.evaluate(() => {
  hive.state.tech.glycolysis = true;
  hive.state.insight = 10000;
  const heldBefore = hive.state.nutrients.potassium;
  const ok = hive.research('bulkMineralAssay');
  return { ok, heldBefore, tech: hive.state.tech.bulkMineralAssay, log: hive.state.log.slice(0, 4).map((l) => l.text) };
});
await page.waitForTimeout(300);
const afterReveal = await page.$$eval('.res-name', (els) => els.map((e) => e.textContent.trim()));
check(
  'assay reveals minerals already in store',
  afterReveal.includes('Potassium') && revealed.log.some((t) => /uncounted until now/i.test(t)),
  revealed.log.find((t) => /uncounted/i.test(t)) ?? '',
);

/* 11. costs in unresolved compounds cannot be paid */
const unpayable = await page.evaluate(() => hive.canAfford(hive.state, { selenium: 0.001 }));
check('a cost in an unresolved compound is unpayable', unpayable === false);

/* 12. codex hides unresolved micros on items */
// The Codex only lists what the hive knows by name, so the item under test has
// to have been found at least once. state.found is what names a thing — see
// discovery.js isNamed.
await page.evaluate(() => {
  const s = hive.state;
  s.found ??= {};
  const biome = Object.keys(s.territory || {})[0] || 'forestFloor';
  s.found[biome] ??= {};
  s.found[biome].beef_liver = (s.found[biome].beef_liver || 0) + 1;
});
await openTab(page, 'Codex');
await page.waitForSelector('.codex-row');
await page.fill('.codex-search', 'beef liver');
await page.waitForTimeout(200);
await page.click('.codex-row');
await page.waitForSelector('.codex-detail .data-table');
const codex = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('.codex-detail td:first-child')].map((e) => e.textContent.trim()),
  unresolvedNote: document.querySelector('.codex-detail .notice.is-warn')?.textContent.trim() ?? '',
}));
check(
  'codex lists resolved micros and only counts the rest',
  codex.rows.includes('Potassium') && !codex.rows.includes('Vitamin A') && /not yet resolved/.test(codex.unresolvedNote),
  codex.unresolvedNote.replace(/\s+/g, ' ').slice(0, 70),
);
await page.screenshot({ path: shot('codex.png') });

/* 13. SI units scale */
const units = await page.evaluate(() => ({
  small: hive.formatMass(0.0000593),
  big: hive.formatMass(5.5e9),
  energy: hive.formatEnergy(1.2e15),
  power: hive.formatPower(2500),
}));
check(
  'units scale from micrograms to petajoules',
  units.small === '59.3 µg' && units.big === '5.5 kt' && units.energy === '1.2 PJ' && units.power === '2.5 kW',
  Object.values(units).join(' | '),
);

/* 14. screenshots of the remaining tabs */
await openTab(page, 'Metabolism');
await page.waitForSelector('.fuel-row');
await page.screenshot({ path: shot('metabolism.png') });
await openTab(page, 'Hive');
await page.waitForTimeout(200);
await page.screenshot({ path: shot('hive.png') });
await openTab(page, 'Stats');
await page.waitForSelector('.data-table');
await page.screenshot({ path: shot('stats.png') });

/* 15. persistence */
await page.evaluate(() => hive.save());
const before = await page.evaluate(() => ({ k: hive.state.nutrients.potassium, tech: hive.state.tech.bulkMineralAssay }));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.res-row');
  await ensureLanded(page);
  await giveStorage(page, 50);
const after = await page.evaluate(() => ({ k: hive.state.nutrients.potassium, tech: hive.state.tech.bulkMineralAssay }));
check('save survives a reload', after.tech === before.tech && after.k > 0, `tech kept, K=${after.k.toFixed(2)}g`);

console.log(`\nconsole errors: ${errors.length ? errors.join(' | ') : 'none'}`);
console.log(fail.length ? `\n=== ${fail.length} CHECK(S) FAILED: ${fail.join('; ')} ===` : '\n=== all checks passed ===');
await browser.close();
console.log('=== smoke test finished ===');
