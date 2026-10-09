import { chromium } from 'playwright';
import { BASE, LAUNCH, shot } from './harness.mjs';

/**
 * Territory, biome weighting and forage rolls.
 *
 * The claims worth protecting here are statistical, so most of these run
 * thousands of rolls and check the resulting distribution rather than asserting
 * on a single outcome — a test that rolls once and checks what it got would
 * pass or fail at random, which is worse than no test.
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

parked = await p.evaluate(() => ({
  castes: hive.castesLive === 0,
  structures: hive.structuresLive === 0,
}));
if (parked.castes || parked.structures) {
  console.log(`NOTE    castes parked: ${parked.castes}, structures parked: ${parked.structures}`);
}

/* ==================================================== 1. the opening holding */

const start = await p.evaluate(() => ({
  territory: { ...hive.state.territory },
  total: hive.totalArea(),
}));
check('the Anthill lands on 36 m² of temperate forest',
  start.territory.temperateForest === 36 && start.total === 36,
  JSON.stringify(start.territory));

/* ======================================================= 2. the grant API */

const granted = await p.evaluate(() => {
  const a = hive.run.grantTerritory('denseUrban', 64);
  const b = hive.run.grantTerritory('denseUrban', 36); // accumulates
  const bad = hive.run.grantTerritory('notARealBiome', 100);
  const negative = hive.run.grantTerritory('coast', -5);
  const revoked = hive.run.revokeTerritory('denseUrban', 50);
  return {
    a, b, bad, negative, revoked,
    total: hive.totalArea(),
    held: { ...hive.state.territory },
  };
});
check('granting land adds it and accumulates',
  granted.a === 64 && granted.b === 100,
  `64 then 100 m² of dense urban`);
check('an unknown biome or a negative area is refused',
  granted.bad === 0 && granted.negative === 0 && granted.held.coast === undefined);
check('land can be given back', granted.revoked === 50 && granted.total === 86, `${granted.total} m² left`);

const sorted = await p.evaluate(() => {
  hive.run.grantTerritory('coast', 10);
  return hive.holdings().map((h) => ({ name: h.def.name, area: h.area }));
});
check('holdings come back sorted by size',
  sorted.every((h, i) => i === 0 || sorted[i - 1].area >= h.area),
  sorted.map((h) => `${h.name} ${h.area}`).join(' > '));

/* ============================================ 3. biome choice follows area */

const biomeSplit = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 75, denseUrban: 25 }; // deliberate 3:1
  const counts = {};
  for (let i = 0; i < 20_000; i += 1) {
    const slot = hive.forage.rollForage(s, 'forager');
    counts[slot.biomeId] = (counts[slot.biomeId] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { forest: counts.temperateForest / total, urban: counts.denseUrban / total };
});
check('biome is picked by share of area, nothing else',
  Math.abs(biomeSplit.forest - 0.75) < 0.02 && Math.abs(biomeSplit.urban - 0.25) < 0.02,
  `75/25 land gave ${(biomeSplit.forest * 100).toFixed(1)}% / ${(biomeSplit.urban * 100).toFixed(1)}%`);

const evenSplit = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 50, denseUrban: 50 };
  const counts = {};
  for (let i = 0; i < 20_000; i += 1) {
    const slot = hive.forage.rollForage(s, 'forager');
    counts[slot.biomeId] = (counts[slot.biomeId] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return counts.temperateForest / total;
});
check('half and half really is a coin flip', Math.abs(evenSplit - 0.5) < 0.02,
  `${(evenSplit * 100).toFixed(1)}% forest`);

/* an item that exists in only one of the two biomes shows up at the right rate */
const crossBiome = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 50, denseUrban: 50 };
  const counts = {};
  for (let i = 0; i < 30_000; i += 1) {
    const slot = hive.forage.rollForage(s, 'scavenger');
    if (slot.itemId) counts[slot.itemId] = (counts[slot.itemId] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  // Bread exists in dense urban and nowhere forested. Expected share is
  // 0.5 * (its weight / the dense urban scavenger pool).
  const pool = hive.poolFor('scavenger', 'denseUrban');
  const sum = pool.reduce((a, e) => a + e.weight, 0);
  const expected = 0.5 * (pool.find((e) => e.itemId === 'bread_white').weight / sum);
  return { got: (counts.bread_white || 0) / total, expected };
});
check('an item from one biome appears at that biome\'s share of the roll',
  Math.abs(crossBiome.got - crossBiome.expected) < 0.01,
  `bread ${(crossBiome.got * 100).toFixed(2)}% vs ${(crossBiome.expected * 100).toFixed(2)}% expected`);

/* ========================================= 4. items follow their own weights */

const withinBiome = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 100 };
  const counts = {};
  for (let i = 0; i < 30_000; i += 1) {
    const slot = hive.forage.rollForage(s, 'forager');
    if (slot.itemId) counts[slot.itemId] = (counts[slot.itemId] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const pool = hive.poolFor('forager', 'temperateForest');
  const sum = pool.reduce((a, e) => a + e.weight, 0);
  const worst = pool.reduce((w, e) => {
    const got = (counts[e.itemId] || 0) / total;
    return Math.max(w, Math.abs(got - e.weight / sum));
  }, 0);
  return {
    worst,
    distinct: Object.keys(counts).length,
    poolSize: pool.length,
    topShare: Math.max(...Object.values(counts)) / total,
  };
});
check('items are drawn in proportion to their weight in that biome',
  withinBiome.worst < 0.015,
  `worst deviation ${(withinBiome.worst * 100).toFixed(2)} points across ${withinBiome.poolSize} items`);
check('the whole pool gets used, not just the commonest',
  withinBiome.distinct === withinBiome.poolSize && withinBiome.topShare < 0.4,
  `${withinBiome.distinct} of ${withinBiome.poolSize} items seen, commonest ${(withinBiome.topShare * 100).toFixed(0)}%`);
check('not every item is equally likely',
  withinBiome.topShare > 1.5 / withinBiome.poolSize,
  `commonest is ${(withinBiome.topShare * withinBiome.poolSize).toFixed(1)}x a flat draw`);

/* ================================================ 5. castes respect their tag */

const tags = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 40, denseUrban: 30, coast: 30 };
  const out = {};
  for (const caste of ['forager', 'scavenger', 'excavator', 'siphon']) {
    const seen = new Set();
    for (let i = 0; i < 4000; i += 1) {
      const slot = hive.forage.rollForage(s, caste);
      if (slot.itemId) seen.add(slot.itemId);
    }
    out[caste] = {
      count: seen.size,
      allTagged: [...seen].every((id) => hive.forageTable[id].gather.includes(caste)),
      sample: [...seen].slice(0, 3),
    };
  }
  return out;
});
for (const [caste, r] of Object.entries(tags)) {
  check(`a ${caste} only ever finds ${caste}-tagged matter`,
    r.allTagged && r.count > 0, `${r.count} distinct, e.g. ${r.sample.join(', ')}`);
}

// A hunter's pool is prey AND huntable items — a deer is worth butchering into
// a dozen cuts, a lanternfish is just a lanternfish — and everything it can
// come back with has to actually live on the ground it rolled.
const hunting = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { coast: 100 };
  const prey = new Set();
  const items = new Set();
  for (let i = 0; i < 6000; i += 1) {
    const slot = hive.forage.rollForage(s, 'hunter');
    if (slot.organismId) prey.add(slot.organismId);
    if (slot.itemId) items.add(slot.itemId);
  }
  return {
    prey: [...prey],
    items: [...items],
    preyLivesThere: [...prey].every((o) => hive.organisms[o].biomes.coast > 0),
    itemsLiveThere: [...items].every((i) => (hive.forageTable[i].biomes.coast || 0) > 0),
    itemsAreHuntable: [...items].every((i) => hive.forageTable[i].gather.includes('hunter')),
  };
});
check('a hunter only ever takes what lives on the ground it rolled',
  hunting.preyLivesThere && hunting.itemsLiveThere && hunting.itemsAreHuntable &&
    hunting.prey.length > 2,
  `${hunting.prey.length} coastal species and ${hunting.items.length} huntable items`);

/* one roll becomes a whole carcass of separate cuts */
const carcass = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { grassland: 100 };
  s.tech.predation = true;
  s.structures.ambushBurrow = 20;
  s.drones = 10;
  for (const k of Object.keys(s.castes)) s.castes[k] = 0;
  s.castes.hunter = 10;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e5;
  // Whatever it rolls, every part of it must arrive at once — a whole carcass
  // if it caught an animal worth butchering, or exactly one item if it caught
  // something small enough to be itself.
  hive.forage.rollForage(s, 'hunter');
  const slot = s.forage.hunter;
  const flowing = Object.keys(hive.derived().itemFlow).length;
  const expected = slot.organismId
    ? Object.keys(hive.organisms[slot.organismId].parts).length
    : 1;
  const matches = flowing === expected;
  const rolled = { name: slot.organismId ? hive.organisms[slot.organismId].name : hive.items[slot.itemId].name };

  // Then pin a known multi-part animal, because a swarm butchers into exactly
  // one item and rolling one would make this check pass or fail at random.
  s.forage.hunter = { organismId: 'bison', biomeId: 'grassland', elapsed: 0 };
  const org = hive.organisms.bison;
  return {
    rolledPrey: rolled.name,
    matches,
    cuts: Object.keys(org.parts).length,
    flowing: Object.keys(hive.derived().itemFlow).length,
  };
});
checkOrPark('castes', 'every part of whatever was rolled arrives at once',
  carcass.matches, `rolled ${carcass.rolledPrey}`);
checkOrPark('castes', 'one hunted animal arrives as a carcass worth of cuts',
  carcass.flowing === carcass.cuts && carcass.cuts > 1,
  `bison -> ${carcass.cuts} separate items in one roll`);

/* ============================================ 6. the empty and absent cases */

const nothing = await p.evaluate(() => {
  const s = hive.state;
  s.territory = {};
  hive.forage.resetForage(s);
  // Roll every route by hand. Ticking would only re-roll the castes that are
  // on shift, and during the rebuild there are none — but the claim being made
  // here is about the roll itself, which still has to come back empty.
  const rolled = ['forager', 'scavenger', 'excavator', 'siphon', 'hunter']
    .map((c) => hive.forage.rollForage(s, c));
  return {
    anyBiome: rolled.some((r) => r.biomeId),
    anyFind: rolled.some((r) => r.itemId || r.organismId),
    harvest: hive.derived().harvestRate,
  };
});
check('a hive with no land finds nothing anywhere',
  !nothing.anyBiome && !nothing.anyFind && nothing.harvest === 0,
  `every route rolled, nothing found`);

// A desert has no standing fresh water, so a siphon there draws the only thing
// that is liquid: sap out of an agave.
const dryDesert = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { desert: 100 };
  const found = new Set();
  for (let i = 0; i < 500; i += 1) {
    const slot = hive.forage.rollForage(s, 'siphon');
    if (slot.itemId) found.add(slot.itemId);
  }
  return { found: [...found] };
});
check('a siphon in a desert finds no fresh water',
  !dryDesert.found.includes('fresh_water') && dryDesert.found.length > 0,
  `only ${dryDesert.found.join(', ')}`);

// Open water has nothing to dig. An empty roll is a real outcome and the
// interface has to say so rather than showing a blank.
const nothingToDig = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { openOcean: 100 };
  const slot = hive.forage.rollForage(s, 'excavator');
  const described = hive.forage.describeFind(s, 'excavator');
  return { biome: slot.biomeId, item: slot.itemId, label: described.label, empty: described.empty };
});
check('a caste with nothing to find there comes back empty, and is told so',
  nothingToDig.biome === 'openOcean' && nothingToDig.item === null && nothingToDig.empty &&
    /open ocean/i.test(nothingToDig.label),
  nothingToDig.label);

/* ===================================================== 7. the manual gather */

const clicks = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 50, denseUrban: 50 };
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  const biomes = {};
  const items = new Set();
  for (let i = 0; i < 4000; i += 1) {
    hive.consumeBiomass();
    const last = s.lastGather;
    biomes[last.biomeId] = (biomes[last.biomeId] || 0) + 1;
    if (last.itemId) items.add(last.itemId);
  }
  const total = Object.values(biomes).reduce((a, b) => a + b, 0);
  const routes = [...items].every((id) => {
    const g = hive.forageTable[id].gather;
    return g.includes('forager') || g.includes('scavenger');
  });
  return {
    forestShare: biomes.temperateForest / total,
    distinct: items.size,
    routes,
    gained: s.nutrients.carb + s.nutrients.protein + s.nutrients.fat,
  };
});
check('clicking gathers from the hive\'s own land, weighted by area',
  Math.abs(clicks.forestShare - 0.5) < 0.03,
  `${(clicks.forestShare * 100).toFixed(1)}% of clicks hit the forest half`);
check('clicking turns up many different things, all pickable by hand',
  clicks.distinct > 20 && clicks.routes,
  `${clicks.distinct} distinct items, all foraged or scavenged`);
check('clicking still feeds the hive', clicks.gained > 0, `${clicks.gained.toFixed(0)} g of macros`);

const odds = await p.evaluate(() => {
  const list = hive.manualOdds(50);
  const sum = list.reduce((a, o) => a + o.chance, 0);
  return { top: list[0], count: list.length, sum, ordered: list.every((o, i) => i === 0 || list[i - 1].chance >= o.chance) };
});
check('the click tooltip states real odds, highest first',
  odds.ordered && odds.sum > 0 && odds.sum <= 1.0001,
  `commonest is ${odds.top.name} at ${(odds.top.chance * 100).toFixed(1)}%`);

const landless = await p.evaluate(() => {
  hive.state.territory = {};
  const before = hive.state.stats.ingested;
  hive.consumeBiomass();
  return { gained: hive.state.stats.ingested - before, last: hive.state.lastGather };
});
check('clicking with no land finds nothing rather than erroring',
  landless.gained === 0 && landless.last.itemId === null);

/* ============================================= 8. rolls happen only in tick */

const purity = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 100 };
  s.drones = 5;
  for (const k of Object.keys(s.castes)) s.castes[k] = 0;
  s.castes.forager = 5;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e5;
  hive.forage.rollForage(s, 'forager');
  const picks = new Set();
  for (let i = 0; i < 200; i += 1) picks.add(JSON.stringify(hive.derived().itemFlow));
  return { stable: picks.size === 1, snapshot: s.forage.forager.itemId };
});
check('reading the interface never re-rolls — 200 reads, one answer',
  purity.stable, `held on ${purity.snapshot}`);

const cycling = await p.evaluate(() => {
  const s = hive.state;
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) {
    hive.tick(hive.forage.FORAGE_CYCLE);
    if (s.forage.forager.itemId) seen.add(s.forage.forager.itemId);
  }
  return seen.size;
});
checkOrPark('castes', 'ticking past the cycle length does re-roll', cycling > 3, `${cycling} different finds over 400 cycles`);

/* ================================================== 9. saving and migrating */

await p.evaluate(() => {
  hive.state.territory = { temperateForest: 36, coast: 12 };
  hive.save();
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
const reloaded = await p.evaluate(() => ({
  territory: { ...hive.state.territory },
  version: hive.state.version,
}));
check('territory survives a reload',
  reloaded.territory.temperateForest === 36 && reloaded.territory.coast === 12 && reloaded.version === SAVE_VERSION,
  `${JSON.stringify(reloaded.territory)}, save v${reloaded.version}`);

// On its own page, seeded with addInitScript. Reloading a running page fires
// beforeunload, which saves the live state over the doctored one before load()
// ever sees it — so a migration test that reloads in place tests nothing.
{
  const raw = await p.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('hiveidle.save.v2'));
    r.version = 4;
    delete r.territory;
    delete r.forage;
    return JSON.stringify(r);
  });
  const q = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await q.addInitScript((save) => localStorage.setItem('hiveidle.save.v2', save), raw);
  await q.goto(base, { waitUntil: 'networkidle' });
  await q.waitForSelector('.res-row');
  await ensureLanded(q);
  await q.waitForTimeout(600);
  const migrated = await q.evaluate(() => ({
    territory: { ...hive.state.territory },
    version: hive.state.version,
    find: hive.state.forage?.forager?.itemId ?? null,
  }));
  check('a save from before territory existed is granted the forest it was always on',
    migrated.territory.temperateForest === 36 &&
      Object.keys(migrated.territory).length === 1 &&
      migrated.version === SAVE_VERSION,
    `migrated to v${migrated.version} with ${JSON.stringify(migrated.territory)}`);
  await q.close();
}

/* ===================================================== 10. the Territory tab */

await p.evaluate(() => {
  hive.dev.addTerritory('denseUrban', 64);
  hive.dev.addTerritory('coast', 20);
  const s = hive.state;
  s.drones = 12;
  for (const k of Object.keys(s.castes)) s.castes[k] = 0;
  s.castes.forager = 6;
  s.castes.scavenger = 6;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e5;
});
await openTab(p, 'Territory');
await p.waitForSelector('.terr-tile');
await p.waitForTimeout(400);

const tab = await p.evaluate(() => {
  // The holdings are a treemap now, so "sorted by size" is a claim about the
  // tiles' AREAS, not about row order — and that is the claim worth testing,
  // because a treemap whose geometry drifts from the data is worse than a bar.
  const frame = document.querySelector('.terr-map').getBoundingClientRect();
  const tiles = [...document.querySelectorAll('.terr-tile')].map((t) => {
    const b = t.getBoundingClientRect();
    return { px: (b.width * b.height) / (frame.width * frame.height) };
  });
  const rows = [...document.querySelectorAll('.terr-key')].map((r) => ({
    name: r.querySelector('.terr-key-name').textContent.trim(),
    area: parseFloat(r.querySelector('.terr-key-num').textContent),
    share: parseFloat(r.querySelector('.terr-key-pct').textContent),
  }));
  return {
    rows,
    tiles,
    tileAreaSum: tiles.reduce((a, t) => a + t.px, 0),
    sorted: rows.every((r, i) => i === 0 || rows[i - 1].area >= r.area),
    shareSum: rows.reduce((a, r) => a + r.share, 0),
    // textContent, not innerText: the panel heads are uppercased in CSS and
    // innerText returns the transformed text, so "Out now" never matches.
    outNow: [...document.querySelectorAll('.panel-head')].some((h) => /Out now/i.test(h.textContent)),
    working: document.querySelectorAll('.panel-box .field-row .field-help').length,
    offers: document.querySelectorAll('.offer-chip').length,
  };
});
check('the tab lists territory sorted by size', tab.sorted && tab.rows.length === 3,
  tab.rows.map((r) => `${r.name.split('\n')[0]} ${r.area}`).join(' > '));
check('the treemap draws one tile per holding', tab.tiles.length === tab.rows.length,
  `${tab.tiles.length} tiles for ${tab.rows.length} holdings`);
check('the tiles fill the frame, so no area is unaccounted for',
  Math.abs(tab.tileAreaSum - 1) < 0.04, `${(tab.tileAreaSum * 100).toFixed(1)}% of the frame covered`);
check('shares add up to the whole', Math.abs(tab.shareSum - 100) <= 1, `${tab.shareSum}%`);
checkOrPark('castes', 'it shows what each caste is out on', tab.outNow && tab.working > 0,
  `${tab.working} caste rows`);
check('it shows what the ground offers', tab.offers > 10, `${tab.offers} entries listed`);

/* switching gather type changes what is listed */
await p.selectOption('.filter-row select', 'excavator');
await p.waitForTimeout(250);
const switched = await p.evaluate(() => {
  const names = [...document.querySelectorAll('.offer-chip')].map((c) => c.textContent.trim());
  return { names, allDiggable: names.every((n) => !/bread|mussel/i.test(n)) };
});
check('switching gather type changes the listing', switched.allDiggable && switched.names.length > 0,
  switched.names.slice(0, 4).map((n) => n.split('\n')[0]).join(', '));

/* ============================================= 11. the data itself holds up */

const coverage = await p.evaluate(() => {
  const fromPrey = new Set();
  for (const o of Object.values(hive.organisms)) for (const i of Object.keys(o.parts)) fromPrey.add(i);
  const ids = Object.keys(hive.items);
  const unclassified = ids.filter((id) => !hive.forageTable[id]);
  const unreachable = ids.filter((id) => {
    const e = hive.forageTable[id];
    if (!e) return true;
    // Any gather tag counts, 'hunter' included — small prey is rolled as an
    // item. An item with no biomes is reachable only off a carcass.
    const direct = e.gather.length > 0 && Object.keys(e.biomes).length > 0;
    return !direct && !fromPrey.has(id);
  });
  const uniform = new Set(ids.map((id) => JSON.stringify(hive.forageTable[id]?.biomes ?? {})));
  return { total: ids.length, unclassified, unreachable, distinctProfiles: uniform.size };
});
check('every item in the database is classified',
  coverage.unclassified.length === 0, `${coverage.total} items`);
check('every item can actually be obtained somehow',
  coverage.unreachable.length === 0, coverage.unreachable.slice(0, 5).join(', ') || 'no orphans');
check('the likelihoods are genuinely per-item, not one profile copied around',
  coverage.distinctProfiles > 100, `${coverage.distinctProfiles} distinct biome profiles`);

const biomeHealth = await p.evaluate(() => {
  // Nothing to dig in open water is deliberate; the seabed biomes are where a
  // hive mines the ocean.
  const ALLOWED = new Set(['openOcean:excavator', 'twilightZone:excavator', 'polarSea:excavator']);
  const bad = [];
  for (const b of hive.biomeIds) {
    for (const g of ['forager', 'scavenger', 'excavator', 'siphon']) {
      if (hive.poolFor(g, b).length === 0 && !ALLOWED.has(`${b}:${g}`)) bad.push(`${b}:${g}`);
    }
    // A hunter's pool is prey plus huntable items.
    if (!hive.preyFor(b).length && !hive.poolFor('hunter', b).length) bad.push(`${b}:hunter`);
  }
  return { count: hive.biomeIds.length, bad };
});
check('every biome supports every caste',
  biomeHealth.bad.length === 0,
  `${biomeHealth.count} biomes; the only gaps are excavating open water`);

await p.screenshot({ path: shot('territory-test.png') });

console.log(`\nconsole errors: ${errors.length ? errors.slice(0, 4).join(' | ') : 'none'}`);
console.log(fail.length ? `\n=== ${fail.length} CHECK(S) FAILED: ${fail.join('; ')} ===` : '\n=== territory, biomes and forage rolls verified ===');
await browser.close();
console.log('=== territory test finished ===');
