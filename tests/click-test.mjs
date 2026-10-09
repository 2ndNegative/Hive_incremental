import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * The click combo, the bigger seed, and what a Forager carries.
 *
 * The combo is the only thing in the game that rewards the player's hands
 * rather than their planning, so it has to behave exactly as advertised: a
 * steady hammering reaches ×3 and no further, walking away loses it, and it is
 * the GRAMS that are multiplied — not the odds, not the find.
 */

async function ensureLanded(page) {
  const card = await page.$('.origin-card:not(.is-locked):not(.is-placeholder)');
  if (!card) return false;
  await card.click();
  await page.waitForSelector('.origin-backdrop', { state: 'detached', timeout: 5000 });
  return true;
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

/* ==================================================== 1. the opening reserve */

const seed = await p.evaluate(() => {
  const d = hive.derived();
  return {
    pool: hive.state.energyPool,
    demand: d.energy.demand,
    minutes: hive.state.energyPool / d.energy.demand / 60,
    charge: d.power.hivecore.charge,
  };
});
check('the seed carries a gigajoule', Math.abs(seed.pool - 1e9) < 2e6,
  `${(seed.pool / 1e9).toFixed(3)} GJ`);
// Hours, since the Hivecore came down to fifty kilowatts. Checked as a ratio
// rather than a figure so a change to either number fails this honestly.
check('which is the whole of the seed divided by what a Hivecore eats',
  Math.abs(seed.minutes - 1e9 / seed.demand / 60) < 0.1 && seed.minutes > 60,
  `${seed.minutes.toFixed(0)} minutes at ${(seed.demand / 1000).toFixed(0)} kW`);
check('and the hive lands lit', seed.charge === 1, seed.charge.toFixed(2));

/* ===================================================== 2. a Forager's trip */

const load = await p.evaluate(() => {
  const def = hive.drones.types.forager;
  const out = [];
  for (let i = 0; i < 400; i += 1) {
    const patch = hive.forage.rollPatch(hive.state, 'forager', 'temperateForest', {});
    if (patch.itemId) out.push(patch.grams);
  }
  return { min: def.load.min, max: def.load.max, rolls: out };
});
check('a Forager declares a 20–45 g trip',
  load.min === 20 && load.max === 45, `${load.min}–${load.max} g`);
check('and every rolled trip lands inside it',
  Math.min(...load.rolls) >= 20 - 1e-9 && Math.max(...load.rolls) <= 45 + 1e-9,
  `${Math.min(...load.rolls).toFixed(1)}–${Math.max(...load.rolls).toFixed(1)} g over 400 trips`);

/* ==================================================== 3. the combo itself */

const cold = await p.evaluate(() => {
  hive.state.clickHeat = 0;
  return hive.manualCombo();
});
check('a cold button is worth exactly what it always was',
  cold.multiplier === 1 && !cold.hot, `×${cold.multiplier}`);

const ramp = await p.evaluate(() => {
  const s = hive.state;
  s.clickHeat = 0;
  const steps = [];
  // Hammering: no simulated time passes between presses, so nothing cools.
  for (let i = 0; i < 20; i += 1) {
    hive.consumeBiomass();
    steps.push(hive.clickMultiplier());
  }
  return steps;
});
check('every press is worth more than the last, until it is not',
  ramp.every((m, i) => i === 0 || m >= ramp[i - 1] - 1e-9), ramp.slice(0, 4).map((m) => m.toFixed(2)).join(' → '));
check('twelve fast presses reach the ceiling',
  Math.abs(ramp[11] - 3) < 1e-9, `×${ramp[11].toFixed(2)} on the twelfth`);
check('and it stops there, however long the hammering goes on',
  ramp[19] === 3, `×${ramp[19]} after twenty`);

const cools = await p.evaluate(() => {
  const s = hive.state;
  s.clickHeat = 1;
  const out = {};
  hive.tick(1);
  out.half = hive.clickMultiplier();
  hive.tick(1.1);
  out.cold = hive.clickMultiplier();
  s.clickHeat = 1;
  hive.tick(3600); // away for an hour
  out.away = hive.clickMultiplier();
  return out;
});
check('a second of not clicking loses half of it',
  Math.abs(cools.half - 2) < 1e-9, `×${cools.half.toFixed(2)} after 1s`);
check('two seconds loses all of it', cools.cold === 1, `×${cools.cold}`);
check('and coming back from an hour away starts cold', cools.away === 1, `×${cools.away}`);

/* ======================================== 4. it is the grams that are multiplied */

const grams = await p.evaluate(() => {
  const s = hive.state;
  const sample = (heat, n) => {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      s.clickHeat = heat; // held, so every press is at the same multiplier
      s.items = {};
      hive.consumeBiomass();
      if (s.lastGather.itemId) out.push(s.lastGather.grams);
    }
    return out.reduce((a, b) => a + b, 0) / out.length;
  };
  // Heat set BEFORE the press, and the press adds its own step, so compare at
  // the multipliers that actually result.
  s.clickHeat = 0;
  const base = sample(0, 400);
  const hot = sample(1, 400);
  return { base, hot, intake: hive.manualIntake };
});
check('a hot press brings back about three times as much',
  Math.abs(grams.hot / grams.base - 3 / (1 + 2 / 12)) < 0.12,
  `${grams.base.toFixed(1)} g cold vs ${grams.hot.toFixed(1)} g hot`);
check('the underlying mouthful is unchanged',
  grams.intake.grams === 40 && grams.intake.comboMax === 3,
  `${grams.intake.min}–${grams.intake.max} g, ×${grams.intake.comboMax} ceiling`);

// Nothing else moves: the combo is a multiplier on mass, not on luck.
const odds = await p.evaluate(() => {
  hive.state.clickHeat = 0;
  const cold = hive.manualOdds(6).map((o) => o.rate).join();
  hive.state.clickHeat = 1;
  const hot = hive.manualOdds(6).map((o) => o.rate).join();
  return { cold, hot };
});
check('and the odds of finding anything are untouched by it',
  odds.cold === odds.hot, odds.hot.slice(0, 40));

/* =========================================================== 5. on the screen */

await p.evaluate(() => { hive.state.clickHeat = 0; });
await p.waitForTimeout(200);
const beforeShown = await p.evaluate(() => ({
  hot: document.querySelector('.gather-btn')?.classList.contains('is-hot'),
  text: document.querySelector('.gather-btn')?.innerText.trim(),
}));
check('a cold button says nothing about multipliers',
  !beforeShown.hot && !/×/.test(beforeShown.text || ''), beforeShown.text);

for (let i = 0; i < 8; i += 1) await p.click('.gather-btn');
await p.waitForTimeout(200);
const shown = await p.evaluate(() => {
  const btn = document.querySelector('.gather-btn');
  return {
    hot: btn?.classList.contains('is-hot'),
    text: btn?.innerText.replace(/\s+/g, ' ').trim(),
    bar: parseFloat(btn?.querySelector('.combo-bar > span')?.style.width ?? '0'),
    heat: hive.manualCombo().heat,
    last: document.querySelector('.last-gather')?.innerText.replace(/\s+/g, ' ').trim(),
  };
});
check('eight real clicks warm the button up', shown.hot && /×\d/.test(shown.text), shown.text);
check('and the bar matches the heat underneath it',
  Math.abs(shown.bar / 100 - shown.heat) < 0.02,
  `bar ${shown.bar.toFixed(0)}%, heat ${(shown.heat * 100).toFixed(0)}%`);
check('the last gather says what it was multiplied by',
  /×\d/.test(shown.last || ''), shown.last);

/* ================================================== 6. a save keeps nothing hot */

const saved = await p.evaluate(() => {
  hive.save();
  const key = Object.keys(localStorage).find((k) => /hive/i.test(k));
  const raw = JSON.parse(localStorage.getItem(key));
  const s = raw?.state ?? raw;
  return { version: s?.version, heat: s?.clickHeat };
});
const SAVE_VERSION = await p.evaluate(() => hive.saveVersion);
check('the heat round-trips rather than being lost mid-run',
  typeof saved.heat === 'number', `${saved.heat}`);
check('at the current save version', saved.version === SAVE_VERSION, `v${saved.version}`);

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
