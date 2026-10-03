// Hive structures.
//
// Built out of nutrient mass, not an abstract currency — a Nerve Node costs
// actual protein and fat off the stores, which is why an early hive has to
// choose between growing and eating.
//
//   cost(n)      nutrient grams for the next unit, given n already built
//   caps         flat capacity added per unit, in grams
//   capMult      multiplicative capacity bonus per unit, by nutrient group
//   throughput   watts added to the metabolic ceiling
//   upkeepWatts  continuous energy draw per unit
//   slots        caste capacity added per unit
//   mult         multiplier channel bonuses per unit
//   digestion    grams of stored item mass broken down per second, per unit
//   itemCapMult  multiplicative bonus to every item's storage, per unit

const geo = (base, growth) => (n) => base * growth ** n;

export const STRUCTURES = {
  nodeCluster: {
    id: 'nodeCluster',
    name: 'Nerve Node',
    desc: 'Extra processing mass. Raises how many drones the hivemind can hold coherent at once.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(350, 1.3)(n), fat: geo(150, 1.3)(n) }),
    caps: { drones: 3 },
    upkeepWatts: 15,
  },
  gutSac: {
    id: 'gutSac',
    name: 'Gut Sac',
    desc: 'Bulk storage lining. Expands every macronutrient reserve the hive holds.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(400, 1.32)(n) }),
    capMult: { bulk: 0.5 },
    upkeepWatts: 5,
  },
  caecum: {
    id: 'caecum',
    name: 'Digestive Caecum',
    desc: 'A blind fermenting gut. Breaks whole harvest down into the nutrients it was made of — without enough of them, matter just piles up in storage.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(220, 1.28)(n), water: geo(500, 1.28)(n) }),
    digestion: 150,
    upkeepWatts: 10,
  },
  crop: {
    id: 'crop',
    name: 'Crop Chamber',
    desc: 'A muscular holding sac for matter the hive has gathered but not yet broken down. Harvest in excess of this spoils where it lies.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(260, 1.3)(n), fiber: geo(200, 1.3)(n) }),
    itemCapMult: 0.75,
    upkeepWatts: 4,
  },
  thermalVent: {
    id: 'thermalVent',
    name: 'Metabolic Core',
    desc: 'Oxidation chamber. Raises the ceiling on how fast the hive can burn mass for energy.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(500, 1.34)(n), fat: geo(250, 1.34)(n) }),
    throughput: 5000,
    upkeepWatts: 0,
  },
  assayChamber: {
    id: 'assayChamber',
    name: 'Assay Chamber',
    desc: 'Dedicated analysis tissue. Banks more insight and makes every analyst sharper.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(800, 1.35)(n), ash: geo(150, 1.35)(n) }),
    insightCap: 600,
    mult: { analyst: 0.2 },
    upkeepWatts: 40,
  },
  mineralVault: {
    id: 'mineralVault',
    name: 'Mineral Vault',
    desc: 'Sequestration cells for inorganic elements. Without these, assayed minerals spill as fast as they arrive.',
    unlock: (state) => state.tech.bulkMineralAssay,
    cost: (n) => ({ protein: geo(1100, 1.36)(n), ash: geo(500, 1.36)(n) }),
    capMult: { mineral: 1.0 },
    upkeepWatts: 25,
  },
  vitaminLattice: {
    id: 'vitaminLattice',
    name: 'Vitamin Lattice',
    desc: 'Stabilised organic scaffolding. Vitamins degrade in open storage; this is what stops them.',
    unlock: (state) => state.tech.lipidAssay,
    cost: (n) => ({ protein: geo(1600, 1.38)(n), fat: geo(500, 1.38)(n) }),
    capMult: { vitamin: 1.0 },
    upkeepWatts: 60,
  },
  boreShaft: {
    id: 'boreShaft',
    name: 'Bore Shaft',
    desc: 'A worked opening into the substrate. Each one supports an excavator at the face.',
    unlock: (state) => state.tech.lithovory,
    cost: (n) => ({ protein: geo(900, 1.3)(n), ash: geo(400, 1.3)(n) }),
    slots: { excavator: 1 },
    upkeepWatts: 20,
  },
  ambushBurrow: {
    id: 'ambushBurrow',
    name: 'Ambush Burrow',
    desc: 'A concealed approach onto a game trail. Each one supports one hunter in the field.',
    unlock: (state) => state.tech.predation,
    cost: (n) => ({ protein: geo(1800, 1.33)(n), fat: geo(600, 1.33)(n) }),
    slots: { hunter: 1 },
    mult: { hunter: 0.1 },
    upkeepWatts: 35,
  },
};

export const STRUCTURE_ORDER = [
  'nodeCluster',
  'caecum',
  'crop',
  'gutSac',
  'thermalVent',
  'assayChamber',
  'mineralVault',
  'vitaminLattice',
  'boreShaft',
  'ambushBurrow',
];
