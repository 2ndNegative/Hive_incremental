import { chromium } from 'playwright';
import { BASE, LAUNCH, shot } from './harness.mjs';

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

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};

const errors = [];
const p = await browser.newPage({ viewport: { width: 1440, height: 980 } });
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await p.goto(base, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
  await ensureLanded(p);

/* Build up a run worth losing. */
await p.evaluate(() => {
  hive.dev.fillAllStores();
  hive.dev.grantAllResearch();
  hive.dev.addDrones(50);
  hive.state.stats.clicks = 123;
  hive.state.stats.ingested = 500000;
  hive.state.stats.built = 40;
  hive.state.playtime = 7200;
  hive.state.stats.peakDrones = 31;
  hive.save();
});

await openTab(p, 'Settings');
await p.waitForSelector('button:text-is("Restart run")');

/* ---------------------------------------------------- restart: dialog gating */
check('no dialog until asked', (await p.$('.modal-backdrop')) === null);
await p.click('button:text-is("Restart run")');
await p.waitForSelector('.modal-card');
const restartText = await p.textContent('.modal-card');
check('restart dialog explains what is kept vs cleared',
  /Lifetime totals and records/.test(restartText) && /All nutrient stores/.test(restartText));

await p.click('.modal-foot .btn:text-is("Cancel")');
await p.waitForTimeout(200);
const afterCancel = await p.evaluate(() => ({ drones: hive.state.drones, runs: hive.state.lifetime.runs }));
check('cancelling changes nothing', afterCancel.drones > 1 && afterCancel.runs === 1, `${afterCancel.drones} drones intact`);

/* ------------------------------------------------------- restart: the actual */
const before = await p.evaluate(() => ({
  playtime: hive.state.playtime,
  ingested: hive.state.stats.ingested,
  peak: hive.state.stats.peakDrones,
  researched: hive.state.stats.researched,
  theme: hive.state.settings.theme,
  dev: hive.state.dev.enabled,
}));
await p.click('button:text-is("Restart run")');
await p.waitForSelector('.modal-card');
await p.click('.modal-foot .btn:text-is("Restart run")');
await p.waitForTimeout(300);
// A restart hands the player back to the landing-site chooser, so the new run
// has to be landed before it has any stores to check.
await ensureLanded(p);

const after = await p.evaluate(() => ({
  runs: hive.state.lifetime.runs,
  playtime: hive.state.playtime,
  drones: hive.state.drones,
  structures: Object.values(hive.state.structures).reduce((a, b) => a + b, 0),
  tech: Object.values(hive.state.tech).filter(Boolean).length,
  insight: hive.state.insight,
  protein: hive.state.nutrients.protein,
  runIngested: hive.state.stats.ingested,
  hivecore: hive.state.structures.hivecore,
  lifetime: { ...hive.state.lifetime },
  theme: hive.state.settings.theme,
  dev: hive.state.dev.enabled,
  modalGone: !document.querySelector('.modal-backdrop'),
}));

// Back to the opening conditions, which are not nothing: the Anthill lands
// with a Hivecore, so a reset run has exactly that and nothing else.
check('the run resets', after.playtime < 5 && after.structures === 1 && after.tech === 0 && after.insight === 0,
  `${after.playtime.toFixed(1)}s, ${after.structures} structures, ${after.tech} tech`);
check('and resets to the landing site, not to a blank hive',
  after.hivecore === 1, `Hivecore Lv ${after.hivecore}`);
check('run statistics reset', after.runIngested < 1000, `${after.runIngested.toFixed(0)} g this run`);
check('run counter advances', after.runs === 2, `run ${after.runs}`);
check('lifetime totals absorb the finished run',
  after.lifetime.playtime >= before.playtime && after.lifetime.ingested >= before.ingested,
  `${(after.lifetime.playtime / 3600).toFixed(1)}h, ${(after.lifetime.ingested / 1000).toFixed(0)} kg banked`);
check('lifetime records kept', after.lifetime.bestDrones === before.peak && after.lifetime.bestResearched === before.researched,
  `best ${after.lifetime.bestDrones} drones, ${after.lifetime.bestResearched} research`);
check('settings and dev unlock survive', after.theme === before.theme && after.dev === before.dev);
// The Anthill grants no stores and no drones during the rebuild; what a
// restart must still restore is the ground the site sits on.
check('the restarted run is seeded with its territory',
  await p.evaluate(() => hive.state.territory.temperateForest === 36),
  '36 m² of temperate forest');
check('dialog closes itself', after.modalGone);

/* lifetime shown in the UI includes the run in progress */
await openTab(p, 'Stats');
await p.waitForSelector('.data-table');
const statsText = await p.textContent('.panel-box');
check('stats tab reports a lifetime panel', /Lifetime/.test(await p.textContent('.main-col')));

/* ------------------------------------------------------------ wipe: gated */
await openTab(p, 'Settings');
await p.waitForSelector('button:text-is("Wipe save")');
await p.click('button:text-is("Wipe save")');
await p.waitForSelector('.modal-card.is-danger');

const wipeText = await p.textContent('.modal-card.is-danger');
check('wipe dialog states it is irreversible', /cannot be undone/i.test(wipeText));
check('wipe dialog names the lifetime record', /lifetime record/i.test(wipeText) && /prestige/i.test(wipeText));
check('wipe dialog shows what is at stake', /Runs played/.test(wipeText) && /Most drones ever/.test(wipeText));
check('wipe dialog points at restart instead', /Restart run/.test(wipeText));

const disabled = await p.isDisabled('.modal-foot .btn:text-is("Delete everything")');
check('confirm is disabled until the phrase is typed', disabled === true);

await p.fill('.confirm-phrase input', 'delete me');
await p.waitForTimeout(100);
check('a wrong phrase keeps it disabled', await p.isDisabled('.modal-foot .btn:text-is("Delete everything")'));

await p.fill('.confirm-phrase input', 'DELETE');
await p.waitForTimeout(100);
check('the exact phrase enables it', !(await p.isDisabled('.modal-foot .btn:text-is("Delete everything")')));

/* export-before-wipe escape hatch */
await p.click('.modal-card .btn:text-is("Export save")');
await p.waitForTimeout(200);
const exported = await p.evaluate(() => document.querySelector('.save-box')?.value?.length ?? 0);
check('export-before-wipe produces a save string', exported > 100, `${exported} chars`);

/* backing out of the wipe */
await p.click('.modal-foot .btn:text-is("Cancel")');
await p.waitForTimeout(200);
check('cancelling the wipe keeps the save', await p.evaluate(() => hive.state.lifetime.runs === 2));

/* and finally, actually wiping */
await p.click('button:text-is("Wipe save")');
await p.waitForSelector('.modal-card.is-danger');
await p.fill('.confirm-phrase input', 'DELETE');
await p.click('.modal-foot .btn:text-is("Delete everything")');
await p.waitForTimeout(300);
const wiped = await p.evaluate(() => ({
  runs: hive.state.lifetime.runs,
  lifetimePlaytime: hive.state.lifetime.playtime,
  lifetimeIngested: hive.state.lifetime.ingested,
  best: hive.state.lifetime.bestDrones,
  playtime: hive.state.playtime,
}));
check('wipe clears the lifetime record too',
  wiped.runs === 1 && wiped.lifetimePlaytime === 0 && wiped.lifetimeIngested === 0 && wiped.best === 0,
  `run ${wiped.runs}, lifetime zeroed`);

/* and it persists as wiped */
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
  await ensureLanded(p);
check('the wipe survives a reload', await p.evaluate(() => hive.state.lifetime.runs === 1 && hive.state.lifetime.ingested === 0));

await openTab(p, 'Settings');
await p.waitForSelector('button:text-is("Wipe save")');
await p.click('button:text-is("Wipe save")');
await p.waitForSelector('.modal-card.is-danger');
await p.screenshot({ path: shot('wipe-dialog.png') });
await p.click('.modal-foot .btn:text-is("Cancel")');
await p.click('button:text-is("Restart run")');
await p.waitForSelector('.modal-card');
await p.screenshot({ path: shot('restart-dialog.png') });

console.log(`\nconsole errors: ${errors.length ? errors.slice(0, 4).join(' | ') : 'none'}`);
console.log(fail.length ? `\n=== ${fail.length} CHECK(S) FAILED: ${fail.join('; ')} ===` : '\n=== runs and wipe verified ===');
await browser.close();
console.log('=== run test finished ===');
