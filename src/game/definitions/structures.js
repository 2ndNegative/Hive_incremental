// Hive structures.
//
// ============================================================================
// THE WHOLE OF `STRUCTURES` BELOW IS PARKED PENDING THE BUILDING REBUILD.
//
// None of it is referenced by the game any more: `STRUCTURE_ORDER` is empty, so
// the engine computes no capacity, no upkeep, no slots and no multipliers from
// any of it, and the Hive tab lists none of it. It is kept, rather than
// deleted, because much of it is probably adaptable — the geometric cost curve,
// the capMult/slots/throughput shape and several of the buildings themselves
// are likely to survive the rebuild in some form.
//
// `DEPRECATED_STRUCTURE_ORDER` still seeds `state.structures`, so an existing
// save round-trips its counts instead of silently losing them.
//
// When the rebuild lands: give each surviving structure a `category` from
// BUILDING_CATEGORIES and move its id into STRUCTURE_ORDER.
// ============================================================================
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
//   itemCapMult  multiplicative bonus to the larder, per unit
//   storage      flat grams of room, by nutrient. The hive holds NOTHING on its
//                own — every nutrient's baseCap is zero — so this map is where
//                storage comes from, full stop. Granted once per thing standing:
//                five Gut Sacs give five times this, but a levelled building is
//                ONE thing however tall it is, so taking a Hivecore from level 1
//                to level 9 adds no room at all.
//   itemStorage  flat grams of room for RAW matter — the larder. One pool for
//                everything gathered and not yet broken down, not a shelf per
//                item: five hundred grams of room is five hundred grams whether
//                it is all acorns or nine different things. Granted per thing
//                standing, like `storage`.
//   digestion    grams of raw matter broken down into nutrients per second, per
//                unit. The hive has NONE of its own: without something that
//                declares this, everything gathered sits in the larder until
//                the larder is full and then spoils where it lies.
//   molding      { seconds } — turns one larva into one drone per cycle, of
//                whatever drones.js says is eligible. A chamber that is actually
//                pressing — something eligible AND a larva to press — draws
//                `activeWatts`; one with nothing to do idles at `upkeepWatts`.
//   activeWatts  what it draws while it has work. Falls back to upkeepWatts.
//   brood        { seconds, cost, yield } — a cycle this structure works through
//                at its own charge. When it completes it ATTEMPTS to pay `cost`
//                and lay `yield` larvae; an attempt it cannot pay for is lost.
//   generalStorage  flat grams of SHARED room, which anything may use. Last in,
//                first out: matter only reaches it once its own dedicated room
//                is full, and it is the first thing drawn back out. It is a
//                buffer for catching overflow, not a bigger cupboard.
//   cogitCapacity  cogits of cognitive bandwidth supplied per unit
//   cogitDraw      cogits occupied per unit while it stands
//   metabolism     grams per second this converts into usable energy
//
// WHAT POWER DOES TO ALL OF THIS
//   Every figure in the list above that is a BENEFIT is multiplied by the
//   structure's charge — see `state.power` and BROWNOUT_SECONDS in engine.js.
//   A building running at 40% gives 40% of its capacity, 40% of its slots, 40%
//   of its cogits and metabolises 40% as fast. Every figure that is a COST
//   (upkeepWatts, cogitDraw) is not: a dark building still asks for its watts,
//   which is exactly why it can come back when the power does.
//
// COUNTED OR LEVELLED
//   By default a structure is COUNTED: you grow more of them and the effects
//   add up. A structure with `leveled: true` is instead a single thing you
//   UPGRADE — `state.structures[id]` holds its level rather than how many you
//   have, 0 meaning not built. Effects still scale with that number, and
//   `cost(n)` is still the price of going from n to n+1, so the arithmetic is
//   identical; what changes is what the interface says and the fact that you
//   cannot have two. `maxLevel` caps it.

const geo = (base, growth) => (n) => base * growth ** n;

export const STRUCTURES = {
  /* ------------------------------------------------------------------ live -- */

  hivecore: {
    id: 'hivecore',
    name: 'Hivecore',
    category: 'core',
    leveled: true,
    maxLevel: 20,
    desc:
      'The mind itself: a dense knot of nervous tissue the rest of the hive is grown around. ' +
      'The first of it brings a body with somewhere to put things; every level after that widens ' +
      'what the hivemind can hold in flight at once — and costs a great deal to keep lit.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(150, 1.6)(n), fat: geo(60, 1.6)(n) }),
    cogitCapacity: 5,

    // THE HIVE'S ONLY STORAGE.
    //
    // A body has to be grown before it has anywhere to put anything, and for
    // now the core is the whole of that body. Flat, and granted for having a
    // Hivecore at all — levelling it up widens what the hive can think, not
    // what it can hold. Something in the Storage band will have to do that.
    storage: {
      water: 20_000,
      protein: 2_000,
      fat: 2_000,
      carb: 2_000,
      fiber: 2_000,
      ethanol: 200,
      ash: 4_000,
      sodium: 20,
      potassium: 20,
      calcium: 40,
      magnesium: 10,
      phosphorus: 30,
      chloride: 20,
      sulfur: 10,
      iron: 2,
      zinc: 2,
      copper: 1,
      manganese: 1,
      selenium: 0.05,
      iodine: 0.05,
      chromium: 0.02,
      molybdenum: 0.02,
      vitaminA: 0.2,
      vitaminD: 0.02,
      vitaminE: 1,
      vitaminK: 0.1,
      vitaminC: 2,
      vitaminB1: 0.2,
      vitaminB2: 0.2,
      vitaminB3: 1,
      vitaminB5: 0.5,
      vitaminB6: 0.2,
      vitaminB7: 0.05,
      vitaminB9: 0.1,
      vitaminB12: 0.02,
    },
    // Room for raw matter, shared across everything in the larder. Deliberately
    // small and deliberately unadvertised — the card says nothing about it,
    // because a player choosing to grow a Hivecore is not choosing a pantry.
    // It is there so the first forage has somewhere to land at all.
    itemStorage: 500,
    // 1 MJ every second. Nothing else in the game is close, and nothing in the
    // game can pay for it without generators.
    upkeepWatts: 1_000_000,
  },

  broodChamber: {
    id: 'broodChamber',
    name: 'Brood Chamber',
    category: 'core',
    desc:
      'A warm blind cell the hive packs with protein and leaves to do what protein does. What ' +
      'comes out is not yet anything — it only eats, and waits to be told what it is for. Stop ' +
      'feeding it and it stops being anything at all, quickly.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(260, 1.4)(n), fat: geo(90, 1.4)(n) }),
    brood: { seconds: 20, cost: { protein: 120 }, yield: 1 },
    upkeepWatts: 250_000,
  },

  moldingChamber: {
    id: 'moldingChamber',
    name: 'Molding Chamber',
    category: 'production',
    desc:
      'A press of living cartilage. A larva goes in formless and comes out as something with a ' +
      'job. Switch a drone type on in the Drones tab and this is what makes it.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(180, 1.35)(n), ash: geo(90, 1.35)(n) }),
    upkeepWatts: 100_000, // idling, with nothing it is allowed to make
    activeWatts: 500_000, // pressing
    molding: { seconds: 20 },
  },

  vacuole: {
    id: 'vacuole',
    name: 'Vacuole',
    category: 'storage',
    desc:
      'A slack membrane sac that holds whatever is pushed into it. It keeps nothing in particular ' +
      'and everything in general: when a dedicated store overflows, this is what catches it — and ' +
      'it is the first thing the hive empties again.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(90, 1.35)(n), water: geo(400, 1.35)(n) }),
    generalStorage: 1_000, // grams, shared across every nutrient
  },

  proteinGranule: {
    id: 'proteinGranule',
    name: 'Protein Granule',
    category: 'storage',
    desc:
      'Dense packed amino acid, laid down in a shell the hive can break open again. Holds nothing ' +
      'but protein, and holds it far better than anything that holds everything.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(140, 1.4)(n), ash: geo(40, 1.4)(n) }),
    storage: { protein: 200 },
  },

  lipidDroplet: {
    id: 'lipidDroplet',
    name: 'Lipid Droplet',
    category: 'storage',
    desc:
      'A bead of rendered fat held in a skin of its own making. The densest thing the hive can ' +
      'keep, and the cheapest to keep it in — fat needs no water around it.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(120, 1.4)(n), fat: geo(60, 1.4)(n) }),
    storage: { fat: 200 },
  },

  glycogenGranule: {
    id: 'glycogenGranule',
    name: 'Glycogen Granule',
    category: 'storage',
    desc:
      'Sugar wound into a branched knot so it can be packed away and pulled back out in a hurry. ' +
      'What the brood eats comes out of here.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(120, 1.4)(n), carb: geo(120, 1.4)(n) }),
    storage: { carb: 200 },
  },

  crop: {
    id: 'crop',
    name: 'Crop Chamber',
    category: 'storage',
    desc:
      'A muscular holding sac for matter the hive has gathered but not yet broken down. Harvest ' +
      'beyond what it can hold spoils where it lies.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(260, 1.3)(n), fiber: geo(200, 1.3)(n) }),
    itemStorage: 2_000,
  },

  metabolicGenerator: {
    id: 'metabolicGenerator',
    name: 'Metabolic Generator',
    category: 'digestion',
    desc:
      'An oxidation bed. Draws on the nutrient stores and turns their mass into energy the hive ' +
      'can actually spend — the only thing in the hive that can. Without one, stored matter is ' +
      'just matter.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(120, 1.25)(n), ash: geo(60, 1.25)(n) }),
    metabolism: 10, // grams per second
  },

  caecum: {
    id: 'caecum',
    name: 'Digestive Caecum',
    category: 'digestion',
    desc:
      'A blind fermenting gut. Breaks whole harvest down into the nutrients it was made of — ' +
      'without one, everything gathered simply piles up in the larder and rots there.',
    unlock: () => true,
    cost: (n) => ({ protein: geo(220, 1.28)(n), water: geo(500, 1.28)(n) }),
    // Eighty grams a second, for nothing. Digestion is not a machine the hive
    // runs — it is a gut, and a gut works on what is in it. Charging watts for
    // it would make the opening unwinnable: a hive with no generator could not
    // digest, so it could not fuel a generator.
    digestion: 80,
    upkeepWatts: 0,
  },

  /* ------------------------------------------------------------- parked -- */

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

/**
 * The bands the Hive tab is organised into, in display order.
 *
 * Every structure the rebuild produces names one of these in its `category`.
 * A band with nothing in it still shows — an empty Cognition band is a better
 * answer to "where does thinking come from" than no band at all.
 */
export const BUILDING_CATEGORIES = {
  core: {
    id: 'core',
    name: 'Core',
    desc: 'The hive itself. What everything else is grown onto, and what dies if it does.',
  },
  cognition: {
    id: 'cognition',
    name: 'Cognition',
    desc: 'Thinking mass. How much the hivemind can hold coherent at once, and how fast it works anything out.',
  },
  gathering: {
    id: 'gathering',
    name: 'Gathering',
    desc: 'Reaching matter where it lies — and holding the ground it lies on.',
  },
  production: {
    id: 'production',
    name: 'Production',
    desc: 'Turning what the hive has into something it would rather have.',
  },
  digestion: {
    id: 'digestion',
    name: 'Digestion',
    desc: 'Breaking whole matter down into the nutrients it was made of.',
  },
  storage: {
    id: 'storage',
    name: 'Storage',
    desc: 'Holding it. Nothing the hive cannot keep is worth the energy of fetching.',
  },
};

export const BUILDING_CATEGORY_ORDER = ['core', 'cognition', 'gathering', 'production', 'digestion', 'storage'];

/**
 * Buildable structures. EMPTY during the rebuild — see the header.
 * Everything the engine and the interface iterate comes from here.
 */
export const STRUCTURE_ORDER = [
  'hivecore',
  'broodChamber',
  'moldingChamber',
  'metabolicGenerator',
  'caecum',
  'proteinGranule',
  'lipidDroplet',
  'glycogenGranule',
  'crop',
  'vacuole',
];

/**
 * The order energy is handed out in when there is not enough of it.
 *
 * Band by band from the top of the Hive tab, and inside a band in the order the
 * cards are laid out — which is STRUCTURE_ORDER, so reading the screen top to
 * bottom and left to right reads the priority list. The Core is kept lit before
 * Cognition, Cognition before Gathering, and so on down; whatever the supply
 * runs out on browns out, and everything below it goes dark.
 *
 * Anything whose `category` is not a known band is appended at the end rather
 * than dropped, so a mis-filed building loses its power first instead of
 * silently never being billed for it. The Hive tab flags the same mistake.
 */
export function powerPriority() {
  return [
    ...BUILDING_CATEGORY_ORDER.flatMap((category) =>
      STRUCTURE_ORDER.filter((id) => STRUCTURES[id].category === category),
    ),
    ...STRUCTURE_ORDER.filter((id) => !BUILDING_CATEGORIES[STRUCTURES[id].category]),
  ];
}

/** Is this one thing you upgrade, rather than many things you grow? */
export function isLeveled(id) {
  return Boolean(STRUCTURES[id]?.leveled);
}

/** The cap on a levelled structure; counted ones have none. */
export function maxLevelOf(id) {
  return STRUCTURES[id]?.maxLevel ?? Infinity;
}

/**
 * Parked. Not built, not displayed, not computed — but still seeded into
 * `state.structures` so an existing save keeps its counts for whenever one of
 * these comes back.
 */
export const DEPRECATED_STRUCTURE_ORDER = [
  'nodeCluster',
  'gutSac',
  'thermalVent',
  'assayChamber',
  'mineralVault',
  'vitaminLattice',
  'boreShaft',
  'ambushBurrow',
];
