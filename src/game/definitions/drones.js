// Drones: castes, and the types inside them.
//
// ============================================================================
// PART BUILT. A type can be MADE, it occupies bandwidth, and it can work.
//
// A Molding Chamber turns a larva into one of these on a twenty-second cycle.
// What it makes is the first ELIGIBLE type in declared order: switched on, and
// under its target if it has one. A chamber with nothing eligible — or nothing
// in the brood to press — is idle, and costs the lower of its two draws.
// A drone that exists costs `cogitDraw` cogits for as long as it exists, and a
// drone with a `gather` route brings matter home. It still has no energy
// upkeep and no appetite of its own: those arrive with the rest of the rebuild.
// ============================================================================
//
// THE MODEL
// A CASTE is a kind of drone: a body plan, a role in the hive, a band on the
// Drones tab. A TYPE is a specific drone within that caste. The same shape the
// Hive tab uses for buildings — BUILDING_CATEGORIES to STRUCTURES is
// DRONE_CASTES to DRONE_TYPES — because the two screens should read the same
// way and a player who has learned one has learned the other.
//
// This is NOT the old `castes.js`, which is a flat list of jobs a drone could
// be assigned to and is parked pending this rebuild. The old file keeps its
// definitions; nothing here reads them.
//
// WHAT A TYPE DECLARES
//   caste        the band it belongs to, from DRONE_CASTES
//   cost         what a Molding Chamber spends to press one.  READ. Written
//                with flat() from definitions/costs.js — a named amount per
//                resource off the shared ladder, never a number of grams. No
//                growth curve: the hundredth forager costs what the first did.
//                A cost in a nutrient the hive has not assayed yet is charged
//                to its parent macro at fifty times the amount — see
//                payableCost in definitions/nutrients.js. The hive can want
//                phosphorus before it can find phosphorus; it just pays in ash
//                until it can.
//   cogitDraw    cogits one of them occupies, working or not.  READ
//   gather       which forage route it works, as the old castes did.  READ
//   load         grams one of them carries home per trip, as { min, max }
//                — rolled fresh every trip.  READ
//   range        square metres of ONE BIOME this drone needs to work at full
//                rate. See the range table below.  READ
//   crowding     how badly it minds company, off the CROWDING ladder.  READ
//   upkeepWatts  what it draws while it lives.  NOT READ YET
//   eats         what it consumes, and how fast.  NOT READ YET
//
// WHY A LOAD RATHER THAN A RATE
// The old castes declared `harvestRate`, grams per second, and a drone was a
// tap that ran at a constant pressure. A drone is not a tap: it walks out,
// picks something up and walks back, and how much it manages to carry is not
// the same every time. So a type declares what one TRIP is worth and the
// forage cycle decides how often a trip lands — see forage.js, which rolls the
// weight at the same moment it rolls the find. The rate the interface shows is
// that load spread over the cycle, which is the honest average of a thing that
// actually arrives in parcels.

import { flat } from './costs.js';

/* ------------------------------------------------- how much ground one needs */

/**
 * RANGE, AND WHY A PATCH IS NOW A DRONE.
 *
 * The old model divided the land into patches of 36 m² and put a share of the
 * drones on each. That 36 was the Anthill's starting territory and nothing
 * else — the patch size was the opening tile, chosen once and then reasoned
 * backwards from. It also meant land never constrained anything: at 2.5 m² a
 * forager, 540 m² carried 216 of them, and cognition caps the hive two orders
 * of magnitude below that.
 *
 * So the unit is now the drone. A patch is the ground ONE drone works, its size
 * is declared by the type, and capacity is counted per BIOME rather than
 * pooled. That last part is where the decision lives: the hive does not run out
 * of land, it runs out of *farmland*, and 90 m² of it holds twenty foragers or
 * two hunters but not both.
 *
 * RANGE IS A STATEMENT ABOUT THE BODY. A gatherer works the ground it is
 * standing on. A scavenger has to find something that has already died, which
 * means covering more of it. A hunter needs a predator's home range, which is
 * the reason there are not many predators anywhere.
 *
 *   route       range   crowding       drone
 *   forager       4 m²  tolerant       Forager            BUILT
 *   scavenger    14 m²  touchy         Scavenger          BUILT
 *   excavator    10 m²  even           — not built yet
 *   siphon       25 m²  territorial    — not built yet
 *   hunter       50 m²  solitary       — not built yet
 *
 * The bottom three have no drone to work them. Their forage tables are complete
 * (119 huntable items plus the prey organisms, 13 excavated, 4 siphoned) and
 * the figures above are what those drones will declare when they exist —
 * written down here rather than invented later, so the balance of the whole
 * table can be read in one place. A hunter in particular needs the carcass-into-
 * cuts path wired through the drone route before it can exist at all; today
 * only the parked hunter CASTE rolls prey.
 */

/**
 * HOW BADLY A DRONE MINDS COMPANY.
 *
 * Efficiency per drone is `min(1, slots / drones) ** crowding`, where `slots` is
 * the biome's area over the type's range. At or under its room every drone
 * works at full rate; over it, each one loses ground, and this exponent says
 * how fast.
 *
 * ONE NUMBER, TWO SHAPES. Below 1 the curve is concave: a crowded forager is
 * merely inefficient, and total intake still rises as you add more, because
 * there is always another bush. At 1 the total simply caps — ten scavengers on
 * one carcass bring back one carcass. Above 1 the total FALLS: two hunters
 * inside one home range do not split the prey, they drive it off, and the
 * second one costs the hive the first one's dinner.
 *
 * Which is what makes a sliver of ground type-dependent rather than just small.
 * Two square metres of farmland is half a forager's range — one forager at 71%,
 * worth having. It is a twenty-fifth of a hunter's, which at `solitary` is
 * 0.0003 of a hunter: not a bad deal, not a deal at all. The hive cannot nibble
 * its way to a hunting ground; it has to take one.
 */
export const CROWDING = {
  tolerant: 0.5,
  even: 1,
  touchy: 1.5,
  territorial: 2.5,
  solitary: 4,
};

export const DRONE_CASTES = {
  worker: {
    id: 'worker',
    name: 'Worker',
    desc: 'The hive\'s hands. Everything that fetches, carries, digs or builds.',
  },
};

/** Band order on the Drones tab. */
export const DRONE_CASTE_ORDER = ['worker'];

export const DRONE_TYPES = {
  forager: {
    id: 'forager',
    name: 'Forager',
    caste: 'worker',
    desc:
      'Goes out, finds something, brings it back. The simplest thing the hive can grow that is ' +
      'worth growing — and the one every other drone is a specialisation of.',
    // One cogit each. The hive has to hold a drone in mind for it to stay
    // coherent, and that room is occupied whether the drone is doing anything
    // or not — and a chamber will not press one the hive has no room for.
    cogitDraw: 1,
    // Pressed out of a larva and a little fat. Cheap, because a Forager is the
    // thing a hive makes when it has nothing else to make.
    cost: flat({ fat: 'minuscule' }),
    // The ground-vegetation route, the same one the parked forager caste worked
    // and the same one a manual gather draws on.
    gather: 'forager',
    // Grams per trip, rolled per trip.
    load: { min: 20, max: 45 },
    // Four square metres, and it barely minds sharing them. Standing vegetation
    // is the one thing there is always more of — two foragers on one bush is
    // two foragers picking slightly slower, not one of them going hungry.
    range: 4,
    crowding: CROWDING.tolerant,
    unlock: () => true,
  },

  scavenger: {
    id: 'scavenger',
    name: 'Scavenger',
    caste: 'worker',
    desc:
      'Works what has already died. Brings back no more mass than a Forager and far more out of ' +
      'it — carrion is fat and protein where standing vegetation is water and fibre. Nothing it ' +
      'takes puts up a fight.',
    cogitDraw: 1,
    // Phosphorus, which the hive cannot see yet: until the assay is run this is
    // charged as 250 g of mineral mass instead. Expensive on purpose — the
    // scavenger route is worth far more per gram than the forager one.
    cost: flat({ phosphorus: 'minuscule' }),
    gather: 'scavenger',
    load: { min: 20, max: 45 },
    // Three and a half times a forager's ground, because carrion is an EVENT
    // rather than a crop: it has to be come across, and the only way to come
    // across more of it is to cover more ground. And a carcass does not divide
    // — past the point where the ground is covered, another scavenger is
    // another mouth at the same body, so the total caps rather than climbing.
    range: 14,
    crowding: CROWDING.touchy,
    // Behind Scavenging, as the research has always claimed. Eating what died
    // on its own is a tolerance the hive has to evolve — the bacterial load in
    // tissue that has already gone over is the whole reason nothing else is
    // competing for it.
    unlock: (state) => Boolean(state.tech?.scavenging),
  },

  explorer: {
    id: 'explorer',
    name: 'Explorer',
    caste: 'worker',
    desc:
      'Goes out past the edge of what the hive holds and maps what is there. Brings back ground ' +
      'more often than food and nothing at all more often than either — and sometimes does not ' +
      'come back. The only way the hive learns there is anywhere else.',
    cogitDraw: 1,
    // Manganese is unassayed at the start, so this is really 250 g of mineral
    // mass until the hive can tell manganese from the rest of the ash.
    cost: flat({ fat: 'medium', manganese: 'minuscule', water: 'medium' }),
    // NOT a gather route: an expedition is a one-shot roll with several very
    // different outcomes, not a trip with a weight. See engine.js.
    expedition: {
      seconds: 90,
      // Ground already held is ground already walked, so the same expedition
      // covers proportionally less of it. A hive ten times the size needs ten
      // times the explorers to map at the same rate.
      scaleArea: 36,
    },
    unlock: () => true,
  },
};

/** Display order within a caste, and the order the engine will iterate. */
export const DRONE_TYPE_ORDER = ['forager', 'scavenger', 'explorer'];

/**
 * What the molding chambers should make next, or null if there is nothing they
 * are allowed to make.
 *
 * FIRST ELIGIBLE IN DECLARED ORDER, not round-robin and not random: the player
 * sets what they want with the switches and the targets, and the order they are
 * declared in is the tie-break. Predictable beats clever — a chamber that
 * alternates between two types is one the player cannot reason about.
 *
 * Eligible means: switched on, unlocked, and under its target. No target at all
 * means no ceiling.
 */
export function nextMoldable(state, free = Infinity) {
  for (const id of DRONE_TYPE_ORDER) {
    const def = DRONE_TYPES[id];
    if (!def || !def.unlock(state)) continue;
    const want = state.droneMolding?.[id];
    if (!want?.on) continue;
    const target = want.target;
    if (target !== null && target !== undefined && (state.droneTypes?.[id] || 0) >= target) continue;
    // A drone the hive cannot hold in mind is not a drone, it is a loss. The
    // chamber waits rather than pressing one.
    if ((def.cogitDraw || 0) > free + 1e-9) continue;
    return id;
  }
  return null;
}

/** Why a type is not being made, for the row to say so. */
export function moldStatus(state, id, free = Infinity) {
  const def = DRONE_TYPES[id];
  if (!def) return 'unknown';
  const want = state.droneMolding?.[id];
  if (!want?.on) return 'off';
  const target = want.target;
  if (target !== null && target !== undefined && (state.droneTypes?.[id] || 0) >= target) {
    return 'at target';
  }
  if ((def.cogitDraw || 0) > free + 1e-9) return 'no bandwidth';
  if (nextMoldable(state, free) !== id) return 'queued';
  // Allowed, first in line, and nothing to press. The chamber idles at its
  // lower draw while this is true, so the row should not claim it is working.
  return (state.larvae || 0) >= 1 ? 'molding' : 'no larvae';
}

/** The types that belong to a caste, in declared order. */
export function typesInCaste(casteId) {
  return DRONE_TYPE_ORDER.filter((id) => DRONE_TYPES[id]?.caste === casteId);
}

/** The types that go out on expeditions, in declared order. */
export function exploringTypes() {
  return DRONE_TYPE_ORDER.filter((id) => DRONE_TYPES[id]?.expedition);
}

/** The types that work a forage route, in declared order. */
export function foragingTypes() {
  return DRONE_TYPE_ORDER.filter((id) => DRONE_TYPES[id]?.gather && DRONE_TYPES[id]?.load);
}

/** Cogits one drone of this type occupies. */
export function cogitDrawOf(id) {
  return DRONE_TYPES[id]?.cogitDraw || 0;
}

/**
 * Types whose caste does not exist. A tripwire, not a feature: a type with a
 * bad caste would otherwise be invisible, and the tab says so out loud.
 */
export function unfiledTypes() {
  return DRONE_TYPE_ORDER.filter((id) => !DRONE_CASTES[DRONE_TYPES[id]?.caste]);
}
