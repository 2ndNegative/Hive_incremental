import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * WHAT HOLDING GROUND IS ACTUALLY WORTH.
 *
 * This suite used to test a different game. Land was one pooled ceiling on how
 * many drones could forage at once, patches were 36 m² apiece because that was
 * the opening tile, and every patch rolled a biome against the whole territory
 * before it rolled a find. All three are gone, so the checks were rewritten
 * rather than repaired — a suite that still described the old model would pass
 * while testing nothing anyone can reach.
 *
 * WHAT IT TESTS NOW
 *   RANGE      — a drone needs so many square metres of ONE biome, declared by
 *                its type. Room is counted per biome, so the hive runs out of
 *                farmland rather than out of land.
 *   CROWDING   — past that room every drone loses ground, gently or badly
 *                depending on the animal. One exponent, two shapes: a crowded
 *                forager is inefficient, a crowded hunter is pointless.
 *   ASSIGNMENT — the player sets targets, including for drones that do not
 *                exist yet; whatever is left over spreads by area as it always
 *                did.
 *   THE GROUND IS THE POOL — a drone assigned to a biome finds what is on that
 *                biome and nothing else. This is the check that would catch the
 *                biome roll coming back.
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
 */
const comfortable = () => p.evaluate(() => {
  hive.state.nutrients.water = 15_000;
  for (const n of ['carb', 'fat', 'protein', 'fiber']) hive.state.nutrients[n] = 5_000;
  hive.state.structures.hivecore = Math.max(1, hive.state.structures.hivecore || 0);
  hive.state.active = { ...hive.state.structures };
});
await comfortable();

/* ======================================== 1. a type declares the room it needs */

const decl = await p.evaluate(() => {
  const out = {};
  for (const id of hive.drones.foraging()) {
    const def = hive.drones.types[id];
    out[id] = { range: def.range, crowding: def.crowding };
  }
  return {
    types: out,
    // The landing site, and what it carries of each.
    forest36: Object.fromEntries(
      hive.drones.foraging().map((id) => [id, hive.land.slots('temperateForest', id)]),
    ),
  };
});
check('every foraging type declares a range in square metres',
  Object.values(decl.types).every((t) => t.range > 0),
  Object.entries(decl.types).map(([k, v]) => `${k} ${v.range}m²`).join(', '));
check('and how badly it minds company',
  Object.values(decl.types).every((t) => t.crowding > 0),
  Object.entries(decl.types).map(([k, v]) => `${k} ^${v.crowding}`).join(', '));
check('a scavenger needs more ground than a forager — carrion has to be found',
  decl.types.scavenger.range > decl.types.forager.range,
  `${decl.types.forager.range} vs ${decl.types.scavenger.range} m²`);
check('and minds company more than a forager does',
  decl.types.scavenger.crowding > decl.types.forager.crowding,
  `^${decl.types.forager.crowding} vs ^${decl.types.scavenger.crowding}`);
check('the 36 m² landing site carries nine foragers',
  decl.forest36.forager === 9, `${decl.forest36.forager}`);

/* ============================================= 2. room is counted PER BIOME */

const perBiome = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 100, farmland: 20 };
  return {
    forest: hive.land.slots('temperateForest', 'forager'),
    farm: hive.land.slots('farmland', 'forager'),
    farmScav: hive.land.slots('farmland', 'scavenger'),
    // The threshold figure: how much more farmland before another scavenger.
    next: hive.land.nextWhole('farmland'),
  };
});
check('a big biome and a small one are counted separately',
  perBiome.forest === 25 && perBiome.farm === 5,
  `${perBiome.forest} forager slots in the forest, ${perBiome.farm} on the farm`);
check('and the same ground holds fewer of a wider-ranging type',
  perBiome.farmScav < perBiome.farm,
  `${perBiome.farm} foragers or ${perBiome.farmScav.toFixed(2)} scavengers on 20 m²`);
const scavNext = perBiome.next.find((n) => n.droneId === 'scavenger');
check('the tab can say how much more ground buys the next whole one',
  scavNext.have === 1 && Math.abs(scavNext.needed - 8) < 1e-9,
  `${scavNext.have} now, ${scavNext.needed} m² to the next`);

/* ================================================ 3. the crowding curve */

const crowd = await p.evaluate(() => {
  const e = hive.land.efficiency;
  return {
    // Room to spare is not a bonus — two legs are two legs.
    spare: e(10, 2, 0.5),
    // A tolerant type on half the ground it wants.
    forgiving: e(1, 2, 0.5),
    // A solitary one on the same squeeze.
    brutal: e(1, 2, 4),
    // And on a sliver: a twenty-fifth of its range.
    sliver: e(0.04, 1, 4),
    sliverTolerant: e(0.5, 1, 0.5),
    // Total output, not per drone: a tolerant type still gains from crowding,
    // a solitary one actively loses.
    tolerantTotal: 2 * e(1, 2, 0.5),
    solitaryTotal: 2 * e(1, 2, 4),
  };
});
check('room to spare does not make a drone faster', crowd.spare === 1, `${crowd.spare}`);
check('a tolerant type on half its ground is merely slower',
  crowd.forgiving > 0.6, `${(crowd.forgiving * 100).toFixed(0)}%`);
check('a solitary one on the same squeeze is nearly useless',
  crowd.brutal < 0.1, `${(crowd.brutal * 100).toFixed(1)}%`);
check('crowding two tolerant drones still raises the total',
  crowd.tolerantTotal > 1, `${crowd.tolerantTotal.toFixed(2)}× one drone's work`);
check('crowding two solitary ones LOWERS it — they drive the prey off',
  crowd.solitaryTotal < 1, `${crowd.solitaryTotal.toFixed(2)}× one drone's work`);
check('a sliver is worth something to a forager and nothing to a hunter',
  crowd.sliverTolerant > 0.5 && crowd.sliver < 0.01,
  `${(crowd.sliverTolerant * 100).toFixed(0)}% vs ${(crowd.sliver * 100).toFixed(3)}%`);

/* ============== 3b. two types on one biome compete for the same metres */

/*
 * THE BUG THIS EXISTS FOR. Room was `area / range` PER TYPE, so a biome handed
 * its whole area to every type independently: twenty-nine foragers and eight
 * scavengers on 117 m² both read 100% efficient while between them claiming
 * 228 m². The panel's header said "195% of what it carries" and nothing
 * anywhere enforced it — the hive was being paid in full for land that does
 * not exist.
 */
const shared = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 116.9 };
  s.assign = {};
  s.droneTypes = { forager: 29, scavenger: 8 };
  const alone = hive.land.use()[0];

  hive.land.setTarget('temperateForest', 'forager', 29);
  hive.land.setTarget('temperateForest', 'scavenger', 8);
  const both = hive.land.use()[0];
  const get = (u, id) => u.crews.find((c) => c.droneId === id);
  return {
    squeeze: both.squeeze,
    claimed: both.claimed,
    forager: get(both, 'forager'),
    scavenger: get(both, 'scavenger'),
    soloForager: get(alone, 'forager')?.alone,
  };
});

check('the ground reports how over-committed it is',
  Math.abs(shared.claimed - 228 / 116.9) < 0.01,
  `${(shared.claimed * 100).toFixed(0)}% committed`);
check('and squeezes everyone by the same share of what they asked for',
  Math.abs(shared.squeeze - 116.9 / 228) < 1e-9,
  `${(shared.squeeze * 100).toFixed(0)}% each`);
check('NEITHER type still reads as working at full rate',
  shared.forager.efficiency < 1 && shared.scavenger.efficiency < 1,
  `forager ${(shared.forager.efficiency * 100).toFixed(0)}%`
  + `, scavenger ${(shared.scavenger.efficiency * 100).toFixed(0)}%`);
check('the same squeeze costs the touchy type far more than the tolerant one',
  shared.scavenger.efficiency < shared.forager.efficiency / 1.5,
  `${(shared.forager.efficiency * 100).toFixed(0)}% vs `
  + `${(shared.scavenger.efficiency * 100).toFixed(0)}% on identical ground`);
check('room for a type is what is left after the rest of the plan',
  shared.forager.room < shared.soloForager && shared.scavenger.room === 0,
  `forager ${shared.forager.room} (${shared.soloForager} alone), `
  + `scavenger ${shared.scavenger.room}`);

const filled = await p.evaluate(() => {
  const s = hive.state;
  s.assign = {};
  hive.land.setTarget('temperateForest', 'scavenger', 8); // 112 of 116.9 m²
  hive.land.fillTarget('temperateForest', 'forager');
  return {
    forager: s.assign.temperateForest.forager ?? 0,
    claimed: hive.land.use()[0].claimed,
  };
});
check('and `fill` fills what is LEFT, not the whole biome',
  filled.forager === 1 && filled.claimed <= 1.001,
  `${filled.forager} foragers, ${(filled.claimed * 100).toFixed(0)}% committed after`);

/* ===================================== 4. assignment: targets, then the rest */

const spread = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 120, grassland: 60, farmland: 20 };
  s.assign = {};
  s.droneTypes = { forager: 18, scavenger: 0 };
  return hive.land.assignment().forager;
});
check('with no targets, drones spread by area share',
  spread.temperateForest === 11 && spread.grassland === 5 && spread.farmland === 2,
  JSON.stringify(spread));

const planned = await p.evaluate(() => {
  const s = hive.state;
  s.assign = {};
  hive.land.setTarget('farmland', 'forager', 5);
  const withTarget = hive.land.assignment().forager;
  // A target the hive cannot fill yet: the plan is honoured in RATIO.
  s.assign = {};
  hive.land.setTarget('temperateForest', 'forager', 30);
  hive.land.setTarget('grassland', 'forager', 10);
  const overAsked = hive.land.assignment().forager;
  return { withTarget, overAsked };
});
check('a target is honoured before anything spreads',
  planned.withTarget.farmland === 5, JSON.stringify(planned.withTarget));
check('and the leftovers still spread by area',
  planned.withTarget.temperateForest + planned.withTarget.grassland === 13,
  JSON.stringify(planned.withTarget));
check('targets beyond the headcount are met in the ratio asked',
  planned.overAsked.temperateForest === 14 && planned.overAsked.grassland === 4,
  `asked 30:10 with 18 in hand → ${JSON.stringify(planned.overAsked)}`);

const future = await p.evaluate(() => {
  const s = hive.state;
  s.assign = {};
  s.droneTypes = { forager: 0, scavenger: 0 };
  hive.land.setTarget('farmland', 'scavenger', 4);
  const use = hive.land.use().find((b) => b.biomeId === 'farmland');
  const crew = use.crews.find((c) => c.droneId === 'scavenger');
  return { target: crew?.target, drones: crew?.drones, planned: crew?.planned, claimed: use.claimed };
});
check('a target can be set for drones the hive has not molded yet',
  future.target === 4 && future.drones === 0, `${future.drones} of ${future.target} there`);
check('and the ground immediately reads as spoken for',
  future.claimed > 1, `planned at ${(future.claimed * 100).toFixed(0)}% of what it carries`);
check('with the efficiency the plan WOULD run at',
  future.planned > 0 && future.planned < 1, `${(future.planned * 100).toFixed(0)}% each`);

/* ================================= 5. a drone finds what is on its own ground */

const pools = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 200, farmland: 200 };
  s.assign = {};
  s.droneTypes = { forager: 20, scavenger: 0 };
  hive.land.setTarget('farmland', 'forager', 20);
  hive.forage.resetForage(s);
  for (let i = 0; i < 40; i += 1) hive.tick(1);

  const farmPool = new Set(hive.poolFor('forager', 'farmland').map((e) => e.itemId));
  const forestOnly = hive.poolFor('forager', 'temperateForest')
    .map((e) => e.itemId).filter((id) => !farmPool.has(id));
  const crews = hive.derived().crews;
  const found = crews.flatMap((c) => c.patches).filter((q) => q.itemId).map((q) => q.itemId);
  return {
    biomes: [...new Set(crews.map((c) => c.biomeId))],
    found: found.length,
    strays: found.filter((id) => !farmPool.has(id)),
    forestOnlyCount: forestOnly.length,
  };
});
check('every drone went where it was told', pools.biomes.join() === 'farmland',
  pools.biomes.join(', '));
check('the forest offers things the farm does not', pools.forestOnlyCount > 3,
  `${pools.forestOnlyCount} forest-only finds`);
check('and NOTHING off the unworked biome turned up',
  pools.strays.length === 0 && pools.found > 10,
  `${pools.found} finds, ${pools.strays.length} from ground nobody is standing on`);

/* ============================== 6. crowding shows up in the intake, not just the table */

const squeezed = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { farmland: 40 }; // 10 forager slots
  s.assign = {};
  s.droneTypes = { forager: 10, scavenger: 0 };
  hive.forage.resetForage(s);
  for (let i = 0; i < 30; i += 1) hive.tick(1);
  const roomy = hive.derived().crews.find((c) => c.droneId === 'forager');
  const roomyRate = roomy.rate / roomy.drones;

  s.droneTypes.forager = 40; // four times the room
  hive.forage.resetForage(s);
  for (let i = 0; i < 30; i += 1) hive.tick(1);
  const packed = hive.derived().crews.find((c) => c.droneId === 'forager');
  return {
    roomyEff: roomy.efficiency,
    packedEff: packed.efficiency,
    roomyPer: roomyRate,
    packedPer: packed.rate / packed.drones,
    roomyTotal: roomy.rate,
    packedTotal: packed.rate,
  };
});
check('a crew inside its room works at full rate',
  Math.abs(squeezed.roomyEff - 1) < 1e-9, `${(squeezed.roomyEff * 100).toFixed(0)}%`);
check('four times the drones on the same ground works each of them harder',
  squeezed.packedEff < 0.55, `${(squeezed.packedEff * 100).toFixed(0)}% each`);
check('and the total still rises, because a forager is tolerant',
  squeezed.packedTotal > squeezed.roomyTotal,
  `${squeezed.roomyTotal.toFixed(1)} → ${squeezed.packedTotal.toFixed(1)} g/s`);

/* ================== 7. crowding costs twice: less comes in, more goes out */

/*
 * A drone on ground it can work eats some of what it finds before it gets home
 * — SNACK_SHARE in castes.js — so the share of its keep the STORES pay rises as
 * its efficiency falls. That is the only thing stopping a `tolerant` type, whose
 * total output climbs forever as drones pile on, from being free to pile.
 */
const fed = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 400 }; // 100 forager slots
  s.assign = {};
  s.droneTypes = { forager: 20, scavenger: 0 };
  hive.forage.resetForage(s);
  hive.tick(1);
  const roomy = hive.derived().ration;

  // The same drones on a twentieth of the ground.
  s.territory = { temperateForest: 20 }; // 5 slots for 20 drones
  hive.forage.resetForage(s);
  hive.tick(1);
  const packed = hive.derived().ration;

  // And nowhere at all.
  s.territory = {};
  hive.forage.resetForage(s);
  hive.tick(1);
  const nowhere = hive.derived().ration;
  return { roomy, packed, nowhere };
});
check('a comfortable crew feeds itself out on the ground',
  fed.roomy.grazed > 9 && fed.roomy.billable < 11,
  `${fed.roomy.grazed.toFixed(1)} of ${fed.roomy.drones} fed on the job`);
check('a crowded one finds less, so it snacks less, so it costs more',
  fed.packed.billable > fed.roomy.billable,
  `${fed.roomy.billable.toFixed(1)} → ${fed.packed.billable.toFixed(1)} drones on the stores`);
check('and the food bill rises with it',
  fed.packed.joules > fed.roomy.joules,
  `${Math.round(fed.roomy.joules)} → ${Math.round(fed.packed.joules)} W`);
check('a drone with no ground at all eats nothing out there and bills in full',
  fed.nowhere.grazed === 0 && fed.nowhere.billable === fed.nowhere.drones,
  `${fed.nowhere.billable} of ${fed.nowhere.drones} on the stores`);

// Ground that offers the route nothing is the sharpest case: the crew is not
// crowded, it is simply in the wrong place, and the food bill is the only
// number on any screen that says so.
const barren = await p.evaluate(() => {
  const s = hive.state;
  const empty = Object.keys(hive.biomes)
    .find((id) => !hive.landValue.offers('forager', id));
  if (!empty) return null;
  s.territory = { [empty]: 400 };
  s.assign = {};
  s.droneTypes = { forager: 20, scavenger: 0 };
  hive.forage.resetForage(s);
  hive.tick(1);
  const r = hive.derived().ration;
  return { empty, grazed: r.grazed, billable: r.billable, drones: r.drones };
});
if (barren) {
  check('a crew on ground with nothing for it grazes nothing, however much room it has',
    barren.grazed === 0 && barren.billable === barren.drones,
    `${barren.drones} foragers in ${barren.empty}, all on the stores`);
}

/* ============================================== 8. patches drift out of step */

const stagger = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 400 };
  s.assign = {};
  s.droneTypes = { forager: 6, scavenger: 0 };
  hive.forage.resetForage(s);
  hive.tick(1);
  const elapsed = s.crews['forager:temperateForest'].map((q) => q.elapsed);
  return { elapsed, distinct: new Set(elapsed.map((e) => e.toFixed(3))).size };
});
check('one patch per drone', stagger.elapsed.length === 6, `${stagger.elapsed.length}`);
check('and they are staggered rather than rolling in lockstep',
  stagger.distinct === 6, stagger.elapsed.map((e) => e.toFixed(1)).join(' / '));

/* ==================================================== 9. the screen says so */

await openTab(p, 'Territory');
await p.waitForTimeout(250);
const terr = await p.evaluate(() => {
  const panel = (re) => [...document.querySelectorAll('.panel-box')]
    .find((b) => re.test(b.querySelector('.panel-head')?.innerText ?? ''));
  const out = panel(/out now/i);
  const who = panel(/who works what/i);
  return {
    stats: [...(out?.querySelectorAll('.land-stat') ?? [])]
      .map((n) => n.innerText.replace(/\s+/g, ' ').trim()),
    crew: [...(out?.querySelectorAll('.crew-line') ?? [])]
      .map((n) => n.innerText.replace(/\s+/g, ' ').trim()).join(' | '),
    assignRows: who?.querySelectorAll('.assign-row').length ?? 0,
    inputs: [...(who?.querySelectorAll('.assign-input') ?? [])].map((n) => n.value),
    who: who?.innerText.replace(/\s+/g, ' ').trim() ?? '',
  };
});
check('Out now leads with the drones that are out', /6\s*\/\s*6/.test(terr.stats[0] ?? ''),
  terr.stats.join(' | '));
check('and names the crew with the room it has',
  /Forager ×6/.test(terr.crew) && /%\s*each/.test(terr.crew), terr.crew);
check('Who works what gives every type a row on every biome held',
  terr.assignRows === 2, `${terr.assignRows} rows`);
check('and the room each one has', /Room for 100/.test(terr.who), terr.who.slice(0, 110));

// Setting a target through the interface, which is the whole point of it.
await p.evaluate(() => {
  const who = [...document.querySelectorAll('.panel-box')]
    .find((b) => /who works what/i.test(b.querySelector('.panel-head')?.innerText ?? ''));
  const plus = who.querySelectorAll('.assign-row')[0].querySelectorAll('.btn-mini')[1];
  for (let i = 0; i < 3; i += 1) plus.click();
});
await p.waitForTimeout(250);
const set = await p.evaluate(() => ({
  state: hive.state.assign?.temperateForest?.forager ?? 0,
  shown: document.querySelector('.assign-input')?.value,
}));
check('clicking + sets a target the hive honours',
  set.state === 3 && set.shown === '3', `target ${set.state}, input "${set.shown}"`);

await openTab(p, 'Drones');
await p.waitForTimeout(250);
const drones = await p.evaluate(() => document.querySelector('.main-col')?.innerText ?? '');
check('the Drones tab says where its drones went',
  /piece(s)? of ground/.test(drones),
  drones.split('\n').find((l) => /ground/.test(l)) ?? drones.slice(0, 90));

/* ================================================= 10. a save round-trips it */

const saved = await p.evaluate(() => {
  hive.save();
  const key = Object.keys(localStorage).find((k) => /hive/i.test(k));
  const s = JSON.parse(localStorage.getItem(key));
  const st = s?.state ?? s;
  return {
    version: st?.version,
    crew: st?.crews?.['forager:temperateForest']?.length,
    assign: st?.assign?.temperateForest?.forager,
    stale: st?.patches === undefined,
  };
});
const SAVE_VERSION = await p.evaluate(() => hive.saveVersion);
check('the crews round-trip', saved.crew === 6, `${saved.crew} patches saved`);
check('and so does the plan', saved.assign === 3, `target ${saved.assign}`);
check('the old per-type patch map is gone', saved.stale === true);
check('at the current save version', saved.version === SAVE_VERSION, `v${saved.version}`);

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
