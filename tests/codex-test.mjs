import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * The codex, and the gizzard.
 *
 * The codex's job changed: it used to be a catalogue of everything that exists
 * and is now a record of what this colony has actually met. That is a one-line
 * filter and a whole different contract, so most of what is checked here is the
 * contract — that nothing unmet leaks through any route, including search, the
 * category dropdown and a stale selection carried in from a save.
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
  await page.waitForTimeout(250);
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

/* ================================================ 1. the gizzard */

const gizzard = await p.evaluate(() => {
  const def = hive.structureDefs.gizzard;
  if (!def) return { there: false };
  const s = hive.state;
  s.structures = {};
  for (const id of hive.structureOrder) s.structures[id] = 0;
  s.active = {};
  s.power = {};
  s.structures.hivecore = 1;
  const before = { ...hive.derived().storage.dedicated };
  s.structures.gizzard = 1;
  s.active.gizzard = 1;
  const after = { ...hive.derived().storage.dedicated };
  const moved = {};
  for (const n of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = (after[n] || 0) - (before[n] || 0);
    if (Math.abs(d) > 1e-9) moved[n] = d;
  }
  return {
    there: true,
    inOrder: hive.structureOrder.includes('gizzard'),
    category: def.category,
    moved,
    cost: def.cost(0),
  };
});
check('there is a mineral mass store', gizzard.there && gizzard.inOrder);
check('and it is filed under storage', gizzard.category === 'storage');
check('it holds a kilo of unsorted mineral mass',
  gizzard.moved.ash === 1000, `${gizzard.moved.ash} g of ash`);
check('and NOTHING else — no assayed mineral gets a gram of it',
  Object.keys(gizzard.moved).length === 1,
  Object.keys(gizzard.moved).join(', '));
check('its cost is written in rungs, like everything else',
  gizzard.cost.fiber === 250 && gizzard.cost.protein === 50 && gizzard.cost.iron === 10,
  JSON.stringify(gizzard.cost));

const assayed = await p.evaluate(() => {
  // With every assay done, the gizzard must STILL hold only ash. An assay
  // changes what the hive can see in the mass, not where the mass sits.
  const s = hive.state;
  for (const t of ['bulkMineralAssay', 'traceMetalAssay', 'rareElementAssay']) s.tech[t] = true;
  const d = hive.derived();
  s.structures.gizzard = 0;
  const without = { ...hive.derived().storage.dedicated };
  s.structures.gizzard = 1;
  const with_ = { ...d.storage.dedicated };
  const minerals = ['sodium', 'potassium', 'calcium', 'iron', 'zinc', 'phosphorus'];
  return {
    ash: (with_.ash || 0) - (without.ash || 0),
    minerals: minerals.map((m) => (with_[m] || 0) - (without[m] || 0)),
  };
});
check('still only ash once every assay is in',
  assayed.ash === 1000 && assayed.minerals.every((v) => v === 0),
  `ash +${assayed.ash} g, assayed minerals ${assayed.minerals.join('/')}`);

/* ========================================= 2. the codex lists only what is known */

await p.evaluate(() => { hive.state.found = {}; hive.state.ui.codexSearch = ''; });
await openTab(p, 'Codex');
await p.waitForTimeout(350);

const fresh = await p.evaluate(() => ({
  rows: document.querySelectorAll('.codex-row').length,
  head: document.querySelector('.codex-list .panel-head')?.innerText.replace(/\s+/g, ' ').trim(),
  empty: document.querySelector('.codex-list .panel-body p')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
  categories: [...document.querySelectorAll('.codex-controls select')][0]?.options.length,
}));
check('a hive that has met nothing lists nothing', fresh.rows === 0, `${fresh.rows} rows`);
check('and says so in a way that reads as a beginning, not a fault',
  /has not met anything yet/.test(fresh.empty), fresh.empty.slice(0, 60));
check('the category dropdown does not leak the ones it has not met either',
  fresh.categories === 1, `${fresh.categories} option`);

const seeded = await p.evaluate(() => {
  const s = hive.state;
  const ids = Object.keys(hive.items).slice(0, 30);
  s.found = { temperateForest: {} };
  for (const id of ids) s.found.temperateForest[id] = 3;
  return { seeded: ids.length, total: Object.keys(hive.items).length };
});
await p.waitForTimeout(350);
const listed = await p.evaluate(() => ({
  rows: document.querySelectorAll('.codex-row').length,
  head: document.querySelector('.codex-list .panel-head')?.innerText.replace(/\s+/g, ' ').trim(),
}));
check('meeting thirty things lists exactly those thirty',
  listed.rows === seeded.seeded,
  `${listed.rows} of ${seeded.total} in the database`);
check('and the header counts what is known, not what exists',
  /30 known/i.test(listed.head), listed.head);

/* ============================================ 3. the search line */

const placeholder = await p.evaluate(() => document.querySelector('.codex-search')?.placeholder ?? '');
check('the search line quotes no item count at all',
  !/\d/.test(placeholder), placeholder);
check('and says it searches by content too',
  /what is in it|resource|contain/i.test(placeholder), placeholder);

/* ======================================= 4. searching by what is in it */

const byNutrient = await p.evaluate(() => {
  const s = hive.state;
  // Every drink, so there is something with ethanol in it to find.
  const booze = Object.keys(hive.items).filter((i) => (hive.items[i].per100g.ethanol || 0) > 0);
  for (const id of booze) s.found.temperateForest[id] = 3;
  return { booze };
});
await p.fill('.codex-search', 'ethanol');
await p.waitForTimeout(350);
const found = await p.evaluate(() => ({
  rows: [...document.querySelectorAll('.codex-row')].map((r) => r.innerText.split('\n')[0]),
  hint: document.querySelector('.codex-hint')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
}));
check('searching a nutrient finds everything carrying it',
  found.rows.length === byNutrient.booze.length,
  `${found.rows.length} of ${byNutrient.booze.length}: ${found.rows.join(', ')}`);
check('none of which has the word in its name',
  found.rows.every((n) => !/ethanol/i.test(n)),
  'so a name search alone could never have found them');
check('and the list says why they matched',
  /containing ethanol/i.test(found.hint), found.hint);

await p.fill('.codex-search', 'fat');
await p.waitForTimeout(350);
const byFat = await p.evaluate(() => ({
  rows: document.querySelectorAll('.codex-row').length,
  hint: document.querySelector('.codex-hint')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
  allHaveFat: [...document.querySelectorAll('.codex-row')].every((r) => {
    const name = r.innerText.split('\n')[0];
    const id = Object.keys(hive.items).find((i) => hive.items[i].name === name);
    const item = hive.items[id];
    return (item.per100g.fat || 0) > 0 || /fat/i.test(name) || item.tags.some((t) => /fat/.test(t));
  }),
}));
check('a macro works the same way', byFat.rows > 0 && byFat.allHaveFat, `${byFat.rows} results`);

const unassayed = await p.evaluate(() => {
  hive.state.tech = {}; // nothing assayed
  return null;
});
await p.fill('.codex-search', 'iron');
await p.waitForTimeout(350);
const hidden = await p.evaluate(() => ({
  rows: document.querySelectorAll('.codex-row').length,
  hint: document.querySelector('.codex-hint')?.innerText.trim() ?? null,
}));
check('a nutrient the hive has not assayed cannot be searched for',
  hidden.rows === 0 && hidden.hint === null,
  'the hive cannot pick iron out of the mineral mass, so it cannot say which finds carry it');

await p.evaluate(() => { hive.state.tech.bulkMineralAssay = true; hive.state.tech.traceMetalAssay = true; });
await p.waitForTimeout(350);
const revealed = await p.evaluate(() => ({
  rows: document.querySelectorAll('.codex-row').length,
  hint: document.querySelector('.codex-hint')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
}));
check('and can be the moment the assay lands',
  revealed.rows > 0 && /containing iron/i.test(revealed.hint),
  `${revealed.rows} results — ${revealed.hint}`);

await p.fill('.codex-search', 'zzzznothing');
await p.waitForTimeout(300);
const nothing = await p.evaluate(() =>
  document.querySelector('.codex-list .panel-body p')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
check('a query that matches nothing reads differently from an empty codex',
  /Nothing the hive knows matches/.test(nothing), nothing.slice(0, 60));

/* ============================== 5. a stale selection cannot show an unmet item */

await p.fill('.codex-search', '');
await p.waitForTimeout(300);
const stale = await p.evaluate(() => {
  const s = hive.state;
  const unmet = Object.keys(hive.items).find((id) => !s.found?.temperateForest?.[id]);
  s.ui.selectedItem = unmet;
  return { unmet, name: hive.items[unmet].name };
});
await p.waitForTimeout(350);
const detail = await p.evaluate(() => {
  const pane = document.querySelector('.codex-detail');
  return { text: pane?.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '' };
});
check('a selection the hive has no name for shows nothing',
  !detail.text.includes(stale.name),
  `${stale.name} is not on screen`);

const picking = await p.evaluate(() => {
  document.querySelector('.codex-row')?.click();
  return null;
});
await p.waitForTimeout(300);
const opened = await p.evaluate(() => ({
  selected: hive.state.ui.selectedItem,
  shows: document.querySelector('.codex-detail .panel-head')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
}));
check('and clicking a known one still opens it',
  Boolean(opened.selected) && opened.shows.length > 0, opened.shows.slice(0, 50));

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
