// The research ladder.
//
// Research is an instant purchase paid in insight, and sometimes in nutrient
// mass. Two kinds matter most:
//
//   ASSAYS reveal a group of micronutrients. The hive has been storing them
//   since the first bite — the assay is what lets it see the stockpile and
//   spend it. Finishing one is the closest thing this game has to a reveal.
//
//   EFFICIENCY techs state the fraction of a fuel the hive recovers, and they
//   only ever move it UP TOWARDS 1. Every fuel starts wasteful (nutrients.js
//   burnBase) and research buys the waste back; nothing can take a gram past
//   what the gram contains. The number here IS the efficiency, not a bonus.
//
//   METABOLIC techs change what the hive can burn. Cellulolysis is the big one:
//   fibre is 8 kJ/g sitting in every blade of grass and every plank of wood,
//   and until the hive can cleave the bonds, none of it is fuel.
//
// A `queue` field widens the build queue by that many slots — see engine.js
// buildQueueCap, where BUILD_QUEUE_BASE says how many the hive starts with.
//
// A `grants` field hands over buildings, free, the moment the tech lands:
// `grants: { mineralVault: 1 }`. It exists for one specific shape of problem —
// a tech that CREATES a need for a building. The assays are the case: before
// one, the hive pays for minerals in mineral mass and holds them easily; after
// it, the cost is real elements against real element shelves, and a hive that
// researched before building anything would find the cure priced above the
// ceiling it raises. The tech that opens the hole supplies the first patch.
//
// It is not a reward mechanism and should not become one. If a tech grants
// something the player could simply have built, the right change is to the
// price of the building.
//
// COSTS ARE NAMED RUNGS, through tech() — insight against the INSIGHT ladder in
// costs.js, mass against AMOUNT. Research was the last table in the game still
// carrying hand-written numbers, and the two priced in `ash` were breaking a
// rule the rest of the codebase throws on. See the INSIGHT block in costs.js.

import { tech } from './costs.js';

export const RESEARCH = {
  glycolysis: {
    id: 'glycolysis',
    name: 'Glycolysis',
    desc: 'Refine the sugar-splitting pathway. A quarter of every gram was going out as heat; most of that is recoverable.',
    requires: [],
    cost: tech({ insight: 'glimmer' }),
    // The efficiency a tech REACHES, not a bonus it adds — see computeEfficiency.
    // Sugar starts at 0.60, so this is a quarter more energy out of the same mass.
    efficiency: { carb: 0.75 },
    unlocks: ['Carbohydrate burns at 75% rather than 60%'],
  },
  lipolysis: {
    id: 'lipolysis',
    name: 'Lipolysis',
    desc: 'Mobilise stored lipid properly instead of letting it sit inert. Most of what the hive was wasting on fat, it stops wasting.',
    requires: ['glycolysis'],
    cost: tech({ insight: 'inkling' }),
    // Fat starts at 0.70. A quarter more out of the same gram.
    efficiency: { fat: 0.875 },
    unlocks: ['Fat burns at 87.5% rather than 70%'],
  },
  bulkMineralAssay: {
    id: 'bulkMineralAssay',
    name: 'Bulk Mineral Assay',
    desc: 'Separate the mineral fraction into its elements. Everything eaten so far is still in there.',
    requires: ['glycolysis'],
    cost: tech({ insight: 'notion' }),
    grants: { mineralVault: 1 },
    unlocks: ['Reveals sodium, potassium, calcium, magnesium, phosphorus, chloride, sulfur', 'Mineral Vault'],
  },
  stigmergy: {
    id: 'stigmergy',
    name: 'Stigmergy',
    desc: 'Let the work carry its own instructions. A half-finished chamber tells the next drone what to do with it, so nothing has to be told twice.',
    requires: ['glycolysis'],
    cost: tech({ insight: 'notion' }),
    queue: 2,
    unlocks: ['+2 build queue slots'],
  },

  tightPacking: {
    id: 'tightPacking',
    name: 'Tight Packing',
    desc:
      'Stack the stores the way a seed head stacks its seeds. The same cell wall, '
      + 'wrapped closer, holds half again as much before it has to spill.',
    requires: ['stigmergy'],
    // INSIGHT ONLY, and that is the whole point of where it sits.
    //
    // This tech exists to widen a wall the hive hits in FIBRE. Pricing it in
    // fibre would mean the cure gets harder to afford exactly as the disease
    // gets worse, and a hive that had already run out of room could not buy the
    // thing that gives it room. A fix for a bottleneck is never denominated in
    // the bottleneck.
    cost: tech({ insight: 'concept' }),
    // All three cap groups, which together are every DEDICATED shelf in the
    // game. The general pool is sized separately and deliberately untouched —
    // see structures.js generalStorage: it is a buffer for catching overflow,
    // and making it bigger would turn it into the bigger cupboard it is not
    // supposed to be.
    mult: { storage: 0.5, mineralStorage: 0.5, vitaminStorage: 0.5 },
    unlocks: ['+50% dedicated storage'],
  },
  scavenging: {
    id: 'scavenging',
    name: 'Scavenging',
    desc: 'Tolerate the bacterial load in tissue that has already died. Opens a whole food web nobody is guarding.',
    requires: ['lipolysis'],
    cost: tech({ insight: 'concept' }),
    unlocks: ['Scavenger caste'],
  },
  cellulolysis: {
    id: 'cellulolysis',
    name: 'Cellulolysis',
    desc: 'Cleave the β-1,4 bond. Every plant on this world stops being ballast and becomes fuel.',
    requires: ['scavenging'],
    cost: tech({ insight: 'theory', protein: 'massive' }),
    unlocks: ['Fibre becomes a usable energy source (8 kJ/g)'],
  },
  traceMetalAssay: {
    id: 'traceMetalAssay',
    name: 'Trace Metal Assay',
    desc: 'Resolve the transition metals out of the mineral fraction.',
    requires: ['bulkMineralAssay'],
    cost: tech({ insight: 'theory' }),
    unlocks: ['Reveals iron, zinc, copper, manganese'],
  },
  nestPlanning: {
    id: 'nestPlanning',
    name: 'Nest Planning',
    desc: 'Hold the whole shape of the nest at once rather than the next chamber of it. The hive stops building what is in front of it and starts building what it will need.',
    requires: ['stigmergy', 'bulkMineralAssay'],
    cost: tech({ insight: 'theory' }),
    queue: 4,
    unlocks: ['+4 build queue slots'],
  },
  // PARKED — not in RESEARCH_ORDER. Everything it unlocks (the Excavator caste and the Bore Shaft)
  // is parked for the rebuild, so this would buy the player nothing.
  lithovory: {
    id: 'lithovory',
    name: 'Lithovory',
    desc: 'Process inorganic substrate directly. No energy in stone — but the elements are not going anywhere.',
    requires: ['traceMetalAssay'],
    cost: tech({ insight: 'doctrine', ash: 'heavy' }, { sampling: true }),
    unlocks: ['Excavator caste', 'Bore Shaft'],
  },
  // PARKED — not in RESEARCH_ORDER. Everything it unlocks (the Hunter caste and the Ambush Burrow)
  // is parked for the rebuild, so this would buy the player nothing.
  predation: {
    id: 'predation',
    name: 'Predation',
    desc: 'Take prey while it is still moving. An order of magnitude more energy per gram than anything that grows.',
    requires: ['cellulolysis'],
    cost: tech({ insight: 'doctrine', protein: 'colossal', fat: 'massive' }),
    unlocks: ['Hunter caste', 'Ambush Burrow'],
  },
  lipidAssay: {
    id: 'lipidAssay',
    name: 'Lipid-Phase Assay',
    desc: 'Isolate what dissolves in the fat fraction. Liver turns out to have been carrying a great deal of it.',
    requires: ['traceMetalAssay'],
    cost: tech({ insight: 'doctrine' }),
    grants: { vitaminLattice: 1 },
    unlocks: ['Reveals vitamins A, D, E and K', 'Vitamin Lattice'],
  },
  aqueousAssay: {
    id: 'aqueousAssay',
    name: 'Aqueous-Phase Assay',
    desc: 'Isolate what dissolves in water. Thirteen more compounds the hive has been discarding since the beginning.',
    requires: ['lipidAssay'],
    cost: tech({ insight: 'synthesis' }),
    unlocks: ['Reveals vitamin C and the full B complex'],
  },
  rareElementAssay: {
    id: 'rareElementAssay',
    name: 'Rare Element Assay',
    desc: 'Detect elements present at parts per million. One nut and one seaweed turn out to be extraordinary.',
    requires: ['aqueousAssay'],
    cost: tech({ insight: 'synthesis', ash: 'colossal' }, { sampling: true }),
    unlocks: ['Reveals selenium, iodine, chromium, molybdenum'],
  },
  ketogenesis: {
    id: 'ketogenesis',
    name: 'Ketogenesis',
    desc:
      'Run the whole hive off lipid, and finish the job: not one joule in a gram of fat is left '
      + 'on the table. Protein stops being an emergency ration.',
    // Re-pointed off Predation, which is parked with the Hunter caste. This has
    // nothing to do with hunting — it is the end of the fat line, and it now has
    // a job worth reaching: it is the only thing in the game that takes a fuel
    // all the way to the limit.
    requires: ['lipolysis', 'lipidAssay'],
    cost: tech({ insight: 'paradigm', fat: 'colossal' }),
    // THE CEILING. Fat is burned perfectly — nothing can go higher, because a
    // gram of fat is 37 kJ and that is all it is.
    efficiency: { fat: 1, protein: 0.84 },
    unlocks: ['Fat burns perfectly — 100%, the limit', 'Protein burns at 84% rather than 70%'],
  },
};

/**
 * The ladder, in order. A tech that is DEFINED above but not listed here is
 * parked: nothing shows it, nothing can buy it, and `state.tech` round-trips it
 * if an old save has it. Lithovory and Predation are parked because everything
 * they unlock — the Excavator and Hunter castes, the Bore Shaft, the Ambush
 * Burrow — is itself parked for the rebuild, and a tech whose entire reward is
 * a promise the game cannot keep is worse than no tech at all.
 *
 */
export const RESEARCH_ORDER = [
  'glycolysis',
  'lipolysis',
  'bulkMineralAssay',
  'stigmergy',
  'tightPacking',
  'scavenging',
  'cellulolysis',
  'traceMetalAssay',
  'nestPlanning',
  'lipidAssay',
  'aqueousAssay',
  'rareElementAssay',
  'ketogenesis',
];
