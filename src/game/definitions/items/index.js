// The item database.
//
// Everything the hive can ingest — food, prey tissue, minerals, materials —
// lives here as per-100 g composition. Items are not inventory: consuming one
// converts its mass straight into nutrient stores. The database is what tells
// the engine how.

import animal from './animal.js';
import plant from './plant.js';
import material from './material.js';
import processed from './processed.js';
import wild from './wild.js';
import { normalizeItem, CATEGORIES } from './normalize.js';

const RAW = [...animal, ...plant, ...material, ...processed, ...wild];

export const ITEMS = {};
for (const raw of RAW) {
  if (ITEMS[raw.id]) throw new Error(`Duplicate item id "${raw.id}"`);
  ITEMS[raw.id] = normalizeItem(raw);
}

export const ITEM_IDS = Object.keys(ITEMS);

/** Items grouped by category, in display order. */
export const ITEMS_BY_CATEGORY = Object.keys(CATEGORIES)
  .sort((a, b) => CATEGORIES[a].order - CATEGORIES[b].order)
  .map((category) => ({
    category,
    name: CATEGORIES[category].name,
    items: ITEM_IDS.filter((id) => ITEMS[id].category === category).sort((a, b) =>
      ITEMS[a].name.localeCompare(ITEMS[b].name),
    ),
  }))
  .filter((group) => group.items.length > 0);

export { CATEGORIES };
export { yieldOf, itemJoulesPerGram } from './normalize.js';
