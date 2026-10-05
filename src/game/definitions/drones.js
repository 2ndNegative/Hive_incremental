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
//   cogitDraw    cogits one of them occupies, working or not.  READ
//   gather       which forage route it works, as the old castes did.  READ
//   load         grams one of them carries home per trip, as { min, max }
//                — rolled fresh every trip.  READ
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
    // or not.
    cogitDraw: 1,
    // The ground-vegetation route, the same one the parked forager caste worked
    // and the same one a manual gather draws on.
    gather: 'forager',
    // Grams per trip, rolled per trip.
    load: { min: 20, max: 45 },
    unlock: () => true,
  },
};

/** Display order within a caste, and the order the engine will iterate. */
export const DRONE_TYPE_ORDER = ['forager'];

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
export function nextMoldable(state) {
  for (const id of DRONE_TYPE_ORDER) {
    const def = DRONE_TYPES[id];
    if (!def || !def.unlock(state)) continue;
    const want = state.droneMolding?.[id];
    if (!want?.on) continue;
    const target = want.target;
    if (target !== null && target !== undefined && (state.droneTypes?.[id] || 0) >= target) continue;
    return id;
  }
  return null;
}

/** Why a type is not being made, for the row to say so. */
export function moldStatus(state, id) {
  const def = DRONE_TYPES[id];
  if (!def) return 'unknown';
  const want = state.droneMolding?.[id];
  if (!want?.on) return 'off';
  const target = want.target;
  if (target !== null && target !== undefined && (state.droneTypes?.[id] || 0) >= target) {
    return 'at target';
  }
  if (nextMoldable(state) !== id) return 'queued';
  // Allowed, first in line, and nothing to press. The chamber idles at its
  // lower draw while this is true, so the row should not claim it is working.
  return (state.larvae || 0) >= 1 ? 'molding' : 'no larvae';
}

/** The types that belong to a caste, in declared order. */
export function typesInCaste(casteId) {
  return DRONE_TYPE_ORDER.filter((id) => DRONE_TYPES[id]?.caste === casteId);
}

/** The types that work a forage route, in declared order. */
export function foragingTypes() {
  return DRONE_TYPE_ORDER.filter((id) => DRONE_TYPES[id]?.gather && DRONE_TYPES[id]?.load);
}

/**
 * Where a drone type's current find lives in `state.forage`.
 *
 * NAMESPACED on purpose. The parked castes keep their own slots under their
 * bare ids, and one of them is called `forager` too — the same word for a
 * different thing. A save from before the rebuild would otherwise hand the new
 * Forager drones whatever the old Forager caste was last carrying.
 */
export function droneForageKey(id) {
  return `drone:${id}`;
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
