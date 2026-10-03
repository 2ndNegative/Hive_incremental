// Drone castes.
//
// A caste is what a drone does. Every drone costs basal energy whether working
// or not; a working drone costs more and returns item mass, which decomposes
// into nutrient stores according to the item database.
//
//   basalWatts   paid by every drone in the hive, idle included
//   workWatts    extra draw while assigned to this caste
//   gather       which forage route this caste works — 'forager', 'scavenger',
//                'excavator', 'siphon' or 'hunter'. It does NOT name an item:
//                what a caste finds is rolled from the hive's territory every
//                forage cycle, so the same forager returns acorns in a forest
//                and discarded bread in a city.
//   harvestRate  grams per second per assigned drone, of whatever it rolled.
//                For a hunter this is grams of LIVE prey, which then butchers
//                down into a carcass worth of separate cuts.
//   insight      insight per second per assigned drone
//   slots        null = unlimited, otherwise a key that structures provide

export const BASAL_WATTS = 20;

/**
 * Water the hive loses per drone per second, regardless of what it is doing.
 * Most forage is already 80% water, so siphons only really earn their keep once
 * the hive moves onto dry matter — grain, bone, mineral.
 */
export const BASAL_WATER_PER_SECOND = 0.1;

export const CASTES = {
  dormant: {
    id: 'dormant',
    name: 'Dormant',
    desc: 'Unassigned. Still costs basal energy, still eats into your reserves.',
    unlock: () => true,
    assignable: false,
    slots: null,
    workWatts: 0,
  },
  siphon: {
    id: 'siphon',
    name: 'Siphon',
    desc: 'Draws standing water. Thankless, but nothing in the hive runs dry without it.',
    unlock: () => true,
    assignable: true,
    slots: null,
    workWatts: 5,
    gather: 'siphon',
    harvestRate: 5.0,
  },
  forager: {
    id: 'forager',
    name: 'Forager',
    desc: 'Strips ground vegetation. Thin pickings per gram, but it covers a third of the land surface.',
    unlock: () => true,
    assignable: true,
    slots: null,
    workWatts: 8,
    gather: 'forager',
    harvestRate: 25,
  },
  analyst: {
    id: 'analyst',
    name: 'Analyst',
    desc: 'Dissects what the hive ingests and works out what was in it. Produces insight.',
    unlock: () => true,
    assignable: true,
    slots: null,
    workWatts: 30,
    insight: 0.3,
    mult: 'analyst',
  },
  scavenger: {
    id: 'scavenger',
    name: 'Scavenger',
    desc: 'Recovers what has already died. Dense in fat and protein, and nothing fights back.',
    unlock: (state) => state.tech.scavenging,
    assignable: true,
    slots: null,
    workWatts: 15,
    gather: 'scavenger',
    harvestRate: 27,
  },
  excavator: {
    id: 'excavator',
    name: 'Excavator',
    desc: 'Processes soil and rock for mineral content. No energy in it at all — only elements.',
    unlock: (state) => state.tech.lithovory,
    assignable: true,
    slots: 'excavator',
    workWatts: 25,
    gather: 'excavator',
    harvestRate: 60,
  },
  hunter: {
    id: 'hunter',
    name: 'Hunter',
    desc: 'Takes live prey. The best energy return in the hive, and the only caste that can lose drones.',
    unlock: (state) => state.tech.predation,
    assignable: true,
    slots: 'hunter',
    workWatts: 60,
    gather: 'hunter',
    harvestRate: 20, // grams of LIVE mass per second per drone
    mult: 'hunter',
  },
};

export const CASTE_ORDER = ['dormant', 'siphon', 'forager', 'analyst', 'scavenger', 'excavator', 'hunter'];

/** Multiplier channels that castes and structures feed into. */
export const MULTIPLIERS = ['forager', 'analyst', 'hunter', 'storage', 'mineralStorage', 'vitaminStorage'];
