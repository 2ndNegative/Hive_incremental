// Drones: castes, and the types inside them.
//
// ============================================================================
// SKELETON. Nothing here does anything yet.
//
// There is one caste with one type in it, no way to grow either, and no cost,
// consumption or output attached to either. This exists so the SHAPE is in
// place — the registry, the state slot, the banded tab — and the rebuild can
// fill it in a piece at a time without moving anything.
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
