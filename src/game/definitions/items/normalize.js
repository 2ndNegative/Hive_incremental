// Item authoring format -> engine format.
//
// Composition is authored in the units nutrition tables actually print, because
// hand-writing 0.0000593 g of cobalamin is how typos get in:
//
//   g:  { water: 70.8, protein: 20.4, fat: 3.6, carb: 3.9, fiber: 0, ash: 1.3 }
//   mg: { sodium: 69, potassium: 313, iron: 4.9, copper: 9.8 }
//   ug: { vitaminA: 4968, vitaminB12: 59.3, selenium: 39.7 }
//
// All three are per 100 g of the item. `normalizeItem` folds them into a single
// `per100g` map in grams, which is the only thing the engine ever reads.
//
// Macros partition the mass and should sum to ~100 g. Micros are a breakdown of
// mass already counted in the macros (minerals inside `ash`, vitamins dispersed
// through the rest), so they are deliberately NOT added to the total.

import { NUTRIENTS, MACROS } from '../nutrients.js';

export const CATEGORIES = {
  meat: { name: 'Meat', order: 1 },
  organ: { name: 'Organ', order: 2 },
  aquatic: { name: 'Aquatic', order: 3 },
  insect: { name: 'Insect', order: 4 },
  egg: { name: 'Egg & dairy', order: 5 },
  hominid: { name: 'Hominid', order: 6 },
  grain: { name: 'Grain', order: 7 },
  legume: { name: 'Legume', order: 8 },
  nut: { name: 'Nut & seed', order: 9 },
  vegetable: { name: 'Vegetable', order: 10 },
  fruit: { name: 'Fruit', order: 11 },
  fungus: { name: 'Fungus', order: 12 },
  algae: { name: 'Algae', order: 13 },
  forage: { name: 'Forage', order: 14 },
  fat: { name: 'Fat & oil', order: 15 },
  refined: { name: 'Refined', order: 16 },
  mineral: { name: 'Mineral', order: 17 },
  metal: { name: 'Metal', order: 18 },
  material: { name: 'Material', order: 19 },
  fluid: { name: 'Fluid', order: 20 },
};

/**
 * Confidence in the composition figures:
 *   high   - standard reference table value (USDA SR Legacy and equivalents)
 *   medium - published but variable between samples, or averaged across sources
 *   low    - order-of-magnitude estimate; good enough to play with, not to cite
 *   model  - a deliberate game abstraction, not a measurement (see `note`)
 */
export const CONFIDENCE = ['high', 'medium', 'low', 'model'];

/**
 * Micronutrient coverage, so the codex can be honest about what it does not
 * know rather than implying a missing value is a zero.
 *   full      - the whole panel was sourced
 *   partial   - the notable micros are present, the rest are unknown
 *   macroOnly - macros only; treat every micro as unknown, not absent
 */
export const COVERAGE = ['full', 'partial', 'macroOnly'];

export function normalizeItem(raw) {
  const per100g = {};

  for (const [id, grams] of Object.entries(raw.g || {})) {
    assertNutrient(id, raw.id);
    per100g[id] = (per100g[id] || 0) + grams;
  }
  for (const [id, mg] of Object.entries(raw.mg || {})) {
    assertNutrient(id, raw.id);
    per100g[id] = (per100g[id] || 0) + mg / 1000;
  }
  for (const [id, ug] of Object.entries(raw.ug || {})) {
    assertNutrient(id, raw.id);
    per100g[id] = (per100g[id] || 0) + ug / 1_000_000;
  }

  const macroMass = MACROS.reduce((sum, id) => sum + (per100g[id] || 0), 0);

  return {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    tags: raw.tags || [],
    source: raw.source || null,
    note: raw.note || null,
    confidence: raw.confidence || 'medium',
    coverage: raw.coverage || 'partial',
    per100g,
    macroMass,
  };
}

function assertNutrient(id, itemId) {
  if (!NUTRIENTS[id]) {
    throw new Error(`Item "${itemId}" references unknown nutrient "${id}"`);
  }
}

/** Nutrient yield (grams) from consuming `grams` of an item. */
export function yieldOf(item, grams) {
  const out = {};
  const scale = grams / 100;
  for (const [id, per100] of Object.entries(item.per100g)) {
    if (per100) out[id] = per100 * scale;
  }
  return out;
}

/** Energy density of an item, in joules per gram. */
export function itemJoulesPerGram(item) {
  let total = 0;
  for (const id of MACROS) {
    total += (item.per100g[id] || 0) * NUTRIENTS[id].kjPerGram * 1000;
  }
  return total / 100;
}
