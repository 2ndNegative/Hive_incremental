import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * The shared pool: what is in it, where it sits, and what is allowed in.
 *
 * The pool is a buffer, not a cupboard — small, last-in-first-out, and whatever
 * overflows into it first owns it. A forest hive fills it with water within
 * seconds and then has nowhere to catch the protein that mattered, which is the
 * entire reason the player needs to be able to bar things from it.
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

/** A hive with a small pool and more of two things than its shelves can hold. */
async function fixture() {
  await p.evaluate(() => {
    const s = hive.state;
    s.structures.vacuole = 1; // 1 kg of shared room
    s.generalBans = {};
    s.general = {};
    for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
    s.spilled = {};
    hive.tick(0.1);
  });
}

/* ================================================ 1. it sits at the very top */

await fixture();
await p.waitForTimeout(250);
const placement = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.res-row')];
  const heads = [...document.querySelectorAll('.group-head')];
  const general = document.querySelector('.general-row');
  return {
    exists: Boolean(general),
    isFirstRow: rows[0]?.classList.contains('general-row'),
    // And above the first group header, not merely above the first row in it.
    aboveGroups: general && heads[0]
      ? general.compareDocumentPosition(heads[0]) & Node.DOCUMENT_POSITION_FOLLOWING
      : 0,
    clickable: general?.getAttribute('role') === 'button',
  };
});
check('the general store has a row of its own', placement.exists);
check('and it is the first resource row on the panel', placement.isFirstRow === true);
check('above every group heading, not inside one', Boolean(placement.aboveGroups));
check('and it reads as something you can click', placement.clickable);

/* ===================================================== 2. hovering says what is in it */

const filled = await p.evaluate(() => {
  const s = hive.state;
  // More water and fibre than their shelves hold, so both overflow.
  const d = hive.derived();
  const store = hive.openStore(s, d.storage);
  store.apply('water', (d.storage.dedicated.water || 0) + 600);
  store.apply('fiber', (d.storage.dedicated.fiber || 0) + 300);
  return { contents: hive.generalContents().map((g) => `${g.id} ${g.grams.toFixed(0)}`) };
});
check('two things overflowing both land in the pool',
  filled.contents.length === 2, filled.contents.join(', '));

await p.waitForTimeout(250);
await p.locator('.general-row').hover();
await p.waitForTimeout(300);
const tip = await p.evaluate(() => {
  const body = document.querySelector('.general-row .tip-body');
  return {
    visible: getComputedStyle(body).visibility !== 'hidden',
    text: body.innerText.replace(/\s+/g, ' ').trim(),
    rows: [...body.querySelectorAll('.tip-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
  };
});
check('hovering it shows a tooltip', tip.visible);
check('which names everything in the pool and how much',
  /Water/.test(tip.text) && /Fibre/.test(tip.text) && /600 g/.test(tip.text),
  tip.rows.slice(0, 3).join(' | '));
check('and says how much room is left', /Free/.test(tip.text), tip.rows.at(-1));
check('and that clicking it does something',
  /Click to choose what is allowed in/.test(tip.text));

/* ============================================= 3. barring keeps things out */

const barred = await p.evaluate(() => {
  const s = hive.state;
  s.generalBans = {};
  s.general = {};
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.spilled = {};
  const d = hive.derived();

  // Water barred, fibre not. Both are pushed well past their shelves.
  hive.setGeneralBan('water', true);
  const store = hive.openStore(s, d.storage);
  const waterSpill = store.apply('water', (d.storage.dedicated.water || 0) + 500);
  const fibreSpill = store.apply('fiber', (d.storage.dedicated.fiber || 0) + 500);
  return {
    bans: hive.generalBans(),
    pooledWater: s.general.water || 0,
    pooledFibre: s.general.fiber || 0,
    waterSpill,
    fibreSpill,
  };
});
check('a barred nutrient never reaches the pool',
  barred.pooledWater === 0 && barred.waterSpill > 0,
  `${barred.pooledWater} g pooled, ${barred.waterSpill.toFixed(0)} g spilled`);
check('and an allowed one still does',
  barred.pooledFibre > 0 && barred.fibreSpill === 0,
  `${barred.pooledFibre.toFixed(0)} g of fibre pooled`);
check('the ban is recorded', barred.bans.water === true, JSON.stringify(barred.bans));

/* =================================== 4. barring something already in there */

const evicted = await p.evaluate(() => {
  const s = hive.state;
  s.generalBans = {};
  s.general = {};
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.spilled = {};
  const d = hive.derived();
  hive.openStore(s, d.storage).apply('water', (d.storage.dedicated.water || 0) + 400);
  const before = { pooled: s.general.water || 0, held: s.nutrients.water };
  hive.setGeneralBan('water', true);
  return {
    before,
    after: { pooled: s.general.water || 0, held: s.nutrients.water },
    spilled: s.spilled.water || 0,
    shelf: d.storage.dedicated.water || 0,
  };
});
check('barring something already pooled evicts it',
  evicted.before.pooled > 0 && evicted.after.pooled === 0,
  `${evicted.before.pooled.toFixed(0)} g → ${evicted.after.pooled} g`);
check('the evicted mass spills rather than moving back onto a full shelf',
  Math.abs(evicted.after.held - evicted.shelf) < 1e-6 &&
    Math.abs(evicted.spilled - evicted.before.pooled) < 1e-6,
  `${evicted.after.held.toFixed(0)} g held, ${evicted.spilled.toFixed(0)} g spilled`);

const logged = await p.evaluate(() =>
  hive.state.log.slice(0, 4).map((l) => l.text).join(' | '),
);
check('and the log says so', /spilled out of general storage/.test(logged), logged.slice(0, 90));

/* ====================================== 5. a ban changes what is affordable */

const reach = await p.evaluate(() => {
  const s = hive.state;
  s.generalBans = {};
  s.general = {};
  const open = hive.derived().capsMax.water;
  hive.setGeneralBan('water', true);
  const shut = hive.derived().capsMax.water;
  const shelf = hive.derived().storage.dedicated.water || 0;
  hive.setGeneralBan('water', false);
  return { open, shut, shelf };
});
check('a barred nutrient stops counting the pool as headroom',
  reach.open > reach.shut && Math.abs(reach.shut - reach.shelf) < 1e-6,
  `${reach.open.toFixed(0)} g → ${reach.shut.toFixed(0)} g`);

/* ============ 5b. what the hive cannot name, it does not report by name

   An unassayed micronutrient is a shadow tally riding inside a macro: the hive
   is holding the iron but cannot tell it from the mineral mass around it. The
   rules dialog has always filtered those out, so the tooltip must too — and a
   rule set on the macro has to govern them, or barring mineral mass would leak
   most of the mass it was meant to stop. */

const shadow = await p.evaluate(() => {
  const s = hive.state;
  s.generalBans = {};
  s.general = {};
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.spilled = {};
  const d = hive.derived();
  const store = hive.openStore(s, d.storage);
  // Mineral mass over its shelf, and unassayed iron riding inside it.
  store.apply('ash', (d.storage.dedicated.ash || 0) + 120);
  store.apply('iron', (d.storage.dedicated.iron || 0) + 30);
  return {
    assayed: hive.isRevealed('iron'),
    raw: { ...s.general },
    shown: hive.generalContents().map((g) => ({ id: g.id, grams: Math.round(g.grams) })),
  };
});
check('iron is not assayed yet in this fixture', shadow.assayed === false);
check('but it is sitting in the pool', (shadow.raw.iron || 0) > 0,
  `${(shadow.raw.iron || 0).toFixed(0)} g of it`);
check('the tooltip never names a resource the hive has not assayed',
  shadow.shown.every((g) => g.id !== 'iron'),
  shadow.shown.map((g) => `${g.id} ${g.grams}`).join(', '));
check('it reports those grams under the macro carrying them instead',
  shadow.shown.find((g) => g.id === 'ash')?.grams === 150,
  `mineral mass reads ${shadow.shown.find((g) => g.id === 'ash')?.grams} g`);

const inherited = await p.evaluate(() => {
  const s = hive.state;
  s.generalBans = {};
  s.general = {};
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.spilled = {};
  hive.setGeneralBan('ash', true);
  const d = hive.derived();
  const store = hive.openStore(s, d.storage);
  const macroSpill = store.apply('ash', (d.storage.dedicated.ash || 0) + 80);
  const ironSpill = store.apply('iron', (d.storage.dedicated.iron || 0) + 40);
  const out = {
    pooledMacro: s.general.ash || 0,
    pooledIron: s.general.iron || 0,
    macroSpill,
    ironSpill,
    ironReach: hive.derived().capsMax.iron,
    ironShelf: d.storage.dedicated.iron || 0,
  };
  hive.setGeneralBan('ash', false);
  return out;
});
check('barring a macro bars the unassayed mass riding inside it',
  inherited.pooledIron === 0 && inherited.ironSpill > 0,
  `${inherited.pooledIron} g pooled, ${inherited.ironSpill.toFixed(0)} g spilled`);
check('and the macro itself, as before', inherited.pooledMacro === 0 && inherited.macroSpill > 0);
check('so the pool is not headroom for it either',
  Math.abs(inherited.ironReach - inherited.ironShelf) < 1e-6,
  `${inherited.ironReach.toFixed(0)} g of reach, ${inherited.ironShelf.toFixed(0)} g of shelf`);

const evictShadow = await p.evaluate(() => {
  const s = hive.state;
  s.generalBans = {};
  s.general = {};
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.spilled = {};
  const d = hive.derived();
  hive.openStore(s, d.storage).apply('iron', (d.storage.dedicated.iron || 0) + 60);
  const before = s.general.iron || 0;
  hive.setGeneralBan('ash', true);
  const after = s.general.iron || 0;
  hive.setGeneralBan('ash', false);
  return { before, after };
});
check('barring the macro evicts what was already pooled under it',
  evictShadow.before > 0 && evictShadow.after === 0,
  `${evictShadow.before.toFixed(0)} g → ${evictShadow.after} g`);

/* ========================================== 6. the dialog, end to end */

await fixture();
await p.waitForTimeout(250);
await p.locator('.general-row').click();
await p.waitForTimeout(300);
const dialog = await p.evaluate(() => {
  const box = document.querySelector('.rules-box');
  return {
    open: Boolean(box),
    rows: box ? box.querySelectorAll('.rule-toggle').length : 0,
    groups: box ? [...box.querySelectorAll('.group-head')].map((h) => h.innerText.split('\n')[0]) : [],
    hasFilter: Boolean(box?.querySelector('.codex-search')),
  };
});
check('clicking the row opens the rules', dialog.open && dialog.rows > 0,
  `${dialog.rows} resources listed`);
check('grouped the way the panel is', dialog.groups.length > 0, dialog.groups.join(', '));
check('with a filter for a long list', dialog.hasFilter);

const toggled = await p.evaluate(() => {
  const box = document.querySelector('.rules-box');
  const row = [...box.querySelectorAll('.field-row')]
    .find((r) => /^Protein/.test(r.querySelector('.field-label')?.innerText ?? ''));
  const btn = row.querySelector('.rule-toggle');
  const before = btn.textContent.trim();
  btn.click();
  return { before };
});
await p.waitForTimeout(250);
const afterToggle = await p.evaluate(() => {
  const box = document.querySelector('.rules-box');
  const row = [...box.querySelectorAll('.field-row')]
    .find((r) => /^Protein/.test(r.querySelector('.field-label')?.innerText ?? ''));
  return {
    label: row.querySelector('.rule-toggle').textContent.trim(),
    barred: row.querySelector('.rule-toggle').classList.contains('is-barred'),
    state: Boolean(hive.state.generalBans.protein),
  };
});
check('a toggle in it bars that resource',
  toggled.before === 'Allowed' && afterToggle.label === 'Barred' && afterToggle.state,
  `${toggled.before} → ${afterToggle.label}`);
check('and the button shows it', afterToggle.barred);

await p.waitForTimeout(250);
const counted = await p.evaluate(() =>
  document.querySelector('.general-row .res-name')?.innerText.replace(/\s+/g, ' ').trim(),
);
check('the row itself says how many are barred', /1 barred/.test(counted || ''), counted);

const all = await p.evaluate(() => {
  const box = document.querySelector('.rules-box');
  [...box.querySelectorAll('.btn')].find((b) => b.textContent.trim() === 'Bar all').click();
  return null;
});
await p.waitForTimeout(250);
const allBarred = await p.evaluate(() => Object.keys(hive.state.generalBans).length);
check('and "bar all" bars the lot', allBarred >= 7, `${allBarred} barred`);

await p.evaluate(() => {
  const box = document.querySelector('.rules-box');
  [...box.querySelectorAll('.btn')].find((b) => b.textContent.trim() === 'Allow all').click();
});
await p.waitForTimeout(250);
const cleared = await p.evaluate(() => Object.keys(hive.state.generalBans).length);
check('and "allow all" clears them', cleared === 0, `${cleared} barred`);

await p.evaluate(() => {
  const box = document.querySelector('.rules-box');
  [...box.querySelectorAll('.btn')].find((b) => b.textContent.trim() === 'Close').click();
});
await p.waitForTimeout(250);
check('and it closes', await p.evaluate(() => !document.querySelector('.rules-box')));

/* ================================================== 7. a save keeps the rules */

const saved = await p.evaluate(() => {
  hive.setGeneralBan('water', true);
  hive.setGeneralBan('fiber', true);
  hive.save();
  const key = Object.keys(localStorage).find((k) => /hive/i.test(k));
  const raw = JSON.parse(localStorage.getItem(key));
  const s = raw?.state ?? raw;
  return { version: s?.version, bans: s?.generalBans };
});
const SAVE_VERSION = await p.evaluate(() => hive.saveVersion);
check('the rules round-trip through a save',
  saved.bans?.water === true && saved.bans?.fiber === true, JSON.stringify(saved.bans));
check('at the current save version', saved.version === SAVE_VERSION, `v${saved.version}`);

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
