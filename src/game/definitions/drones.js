// Drones: castes, and the types inside them.
//
// ============================================================================
// PART BUILT. A type can be MADE, and that is all it can do.
//
// A Molding Chamber turns a larva into one of these on a twenty-second cycle.
// What it makes is the first ELIGIBLE type in declared order: switched on, and
// under its target if it has one. A chamber with nothing eligible — or nothing
// in the brood to press — is idle, and costs the lower of its two draws.
// Beyond being made, a drone type still has no cost, no appetite and no output:
// the rest arrives with the rebuild.
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
// WHAT A TYPE WILL EVENTUALLY DECLARE
//   caste        the band it belongs to, from DRONE_CASTES
//   cost         what it takes to grow one
//   upkeepWatts  what it draws while it lives
//   cogitDraw    bandwidth it occupies
//   eats         what it consumes, and how fast
//   does         whatever the thing is actually for
// None of those are read yet. Adding one is a line here and a line in the
// engine; the tab will carry it without being told.

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
    // Always listed. Nothing can grow one yet, so this only decides whether the
    // card is on screen.
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

/**
 * Types whose caste does not exist. A tripwire, not a feature: a type with a
 * bad caste would otherwise be invisible, and the tab says so out loud.
 */
export function unfiledTypes() {
  return DRONE_TYPE_ORDER.filter((id) => !DRONE_CASTES[DRONE_TYPES[id]?.caste]);
}
