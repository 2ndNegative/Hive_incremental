// The research ladder.
//
// Research is an instant purchase paid in insight, and sometimes in nutrient
// mass. Two kinds matter most:
//
//   ASSAYS reveal a group of micronutrients. The hive has been storing them
//   since the first bite — the assay is what lets it see the stockpile and
//   spend it. Finishing one is the closest thing this game has to a reveal.
//
//   METABOLIC techs change what the hive can burn. Cellulolysis is the big one:
//   fibre is 8 kJ/g sitting in every blade of grass and every plank of wood,
//   and until the hive can cleave the bonds, none of it is fuel.
//
// A `queue` field widens the build queue by that many slots — see engine.js
// buildQueueCap. The hive starts able to hold two jobs in mind at once.

export const RESEARCH = {
  glycolysis: {
    id: 'glycolysis',
    name: 'Glycolysis',
    desc: 'Refine the sugar-splitting pathway. Less mass burned per joule extracted.',
    requires: [],
    cost: { insight: 50 },
    efficiency: { carb: 0.25 },
    unlocks: ['+25% energy yield from carbohydrate'],
  },
  lipolysis: {
    id: 'lipolysis',
    name: 'Lipolysis',
    desc: 'Mobilise stored lipid properly instead of letting it sit inert.',
    requires: ['glycolysis'],
    cost: { insight: 140 },
    efficiency: { fat: 0.25 },
    unlocks: ['+25% energy yield from fat'],
  },
  bulkMineralAssay: {
    id: 'bulkMineralAssay',
    name: 'Bulk Mineral Assay',
    desc: 'Separate the mineral fraction into its elements. Everything eaten so far is still in there.',
    requires: ['glycolysis'],
    cost: { insight: 320 },
    unlocks: ['Reveals sodium, potassium, calcium, magnesium, phosphorus, chloride, sulfur', 'Mineral Vault'],
  },
  stigmergy: {
    id: 'stigmergy',
    name: 'Stigmergy',
    desc: 'Let the work carry its own instructions. A half-finished chamber tells the next drone what to do with it, so nothing has to be told twice.',
    requires: ['glycolysis'],
    cost: { insight: 260 },
    queue: 2,
    unlocks: ['+2 build queue slots'],
  },
  scavenging: {
    id: 'scavenging',
    name: 'Scavenging',
    desc: 'Tolerate the bacterial load in tissue that has already died. Opens a whole food web nobody is guarding.',
    requires: ['lipolysis'],
    cost: { insight: 480 },
    unlocks: ['Scavenger caste'],
  },
  cellulolysis: {
    id: 'cellulolysis',
    name: 'Cellulolysis',
    desc: 'Cleave the β-1,4 bond. Every plant on this world stops being ballast and becomes fuel.',
    requires: ['scavenging'],
    cost: { insight: 900, protein: 2000 },
    unlocks: ['Fibre becomes a usable energy source (8 kJ/g)'],
  },
  traceMetalAssay: {
    id: 'traceMetalAssay',
    name: 'Trace Metal Assay',
    desc: 'Resolve the transition metals out of the mineral fraction.',
    requires: ['bulkMineralAssay'],
    cost: { insight: 1200 },
    unlocks: ['Reveals iron, zinc, copper, manganese'],
  },
  nestPlanning: {
    id: 'nestPlanning',
    name: 'Nest Planning',
    desc: 'Hold the whole shape of the nest at once rather than the next chamber of it. The hive stops building what is in front of it and starts building what it will need.',
    requires: ['stigmergy', 'bulkMineralAssay'],
    cost: { insight: 1600 },
    queue: 4,
    unlocks: ['+4 build queue slots'],
  },
  lithovory: {
    id: 'lithovory',
    name: 'Lithovory',
    desc: 'Process inorganic substrate directly. No energy in stone — but the elements are not going anywhere.',
    requires: ['traceMetalAssay'],
    cost: { insight: 1800, ash: 1500 },
    unlocks: ['Excavator caste', 'Bore Shaft'],
  },
  predation: {
    id: 'predation',
    name: 'Predation',
    desc: 'Take prey while it is still moving. An order of magnitude more energy per gram than anything that grows.',
    requires: ['cellulolysis'],
    cost: { insight: 2600, protein: 4000, fat: 2000 },
    unlocks: ['Hunter caste', 'Ambush Burrow'],
  },
  lipidAssay: {
    id: 'lipidAssay',
    name: 'Lipid-Phase Assay',
    desc: 'Isolate what dissolves in the fat fraction. Liver turns out to have been carrying a great deal of it.',
    requires: ['traceMetalAssay'],
    cost: { insight: 3400 },
    unlocks: ['Reveals vitamins A, D, E and K', 'Vitamin Lattice'],
  },
  aqueousAssay: {
    id: 'aqueousAssay',
    name: 'Aqueous-Phase Assay',
    desc: 'Isolate what dissolves in water. Thirteen more compounds the hive has been discarding since the beginning.',
    requires: ['lipidAssay'],
    cost: { insight: 4800 },
    unlocks: ['Reveals vitamin C and the full B complex'],
  },
  rareElementAssay: {
    id: 'rareElementAssay',
    name: 'Rare Element Assay',
    desc: 'Detect elements present at parts per million. One nut and one seaweed turn out to be extraordinary.',
    requires: ['aqueousAssay'],
    cost: { insight: 6500, ash: 4000 },
    unlocks: ['Reveals selenium, iodine, chromium, molybdenum'],
  },
  ketogenesis: {
    id: 'ketogenesis',
    name: 'Ketogenesis',
    desc: 'Run the whole hive off lipid when nothing else is available. Protein stops being an emergency ration.',
    requires: ['predation', 'lipidAssay'],
    cost: { insight: 9000, fat: 6000 },
    efficiency: { fat: 0.3, protein: 0.2 },
    unlocks: ['+30% energy yield from fat', '+20% from protein'],
  },
};

export const RESEARCH_ORDER = [
  'glycolysis',
  'lipolysis',
  'bulkMineralAssay',
  'stigmergy',
  'scavenging',
  'cellulolysis',
  'traceMetalAssay',
  'nestPlanning',
  'lithovory',
  'predation',
  'lipidAssay',
  'aqueousAssay',
  'rareElementAssay',
  'ketogenesis',
];
