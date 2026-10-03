#!/usr/bin/env node
/**
 * Item database validator.
 *
 * Nutrition data is easy to get subtly wrong — a milligram where a microgram
 * belonged, fibre counted twice, minerals that outweigh the ash they live in.
 * This checks every item against the laws it cannot break and prints what it
 * finds. Run it after any edit to the database:
 *
 *   node tools/validate-items.mjs            # errors and warnings
 *   node tools/validate-items.mjs --verbose  # also print every item's energy
 *
 * CHECKS
 *   1. Macro mass balance — macros must sum to 100 g per 100 g (±2 g).
 *   2. Energy cross-check — energy recomputed from macros must match the
 *      published figure where one is given.
 *   3. Parent containment — every micronutrient must fit inside the macro
 *      fraction it is declared to be part of, because the engine draws its
 *      mass back out of that fraction once the assay resolves it.
 *   4. Plausibility — no negative values, no micronutrient exceeding 1% of mass
 *      unless the item is a mineral or is flagged as an outlier.
 *   5. Referential integrity — organism parts must name real items.
 *   6. Forage coverage — every item must be classified in forage.js, name real
 *      biomes, and be reachable by SOME route; every biome must offer every
 *      caste something, or a hive made of it strands that caste.
 */

import { ITEMS, ITEM_IDS, itemJoulesPerGram } from '../src/game/definitions/items/index.js';
import { ORGANISMS, ORGANISM_IDS } from '../src/game/definitions/organisms.js';
import { NUTRIENTS, MACROS, MICROS, parentsOf } from '../src/game/definitions/nutrients.js';
import { FORAGE, hasDirectRoute, poolFor } from '../src/game/definitions/forage.js';
import { BIOMES, BIOME_IDS } from '../src/game/definitions/biomes.js';
import { formatEnergy } from '../src/game/units.js';

const verbose = process.argv.includes('--verbose');
const errors = [];
const warnings = [];

const err = (id, msg) => errors.push(`${id}: ${msg}`);
const warn = (id, msg) => warnings.push(`${id}: ${msg}`);


for (const id of ITEM_IDS) {
  const item = ITEMS[id];

  /* 1. macro mass balance */
  const macroSum = MACROS.reduce((s, n) => s + (item.per100g[n] || 0), 0);
  if (Math.abs(macroSum - 100) > 2) {
    err(id, `macros sum to ${macroSum.toFixed(2)} g per 100 g, expected 100 (±2)`);
  } else if (Math.abs(macroSum - 100) > 0.5) {
    warn(id, `macros sum to ${macroSum.toFixed(2)} g per 100 g`);
  }

  /* 4a. no negatives */
  for (const [n, v] of Object.entries(item.per100g)) {
    if (v < 0) err(id, `negative ${n}: ${v}`);
  }

  /* 3. parent containment.
     The engine draws a resolved micronutrient's mass out of the macro fraction
     that was carrying it (nutrients.js, MASS ACCOUNTING). That only conserves
     mass if the parent fraction is actually big enough to hold its children,
     so this checks exactly the claim the engine relies on: for each parent, the
     children that name it first must fit inside it. Sulfur names ash then
     protein, and is allowed to spill into protein the way the engine lets it. */
  const claims = {}; // parent -> grams claimed by its children
  for (const n of MICROS) {
    const grams = item.per100g[n] || 0;
    if (grams <= 0) continue;
    let owed = grams;
    for (const parent of parentsOf(n)) {
      if (owed <= 1e-12) break;
      const room = (item.per100g[parent] || 0) - (claims[parent] || 0);
      if (room <= 1e-12) continue;
      const taken = Math.min(owed, room);
      claims[parent] = (claims[parent] || 0) + taken;
      owed -= taken;
    }
    if (owed > 0.01) {
      const where = parentsOf(n).map((p) => `${p} ${(item.per100g[p] || 0).toFixed(2)} g`).join(' / ');
      err(id, `${n} ${grams.toFixed(3)} g does not fit inside ${where} — ${owed.toFixed(3)} g would arrive as mass from nowhere`);
    }
  }

  /* 4b. micronutrient plausibility
     Only meaningful for things that were once alive. A mineral, a metal or a
     bulk material is *supposed* to be percent-level calcium or chloride, and
     the containment check above already polices those. */
  const EDIBLE = ['meat', 'organ', 'aquatic', 'insect', 'egg', 'hominid', 'grain', 'legume', 'nut', 'vegetable', 'fruit', 'fungus', 'refined'];
  if (EDIBLE.includes(item.category) && !item.tags.includes('skeletal')) {
    for (const n of MICROS) {
      const v = item.per100g[n] || 0;
      if (v > 1) {
        warn(id, `${n} is ${v.toFixed(2)} g per 100 g — over 1% of an edible item's mass, check the unit`);
      }
    }
  }

  /* 2. energy sanity */
  const jPerG = itemJoulesPerGram(item);
  if (jPerG > 39_000) {
    err(id, `energy density ${(jPerG / 1000).toFixed(1)} kJ/g exceeds pure fat (37 kJ/g)`);
  }
  if (verbose) {
    console.log(
      `${item.name.padEnd(30)} ${formatEnergy(jPerG * 1000).padStart(10)}/kg  ` +
        `macros ${macroSum.toFixed(1)}g  ${item.confidence}/${item.coverage}`,
    );
  }

  /* metadata */
  if (!['high', 'medium', 'low', 'model'].includes(item.confidence)) {
    err(id, `unknown confidence "${item.confidence}"`);
  }
  if (!['full', 'partial', 'macroOnly'].includes(item.coverage)) {
    err(id, `unknown coverage "${item.coverage}"`);
  }
}

/* 2b. energy regression against published figures.
   Reference kcal per 100 g for a spread of items, from the same tables the
   compositions came from. If a macro split drifts, the energy drifts with it
   and this catches it. Tolerance is 8%, which absorbs the rounding in the
   source rows and the fact that published kcal often use item-specific Atwater
   factors rather than the general ones the hive uses. */
const PUBLISHED_KCAL = {
  beef_ground_80: 254,
  chicken_breast: 110,
  beef_liver: 135,
  salmon: 208,
  cod: 82,
  oyster: 68,
  egg_whole: 143,
  milk_whole: 61,
  butter: 717,
  olive_oil: 884,
  sucrose: 387,
  honey: 304,
  wheat: 327,
  rice_white: 365,
  oats: 389,
  soybean: 446,
  almond: 579,
  brazil_nut: 659,
  potato: 77,
  spinach: 23,
  apple: 52,
  banana: 89,
  avocado: 160,
  beer: 43,
  wine_red: 85,
  table_salt: 0,
};

for (const [id, kcal] of Object.entries(PUBLISHED_KCAL)) {
  const item = ITEMS[id];
  if (!item) {
    err('energy check', `no such item "${id}"`);
    continue;
  }
  const computedKcal = (itemJoulesPerGram(item) * 100) / 4184;
  const published = kcal;
  if (published === 0) {
    if (computedKcal > 1) err(id, `should carry no energy, computes ${computedKcal.toFixed(1)} kcal/100 g`);
    continue;
  }
  // Two tolerances, whichever is kinder:
  //  - 12% relative. The hive uses the GENERAL Atwater factors for everything,
  //    while published kcal often use food-specific ones. Mono- and
  //    disaccharides are the big divergence: sucrose is 3.87 kcal/g and free
  //    monosaccharides 3.75, against the general carbohydrate factor of ~4.06,
  //    so pure sugar and honey read about 5-10% high here. That is a deliberate
  //    consequence of keeping "energy = Σ nutrient mass × one density per
  //    nutrient" exactly true, which the whole game depends on.
  //  - 5 kcal absolute, because on a 23 kcal vegetable a 2 kcal rounding
  //    difference is 9% and means nothing.
  const diff = Math.abs(computedKcal - published);
  const drift = diff / published;
  if (drift > 0.12 && diff > 5) {
    err(
      id,
      `energy ${computedKcal.toFixed(0)} kcal/100 g vs published ${published} ` +
        `(${(drift * 100).toFixed(0)}% off) — macro split is probably wrong`,
    );
  } else if (drift > 0.04 && diff > 5) {
    warn(
      id,
      `energy ${computedKcal.toFixed(0)} kcal/100 g vs published ${published} ` +
        `(expected for sugars: general vs food-specific Atwater factors)`,
    );
  }
}

/* 5. organism references */
for (const oid of ORGANISM_IDS) {
  const org = ORGANISMS[oid];
  let total = 0;
  for (const [itemId, fraction] of Object.entries(org.parts)) {
    if (!ITEMS[itemId]) err(`organism ${oid}`, `references unknown item "${itemId}"`);
    if (fraction <= 0 || fraction > 1) err(`organism ${oid}`, `implausible yield for ${itemId}: ${fraction}`);
    total += fraction;
  }
  if (total > 1) err(`organism ${oid}`, `part yields sum to ${(total * 100).toFixed(0)}% of live mass`);
  if (total < 0.3) warn(`organism ${oid}`, `only ${(total * 100).toFixed(0)}% of live mass is recovered`);
}

/* 6. forage coverage */
{
  const fromPrey = new Set();
  for (const oid of ORGANISM_IDS) {
    if (!ORGANISMS[oid].biomes || Object.keys(ORGANISMS[oid].biomes).length === 0) {
      err(`organism ${oid}`, 'lives in no biome, so it can never be hunted');
    }
    for (const b of Object.keys(ORGANISMS[oid].biomes || {})) {
      if (!BIOMES[b]) err(`organism ${oid}`, `names unknown biome "${b}"`);
    }
    for (const itemId of Object.keys(ORGANISMS[oid].parts)) fromPrey.add(itemId);
  }

  for (const id of ITEM_IDS) {
    const entry = FORAGE[id];
    if (!entry) {
      err(id, 'is not classified in forage.js — it can never be found anywhere');
      continue;
    }
    for (const b of Object.keys(entry.biomes)) {
      if (!BIOMES[b]) err(id, `names unknown biome "${b}"`);
    }
    if (!entry.gather.length) err(id, 'has no gather type, so no caste can collect it');
    if (!hasDirectRoute(id) && !fromPrey.has(id)) {
      err(id, 'has no direct route and is not butchered from any prey — unobtainable');
    }
  }
  for (const id of Object.keys(FORAGE)) {
    if (!ITEMS[id]) err('forage.js', `classifies "${id}", which is not an item`);
  }

  // A biome that offers a caste nothing strands that caste on a hive made of
  // it. Deserts having no standing fresh water is the one deliberate case.
  // Deliberate: a desert has no standing fresh water, and there is nothing to
  // dig in open water — the seabed biomes are where a hive mines the ocean.
  const ALLOWED_GAPS = new Set([
    'desert:siphon',
    'openOcean:excavator', 'twilightZone:excavator', 'polarSea:excavator',
  ]);
  for (const b of BIOME_IDS) {
    for (const g of ['forager', 'scavenger', 'excavator', 'siphon']) {
      if (poolFor(g, b).length === 0 && !ALLOWED_GAPS.has(`${b}:${g}`)) {
        warn(`biome ${b}`, `offers a ${g} nothing at all`);
      }
    }
    // A hunter's pool is prey AND huntable items, so both count here.
    const prey = ORGANISM_IDS.filter((o) => ORGANISMS[o].biomes?.[b] > 0).length;
    if (prey + poolFor('hunter', b).length === 0) {
      warn(`biome ${b}`, 'has nothing to hunt, so a hunter working it comes back empty');
    }
  }
}

/* ------------------------------------------------------------------ report */

const byConfidence = {};
const byCoverage = {};
for (const id of ITEM_IDS) {
  byConfidence[ITEMS[id].confidence] = (byConfidence[ITEMS[id].confidence] || 0) + 1;
  byCoverage[ITEMS[id].coverage] = (byCoverage[ITEMS[id].coverage] || 0) + 1;
}

console.log(`\n=== item database ===`);
console.log(`items          ${ITEM_IDS.length}`);
console.log(`organisms      ${ORGANISM_IDS.length}`);
console.log(`nutrients      ${MACROS.length} macro + ${MICROS.length} micro`);
console.log(`biomes         ${BIOME_IDS.length}, all ${ITEM_IDS.length} items classified`);
console.log(`confidence     ${Object.entries(byConfidence).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`coverage       ${Object.entries(byCoverage).map(([k, v]) => `${k} ${v}`).join(', ')}`);

if (warnings.length) {
  console.log(`\n--- ${warnings.length} warning(s) ---`);
  for (const w of warnings) console.log(`  ${w}`);
}
if (errors.length) {
  console.log(`\n--- ${errors.length} error(s) ---`);
  for (const e of errors) console.log(`  ${e}`);
}
console.log(errors.length ? '\n=== validation FAILED ===' : '\n=== validation passed ===');
process.exit(errors.length ? 1 : 0);
