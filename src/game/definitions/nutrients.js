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
//   *breakdown of what is already inside those macros* (the minerals inside the
//   ash fraction, the vitamins dissolved through the rest), not extra mass.
//   Totalling every store would therefore double-count — which is harmless,
//   because nothing does, and because every micro carries 0 kJ/g so the energy
//   sum above stays exactly right.

export const NUTRIENTS = {
  /* ------------------------------------------------------------- macros -- */

  water: {
    id: 'water',
    name: 'Water',
    tier: 'macro',
    group: 'bulk',
    kjPerGram: 0,
    baseCap: 200_000,
    desc: 'Solvent and coolant. Carries no energy but every reaction needs it.',
  },
  protein: {
    id: 'protein',
    name: 'Protein',
    tier: 'macro',
    group: 'bulk',
    kjPerGram: 17,
    baseCap: 20_000,
    fuel: true,
    desc: 'Structural mass and emergency fuel. What drones and chambers are built from.',
  },
  fat: {
    id: 'fat',
    name: 'Fat',
    tier: 'macro',
    group: 'bulk',
    kjPerGram: 37,
    baseCap: 20_000,
    fuel: true,
    desc: 'The densest fuel on this planet at 37 kJ per gram. Burn this first.',
  },
  carb: {
    id: 'carb',
    name: 'Carbohydrate',
    tier: 'macro',
    group: 'bulk',
    kjPerGram: 17,
    baseCap: 20_000,
    fuel: true,
    desc: 'Fast, abundant fuel. Plants are full of it.',
  },
  fiber: {
    id: 'fiber',
    name: 'Fibre',
    tier: 'macro',
    group: 'bulk',
    kjPerGram: 8,
    baseCap: 20_000,
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
    baseCap: 2_000,
    fuel: true,
    desc: 'Dense, volatile, mildly toxic. The locals drink it recreationally.',
  },
  ash: {
    id: 'ash',
    name: 'Mineral mass',
    tier: 'macro',
    group: 'bulk',
    kjPerGram: 0,
    baseCap: 40_000,
    desc: 'Total incombustible residue. You can weigh it from the first bite; telling apart what is in it takes assay work.',
  },

  /* ------------------------------------------------- minerals (micro) ---- */

  sodium: m('sodium', 'Sodium', 'bulkMineralAssay', 200, 'Electrolyte. Abundant in blood, seawater and anything the locals cooked.'),
  potassium: m('potassium', 'Potassium', 'bulkMineralAssay', 200, 'Intracellular counterpart to sodium. Plant tissue is rich in it.'),
  calcium: m('calcium', 'Calcium', 'bulkMineralAssay', 400, 'Skeletal mineral. Bone is a third of it by dry mass.'),
  magnesium: m('magnesium', 'Magnesium', 'bulkMineralAssay', 100, 'Enzyme cofactor. Concentrated in seeds and chlorophyll.'),
  phosphorus: m('phosphorus', 'Phosphorus', 'bulkMineralAssay', 300, 'Energy transfer and bone. The bottleneck mineral of this biosphere.'),
  chloride: m('chloride', 'Chloride', 'bulkMineralAssay', 200, 'Travels with sodium. Seawater is swimming in it.'),
  sulfur: m('sulfur', 'Sulfur', 'bulkMineralAssay', 100, 'Sits inside two amino acids, so protein mass carries it along.'),

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

/** Shorthand for a micronutrient entry. Caps are in grams. */
function m(id, name, revealedBy, baseCap, desc) {
  return {
    id,
    name,
    tier: 'micro',
    group: revealedBy,
    kjPerGram: 0, // minerals and vitamins yield no metabolisable energy
    baseCap,
    revealedBy,
    desc,
  };
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
