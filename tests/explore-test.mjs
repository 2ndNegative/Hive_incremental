import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * Expeditions, and the ground they come back with.
 *
 * The Explorer is the only drone that can fail to return, and the only way the
 * hive gets bigger. Everything here is about the five-branch outcome table, the
 * adjacency that decides WHERE found ground is, and the fact that mapping
 * ground and standing on it are two different things with two different prices.
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

/* ===================================================== 1. what one costs */

const decl = await p.evaluate(() => {
  const def = hive.drones.types.explorer;
  return {
    cost: def.cost,
    payable: hive.payableCost(def.cost),
    cogits: def.cogitDraw,
    seconds: def.expedition.seconds,
    caste: def.caste,
    gathers: Boolean(def.gather),
  };
});
// 250 g of water, not the 200 it was authored with: costs are written as rungs
// of the shared ladder now (definitions/costs.js) and 200 is not one. Fat and
// manganese landed on `medium` and `minuscule` exactly; the water rounded up a
// quarter rather than halving to `modest`.
check('an Explorer costs 250 g fat, 5 g manganese and 250 g water',
  decl.cost.fat === 250 && decl.cost.manganese === 5 && decl.cost.water === 250,
  JSON.stringify(decl.cost));
check('and the manganese is unassayed, so it pays 250 g of mineral mass instead',
  decl.payable.ash === 250 && decl.payable.manganese === undefined,
  JSON.stringify(decl.payable));
check('it is a Worker, it occupies a cogit, and it does not forage',
  decl.caste === 'worker' && decl.cogits === 1 && !decl.gathers,
  `${decl.caste}, ${decl.cogits} Cg`);

/* ============================================= 2. a trip gets longer as you grow */

const timing = await p.evaluate(() => {
  const s = hive.state;
  const at = (m2) => {
    s.territory = { temperateForest: m2 };
    return hive.expedition.seconds('explorer');
  };
  const out = { a36: at(36), a72: at(72), a360: at(360), a9: at(9) };
  s.territory = { temperateForest: 36 };
  return out;
});
check('ninety seconds on the ground the hive lands with', timing.a36 === 90, `${timing.a36}s`);
check('twice the ground is twice the trip',
  timing.a72 === 180 && timing.a360 === 900, `${timing.a72}s at 72 m², ${timing.a360}s at 360 m²`);
check('and a small hive gets no discount', timing.a9 === 90, `${timing.a9}s at 9 m²`);

/* ============================================== 3. the outcome table, by weight */

const table = await p.evaluate(() => hive.expedition.outcomes);
check('the table is the one on the tin',
  table.map((o) => `${o.id}:${o.weight}`).join(' ') ===
    'nothing:25 lost:5 cache:30 ground:25 hostile:15',
  table.map((o) => `${o.id} ${o.weight}%`).join(', '));
check('and sums to a hundred',
  table.reduce((a, o) => a + o.weight, 0) === 100);

const rolled = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 36 };
  const counts = {};
  for (let i = 0; i < 4000; i += 1) {
    // Topped back up each time: the `lost` branch eats explorers, and a pool
    // that runs out stops rolling.
    s.droneTypes.explorer = 50;
    s.unclaimed = {};
    s.items = {};
    const r = hive.expedition.resolve('explorer');
    counts[r.outcome] = (counts[r.outcome] || 0) + 1;
  }
  s.unclaimed = {};
  return counts;
});
const share = (id) => ((rolled[id] || 0) / 4000) * 100;
check('a quarter of expeditions find nothing',
  Math.abs(share('nothing') - 25) < 3, `${share('nothing').toFixed(1)}%`);
check('one in twenty does not come back',
  Math.abs(share('lost') - 5) < 2, `${share('lost').toFixed(1)}%`);
check('three in ten bring back a cache',
  Math.abs(share('cache') - 30) < 3, `${share('cache').toFixed(1)}%`);
check('a quarter find ground',
  Math.abs(share('ground') - 25) < 3, `${share('ground').toFixed(1)}%`);
check('and fifteen per cent find ground with a problem attached',
  Math.abs(share('hostile') - 15) < 3, `${share('hostile').toFixed(1)}%`);

/* ================================================== 4. what each branch does */

const lost = await p.evaluate(() => {
  const s = hive.state;
  s.droneTypes.explorer = 10;
  const before = s.droneTypes.explorer;
  let gone = 0;
  for (let i = 0; i < 200 && s.droneTypes.explorer > 0; i += 1) {
    const r = hive.expedition.resolve('explorer');
    if (r.outcome === 'lost') gone += 1;
  }
  return { before, after: s.droneTypes.explorer, gone, stat: hive.state.stats.explorersLost };
});
check('a lost explorer is actually gone from the count',
  lost.after === lost.before - lost.gone && lost.gone > 0,
  `${lost.before} → ${lost.after}, ${lost.gone} lost`);
check('and the run remembers how many', lost.stat >= lost.gone, `${lost.stat} this run`);

const cache = await p.evaluate(() => {
  const s = hive.state;
  s.droneTypes.explorer = 50;
  s.items = {};
  const sizes = [];
  for (let i = 0; i < 400; i += 1) {
    const r = hive.expedition.resolve('explorer');
    if (r.outcome === 'cache') sizes.push(r.grams);
  }
  return {
    sizes: { min: Math.min(...sizes), max: Math.max(...sizes), n: sizes.length },
    held: Object.values(s.items).reduce((a, b) => a + b, 0),
    bounds: hive.expedition.cacheGrams,
  };
});
check('a cache is 100 to 200 g',
  cache.sizes.min >= 100 - 1e-9 && cache.sizes.max <= 200 + 1e-9,
  `${cache.sizes.min.toFixed(0)}–${cache.sizes.max.toFixed(0)} g over ${cache.sizes.n}`);
check('and it lands in the larder',
  cache.held > 0, `${cache.held.toFixed(0)} g held`);

const ground = await p.evaluate(() => {
  const s = hive.state;
  s.unclaimed = {};
  s.territory = { temperateForest: 36 };
  s.droneTypes.explorer = 50;
  const areas = [];
  const found = {};
  for (let i = 0; i < 600; i += 1) {
    const r = hive.expedition.resolve('explorer');
    if (r.outcome === 'ground' || r.outcome === 'hostile') {
      areas.push(r.area);
      found[r.biomeId] = (found[r.biomeId] || 0) + 1;
    }
  }
  return {
    min: Math.min(...areas),
    max: Math.max(...areas),
    bounds: hive.expedition.patchArea,
    biomes: Object.keys(found),
    neighbours: Object.keys(hive.adjacency.temperateForest),
    unclaimed: { ...s.unclaimed },
    held: s.territory.temperateForest,
  };
});
check('a found patch is 0.2 to 8 m²',
  ground.min >= 0.2 - 1e-9 && ground.max <= 8 + 1e-9,
  `${ground.min.toFixed(2)}–${ground.max.toFixed(2)} m²`);
check('and every patch is somewhere a forest could actually border',
  ground.biomes.every((id) => ground.neighbours.includes(id)),
  ground.biomes.join(', '));
check('found ground is UNCLAIMED, not held',
  Object.keys(ground.unclaimed).length > 0 && ground.held === 36,
  `${Object.keys(ground.unclaimed).length} patches mapped, still holding ${ground.held} m²`);

/* ========================================== 5. the hostile branch finds trouble */

const hostile = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 36 };
  s.droneTypes.explorer = 50;
  let awkward = 0;
  let plain = 0;
  let total = 0;
  for (let i = 0; i < 800; i += 1) {
    s.unclaimed = {};
    const r = hive.expedition.resolve('explorer');
    if (r.outcome !== 'hostile') continue;
    total += 1;
    if (r.dangerous || !r.colonisable) awkward += 1;
    else plain += 1;
  }
  s.unclaimed = {};
  return { awkward, plain, total };
});
check('the hostile branch usually finds people or water, not a meadow',
  hostile.awkward > hostile.plain,
  `${hostile.awkward} awkward vs ${hostile.plain} ordinary of ${hostile.total}`);

const realms = await p.evaluate(() => ({
  marine: hive.realmOf('kelpForest'),
  fresh: hive.realmOf('riverine'),
  land: hive.realmOf('wetland'),
  canTakeSea: hive.isColonisable('kelpForest'),
  canTakeField: hive.isColonisable('grassland'),
  urbanIsDangerous: hive.isDangerous('denseUrban'),
  forestIsNot: hive.isDangerous('temperateForest'),
}));
check('a land hive cannot colonise the sea',
  realms.marine === 'marine' && !realms.canTakeSea, `${realms.marine}, takeable ${realms.canTakeSea}`);
check('but it can take any ground of its own kind', realms.canTakeField);
check('wetland counts as land — it is walkable', realms.land === 'land');
check('human ground is the dangerous kind',
  realms.urbanIsDangerous && !realms.forestIsNot);

/* ================================================= 6. claiming what was found */

const claim = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 36 };
  s.unclaimed = { grassland: 5 };
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.structures.hivecore = 1;
  s.structures.vacuole = 200;
  const unit = hive.claimCost('grassland', 1);
  const broke = hive.claim('grassland', 2);
  // Now pay for it.
  s.nutrients.water = 100_000;
  s.nutrients.protein = 10_000;
  s.nutrients.fiber = 10_000;
  s.nutrients.ash = 10_000;
  const took = hive.claim('grassland', 2);
  return {
    unit,
    perMetre: hive.claimPerSquareMetre,
    broke,
    took,
    held: s.territory.grassland || 0,
    left: s.unclaimed.grassland || 0,
    waterLeft: s.nutrients.water,
  };
});
check('a square metre costs water, protein, fibre and iron',
  claim.perMetre.water === 400 && claim.perMetre.protein === 60 &&
  claim.perMetre.fiber === 120 && claim.perMetre.iron === 1,
  JSON.stringify(claim.perMetre));
check('with the iron charged as mineral mass until it is assayed',
  claim.unit.ash === 50 && claim.unit.iron === undefined, JSON.stringify(claim.unit));
check('a hive that cannot pay claims nothing', claim.broke === 0, `${claim.broke} m²`);
check('and one that can takes exactly what it paid for',
  claim.took === 2 && claim.held === 2 && Math.abs(claim.left - 3) < 1e-9,
  `${claim.took} m² taken, ${claim.left.toFixed(1)} m² still mapped`);
check('the bill actually leaves the stores',
  Math.abs(claim.waterLeft - (100_000 - 800)) < 1e-6, `${claim.waterLeft.toFixed(0)} g of water left`);

const refuse = await p.evaluate(() => {
  const s = hive.state;
  s.unclaimed = { kelpForest: 4, denseUrban: 4 };
  s.nutrients.water = 1e6; s.nutrients.protein = 1e5; s.nutrients.fiber = 1e5; s.nutrients.ash = 1e5;
  const sea = hive.claim('kelpForest', 4);
  const urbanUnit = hive.claimCost('denseUrban', 1);
  const plainUnit = hive.claimCost('grassland', 1);
  const urban = hive.claim('denseUrban', 1);
  return {
    sea,
    urban,
    stillSea: s.unclaimed.kelpForest,
    urbanCost: urbanUnit.water,
    plainCost: plainUnit.water,
    multiplier: hive.dangerousClaimMultiplier,
  };
});
check('ground the hive cannot live in cannot be claimed at any price',
  refuse.sea === 0 && refuse.stillSea === 4, `${refuse.sea} m² taken`);
check('ground people are on can be, at a premium',
  refuse.urban === 1 && Math.abs(refuse.urbanCost / refuse.plainCost - refuse.multiplier) < 1e-9,
  `×${(refuse.urbanCost / refuse.plainCost).toFixed(1)}`);

/* ================================================= 7. the whole loop, ticking */

const live = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 36 };
  s.unclaimed = {};
  s.droneTypes.explorer = 6;
  s.structures.nodeCluster = 10;
  s.expedition = {};
  s.energyPool = 1e9;
  const before = { ...s.unclaimed };
  hive.tick(900, 1); // fifteen minutes: six explorers on a ninety-second trip
  return {
    before,
    mapped: Object.entries(s.unclaimed).map(([id, a]) => `${id} ${a.toFixed(1)}`),
    total: Object.values(s.unclaimed).reduce((a, b) => a + b, 0),
    left: s.droneTypes.explorer,
    stats: {
      found: s.stats.groundFound,
      caches: s.stats.cachesFound,
      lost: s.stats.explorersLost,
    },
  };
});
check('a hive with explorers out maps ground as it ticks',
  live.total > 0, `${live.total.toFixed(1)} m² across ${live.mapped.length} kinds`);
check('and loses one now and then', live.left < 6, `${live.left} of 6 came home`);
check('the run keeps the tally',
  live.stats.found > 0 && live.stats.caches > 0,
  `${live.stats.found.toFixed(1)} m² found, ${live.stats.caches} caches, ${live.stats.lost} lost`);

/* ==================================================== 8. the map shows it */

await p.evaluate(() => {
  const s = hive.state;
  s.unclaimed = { grassland: 4, kelpForest: 3, lightUrban: 2 };
  s.nutrients.water = 1e6; s.nutrients.protein = 1e5; s.nutrients.fiber = 1e5; s.nutrients.ash = 1e5;
});
await openTab(p, 'Territory');
await p.waitForTimeout(300);
const map = await p.evaluate(() => {
  const tiles = [...document.querySelectorAll('.terr-tile')];
  return {
    total: tiles.length,
    unclaimed: tiles.filter((t) => t.classList.contains('is-unclaimed')).length,
    blocked: tiles.filter((t) => t.classList.contains('is-blocked')).length,
    dangerous: tiles.filter((t) => t.classList.contains('is-dangerous')).length,
    note: document.querySelector('.main-col').innerText.includes('mapped'),
  };
});
check('the unclaimed ground is on the treemap, marked',
  map.unclaimed === 3 && map.total === 4, `${map.unclaimed} unclaimed of ${map.total} tiles`);
check('the sea is marked as something it cannot have', map.blocked === 1, `${map.blocked} blocked`);
check('and the road as something people are on', map.dangerous === 1, `${map.dangerous} dangerous`);

/* A shade would read as "a smaller patch of the same thing" on a treemap, so
   the mark has to be a texture. The hazard here is the tile's inline colour:
   the `background` shorthand resets `background-image`, and inline wins over
   the stylesheet, so a single careless property quietly un-stripes the lot. */
const hatch = await p.evaluate(() => {
  const read = (el) => {
    const s = getComputedStyle(el);
    return { image: s.backgroundImage, colour: s.backgroundColor };
  };
  const tiles = [...document.querySelectorAll('.terr-tile')];
  const claimed = tiles.find((t) => !t.classList.contains('is-unclaimed'));
  const out = {};
  for (const kind of ['is-unclaimed', 'is-dangerous', 'is-blocked']) {
    const el = tiles.find((t) => t.classList.contains(kind));
    out[kind] = el ? read(el) : null;
  }
  out.claimed = claimed ? read(claimed) : null;
  return out;
});
check('unclaimed ground is striped, not merely outlined',
  /repeating-linear-gradient/.test(hatch['is-unclaimed']?.image ?? ''),
  (hatch['is-unclaimed']?.image ?? '').slice(0, 60));
check('ground people are on is striped too', /repeating-linear-gradient/.test(hatch['is-dangerous']?.image ?? ''));
check('and ground it can never have', /repeating-linear-gradient/.test(hatch['is-blocked']?.image ?? ''));
check('the stripes carry which kind it is',
  hatch['is-dangerous'].image !== hatch['is-blocked'].image);
check('the biome colour survives underneath the stripes',
  /^rgba?\(/.test(hatch['is-unclaimed']?.colour ?? '') &&
    hatch['is-unclaimed'].colour !== 'rgba(0, 0, 0, 0)',
  hatch['is-unclaimed']?.colour);
check('while ground the hive holds stays flat',
  hatch.claimed?.image === 'none', hatch.claimed?.image);

await p.evaluate(() => {
  const tile = [...document.querySelectorAll('.terr-tile.is-unclaimed')]
    .find((t) => !t.classList.contains('is-blocked') && !t.classList.contains('is-dangerous'));
  tile.click();
});
await p.waitForTimeout(300);
const dialog = await p.evaluate(() => {
  const box = document.querySelector('.claim-box');
  return {
    open: Boolean(box),
    text: box?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    hasInput: Boolean(box?.querySelector('.claim-input')),
  };
});
check('clicking one opens the claim dialog', dialog.open && dialog.hasInput, dialog.text.slice(0, 60));
check('which says what a claim costs',
  /Water/.test(dialog.text) && /Protein/.test(dialog.text) && /Fibre/.test(dialog.text) &&
  /Mineral mass/.test(dialog.text),
  dialog.text.slice(0, 180));

const claimed = await p.evaluate(async () => {
  const before = hive.state.territory.grassland || 0;
  const btn = [...document.querySelectorAll('.claim-box .btn')].find((b) => /^Claim/.test(b.textContent.trim()));
  btn.click();
  return { before, label: btn.textContent.trim() };
});
await p.waitForTimeout(300);
const after = await p.evaluate(() => ({
  held: hive.state.territory.grassland || 0,
  mapped: hive.state.unclaimed.grassland || 0,
  closed: !document.querySelector('.claim-box'),
}));
check('and the button on it takes the ground',
  after.held > claimed.before && after.mapped < 4 && after.closed,
  `${claimed.label} → holding ${after.held.toFixed(1)} m²`);

/* ========================== 9. the walk out, simulated rather than reasoned

   The graph says every biome is reachable from every other. This walks it: a
   hive that claims whatever it finds, over and over, should spread out of its
   starting forest and into ground several steps away — and should never end up
   holding something it is not allowed to live in. */

const walk = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 36 };
  s.unclaimed = {};
  s.droneTypes.explorer = 1;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;

  const held = new Set(['temperateForest']);
  let illegal = null;
  for (let i = 0; i < 4000; i += 1) {
    const r = hive.expedition.resolve('explorer');
    s.droneTypes.explorer = 1; // the lost branch would end the walk early
    if (r.outcome !== 'ground' && r.outcome !== 'hostile') continue;
    // Claim it outright: this is about where the hive CAN get to, not what it
    // can afford, so the bill is waived rather than simulated.
    if (!hive.isColonisable(r.biomeId)) continue;
    s.territory[r.biomeId] = (s.territory[r.biomeId] || 0) + r.area;
    delete s.unclaimed[r.biomeId];
    held.add(r.biomeId);
    if (hive.realmOf(r.biomeId) !== 'land') illegal = r.biomeId;
  }
  const land = hive.biomeIds.filter((id) => hive.realmOf(id) === 'land');
  return {
    held: [...held].sort(),
    land: land.length,
    illegal,
    missed: land.filter((id) => !held.has(id)),
  };
});
check('a hive that keeps claiming spreads across the whole land realm',
  walk.missed.length === 0,
  `${walk.held.length} of ${walk.land} land biomes — missing ${walk.missed.join(', ') || 'none'}`);
check('and never ends up standing in water',
  walk.illegal === null, walk.illegal ?? 'none');
check('including ground several steps from where it started',
  walk.held.includes('denseUrban') || walk.held.includes('tundra') || walk.held.includes('desert'),
  walk.held.join(', '));

/* ============================ 10. fractional ground stays fractional on screen

   The bug: holdings used to be whole numbers, so every area printed with no
   decimals. Expeditions find 3.2 m² patches, so a claim makes a hive 39.2 m² —
   and the screen said 39, which reads exactly like territory being eaten. */

const decimals = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 36 };
  s.unclaimed = { temperateForest: 3.2 };
  s.nutrients.water = 1e6; s.nutrients.protein = 1e5; s.nutrients.fiber = 1e5; s.nutrients.ash = 1e5;
  s.structures.vacuole = 300;
  const took = hive.claim('temperateForest', 3.2);
  return { took, stored: s.territory.temperateForest, total: hive.totalArea() };
});
check('a fractional claim is stored exactly',
  decimals.took === 3.2 && Math.abs(decimals.stored - 39.2) < 1e-9,
  `${decimals.stored} m² held`);

await p.waitForTimeout(300);
const onScreen = await p.evaluate(() => {
  const head = [...document.querySelectorAll('.panel-head')]
    .find((h) => /holdings/i.test(h.innerText));
  const tile = [...document.querySelectorAll('.terr-tile')]
    .find((t) => /Temperate forest/.test(t.innerText));
  const legend = [...document.querySelectorAll('.terr-key')]
    .find((k) => /Temperate forest/.test(k.innerText));
  return {
    head: head?.innerText.replace(/\s+/g, ' ').trim(),
    tile: tile?.querySelector('.terr-tile-figure')?.innerText.trim(),
    legend: legend?.innerText.replace(/\s+/g, ' ').trim(),
  };
});
check('and the header keeps the decimal', /39\.2 m²/i.test(onScreen.head || ''), onScreen.head);
check('so does the tile', /39\.2 m²/.test(onScreen.tile || ''), onScreen.tile);
check('and the legend', /39\.2 m²/.test(onScreen.legend || ''), onScreen.legend);

const whole = await p.evaluate(() => {
  hive.state.territory = { temperateForest: 36 };
  hive.state.unclaimed = {};
  return hive.formatArea ? null : null;
});
await p.waitForTimeout(300);
const wholeShown = await p.evaluate(() =>
  [...document.querySelectorAll('.panel-head')].find((h) => /holdings/i.test(h.innerText))
    ?.innerText.replace(/\s+/g, ' ').trim(),
);
check('a whole number still prints whole, with no trailing .0',
  /36 m²/i.test(wholeShown || '') && !/36\.0/.test(wholeShown || ''), wholeShown);

/* ================ 11. hovering a patch says what it is and how big it is

   The slivers are the tiles with no room for a label, so the tooltip is the
   only place their type and size appear — and they are also the tiles nearest
   the right-hand edge, where a tooltip that always opens leftwards runs off the
   window. Both halves of that have to hold. */

await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 36, taiga: 7 };
  s.unclaimed = { temperateForest: 3.2, kelpForest: 0.8 };
});
await p.waitForTimeout(300);

const hovered = [];
for (const tile of await p.$$('.terr-tile')) {
  await tile.hover();
  await p.waitForTimeout(140);
  hovered.push(
    await p.evaluate((el) => {
      const body = el.querySelector('.tip-body');
      const r = body.getBoundingClientRect();
      // `visibility` and the bounding rect both report a tooltip that an
      // ancestor's overflow has cut away to nothing — the box is laid out, it
      // is simply not painted. So walk the ancestors and intersect every clip
      // against it: what survives is what a player can actually read.
      let box = { l: r.left, t: r.top, rt: r.right, b: r.bottom };
      for (let up = body.parentElement; up; up = up.parentElement) {
        const cs = getComputedStyle(up);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const c = up.getBoundingClientRect();
        box = {
          l: Math.max(box.l, c.left),
          t: Math.max(box.t, c.top),
          rt: Math.min(box.rt, c.right),
          b: Math.min(box.b, c.bottom),
        };
      }
      const shown = Math.max(0, box.rt - box.l) * Math.max(0, box.b - box.t);
      const whole = r.width * r.height;
      return {
        title: body.querySelector('.tip-title')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
        visible: getComputedStyle(body).visibility !== 'hidden',
        unclipped: whole > 0 && shown / whole > 0.99,
        offscreen:
          r.right > window.innerWidth + 1 || r.left < -1 ||
          r.bottom > window.innerHeight + 1 || r.top < -1,
      };
    }, tile),
  );
}

check('every tile has a tooltip that actually shows',
  hovered.length === 4 && hovered.every((h) => h.visible), `${hovered.length} tiles`);
check('and no ancestor clips it away',
  hovered.every((h) => h.unclipped),
  `${hovered.filter((h) => !h.unclipped).length} of ${hovered.length} cut off`);
check('each one leads with the type and the size',
  hovered.every((h) => /·\s*[\d.]+ m²/.test(h.title)),
  hovered.map((h) => h.title).join(' | '));
check('the unclaimed ones say so',
  hovered.filter((h) => /unclaimed/.test(h.title)).length === 2,
  hovered.filter((h) => /unclaimed/.test(h.title)).map((h) => h.title).join(' | '));
check('and none of them opens off the edge of the window',
  hovered.every((h) => !h.offscreen),
  `${hovered.filter((h) => h.offscreen).length} off-screen`);

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
