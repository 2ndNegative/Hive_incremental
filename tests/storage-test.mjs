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
 * Storage, digestion, parent-mass accounting and pinned tooltips.
 *
 * The thing this suite really exists to protect is mass conservation: an assay
 * must move mass out of the macro that was carrying it, not invent new mass,
 * and it must never push a store negative.
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

/**
 * The building and drone systems are parked for the rebuild. Checks that need a
 * live caste or a live structure report PARKED rather than FAIL, so a real
 * regression still stands out — and they switch themselves back on the moment
 * the new castes and structures land, because the flag is read from the game.
 */
let parked = { castes: true, structures: true };
const checkOrPark = (needs, label, ok, detail = '') => {
  if (parked[needs]) {
    console.log(`PARKED  ${label} — needs ${needs}, which the rebuild has parked`);
    return;
  }
  check(label, ok, detail);
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
await giveStorage(p, 50);

parked = await p.evaluate(() => ({
  castes: hive.castesLive === 0,
  structures: hive.structuresLive === 0,
  // Named individually: some buildings are live again while others are still
  // parked, so "structures" as a whole no longer answers the question.
  caecum: !hive.structureOrder.includes('caecum'),
  crop: !hive.structureOrder.includes('crop'),
}));
if (parked.castes || parked.structures) {
  console.log(`NOTE    castes parked: ${parked.castes}, structures parked: ${parked.structures}`);
}

/* ======================================================= 1. parent accounting */

// Done in one evaluate with the loop paused, because the live tick would
// otherwise digest and burn the stores out from under the measurement.
const assay = await p.evaluate(() => {
  const s = hive.state;
  s.castes.dormant = s.drones; // stop all harvesting
  for (const k of Object.keys(s.castes)) if (k !== 'dormant') s.castes[k] = 0;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.items = {};

  // 20 kg of limestone, which is pure mineral mass and therefore the clearest
  // possible case: everything in it comes out of the ash.
  hive.ingestItem('limestone', 20_000);

  const ashBefore = s.nutrients.ash;
  const minerals = Object.keys(hive.nutrients).filter(
    (n) => hive.nutrients[n].tier === 'micro' && hive.nutrients[n].revealedBy === 'bulkMineralAssay',
  );
  const heldHidden = minerals.reduce((a, n) => a + s.nutrients[n], 0);
  const shownBefore = [...document.querySelectorAll('.res-name')].map((e) => e.textContent.trim());

  s.insight = 1e6;
  s.tech.glycolysis = true;
  const ok = hive.research('bulkMineralAssay');

  const ashAfter = s.nutrients.ash;
  const heldNow = minerals.reduce((a, n) => a + s.nutrients[n], 0);

  return {
    ok,
    ashBefore,
    ashAfter,
    heldHidden,
    heldNow,
    shownBefore,
    negatives: Object.entries(s.nutrients).filter(([, v]) => v < -1e-9).map(([k]) => k),
    settleLogged: s.log.find((l) => /Separating it out draws/.test(l.text))?.text ?? '',
  };
});

check('minerals ride inside the ash while unresolved',
  assay.heldHidden > 0 && !assay.shownBefore.includes('Potassium'),
  `${assay.heldHidden.toFixed(0)} g held but not listed`);

check('the assay draws exactly that mass back out of the ash',
  Math.abs(assay.ashBefore - assay.ashAfter - assay.heldHidden) < 1e-6,
  `ash ${assay.ashBefore.toFixed(0)} g -> ${assay.ashAfter.toFixed(0)} g, for ${assay.heldHidden.toFixed(0)} g named`);

check('the named mass is kept, not destroyed',
  Math.abs(assay.heldNow - assay.heldHidden) < 1e-6,
  `${assay.heldNow.toFixed(0)} g still in store`);

check('the reveal says what it cost', /off the mineral mass/.test(assay.settleLogged),
  assay.settleLogged.slice(0, 80));

check('nothing is pushed negative', assay.negatives.length === 0, assay.negatives.join(', ') || 'all stores >= 0');

/* Intake after the assay routes the mass out of the parent on arrival. Mineral
   storage has to be opened up first, or the named grams simply hit their caps
   and spill — which is correct, and checked separately below. */
const after = await p.evaluate(() => {
  const s = hive.state;
  // Raise the caps directly rather than through a Mineral Vault: the buildings
  // are parked for the rebuild, and what this is testing is the mass
  // accounting, not what happens to be holding it.
  window.__caps = {};
  for (const n of Object.keys(hive.nutrients)) {
    if (hive.nutrients[n].tier === 'micro') {
      window.__caps[n] = hive.nutrients[n].baseCap;
      hive.nutrients[n].baseCap = 1e7;
    }
  }
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  const before = { ...s.nutrients };
  hive.ingestItem('limestone', 10_000);
  const named = Object.keys(hive.nutrients)
    .filter((n) => hive.nutrients[n].tier === 'micro')
    .reduce((a, n) => a + (s.nutrients[n] - before[n]), 0);
  for (const [n, cap] of Object.entries(window.__caps)) hive.nutrients[n].baseCap = cap;
  return { ashGain: s.nutrients.ash - before.ash, named, grams: 10_000 };
});
check('resolved intake splits the parent instead of duplicating it',
  Math.abs(after.ashGain + after.named - after.grams) < 1,
  `${after.ashGain.toFixed(0)} g ash + ${after.named.toFixed(0)} g named = ${(after.ashGain + after.named).toFixed(0)} g of 10 kg`);

/* The flip side, and the reason the Mineral Vault exists: with no room for the
   named minerals, the mass that used to sit safely in the ash now spills. This
   is deliberate — it is what the vault's description has always promised — so
   it is pinned down here rather than left to be discovered as a bug. */
const squeeze = await p.evaluate(() => {
  const s = hive.state;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  for (const k of Object.keys(s.spilled)) s.spilled[k] = 0;
  hive.ingestItem('limestone', 20_000);
  const micros = Object.keys(hive.nutrients).filter((n) => hive.nutrients[n].tier === 'micro');
  return {
    ash: s.nutrients.ash,
    kept: micros.reduce((a, n) => a + s.nutrients[n], 0),
    spilled: micros.reduce((a, n) => a + s.spilled[n], 0),
  };
});
check('without mineral storage the named mass spills instead of hiding in the ash',
  squeeze.spilled > 0 && squeeze.ash + squeeze.kept + squeeze.spilled > 19_990,
  `${squeeze.ash.toFixed(0)} g ash + ${squeeze.kept.toFixed(0)} g held + ${squeeze.spilled.toFixed(0)} g spilled of 20 kg`);

/* and the books balance over every item in the database */
const conservation = await p.evaluate(() => {
  const macros = Object.keys(hive.nutrients).filter((n) => hive.nutrients[n].tier === 'macro');
  const micros = Object.keys(hive.nutrients).filter((n) => hive.nutrients[n].tier === 'micro');
  const bare = { tech: {}, nutrients: {} };
  const full = { tech: Object.fromEntries(micros.map((n) => [hive.nutrients[n].revealedBy, true])), nutrients: {} };
  let worst = 0;
  let worstId = '';
  for (const [id, item] of Object.entries(hive.items)) {
    const b = hive.itemYield(bare, item.per100g, 1000);
    const f = hive.itemYield(full, item.per100g, 1000);
    const mb = macros.reduce((a, n) => a + (b[n] || 0), 0);
    const mf = macros.reduce((a, n) => a + (f[n] || 0), 0);
    const uf = micros.reduce((a, n) => a + (f[n] || 0), 0);
    const residue = Math.abs(mb - (mf + uf));
    if (residue > worst) { worst = residue; worstId = id; }
  }
  return { worst, worstId, count: Object.keys(hive.items).length };
});
check('no item gains or loses mass when its compounds are resolved',
  conservation.worst < 0.001,
  `${conservation.count} items, worst residue ${conservation.worst.toExponential(1)} g/kg (${conservation.worstId})`);

/* ============================================================= 2. the storage */

await openTab(p, 'Storage');
await p.waitForSelector('.panel-head:has-text("Digestion")');
check('a Storage tab exists and renders', true);

const gut = await p.evaluate(() => {
  const s = hive.state;
  hive.dev.emptyStorage();
  // One forager: harvest well under the base gut, so nothing should back up.
  // Fuel first — a hive with nothing to burn does no work and gathers nothing,
  // which would look like a broken gut rather than an empty tank.
  s.nutrients.carb = 1e6; s.nutrients.fat = 1e6; s.nutrients.water = 1e6;
  for (const k of Object.keys(s.castes)) s.castes[k] = 0;
  s.drones = 1; s.castes.forager = 1;
  const d = hive.derived();
  return { harvest: d.harvestRate, gut: d.digestion, ratio: d.digestRatio };
});
checkOrPark('castes', 'a new hive digests everything it can gather',
  gut.ratio > 0.999 && gut.harvest < gut.gut,
  `${gut.harvest.toFixed(0)} g/s gathered against a ${gut.gut.toFixed(0)} g/s gut`);

const backlog = await p.evaluate(() => {
  const s = hive.state;
  // Far more harvest than the base gut can take. The Nerve Nodes matter: tick()
  // enforces the drone cap, so 60 drones without the capacity to hold them get
  // clamped back to 3 and the hive never out-harvests its gut at all.
  s.structures.nodeCluster = 30;
  s.structures.caecum = 0;
  s.drones = 60;
  for (const k of Object.keys(s.castes)) s.castes[k] = 0;
  s.castes.forager = 60;
  s.nutrients.carb = 1e6; s.nutrients.fat = 1e6; s.nutrients.water = 1e6;
  const d = hive.derived();
  hive.tick(30);
  const d2 = hive.derived();
  return {
    harvest: d.harvestRate,
    gut: d.digestion,
    ratio: d.digestRatio,
    stored: Object.values(s.items).reduce((a, b) => a + b, 0),
    cap: d2.itemCap,
    spoiled: Object.values(s.spilledItems || {}).reduce((a, b) => a + b, 0),
  };
});
checkOrPark('castes', 'out-harvesting the gut backs matter up into storage',
  backlog.stored > 0 && backlog.ratio < 1,
  `${backlog.harvest.toFixed(0)} g/s gathered, ${backlog.gut.toFixed(0)} g/s gut, ${backlog.stored.toFixed(0)} g held`);
checkOrPark('castes', 'storage spoils at its cap rather than growing forever',
  backlog.stored <= backlog.cap * 25 + 1 && backlog.spoiled > 0,
  `cap ${backlog.cap.toFixed(0)} g each, ${backlog.spoiled.toFixed(0)} g spoiled`);

await p.waitForTimeout(250);
const shown = await p.evaluate(() => ({
  rows: document.querySelectorAll('.store-row').length,
  alert: Boolean(document.querySelector('.tab-bar .badge.is-alert')),
  warned: /gathering faster than it can digest/.test(document.querySelector('.main-col').innerText),
}));
checkOrPark('castes', 'the backlog is visible in the tab', shown.rows > 0, `${shown.rows} rows`);
checkOrPark('castes', 'the player is warned rather than left to guess', shown.warned);
checkOrPark('castes', 'the tab bar flags spoilage', shown.alert);

/* ---------------------------------------- the gut, and the larder it feeds from

   A hive is born with NO gut: whatever is gathered sits whole in the larder,
   fills it, and spoils. The Digestive Caecum is the gate out of that, and it
   costs no energy to run — charging watts for it would make the opening
   unwinnable, since a hive that cannot digest cannot fuel a generator.

   Built on drones rather than the parked castes, so it tests the hive as it
   actually plays. */
const gutless = await p.evaluate(() => {
  const s = hive.state;
  s.items = {};
  s.spilledItems = {};
  s.structures.caecum = 0;
  s.structures.crop = 0;
  s.droneTypes.forager = 20;
  hive.forage.resetForage(s);
  // Two ticks: the first rolls the trip, the second walks it home.
  hive.tick(1);
  hive.tick(1);
  const d = hive.derived();
  return {
    digestion: d.digestion,
    cap: d.itemCap,
    upkeep: hive.structureDefs.caecum.upkeepWatts || 0,
    harvest: d.harvestRate,
    held: Object.values(s.items).reduce((a, b) => a + b, 0),
  };
});
check('a hive with no gut digests nothing at all',
  gutless.digestion === 0, `${gutless.digestion} g/s`);
check('and the Digestive Caecum costs no energy to run',
  gutless.upkeep === 0, `${gutless.upkeep} W`);
check('matter gathered without a gut simply piles up',
  gutless.harvest > 0 && gutless.held > 0,
  `${gutless.harvest.toFixed(1)} g/s in, ${gutless.held.toFixed(1)} g held`);

const filled = await p.evaluate(() => {
  hive.tick(600); // long enough to fill anything
  const s = hive.state;
  const d = hive.derived();
  return {
    held: Object.values(s.items).reduce((a, b) => a + b, 0),
    cap: d.itemCap,
    spoiled: Object.values(s.spilledItems || {}).reduce((a, b) => a + b, 0),
    nutrients: Object.values(s.nutrients).reduce((a, b) => a + b, 0),
  };
});
check('the larder fills to its cap and no further',
  filled.held <= filled.cap + 1e-6 && filled.held > filled.cap * 0.99,
  `${filled.held.toFixed(1)} g of ${filled.cap.toFixed(0)} g`);
check('and everything past it spoils',
  filled.spoiled > 0, `${filled.spoiled.toFixed(0)} g spoiled`);

/* the digestion building is what fixes it */
const fixed = await p.evaluate(() => {
  const before = hive.derived();
  hive.state.structures.caecum = 1;
  const after = hive.derived();
  const nutrientsBefore = Object.values(hive.state.nutrients).reduce((a, b) => a + b, 0);
  hive.tick(5);
  return {
    before: before.digestion,
    after: after.digestion,
    rate: hive.derived().digestRate,
    gained:
      Object.values(hive.state.nutrients).reduce((a, b) => a + b, 0) - nutrientsBefore,
  };
});
check('one Digestive Caecum is 80 g/s of gut',
  fixed.before === 0 && fixed.after === 80, `${fixed.before} -> ${fixed.after} g/s`);
check('and the backlog starts turning into nutrients',
  fixed.rate > 0 && fixed.gained > 0,
  `${fixed.rate.toFixed(1)} g/s broken down, ${fixed.gained.toFixed(0)} g into the stores`);

/* the larder is ONE sac, not a shelf per item */
const held = await p.evaluate(() => {
  const before = hive.derived().itemCap;
  hive.state.structures.crop = 4;
  const after = hive.derived().itemCap;
  return { before, after, declared: hive.structureDefs.crop.itemStorage };
});
check('a Crop Chamber adds 2 kg of larder',
  held.declared === 2_000 && held.after === held.before + 4 * 2_000,
  `${held.before.toFixed(0)} g -> ${held.after.toFixed(0)} g with 4 built`);

const pooled = await p.evaluate(() => {
  const s = hive.state;
  s.structures.crop = 0;
  s.droneTypes.forager = 0; // nothing arriving, so the piles are only the ones set here
  s.items = {};
  const cap = hive.derived().itemCap;
  // Three piles that together are twice the sac. One sac means one overflow.
  s.items.hazelnut = cap;
  s.items.truffle = cap * 0.5;
  s.items.leaf_litter = cap * 0.5;
  s.structures.caecum = 0;
  hive.tick(1);
  return {
    cap,
    held: Object.values(s.items).reduce((a, b) => a + b, 0),
    piles: Object.values(s.items).filter((g) => g > 1e-9).length,
  };
});
check('three piles share one cap rather than each getting their own',
  Math.abs(pooled.held - pooled.cap) < 1e-6,
  `${pooled.held.toFixed(1)} g held against a ${pooled.cap.toFixed(0)} g larder`);
check('and the overflow is taken from every pile, not just the biggest',
  pooled.piles === 3, `${pooled.piles} piles still there`);

await p.evaluate(() => { hive.state.droneTypes.forager = 0; hive.state.items = {}; });

/* storage digests down while the hive is idle — the reason to stockpile */
const drain = await p.evaluate(() => {
  const s = hive.state;
  for (const k of Object.keys(s.castes)) s.castes[k] = 0;
  s.castes.dormant = s.drones;
  s.structures.caecum = 1;
  // Inside the larder, or most of it would spoil before the gut ever saw it.
  const stock = hive.derived().itemCap;
  s.items = { pasture_grass: stock };
  // Measured on ash, not carb: ash carries no energy so it is never burned,
  // which makes it the only store whose rise is unambiguously digestion.
  const ashBefore = s.nutrients.ash;
  hive.tick(120);
  return { stock, left: s.items.pasture_grass || 0, ashGain: s.nutrients.ash - ashBefore };
});
check('a stockpile keeps digesting with nobody harvesting',
  drain.left < drain.stock && drain.ashGain > 0,
  `${(drain.stock - drain.left).toFixed(0)} g processed, ${drain.ashGain.toFixed(1)} g of mineral mass recovered`);

/* ==================================================== 3. attribution and links */

const attribution = await p.evaluate(() => {
  const s = hive.state;
  s.tech.predation = true;
  s.structures.ambushBurrow = 12;
  s.drones = 12;
  for (const k of Object.keys(s.castes)) s.castes[k] = 0;
  s.castes.hunter = 12;
  const d = hive.derived();
  const beefLike = Object.keys(d.itemFlow).find((id) => (hive.items[id].per100g.protein || 0) > 15);
  return {
    item: beefLike,
    itemName: hive.items[beefLike]?.name,
    sources: (d.itemSources[beefLike] || []).map((x) => x.label),
    proteinSources: (d.flowSources.protein || []).filter((x) => x.itemId).map((x) => x.label),
  };
});
// A hunter rolls prey OR a huntable item, so the label is either "working
// <prey>" or just the caste and where it is — both must name the caste.
checkOrPark('castes', 'every item names the castes bringing it in',
  attribution.sources.length > 0 && /^Hunter ×12( working .+)? in /.test(attribution.sources[0]),
  `${attribution.itemName} <- ${attribution.sources[0]}`);
checkOrPark('castes', 'nutrient flows carry the item they came from',
  attribution.proteinSources.length > 0,
  `protein <- ${attribution.proteinSources.slice(0, 3).join(', ')}`);

/* the pinned tooltip: middle-click freezes it, and what is inside becomes hoverable */
await openTab(p, 'Hive');
await p.waitForSelector('.res-row');
const proteinRow = p.locator('.res-row', { hasText: 'Protein' }).first();
await proteinRow.hover();
await p.waitForTimeout(200);
const beforePin = await p.evaluate(() => hive.tips.pinned.value);
check('nothing is pinned by merely hovering', beforePin === null);

await proteinRow.click({ button: 'middle' });
await p.waitForTimeout(200);
const pinnedState = await p.evaluate(() => ({
  key: hive.tips.pinned.value,
  marked: Boolean(document.querySelector('.res-row.is-pinned')),
  interactive: (() => {
    const body = document.querySelector('.res-row.is-pinned > .tip-body');
    return body ? getComputedStyle(body).pointerEvents : null;
  })(),
  visible: (() => {
    const body = document.querySelector('.res-row.is-pinned > .tip-body');
    return body ? getComputedStyle(body).visibility : null;
  })(),
}));
check('middle-click pins the tooltip', pinnedState.key === 'nutrient:protein' && pinnedState.marked, pinnedState.key);
check('a pinned tooltip accepts the pointer, so its contents can be hovered',
  pinnedState.interactive === 'auto', `pointer-events: ${pinnedState.interactive}`);

/* move the mouse right off the row — a pinned tooltip must stay */
await p.mouse.move(20, 20);
await p.waitForTimeout(250);
const stayed = await p.evaluate(() => {
  const body = document.querySelector('.res-row.is-pinned > .tip-body');
  return body ? getComputedStyle(body).visibility : 'gone';
});
check('it stays open with the pointer elsewhere', stayed === 'visible', stayed);

/* the nested tooltip inside it */
const nested = await p.evaluate(() => {
  const inner = document.querySelector('.res-row.is-pinned .tip-body .tip > .tip-body');
  if (!inner) return { found: false };
  const z = Number(getComputedStyle(inner).zIndex);
  const outer = Number(getComputedStyle(document.querySelector('.res-row.is-pinned > .tip-body')).zIndex);
  return { found: true, z, outer, clears: z > outer };
});
checkOrPark('castes', 'sources inside a pinned tooltip have tooltips of their own',
  nested.found && nested.clears, nested.found ? `nested z-index ${nested.z} over ${nested.outer}` : 'none found');

if (!parked.castes) {
const innerTip = p.locator('.res-row.is-pinned .tip-body .tip').first();
await innerTip.hover();
await p.waitForTimeout(250);
const innerText = await p.evaluate(() => {
  const body = document.querySelector('.res-row.is-pinned .tip-body .tip > .tip-body');
  return { visible: getComputedStyle(body).visibility, text: body.innerText.replace(/\s+/g, ' ') };
});
check('hovering a source inside the pinned tooltip opens it',
  innerText.visible === 'visible', innerText.visible);
check('and it answers where the item came from',
  /×\d+/.test(innerText.text) || /storage/.test(innerText.text), innerText.text.slice(0, 90));
} else {
  console.log('PARKED  nested source tooltips — need a caste bringing something in');
}

await p.screenshot({ path: shot('pinned-tip.png') });

/* escape releases it */
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
check('Escape releases the pin', (await p.evaluate(() => hive.tips.pinned.value)) === null);

/* ---- codex links out of the drone descriptions.
       There are no caste rows at all while the drones are parked, so this
       whole block waits forever rather than failing. Guard it. */
if (!parked.castes) {
  await openTab(p, 'Drones');
  await p.waitForSelector('.job-row');
  const links = await p.evaluate(() => document.querySelectorAll('.job-row .codex-link').length);
  check('drone yields link into the codex', links > 0, `${links} links`);

  await p.click('.job-row .codex-link');
  await p.waitForTimeout(250);
  const landed = await p.evaluate(() => ({
    tab: hive.state.ui.tab,
    item: hive.state.ui.selectedItem,
    detail: Boolean(document.querySelector('.codex-detail')),
    search: hive.state.ui.codexSearch,
  }));
  check('following one opens that entry in the codex',
    landed.tab === 'codex' && landed.item && landed.detail && landed.search === '',
    `${landed.item} shown, filters cleared`);
} else {
  console.log('PARKED  codex links out of drone yields — no castes to describe');
}

// Storage still has rows: matter can be put there directly even with nobody
// gathering, so this half of the claim is still live.
await p.evaluate(() => { hive.state.items = { pasture_grass: 500, carrion: 300 }; });
await openTab(p, 'Storage');
await p.waitForTimeout(200);
const storeLinks = await p.evaluate(() => document.querySelectorAll('.store-row .codex-link').length);
check('stored matter links into the codex too', storeLinks > 0, `${storeLinks} links`);
await p.screenshot({ path: shot('storage.png') });

/* ================================================= 4. saving the new state */

const persisted = await p.evaluate(() => {
  hive.state.items = { pasture_grass: 1234, carrion: 567 };
  hive.state.spilledItems = { carrion: 89 };
  hive.save();
  return hive.saveStatus.ok;
});
check('the save accepts the item store', persisted === true);

await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
await giveStorage(p, 50);
const restored = await p.evaluate(() => ({
  grass: hive.state.items?.pasture_grass ?? 0,
  spoiled: hive.state.spilledItems?.carrion ?? 0,
  version: hive.state.version,
}));
check('storage survives a reload',
  restored.grass > 0 && restored.spoiled > 0 && restored.version === SAVE_VERSION,
  `${restored.grass.toFixed(0)} g grass kept, save v${restored.version}`);

/* A pre-storage save must still load and run. Seeded on its own page: a
   reload fires beforeunload, which saves the live state over the doctored one
   before load() can ever see it. */
{
  const raw = await p.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('hiveidle.save.v2'));
    r.version = 3;
    delete r.items;
    delete r.spilledItems;
    return JSON.stringify(r);
  });
  const q = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await q.addInitScript((save) => localStorage.setItem('hiveidle.save.v2', save), raw);
  await q.goto(base, { waitUntil: 'networkidle' });
  await q.waitForSelector('.res-row');
  await ensureLanded(q);
  await giveStorage(q, 50);
  const old = await q.evaluate(() => ({
    items: hive.state.items,
    version: hive.state.version,
    before: hive.state.playtime,
  }));
  await q.waitForTimeout(700);
  const ticking = await q.evaluate(() => hive.state.playtime);
  check('a save from before storage existed still loads and runs',
    old.items && Object.keys(old.items).length === 0 && old.version === SAVE_VERSION && ticking > old.before,
    `migrated to v${old.version} with an empty larder, still ticking`);
  await q.close();
}

console.log(`\nconsole errors: ${errors.length ? errors.slice(0, 4).join(' | ') : 'none'}`);
console.log(fail.length ? `\n=== ${fail.length} CHECK(S) FAILED: ${fail.join('; ')} ===` : '\n=== storage, digestion, mass and tooltips verified ===');
await browser.close();
console.log('=== storage test finished ===');
