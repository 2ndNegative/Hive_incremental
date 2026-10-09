import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { LAUNCH, shot, ROOT } from './harness.mjs';

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

const url = pathToFileURL(`${ROOT}HiveIdle.html`).href;
const browser = await chromium.launch(LAUNCH);
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url().slice(0, 60)}`));

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};

await page.goto(url, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.res-row', { timeout: 10000 });
  await ensureLanded(page);

check('boots from a file:// double-click', true);

const macros = await page.$$eval('.res-name', (e) => e.map((x) => x.textContent.trim()));
check('nutrient panel renders', macros.length === 7, macros.join(', '));

/* the simulation is actually ticking, not just painted once */
const t1 = await page.evaluate(() => hive.state.playtime);
await page.waitForTimeout(1200);
const t2 = await page.evaluate(() => hive.state.playtime);
check('game loop runs', t2 > t1 + 0.5, `playtime ${t1.toFixed(1)}s -> ${t2.toFixed(1)}s`);

/* interaction works */
for (let i = 0; i < 5; i += 1) await page.click('.gather-btn');
const clicked = await page.evaluate(() => hive.state.stats.clicks);
check('clicking works', clicked >= 5, `${clicked} intakes`);

/* every tab mounts without an external fetch */
const TAB_LABELS = ['Hive', 'Drones', 'Territory', 'Storage', 'Metabolism', 'Research', 'Codex', 'Stats', 'Settings'];
for (const name of TAB_LABELS) {
  await openTab(page, name);
  const painted = await page.evaluate(() => document.querySelector('.main-col').innerText.trim().length);
  if (painted < 20) fail.push(`tab ${name} empty`);
}
check(`all ${TAB_LABELS.length} tabs render`, !fail.some((f) => f.startsWith('tab ')));

/* the item database made it into the bundle */
const items = await page.evaluate(() => Object.keys(hive.items).length);
check('item database is bundled', items > 450, `${items} items`);

/* saves persist across a reload, which is the thing file:// could have broken */
// Within what a landed hive can hold: storage comes entirely from what is
// built, so a figure above the Hivecore's fat shelf would spill on the first
// tick after loading and tell us nothing about file://.
await page.evaluate(() => { hive.state.nutrients.fat = 1234; hive.save(); });
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.res-row');
  await ensureLanded(page);
const fat = await page.evaluate(() => hive.state.nutrients.fat);
check('save survives a reload from file://', fat > 1200, `fat ${fat.toFixed(0)} g`);

await openTab(page, 'Codex');
await page.waitForSelector('.codex-row');
await page.screenshot({ path: shot('portable.png') });

console.log(`\nnetwork/console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
console.log(fail.length ? `\n=== ${fail.length} CHECK(S) FAILED: ${fail.join('; ')} ===` : '\n=== portable build verified ===');
await browser.close();
console.log('=== single-file test finished ===');
