// Nutrient definitions — the only things the hive actually stores.
//
// ENERGY IS NOT A SEPARATE RESOURCE. The hive's available energy is the sum of
// the energy held in its stored nutrients:
//
//     energy (J) = Σ store[n] (g) × kjPerGram[n] × 1000
//
// So spending energy means metabolising mass. Burning a gram of fat costs
// 37 kJ worth of store; burning a gram of sodium costs nothing at all, because
// sodium carries no metabolisable energy — it is already fully oxidised. That
// is why minerals make useless fuel and excellent structure.
//
// `kjPerGram` uses the FAO/WHO general Atwater factors:
//   protein 17, fat 37, carbohydrate 17, dietary fibre 8, ethanol 29 kJ/g.
//   https://www.fao.org/4/y5022e/y5022e04.htm
//
// TIERS
//   macro  always visible, always usable
//   micro  accumulates invisibly from the first bite; `revealedBy` names the
//          assay tech that makes it visible and usable. Before that it still
//          fills its store and still silently spills over at the cap.
//
// MASS ACCOUNTING
//   Macros partition an item's mass and sum to ~100 g per 100 g. Micros are a
//   *breakdown of what is already inside those macros*, not extra mass — the
//   minerals are part of the ash fraction, the fat-soluble vitamins are
//   dissolved in the fat, the water-soluble ones in the water. Each micro
//   therefore names its `parent` macro, and mass is conserved:
//
//     unresolved  the micro's grams are tracked in its own store AND still
//                 counted inside the parent, because the hive genuinely cannot
//                 tell them apart yet. Nothing in the interface shows either.
//     at reveal   the assay separates them, so the balance that was riding
//                 along is drawn back out of the parent in one lump. Resolving
//                 the bulk minerals visibly costs mineral mass.
//     resolved    every later intake routes the micro's grams out of the
//                 parent fraction at the moment they arrive.
//
//   A micro can only ever take grams the parent actually supplied, so the
//   stores can never go negative and nothing appears out of nowhere.
//   `tools/validate-items.mjs` checks children against parents across the
//   whole database.
//
//   Sulfur is the one nutrient with two homes: in rock it is sulfate and reads
//   as ash, in tissue it sits inside cystine and methionine and reads as
//   protein. It names both, in that order.

/**
 * EVERY baseCap HERE IS ZERO, ON PURPOSE.
 *
 * A nutrient has no storage of its own. The hive can hold nothing at all until
 * it has built something to hold it in, and every gram of room comes from a
 * structure's `storage` map — see definitions/structures.js. Setting a figure
 * here would do nothing; the engine does not read it.
 *
 * The field is kept rather than deleted because the save format, the Codex and
 * a good deal of interface code all walk these entries, and a missing key is a
 * worse bug than a zero.
 */
export const NUTRIENTS = {
  /* ------------------------------------------------------------- macros -- */

  water: {
    id: 'water',
    name: 'Water',
    tier: 'macro',
    group: 'bulk',
    kjPerGram: 0,
    baseCap: 0,
    desc: 'Solvent and coolant. Carries no energy but every reaction needs it.',
  },
  protein: {
    id: 'protein',
    name: 'Protein',
    tier: 'macro',
    group: 'bulk',
    kjPerGram: 17,
    baseCap: 0,
    fuel: true,
    desc: 'Structural mass and emergency fuel. What drones and chambers are built from.',
  },
  fat: {
    id: 'fat',
    name: 'Fat',
    tier: 'macro',
    group: 'bulk',
    kjPerGram: 37,
    baseCap: 0,
    fuel: true,
    desc: 'The densest fuel on this planet at 37 kJ per gram. Burn this first.',
  },
  carb: {
    id: 'carb',
    name: 'Carbohydrate',
    tier: 'macro',
    group: 'bulk',
    kjPerGram: 17,
    baseCap: 0,
    fuel: true,
    desc: 'Fast, abundant fuel. Plants are full of it.',
  },
  fiber: {
    id: 'fiber',
    name: 'Fibre',
    tier: 'macro',
    group: 'bulk',
    kjPerGram: 8,
    baseCap: 0,
    fuel: true,
    fuelRequires: 'cellulolysis', // inert until the hive can break the bonds
    desc: 'Structural plant polysaccharide. Locked inside cellulose until the hive learns to cleave it.',
  },
  ethanol: {
    id: 'ethanol',
    name: 'Ethanol',
    tier: 'macro',
    group: 'bulk',
    kjPerGram: 29,
    baseCap: 0,
    fuel: true,
    desc: 'Dense, volatile, mildly toxic. The locals drink it recreationally.',
  },
  ash: {
    id: 'ash',
    name: 'Mineral mass',
    tier: 'macro',
    group: 'bulk',
    kjPerGram: 0,
    baseCap: 0,
    desc: 'Total incombustible residue. You can weigh it from the first bite; telling apart what is in it takes assay work, and every element you learn to name is drawn out of this.',
  },

  /* ------------------------------------------------- minerals (micro) ---- */

  sodium: m('sodium', 'Sodium', 'bulkMineralAssay', 200, 'Electrolyte. Abundant in blood, seawater and anything the locals cooked.'),
  potassium: m('potassium', 'Potassium', 'bulkMineralAssay', 200, 'Intracellular counterpart to sodium. Plant tissue is rich in it.'),
  calcium: m('calcium', 'Calcium', 'bulkMineralAssay', 400, 'Skeletal mineral. Bone is a third of it by dry mass.'),
  magnesium: m('magnesium', 'Magnesium', 'bulkMineralAssay', 100, 'Enzyme cofactor. Concentrated in seeds and chlorophyll.'),
  phosphorus: m('phosphorus', 'Phosphorus', 'bulkMineralAssay', 300, 'Energy transfer and bone. The bottleneck mineral of this biosphere.'),
  chloride: m('chloride', 'Chloride', 'bulkMineralAssay', 200, 'Travels with sodium. Seawater is swimming in it.'),
  sulfur: m('sulfur', 'Sulfur', 'bulkMineralAssay', 100, 'Sits inside two amino acids, so protein mass carries it along.', ['ash', 'protein']),

  iron: m('iron', 'Iron', 'traceMetalAssay', 20, 'Oxygen carrier. Blood and liver are the richest biological sources.'),
  zinc: m('zinc', 'Zinc', 'traceMetalAssay', 20, 'Catalytic metal. Oysters are an absurd outlier.'),
  copper: m('copper', 'Copper', 'traceMetalAssay', 10, 'Electron shuttle. Ruminant liver concentrates it heavily.'),
  manganese: m('manganese', 'Manganese', 'traceMetalAssay', 10, 'Cofactor. Whole grains and nuts carry most of it.'),

  selenium: m('selenium', 'Selenium', 'rareElementAssay', 0.5, 'Antioxidant trace. One species of nut holds a thousand times the usual.'),
  iodine: m('iodine', 'Iodine', 'rareElementAssay', 0.5, 'Thyroid trace. Marine algae concentrate it to extraordinary levels.'),
  chromium: m('chromium', 'Chromium', 'rareElementAssay', 0.2, 'Glucose-handling trace. Present almost everywhere in tiny amounts.'),
  molybdenum: m('molybdenum', 'Molybdenum', 'rareElementAssay', 0.2, 'Enzyme cofactor. Legumes are the reliable source.'),

  /* ------------------------------------------------- vitamins (micro) ---- */

  vitaminA: m('vitaminA', 'Vitamin A', 'lipidAssay', 2, 'Retinoids. Liver stores it to toxic excess.'),
  vitaminD: m('vitaminD', 'Vitamin D', 'lipidAssay', 0.2, 'Secosteroid. Oily fish, or synthesised in skin under this star.'),
  vitaminE: m('vitaminE', 'Vitamin E', 'lipidAssay', 10, 'Tocopherols. Seed oils are the dense source.'),
  vitaminK: m('vitaminK', 'Vitamin K', 'lipidAssay', 1, 'Phylloquinone. Green leaf tissue, overwhelmingly.'),

  vitaminC: m('vitaminC', 'Vitamin C', 'aqueousAssay', 20, 'Ascorbate. Fresh plant tissue only; cooking destroys it.'),
  vitaminB1: m('vitaminB1', 'Thiamin (B1)', 'aqueousAssay', 2, 'Carbohydrate metabolism. Pork and whole grain.'),
  vitaminB2: m('vitaminB2', 'Riboflavin (B2)', 'aqueousAssay', 2, 'Flavin cofactor. Organ meat and dairy.'),
  vitaminB3: m('vitaminB3', 'Niacin (B3)', 'aqueousAssay', 10, 'NAD precursor. Muscle tissue is full of it.'),
  vitaminB5: m('vitaminB5', 'Pantothenate (B5)', 'aqueousAssay', 5, 'Coenzyme A precursor. Near-universal, liver highest.'),
  vitaminB6: m('vitaminB6', 'Pyridoxine (B6)', 'aqueousAssay', 2, 'Amino acid metabolism. Fish, organ meat, starchy tubers.'),
  vitaminB7: m('vitaminB7', 'Biotin (B7)', 'aqueousAssay', 0.5, 'Carboxylase cofactor. Egg yolk and liver.'),
  vitaminB9: m('vitaminB9', 'Folate (B9)', 'aqueousAssay', 1, 'One-carbon transfer. Leaf tissue and legumes.'),
  vitaminB12: m('vitaminB12', 'Cobalamin (B12)', 'aqueousAssay', 0.2, 'Cobalt-cored. Produced only by microbes; found only in animal tissue.'),
};

/**
 * Shorthand for a micronutrient entry.
 *
 * `parents` lists the macro fractions this micro's mass is physically part of,
 * most likely first. It defaults from the assay group: minerals come out of the
 * ash, fat-soluble vitamins out of the fat, water-soluble out of the water.
 */
function m(id, name, revealedBy, baseCap, desc, parents) {
  return {
    id,
    name,
    tier: 'micro',
    group: revealedBy,
    kjPerGram: 0, // minerals and vitamins yield no metabolisable energy
    // Deliberately ignored — see the note on baseCap above. The argument is
    // kept so the hundred-odd call sites below do not all have to be rewritten
    // for a number nothing reads.
    baseCap: 0,
    revealedBy,
    desc,
    parents: parents ?? [defaultParent(revealedBy)],
  };
}

function defaultParent(group) {
  if (group === 'lipidAssay') return 'fat';
  if (group === 'aqueousAssay') return 'water';
  return 'ash';
}

export const NUTRIENT_IDS = Object.keys(NUTRIENTS);

export const MACROS = NUTRIENT_IDS.filter((id) => NUTRIENTS[id].tier === 'macro');
export const MICROS = NUTRIENT_IDS.filter((id) => NUTRIENTS[id].tier === 'micro');

/** Nutrients that can be metabolised for energy at all. */
export const FUELS = NUTRIENT_IDS.filter((id) => NUTRIENTS[id].kjPerGram > 0);

/** Assay groups, in the order the tech tree unlocks them. */
export const ASSAY_GROUPS = [
  { id: 'bulkMineralAssay', name: 'Bulk minerals' },
  { id: 'traceMetalAssay', name: 'Trace metals' },
  { id: 'rareElementAssay', name: 'Rare elements' },
  { id: 'lipidAssay', name: 'Fat-soluble vitamins' },
  { id: 'aqueousAssay', name: 'Water-soluble vitamins' },
];

/** Joules held in one gram of a nutrient. */
export function joulesPerGram(id) {
  return (NUTRIENTS[id]?.kjPerGram ?? 0) * 1000;
}

/** Is this nutrient visible to the player yet? Macros always are. */
export function isRevealed(state, id) {
  const def = NUTRIENTS[id];
  if (!def) return false;
  if (def.tier === 'macro') return true;
  return Boolean(state.tech[def.revealedBy]);
}

/**
 * WHAT THE HIVE THINKS IT IS HOLDING.
 *
 * An unassayed micronutrient is a shadow tally: the hive is carrying the iron,
 * but it cannot tell iron from the mineral mass around it, so every gram of it
 * is also a gram of mineral mass. The player should never be shown the name of
 * something the hive has not resolved, and a rule the player sets on mineral
 * mass has to govern the iron riding inside it — otherwise barring a resource
 * from the shared pool would quietly fail to bar most of its mass.
 *
 * So: the id the player sees this mass as. Itself once assayed, otherwise the
 * parent fraction that is carrying it. Macros are always revealed, so the walk
 * terminates; the guard is there for a composition that names a missing parent.
 */
export function visibleAs(state, id) {
  let at = id;
  for (let hop = 0; hop < 4; hop += 1) {
    if (isRevealed(state, at)) return at;
    const parent = parentsOf(at)[0];
    if (!parent || parent === at) return at;
    at = parent;
  }
  return at;
}

/**
 * Can this nutrient currently be burned for energy? A fuel may additionally
 * require a tech — fibre is 8 kJ/g of perfectly good energy that the hive
 * simply cannot open until it has cellulolysis.
 */
export function isUsableFuel(state, id) {
  const def = NUTRIENTS[id];
  if (!def?.fuel) return false;
  if (def.fuelRequires && !state.tech[def.fuelRequires]) return false;
  return true;
}

/* ------------------------------------------------------------------- costs */

/**
 * What a cost in a nutrient the hive cannot yet see costs INSTEAD.
 *
 * The hive can want a thing before it can name it. A drone built out of
 * phosphorus is still a drone built out of phosphorus — but a hive that has not
 * run the assay has no idea which part of the ash that is, so it has to shovel
 * ash at the problem until enough of it happens to be phosphorus. Fifty grams
 * of the parent for every gram of the real thing: wasteful, workable, and it
 * turns every assay into a cost cut rather than a new menu.
 */
export const LOCKED_COST_MULTIPLIER = 50;

/**
 * Resolve a cost against what the hive can currently see.
 *
 * A revealed nutrient is charged as written. An unrevealed one is charged to
 * its parent macro at LOCKED_COST_MULTIPLIER, and several locked micros sharing
 * a parent pile onto the same line. A nutrient with no parent at all — which
 * should not happen — is left as written rather than silently made free.
 */
export function payableCost(state, cost) {
  if (!cost) return {};
  let swapped = false;
  const out = {};
  for (const [id, grams] of Object.entries(cost)) {
    if (!grams) continue;
    if (!NUTRIENTS[id] || isRevealed(state, id)) {
      out[id] = (out[id] || 0) + grams;
      continue;
    }
    const parent = parentsOf(id)[0];
    if (!parent) {
      out[id] = (out[id] || 0) + grams;
      continue;
    }
    out[parent] = (out[parent] || 0) + grams * LOCKED_COST_MULTIPLIER;
    swapped = true;
  }
  // Marked rather than inferred, so the interface can say WHY a cost looks the
  // way it does without re-deriving it.
  if (swapped) Object.defineProperty(out, 'substituted', { value: true, enumerable: false });
  return out;
}

/** Did resolving this cost swap a locked nutrient for its parent? */
export function costWasSubstituted(cost) {
  return Boolean(cost?.substituted);
}

/* ------------------------------------------------------------ mass accounting */

/** The macro fractions a micro's mass is part of, most likely first. */
export function parentsOf(id) {
  return NUTRIENTS[id]?.parents ?? [];
}

/**
 * What ingesting `grams` of an item actually adds to each store.
 *
 * Macros come straight off the composition. A micro the hive has resolved is
 * drawn out of the parent fraction that was carrying it, so the same gram is
 * never counted twice; a micro it has not resolved yet is tracked in its own
 * store while its mass stays inside the parent, because the hive cannot tell
 * the two apart until the assay is done.
 *
 * The draw is limited to what this item's own parent fraction supplied, so no
 * store can be pushed below zero by a composition that does not add up.
 */
export function itemYield(state, per100g, grams) {
  const scale = grams / 100;
  const add = {};
  for (const [id, per100] of Object.entries(per100g)) {
    if (per100) add[id] = per100 * scale;
  }

  for (const id of MICROS) {
    const amount = add[id];
    if (!amount || !isRevealed(state, id)) continue;
    let owed = amount;
    for (const parent of parentsOf(id)) {
      if (owed <= EPS) break;
      const available = add[parent] || 0;
      if (available <= EPS) continue;
      const taken = Math.min(owed, available);
      add[parent] = available - taken;
      owed -= taken;
    }
    // Any remainder had no parent fraction to come out of, which means the
    // item's composition does not account for it. validate-items.mjs is what
    // catches that; here it simply arrives as mass of its own.
  }

  return add;
}

/**
 * Settle the balance that has been riding inside the macros, at the moment an
 * assay makes it visible. Mutates `state.nutrients` and returns how much came
 * out of each parent, so the reveal can say what it cost.
 */
export function settleReveal(state, ids) {
  const drawn = {};
  for (const id of ids) {
    let owed = state.nutrients[id] || 0;
    if (owed <= EPS) continue;
    for (const parent of parentsOf(id)) {
      if (owed <= EPS) break;
      const available = state.nutrients[parent] || 0;
      if (available <= EPS) continue;
      const taken = Math.min(owed, available);
      state.nutrients[parent] = available - taken;
      drawn[parent] = (drawn[parent] || 0) + taken;
      owed -= taken;
    }
    // Whatever is left was spent as macro mass long ago, or spilled. The hive
    // keeps the named grams it is holding; the books simply do not go negative.
  }
  return drawn;
}

const EPS = 1e-12;
