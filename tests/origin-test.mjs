import { chromium } from 'playwright';
import { BASE, LAUNCH, shot } from './harness.mjs';

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
// One shared context: browser.newPage() would give each page its own isolated
// localStorage, so a save written by one page would be invisible to the next —
// which is exactly what the migration check needs to read.
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};
const errors = [];

const p = await context.newPage();
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await p.goto(base, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });

/* ------------------------------------------------- 1. fresh save shows it */
await p.waitForSelector('.origin-backdrop', { timeout: 10000 });
check('a fresh save asks for a landing site', true);
const cards = await p.$$eval('.origin-card', (e) => e.length);
const pickable = await p.$$eval('.origin-card:not(.is-locked):not(.is-placeholder)', (e) => e.length);
check('one pickable site, shown beside a placeholder', pickable === 1 && cards >= 2, `${pickable} pickable of ${cards} cards`);
check('the site is Anthill', (await p.textContent('.origin-card .origin-name')).trim() === 'Anthill');

/* --------------------------------- 2. the hive is inert until a site is picked */
const inert = await p.evaluate(async () => {
  const before = { ...hive.state.nutrients };
  const d0 = hive.derived();
  await new Promise((r) => { setTimeout(r, 1200); });
  const after = { ...hive.state.nutrients };
  return {
    drones: hive.state.drones,
    demand: d0.energy.demand,
    nutrientSum: Object.values(after).reduce((a, b) => a + b, 0),
    drifted: Object.keys(before).some((n) => Math.abs(after[n] - before[n]) > 1e-9),
    playtimeMoved: hive.state.playtime > 0,
  };
});
check('no hive exists before the choice', inert.drones === 0 && inert.nutrientSum === 0, `${inert.drones} drones, 0 g held`);
check('nothing is consumed while the chooser waits', inert.demand === 0 && !inert.drifted,
  `demand ${inert.demand} W, stores unchanged over 1.2s`);

/* -------------------------------------------------------- 3. picking seeds it */
await p.click('.origin-card:not(.is-locked):not(.is-placeholder)');
await p.waitForSelector('.origin-backdrop', { state: 'detached', timeout: 5000 });
const seeded = await p.evaluate(() => ({
  origin: hive.state.origin,
  drones: hive.state.drones,
  dormant: hive.state.castes.dormant,
  protein: hive.state.nutrients.protein,
  water: hive.state.nutrients.water,
  fat: hive.state.nutrients.fat,
  carb: hive.state.nutrients.carb,
  logged: hive.state.log.some((l) => /Landed: Anthill/.test(l.text)),
  peak: hive.state.stats.peakDrones,
}));
// The Anthill is deliberately empty for the building/drone rebuild: no stores,
// no drones, nothing built. With nothing to consume, an empty hive sits there
// rather than starving — which is the point.
check('choosing seeds the opening conditions',
  seeded.drones === 0 && seeded.protein === 0 && seeded.water === 0 &&
    seeded.fat === 0 && seeded.carb === 0,
  `${seeded.drones} drones, no stores`);
check('an empty hive starts with nobody awake', seeded.dormant === 0 && seeded.peak === 0);
check('the landing is logged', seeded.logged);
check('the site is recorded on the run', seeded.origin === 'anthill');

/* the site still has to grant the one thing it is for: ground */
check('the site still grants its territory',
  await p.evaluate(() => hive.state.territory.temperateForest === 36), '36 m² of temperate forest');

/* --------------------------------------------- 4. it does not reappear mid-run */
await p.evaluate(() => hive.save());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await p.waitForTimeout(400);
check('it does not come back on reload', (await p.$('.origin-backdrop')) === null);
check('picking twice is refused', await p.evaluate(() => hive.run.chooseOrigin('anthill') === false));

/* ------------------------------------------------- 5. a restart asks again */
await p.evaluate(() => { hive.state.playtime = 600; hive.state.stats.ingested = 9999; });
await openTab(p, 'Settings');
await p.waitForSelector('button:text-is("Restart run")');
await p.click('button:text-is("Restart run")');
await p.waitForSelector('.modal-card');
await p.click('.modal-foot .btn:text-is("Restart run")');
await p.waitForSelector('.origin-backdrop', { timeout: 5000 });
const onRestart = await p.evaluate(() => ({
  origin: hive.state.origin,
  drones: hive.state.drones,
  runs: hive.state.lifetime.runs,
  lifetimeKept: hive.state.lifetime.ingested > 0,
  sub: document.querySelector('.origin-sub').textContent.trim(),
}));
check('a restart asks for a site again', onRestart.origin === null && onRestart.drones === 0);
check('lifetime record survived into the choice', onRestart.runs === 2 && onRestart.lifetimeKept, `run ${onRestart.runs}`);
check('the chooser knows which run this is', /Run 2/.test(onRestart.sub), onRestart.sub.slice(0, 40));
await p.screenshot({ path: shot('origin-chooser.png') });

await p.click('.origin-card:not(.is-locked):not(.is-placeholder)');
await p.waitForSelector('.origin-backdrop', { state: 'detached' });
check('run 2 seeds correctly too', await p.evaluate(
  () => hive.state.drones === 0 && hive.state.territory.temperateForest === 36));

/* --------------------------------------- 6. a wipe returns to the chooser */
await openTab(p, 'Settings');
await p.waitForSelector('button:text-is("Wipe save")');
await p.click('button:text-is("Wipe save")');
await p.waitForSelector('.modal-card.is-danger');
const wipeText = await p.textContent('.modal-card.is-danger');
check('no developer mention in the wipe dialog', !/developer/i.test(wipeText));
await p.fill('.confirm-phrase input', 'DELETE');
await p.click('.modal-foot .btn:text-is("Delete everything")');
await p.waitForSelector('.origin-backdrop', { timeout: 5000 });
check('a wipe returns to the chooser', await p.evaluate(() => hive.state.origin === null && hive.state.lifetime.runs === 1));

/* ------------------------------- 7. the restart dialog lost its dev line */
await p.click('.origin-card:not(.is-locked):not(.is-placeholder)');
await p.waitForSelector('.origin-backdrop', { state: 'detached' });
await openTab(p, 'Settings');
await p.click('button:text-is("Restart run")');
await p.waitForSelector('.modal-card');
const restartText = await p.textContent('.modal-card');
check('no developer mention in the restart dialog', !/developer/i.test(restartText));
check('restart dialog still lists what is kept', /Lifetime totals and records/.test(restartText) && /Settings/.test(restartText));
await p.click('.modal-foot .btn:text-is("Cancel")');

/* ------------------------- 8. an older save is grandfathered, not re-seeded */
const legacy = await p.evaluate(() => {
  hive.state.playtime = 3600;
  // Within what a Hivecore can hold. Storage is built now, and a legacy save
  // carrying more than it has room for spills the difference on the first tick
  // after loading — correct behaviour, and not what this test is about.
  hive.state.structures.hivecore = 1;
  hive.state.nutrients.protein = 1800;
  hive.save();
  const raw = JSON.parse(localStorage.getItem('hiveidle.save.v2'));
  // A genuine pre-sites save: no origin AND the older version stamp.
  delete raw.origin;
  raw.version = 2;
  localStorage.setItem('hiveidle.save.v2', JSON.stringify(raw));
  return true;
});
// The first page must be closed before opening the next one: its
// visibilitychange handler saves when it loses focus, which would overwrite the
// doctored save with a current-version one and quietly invalidate this test.
await p.close();

const p2 = await context.newPage();
p2.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await p2.goto(base, { waitUntil: 'networkidle' });
await p2.waitForSelector('.res-row');
await p2.waitForTimeout(400);
const migrated = await p2.evaluate(() => ({
  chooser: !!document.querySelector('.origin-backdrop'),
  origin: hive.state.origin,
  protein: hive.state.nutrients.protein,
  playtime: hive.state.playtime,
  version: hive.state.version,
}));
check('a pre-site save is not shown the chooser', legacy && migrated.chooser === false);
check('and is not re-seeded on top of its progress',
  migrated.origin === 'anthill' && migrated.protein > 1700 && migrated.playtime >= 3600,
  `origin ${migrated.origin}, ${migrated.protein.toFixed(0)} g protein and ` +
  `${Math.round(migrated.playtime)}s of play intact, now v${migrated.version}`);
await p2.close();

console.log(`\nconsole errors: ${errors.length ? errors.slice(0, 4).join(' | ') : 'none'}`);
console.log(fail.length ? `\n=== ${fail.length} CHECK(S) FAILED: ${fail.join('; ')} ===` : '\n=== landing sites verified ===');
await browser.close();
console.log('=== origin test finished ===');
