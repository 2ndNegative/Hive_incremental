import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * What holding ground is actually worth.
 *
 * Two mechanisms, deliberately separate:
 *   CAPACITY — land is the CEILING on how many drones can forage at once. Not a
 *     multiplier on what they bring back: a hive over its ceiling has drones
 *     standing around, and they still cost bandwidth.
 *   PATCHES — land decides how many places are worked at the same time, each
 *     its own find rolled separately. Splitting the same drones over more
 *     patches must not change total income — it changes what is coming in.
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

/* ===================================================== 1. what the rule is */

const rule = await p.evaluate(() => ({
  perMetre: hive.foragersPerSquareMetre,
  perPatch: hive.areaPerPatch,
  area: hive.totalArea(),
  capacity: hive.landCapacity(),
  patches: hive.patchCount(),
}));
check('the landing site is 36 m²', rule.area === 36, `${rule.area} m²`);
check('which carries fourteen foragers, at 0.4 to the square metre',
  rule.capacity === 14 && rule.perMetre === 0.4, `${rule.capacity} drones`);
check('and is one patch, at one per 36 m²',
  rule.patches === 1 && rule.perPatch === 36, `${rule.patches} patch`);

const scaling = await p.evaluate(() => {
  const s = hive.state;
  const at = (m2) => {
    s.territory = { temperateForest: m2 };
    return { capacity: hive.landCapacity(), patches: hive.patchCount() };
  };
  const out = { a36: at(36), a72: at(72), a200: at(200), a1000: at(1000), a9999: at(9999) };
  // Two biomes on a plot too small to earn a second patch by area alone.
  s.territory = { temperateForest: 20, grassland: 10 };
  out.twoBiomes = { capacity: hive.landCapacity(), patches: hive.patchCount() };
  s.territory = { temperateForest: 36 };
  return out;
});
check('doubling the ground doubles the carry and adds a patch',
  scaling.a72.capacity === 28 && scaling.a72.patches === 2,
  `${scaling.a72.capacity} drones, ${scaling.a72.patches} patches`);
check('and it keeps scaling', scaling.a200.patches === 5 && scaling.a1000.patches === 12,
  `200 m² → ${scaling.a200.patches}, 1000 m² → ${scaling.a1000.patches}`);
check('but the patch list stays readable however much land is held',
  scaling.a9999.patches === 12, `${scaling.a9999.patches} at 9999 m²`);
check('holding two kinds of ground is always worth two patches',
  scaling.twoBiomes.patches === 2, `${scaling.twoBiomes.patches} on 30 m² of two biomes`);

/* ================================================= 2. capacity is a ceiling */

const capped = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 36 }; // carries 14
  s.structures.caecum = 1;
  hive.forage.resetForage(s);

  // Trip weights pinned: these checks are about the rule, not the dice, and a
  // 20-to-45-gram roll is plenty of noise to hide a factor of three in.
  const sample = (drones) => {
    s.droneTypes.forager = drones;
    hive.forage.resetForage(s);
    hive.tick(1);
    hive.tick(1);
    for (const patch of s.patches.forager) patch.grams = 30;
    const f = hive.derived().droneForage.forager;
    return { count: f.count, working: f.working, landless: f.landless, rate: f.rate };
  };
  return { under: sample(4), exact: sample(14), over: sample(30) };
});
check('under the ceiling, every forager works',
  capped.under.working === 4 && capped.under.landless === 0,
  `${capped.under.working} of ${capped.under.count}`);
check('at the ceiling, every forager still works',
  capped.exact.working === 14 && capped.exact.landless === 0, `${capped.exact.working} working`);
check('over it, the surplus has nowhere to go',
  capped.over.working === 14 && capped.over.landless === 16,
  `${capped.over.working} working, ${capped.over.landless} standing around`);
check('so income stops rising with drones once the land is full',
  Math.abs(capped.over.rate - capped.exact.rate) < 1e-9,
  `${capped.exact.rate.toFixed(2)} g/s at 14 drones vs ${capped.over.rate.toFixed(2)} at 30`);
check('and more than doubling the drones under the ceiling does raise it',
  capped.exact.rate > capped.under.rate * 3,
  `${capped.under.rate.toFixed(2)} → ${capped.exact.rate.toFixed(2)} g/s`);

// The landless still cost bandwidth: they are drones, not scenery.
const costs = await p.evaluate(() => {
  const load = hive.cognition().load.find((l) => l.key === 'drone:forager');
  return { amount: load?.amount, drones: hive.state.droneTypes.forager };
});
check('a drone with nowhere to work still occupies its cogit',
  costs.amount === 30, `${costs.amount} Cg for ${costs.drones} drones`);

/* ======================================== 3. taking more ground lifts the cap */

const expanded = await p.evaluate(() => {
  const s = hive.state;
  s.droneTypes.forager = 30;
  for (const patch of s.patches.forager) patch.grams = 30;
  const before = hive.derived().droneForage.forager;
  s.territory = { temperateForest: 160 }; // carries 64, 4 patches
  hive.tick(1);
  hive.tick(12); // let the new patches roll
  for (const patch of s.patches.forager) patch.grams = 30;
  const after = hive.derived().droneForage.forager;
  return {
    beforeRate: before.rate,
    beforeWorking: before.working,
    afterRate: after.rate,
    afterWorking: after.working,
    landless: after.landless,
    patches: after.patches.length,
  };
});
check('expanding puts the idle drones to work',
  expanded.afterWorking === 30 && expanded.landless === 0,
  `${expanded.beforeWorking} → ${expanded.afterWorking} working`);
check('and income rises with the land, not with the drone count',
  Math.abs(expanded.afterRate / expanded.beforeRate - 30 / 14) < 0.01,
  `${expanded.beforeRate.toFixed(1)} → ${expanded.afterRate.toFixed(1)} g/s`);
check('on four separate patches', expanded.patches === 4, `${expanded.patches} patches`);

/* ================================= 4. patches split the work, not the total */

const split = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 160 };
  s.droneTypes.forager = 20;
  hive.forage.resetForage(s);
  hive.tick(1);
  const f = hive.derived().droneForage.forager;
  // Every patch is a separate find with its own share of the drones, and the
  // rates must add up to the same mass the type as a whole is bringing in.
  const summed = f.patches.reduce((a, q) => a + q.rate, 0);
  const expected = f.patches.reduce((a, q) => a + (q.grams * (f.working / f.open)) / 12, 0);
  return {
    open: f.open,
    drones: f.patches.map((q) => q.drones),
    rate: f.rate,
    summed,
    expected,
    items: new Set(f.patches.filter((q) => q.itemId).map((q) => q.itemId)).size,
    finds: f.patches.filter((q) => q.itemId).length,
  };
});
check('the drones spread evenly across the open patches',
  split.drones.every((d) => Math.abs(d - 5) < 1e-9), split.drones.join(' / '));
check('and the patch rates are the whole of the income',
  Math.abs(split.summed - split.rate) < 1e-9 && Math.abs(split.rate - split.expected) < 1e-9,
  `${split.summed.toFixed(2)} g/s over ${split.open} patches`);
check('four patches are usually four different things',
  split.finds === 4, `${split.items} distinct items on ${split.finds} worked patches`);

// One forager works ONE patch properly rather than a quarter of four.
const lonely = await p.evaluate(() => {
  const s = hive.state;
  s.droneTypes.forager = 1;
  hive.tick(1);
  const f = hive.derived().droneForage.forager;
  return { open: f.open, held: f.patches.length, worked: f.patches.filter((q) => q.worked).length };
});
check('a single forager works one patch, not a quarter of each',
  lonely.open === 1 && lonely.worked === 1 && lonely.held === 4,
  `${lonely.worked} of ${lonely.held} patches worked`);

/* ============================================== 5. patches drift out of step */

const stagger = await p.evaluate(() => {
  const s = hive.state;
  s.droneTypes.forager = 20;
  hive.forage.resetForage(s);
  hive.tick(1);
  const elapsed = s.patches.forager.map((q) => q.elapsed);
  return { elapsed, distinct: new Set(elapsed.map((e) => e.toFixed(3))).size };
});
check('new patches are staggered rather than rolling in lockstep',
  stagger.distinct === 4, stagger.elapsed.map((e) => e.toFixed(1)).join(' / '));

/* ==================================================== 6. the screen says so */

await openTab(p, 'Territory');
await p.waitForTimeout(250);
const terr = await p.evaluate(() => {
  const box = [...document.querySelectorAll('.panel-box')].find((b) =>
    /out now/i.test(b.querySelector('.panel-head')?.innerText ?? ''),
  );
  return {
    text: box?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    // The three headline figures, read as figures. They used to be a sentence,
    // and a sentence is what a regex had to match — which meant this suite
    // broke on a rewording rather than on a wrong number.
    stats: [...(box?.querySelectorAll('.land-stat') ?? [])]
      .map((n) => n.innerText.replace(/\s+/g, ' ').trim()),
    // Patch rows only. The crews get a row each above them, and unworked patch
    // slots get none at all — see TerritoryTab's `outNow`.
    rows: box?.querySelectorAll('.offer-head ~ .field-row').length ?? 0,
  };
});
check('Territory says what the ground carries, as a figure',
  /20\s*\/\s*64/.test(terr.stats[0] ?? ''), terr.stats.join(' | '));
check('and how many patches are being worked',
  /^4\b/.test(terr.stats[1] ?? ''), terr.stats[1]);
check('and lists a row per worked patch', terr.rows === 4, `${terr.rows} rows`);

await p.evaluate(() => { hive.state.droneTypes.forager = 80; hive.tick(1); });
await p.waitForTimeout(250);
const over = await p.evaluate(() => {
  const box = [...document.querySelectorAll('.panel-box')].find((b) =>
    /out now/i.test(b.querySelector('.panel-head')?.innerText ?? ''),
  );
  return box?.innerText.replace(/\s+/g, ' ').trim() ?? '';
});
check('and warns when the hive outgrows its ground',
  /16 with nowhere to work/.test(over), over.slice(0, 160));

await openTab(p, 'Drones');
await p.waitForTimeout(250);
const drones = await p.evaluate(() => document.querySelector('.main-col')?.innerText ?? '');
check('the Drones tab says the same thing in its own terms',
  /with nowhere to work/.test(drones) && /patches of ground/.test(drones),
  drones.split('\n').find((l) => /nowhere/.test(l)));

/* ================================================== 7. a save round-trips it */

const saved = await p.evaluate(() => {
  hive.save();
  const key = Object.keys(localStorage).find((k) => /hive/i.test(k));
  const s = JSON.parse(localStorage.getItem(key));
  const st = s?.state ?? s;
  return { version: st?.version, patches: st?.patches?.forager?.length, stale: Object.keys(st?.forage ?? {}).filter((k) => k.startsWith('drone:')).length };
});
const SAVE_VERSION = await p.evaluate(() => hive.saveVersion);
check('the patches round-trip', saved.patches === 4, `${saved.patches} saved`);
check('and the old single drone slot is gone', saved.stale === 0, `${saved.stale} stale keys`);
check('at the current save version', saved.version === SAVE_VERSION, `v${saved.version}`);

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
