// Hive structures.
//
// ============================================================================
// SIXTEEN OF THESE ARE LIVE. The rest are PARKED pending the building rebuild.
//
// `STRUCTURE_ORDER` is the definition of live: the engine computes capacity,
// upkeep, slots and multipliers from the ids in that list and the Hive tab
// lists exactly those. Everything else in this file is kept rather than
// deleted, because much of it is adaptable — the capMult/slots/throughput shape
// and several of the buildings themselves are likely to survive in some form.
//
// `DEPRECATED_STRUCTURE_ORDER` still seeds `state.structures`, so an existing
// save round-trips its counts instead of silently losing them.
//
// To bring one back: give it a `category` from BUILDING_CATEGORIES, check its
// cost and `time` rungs still make sense, and move its id into
// STRUCTURE_ORDER.
// ============================================================================
//
// Built out of nutrient mass, not an abstract currency — a Nerve Node costs
// actual protein and fat off the stores, which is why an early hive has to
// choose between growing and eating.
//
//   cost(n)      nutrient grams for the next unit, given n already built. ALWAYS
//                written with build() from definitions/costs.js — a named growth
//                curve and a named amount per resource, never a number of grams.
//                WHICH resources a building costs stays a decision about that
//                building and is spelled out here in full; only the magnitudes
//                come from the ladder, so rebalancing "fibre is too tight" is
//                one line in costs.js rather than thirteen judgement calls
//                scattered through this file. Read the rules at the top of
//                costs.js before adding one.
//                NOTHING COSTS `ash`. Mineral mass is the bag the minerals are
//                hiding in, not a material: a cost names the element the thing
//                is actually made of, and payableCost charges it to the ash at
//                fifty times the amount until the hive has assayed it. build()
//                throws on `ash` rather than trusting this comment. Note the
//                multiplier when choosing the rung — `tiny` iron is 500 g of
//                mineral mass to a hive that cannot see iron yet.
//                MOSTLY FIBRE, always. Fibre is the hive's building material:
//                it is what the ground is actually made of (leaf litter is 68%
//                fibre, wood 87%), it carries no energy worth burning, and
//                almost nothing else wants it. Protein is the opposite — scarce
//                in everything the hive can reach, and wanted by the brood, by
//                drones and by every other system at once. When every building
//                was priced in protein, every decision in the game was the same
//                decision. So each one takes a lot of fibre and a little of
//                whatever else it is structurally made of.
//   time         how long the next one takes to grow, as a NAMED RUNG from
//                definitions/times.js — never a number of seconds. What the
//                rung names is a quantity of WORK; the hive gets through it at
//                `derived.buildPace`, so larvae make building faster and thirst
//                makes it slower, and the headline figure is the no-brood worst
//                case. It also compounds with how many the hive already has, on
//                the gentlest curve in the game: the fiftieth is 2.7× the
//                first, against fourteen million times the cost. Read the rules
//                at the top of times.js — rule 1 especially, because the whole
//                point is that COST gates and TIME only textures.
//   caps         flat capacity added per unit, in grams
//   capMult      multiplicative capacity bonus per unit, by nutrient group
//   throughput   watts added to the metabolic ceiling
//   insightCap   flat insight storage added per unit
//   insight      insight per second per unit. Scaled by how well the building
//                is being paid AND by cogitFocus — see engine.js: bandwidth the
//                hive is not spending on drones is bandwidth it thinks with.
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

import { build, AMOUNT } from './costs.js';
import { duration } from './times.js';
import { MICROS, MICRO_BASE_CAP, capGroupOf } from './nutrients.js';

/**
 * FLAT ROOM FOR EVERY MICRONUTRIENT IN ONE GROUP.
 *
 * A vault is responsible for a whole band of the table, not for one element, so
 * its storage map is derived from the band rather than written out. Twenty-odd
 * hand-typed lines per building is how the Hivecore's micro shelf came to be a
 * copy of a table in another file with six entries silently off by a factor of
 * ten — see MICRO_BASE_CAP in nutrients.js.
 *
 * Deliberately flat grams rather than a `capMult` multiplier. The vaults used
 * to double their group, which sounds generous and was worthless: doubling a
 * 2 g iron ceiling gives 4 g, against a Gizzard that costs 10 g. A multiplier
 * can only ever be as good as the base it multiplies. Tight Packing still
 * multiplies the result, because `capMult` applies to the total dedicated room
 * whatever supplied it.
 */
function groupStorage(group, grams) {
  const out = {};
  for (const id of MICROS) if (capGroupOf(id) === group) out[id] = grams;
  return out;
}

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
    cost: build('steep', { fiber: 'large', protein: 'small', fat: 'slight' }),
    time: 'glacial',
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
      // Every micronutrient gets the same shelf, and the reason is in
      // nutrients.js MICRO_BASE_CAP: a ceiling answers "can I hold what I must
      // spend", and the twenty-eight numbers that used to sit here answered a
      // nutritional question instead. One of them gave iron 2 g against a 10 g
      // cost.
      ...groupStorage('mineral', MICRO_BASE_CAP),
      ...groupStorage('vitamin', MICRO_BASE_CAP),
    },
    // Room for raw matter, shared across everything in the larder. Deliberately
    // small and deliberately unadvertised — the card says nothing about it,
    // because a player choosing to grow a Hivecore is not choosing a pantry.
    // It is there so the first forage has somewhere to land at all.
    itemStorage: 500,
    // PRICED IN FORAGERS. A forager brings 2.7 g/s of forest forage, which is
    // about 16 kW once a generator has opened it — so this is three foragers,
    // and a hive that cannot field three foragers has bigger problems. It used
    // to be five hundred kilowatts, which was thirty-one of them: a fixed cost
    // no small hive could ever pay, and the reason a fifteen-drone hive could
    // not keep itself alive.
    upkeepWatts: 50_000,
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
    cost: build('steady', { fiber: 'large', protein: 'modest', fat: 'slight' }),
    time: 'long',
    brood: { seconds: 20, cost: { protein: 60 }, yield: 1 },
    upkeepWatts: 25_000,
  },

  memoryBank: {
    id: 'memoryBank',
    name: 'Memory Bank',
    category: 'cognition',
    desc:
      'Laid-down tissue the hive writes into and does not overwrite. It works nothing out by '
      + 'itself — it is the difference between having had a thought and still having it, which '
      + 'is most of what the colony is short of.',
    unlock: () => true,
    cost: build('steady', { fiber: 'medium', potassium: 'tiny' }),
    time: 'long',
    insightCap: 400,
    upkeepWatts: 50_000,
  },

  interlocutor: {
    id: 'interlocutor',
    name: 'Interlocutor',
    category: 'cognition',
    desc:
      'Two knots of nervous tissue grown to disagree with each other. Nothing new comes in; the '
      + 'hive simply argues with itself about what it already has, and occasionally that is '
      + 'where an idea comes from.',
    unlock: () => true,
    cost: build('steady', { fiber: 'modest', protein: 'medium', potassium: 'slight' }),
    time: 'glacial',
    // Insight per second per unit, scaled by how well it is being paid and by
    // the bandwidth the hive has left over — see cogitFocus in engine.js.
    insight: 0.2,
    upkeepWatts: 100_000,
  },

  moldingChamber: {
    id: 'moldingChamber',
    name: 'Molding Chamber',
    category: 'production',
    desc:
      'A press of living cartilage. A larva goes in formless and comes out as something with a ' +
      'job. Switch a drone type on in the Drones tab and this is what makes it.',
    unlock: () => true,
    cost: build('steady', { fiber: 'large', protein: 'small', iron: 'tiny' }),
    time: 'long',
    upkeepWatts: 25_000, // idling, with nothing it is allowed to make
    activeWatts: 100_000, // pressing
    molding: { seconds: 20 },
  },

  nodeCluster: {
    id: 'nodeCluster',
    name: 'Nerve Node',
    category: 'cognition',
    desc:
      'A knot of processing mass grown off the core and wired back into it. It decides nothing by ' +
      'itself — it is simply more room to hold a thought in, and the hive is always short of that.',
    unlock: () => true,
    // Steeper than the storage buildings on purpose. Bandwidth is the ceiling
    // on the whole drone economy, so it should be bought a node at a time and
    // felt each time, not stacked twenty deep in one go.
    cost: build('steady', { fiber: 'large', protein: 'modest', fat: 'slight' }),
    time: 'middling',
    cogitCapacity: 5,
    // THE RULE THAT MAKES DRONES WORTH HAVING. Five cogits holds five drones
    // coherent, and five foragers earn about 80 kW. A node has to cost a
    // fraction of that or every drone added is a drone the hive loses energy
    // on — which is exactly what 250 kW did, at −34 kW a drone, and why hives
    // died the moment they grew.
    upkeepWatts: 20_000,
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
    cost: build('steady', { fiber: 'medium', protein: 'slight', water: 'modest' }),
    time: 'short',
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
    cost: build('gentle', { fiber: 'medium', protein: 'small', iron: 'tiny' }),
    time: 'short',
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
    cost: build('gentle', { fiber: 'medium', protein: 'small', fat: 'slight' }),
    time: 'short',
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
    cost: build('gentle', { fiber: 'medium', protein: 'small', carb: 'small' }),
    time: 'short',
    storage: { carb: 200 },
  },

  celluloseBale: {
    id: 'celluloseBale',
    name: 'Cellulose Bale',
    category: 'storage',
    desc:
      'Stripped plant fibre pressed flat and stacked against the wall. Not food and never will be ' +
      '— it is what the rest of the hive gets built out of, kept where it can be reached.',
    unlock: () => true,
    // THE ONE STORE THAT COMPETES WITH ITSELF. Every other dedicated store is
    // paid for in fibre and holds something else, so building one always leaves
    // the hive ahead. This one is paid for in the thing it holds, so it has to
    // hold more than it costs or it is a hole in the ground: 500 g of room for
    // 300 g of fibre is a net 200 g the first time, and the usual geometric
    // curve closes that gap soon enough to stop it being free forever.
    //
    // Bigger than the 200 g granules on purpose, too. Fibre is spent in
    // four-hundred-gram lumps, so a two-hundred-gram shelf of it would not even
    // hold one building's worth.
    cost: build('gentle', { fiber: 'medium', protein: 'small' }),
    time: 'short',
    storage: { fiber: 500 },
  },

  gizzard: {
    id: 'gizzard',
    name: 'Gizzard',
    category: 'storage',
    desc:
      'A muscular grinding chamber packed with swallowed grit. Holds the mineral fraction and '
      + 'nothing else — raw unsorted mass, exactly as it came out of the ground. Whatever the '
      + 'hive has since learned to pick out of it is kept somewhere more careful.',
    unlock: () => true,
    cost: build('gentle', { fiber: 'medium', protein: 'small', iron: 'tiny' }),
    time: 'short',
    // ASH ONLY, on purpose. `ash` is the unsorted mineral fraction; sodium,
    // iron and the rest are their own nutrients the moment an assay resolves
    // them, and they are not stored here. A hive that has assayed everything
    // still fills a gizzard with grit — the assay changes what the hive can
    // SEE in the mass, not where the mass sits. See the Mineral Vault for the
    // other half of the job, which widens the assayed minerals instead.
    storage: { ash: 1_000 },
  },

  cistern: {
    id: 'cistern',
    name: 'Cistern',
    category: 'storage',
    desc:
      'A sealed reservoir of standing water, grown deep and kept out of the sun. The hive is '
      + 'mostly water and loses it constantly; without somewhere to keep a reserve, a dry spell '
      + 'is felt in everything the colony does within the hour.',
    unlock: () => true,
    cost: build('gentle', { fiber: 'medium', protein: 'small' }),
    time: 'short',
    storage: { water: 10_000 },
    // Cheap to keep. It is a bag, not an organ.
    upkeepWatts: 5,
  },

  crop: {
    id: 'crop',
    name: 'Crop Chamber',
    category: 'storage',
    desc:
      'A muscular holding sac for matter the hive has gathered but not yet broken down. Harvest ' +
      'beyond what it can hold spoils where it lies.',
    unlock: () => true,
    cost: build('gentle', { fiber: 'large', protein: 'modest' }),
    time: 'short',
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
    cost: build('gentle', { fiber: 'medium', protein: 'small', iron: 'tiny' }),
    time: 'middling',
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
    cost: build('gentle', { fiber: 'large', protein: 'small', water: 'medium' }),
    time: 'middling',
    // Eighty grams a second, for nothing. Digestion is not a machine the hive
    // runs — it is a gut, and a gut works on what is in it. Charging watts for
    // it would make the opening unwinnable: a hive with no generator could not
    // digest, so it could not fuel a generator.
    digestion: 80,
    upkeepWatts: 0,
  },

  /* ------------------------------------------------------------- parked -- */
  //
  // NOTE ON THE WATTS BELOW: these are pre-rebuild figures, from when a whole
  // hive ran on a few hundred watts. Nothing reads them. Anything revived from
  // here needs repricing against the live scale first — see the Hivecore, which
  // explains what a watt is worth in foragers.

  gutSac: {
    id: 'gutSac',
    name: 'Gut Sac',
    desc: 'Bulk storage lining. Expands every macronutrient reserve the hive holds.',
    unlock: () => true,
    cost: build('gentle', { protein: 'large' }),
    time: 'short',
    capMult: { bulk: 0.5 },
    upkeepWatts: 5,
  },
  thermalVent: {
    id: 'thermalVent',
    name: 'Metabolic Core',
    desc: 'Oxidation chamber. Raises the ceiling on how fast the hive can burn mass for energy.',
    unlock: () => true,
    cost: build('steady', { protein: 'large', fat: 'medium' }),
    time: 'middling',
    throughput: 5000,
    upkeepWatts: 0,
  },
  assayChamber: {
    id: 'assayChamber',
    name: 'Assay Chamber',
    desc: 'Dedicated analysis tissue. Banks more insight and makes every analyst sharper.',
    unlock: () => true,
    cost: build('steady', { protein: 'heavy', iron: 'tiny' }),
    time: 'middling',
    insightCap: 600,
    mult: { analyst: 0.2 },
    upkeepWatts: 40,
  },
  mineralVault: {
    id: 'mineralVault',
    name: 'Mineral Vault',
    category: 'storage',
    desc: 'Sequestration cells for inorganic elements. Without these, assayed minerals spill as fast as they arrive.',
    unlock: (state) => state.tech.bulkMineralAssay,
    // NOT PRICED IN A MINERAL, and that is the whole lesson of this building.
    // It used to cost 25 g of iron against a 2 g iron ceiling: the thing that
    // raises the ceiling was priced above it, so the moment the Trace Metal
    // Assay made the cost real the building became unbuildable forever. A
    // store is never denominated in what it stores.
    //
    // Calcium is the exception that proves it — `tiny` is 10 g against a 50 g
    // shelf, so there is headroom by a factor of five, and a vault really is
    // built out of mineral. If MICRO_BASE_CAP ever drops below 20 g, this line
    // is the first thing that breaks.
    cost: build('gentle', { fiber: 'large', protein: 'small', calcium: 'tiny' }),
    time: 'short',
    storage: groupStorage('mineral', AMOUNT.medium),
  },
  vitaminLattice: {
    id: 'vitaminLattice',
    name: 'Vitamin Lattice',
    category: 'storage',
    desc: 'Stabilised organic scaffolding. Vitamins degrade in open storage; this is what stops them.',
    unlock: (state) => state.tech.lipidAssay,
    // Fat rather than a vitamin, for the reason above and because the
    // fat-soluble half of the table needs a lipid phase to sit in.
    cost: build('gentle', { fiber: 'medium', protein: 'small', fat: 'slight' }),
    time: 'middling',
    storage: groupStorage('vitamin', AMOUNT.medium),
  },
  boreShaft: {
    id: 'boreShaft',
    name: 'Bore Shaft',
    desc: 'A worked opening into the substrate. Each one supports an excavator at the face.',
    unlock: (state) => state.tech.lithovory,
    cost: build('gentle', { protein: 'heavy', iron: 'slight' }),
    time: 'middling',
    slots: { excavator: 1 },
    upkeepWatts: 20,
  },
  ambushBurrow: {
    id: 'ambushBurrow',
    name: 'Ambush Burrow',
    desc: 'A concealed approach onto a game trail. Each one supports one hunter in the field.',
    unlock: (state) => state.tech.predation,
    cost: build('steady', { protein: 'massive', fat: 'large' }),
    time: 'long',
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
  'nodeCluster',
  'memoryBank',
  'interlocutor',
  'moldingChamber',
  'metabolicGenerator',
  'caecum',
  'proteinGranule',
  'lipidDroplet',
  'glycogenGranule',
  'celluloseBale',
  'gizzard',
  'mineralVault',
  'vitaminLattice',
  'cistern',
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
  'gutSac',
  'thermalVent',
  'assayChamber',
  'boreShaft',
  'ambushBurrow',
];

/**
 * EVERY STRUCTURE DECLARES A BUILD TIME, checked here at module load.
 *
 * `cost` resolves its rungs eagerly inside build(), so a typo there is already
 * an error the first time the game starts. `time` is a bare string, so without
 * this it would be an error the first time somebody tried to build that one
 * building — and a missing rung is not even an error at that point, it is a
 * structure that goes up instantly. Loud, at load, is the right volume.
 *
 * Parked structures are checked too. One of them coming back should not also be
 * the moment its build time is discovered to be missing.
 */
for (const [id, def] of Object.entries(STRUCTURES)) {
  try {
    duration(def.time);
  } catch (err) {
    throw new Error(`Structure "${id}": ${err.message}`);
  }
}
