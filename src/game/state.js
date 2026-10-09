// The single reactive game state object.
//
// Holds only *authored* state — what the player changed and what must survive a
// reload. Everything derivable (capacities, flows, energy, unlocks) is computed
// in engine.js.
//
// Note that every micronutrient store exists from the very first tick, long
// before the hive can see it. That is the point: the assay reveals a stockpile
// that was already there.

import { reactive } from 'vue';
import { NUTRIENT_IDS } from './definitions/nutrients.js';
import { STRUCTURE_ORDER, DEPRECATED_STRUCTURE_ORDER } from './definitions/structures.js';
import { CASTE_ORDER, DEPRECATED_CASTE_ORDER } from './definitions/castes.js';
import { RESEARCH_ORDER } from './definitions/research.js';
import { DEFAULT_PINNED } from './definitions/topbar.js';
import { DRONE_TYPE_ORDER } from './definitions/drones.js';

export const SAVE_VERSION = 22;
export const LOG_LIMIT = 60;

export function createInitialState() {
  const nutrients = {};
  const spilled = {};
  for (const id of NUTRIENT_IDS) {
    nutrients[id] = 0;
    spilled[id] = 0;
  }
  // Nothing is seeded here. A run has no mass and no drones until a starting
  // site is chosen; the site decides the opening conditions. That also makes the
  // pre-choice state completely inert — no demand, no growth, no starvation —
  // so the chooser can sit open indefinitely without the hive dying behind it.

  // Parked ids are seeded alongside live ones so that a save written before the
  // rebuild keeps its counts through a load — mergeDefaults only carries keys
  // the defaults declare, so leaving them out would quietly delete them.
  const structures = {};
  for (const id of [...STRUCTURE_ORDER, ...DEPRECATED_STRUCTURE_ORDER]) structures[id] = 0;

  const castes = {};
  for (const id of [...CASTE_ORDER, ...DEPRECATED_CASTE_ORDER]) castes[id] = 0;

  // How many of each drone type the hive holds. Skeleton: nothing grows one yet
  // and nothing reads these but the Drones tab. See definitions/drones.js.
  const droneTypes = {};
  // What the molding chambers are allowed to make, and how many of it.
  // `on` starts FALSE for every type: a chamber that began eating larvae the
  // moment it was built — and drawing five times the power to do it — would be
  // a thing that happened TO the player rather than something they asked for.
  // `target: null` is no ceiling.
  const droneMolding = {};
  for (const id of DRONE_TYPE_ORDER) {
    droneTypes[id] = 0;
    droneMolding[id] = { on: false, target: null };
  }

  const tech = {};
  for (const id of RESEARCH_ORDER) tech[id] = false;

  return {
    version: SAVE_VERSION,
    startedAt: Date.now(),
    savedAt: null,
    playtime: 0,

    nutrients, // TOTAL grams held, shelf and pool together
    spilled, // lifetime mass lost to full stores, per nutrient

    // How much of each nutrient's total is sitting in the shared general store
    // rather than on its own dedicated shelf. Sparse: no entry means none of
    // it. See engine.js openStore — the pool is last in, first out, so this is
    // usually empty and fills only when a shelf overflows.
    general: {},

    // Nutrients the player has forbidden from the shared pool, as a sparse set
    // of ids. A banned nutrient fills its own shelf and then spills — it never
    // takes general room from anything else. See engine.js openStore.
    generalBans: {},

    // What the player has told each gathering route to look for, by biome:
    // focus[gatherType][biomeId][itemKey] = true. A standing preference rather
    // than a fact about the land, so it survives losing and retaking ground.
    // See focus.js — a star claims a share of that route's trips there.
    focus: {},

    // What the hive has been told to build next, in order: [{ id, n }]. The
    // head waits until it can be paid for, so the order is the player's
    // priority rather than a suggestion. How long it may get is
    // BUILD_QUEUE_BASE plus whatever research has widened it.
    buildQueue: [],

    // What is being grown RIGHT NOW: { id, work, remaining, paid } or null.
    // A job leaves the queue, is paid for in full, and then takes minutes —
    // `remaining` is in pace-seconds and comes down at derived.buildPace, so a
    // brood hatching mid-build finishes the rest of it faster. `paid` is the
    // cost that was actually charged, kept so cancelling can hand it back.
    // See engine.js advanceBuildQueue and definitions/times.js.
    building: null,

    // Harvested matter, still whole. Castes deliver here and digestion draws
    // from here; a hive that cannot digest fast enough visibly backs up.
    items: {},
    spilledItems: {}, // lifetime item mass lost to full storage, per item

    // Land held, in square metres, keyed by biome. What the hive holds decides
    // what it can find; the landing site seeds it and nothing else adds to it
    // yet. See run.js grantTerritory, which is the one way in.
    territory: {},

    // What the last manual gather turned up, so the panel can show it without
    // putting a line in the log for every single click.
    lastGather: null,

    // How hot the Consume biomass button is, 0 to 1. Every press adds to it and
    // every second bleeds it away; what the hive takes is multiplied by where
    // it has got to. See engine.js MANUAL_COMBO_MAX.
    clickHeat: 0,

    // What each gathering caste is working on right now: the biome it rolled,
    // the item (or prey) it found there, and how long it has been on it. Rolled
    // in tick(), never in computeDerived — the interface reads this, so it has
    // to be the same from one frame to the next.
    forage: {},

    // The patches each foraging drone type is working, keyed by type id: an
    // array of { elapsed, biomeId, itemId, grams }. How many there are is
    // decided by the land — see definitions/biomes.js patchCount — and each one
    // is rolled separately, so a big holding is several places at once rather
    // than one place that happens to be bigger.
    patches: {},

    // Ground an Explorer has MAPPED but the hive has not paid for, in square
    // metres by biome. It shows on the territory map marked unclaimed and does
    // nothing at all until it is claimed — see actions.js claimTerritory.
    unclaimed: {},

    // How far each exploring drone type is through its current expedition, 0
    // to 1. The same shape as `brood` and `molding`.
    expedition: {},
    insight: 0,
    drones: 0,

    // Larvae in the brood chamber. A STORE, not a capacity: this is a count of
    // things the hive is holding, the way nutrients are. Nothing produces or
    // spends them yet — the drone rebuild is what will.
    larvae: 0,

    // How far each brood structure is through its current cycle, 0 to 1, keyed
    // by structure id. Sparse — no entry means it has not started one.
    brood: {},

    // Seconds the brood has gone unfed, and how far through the next death
    // that has carried it. Both reset the moment it eats. See engine.js
    // LARVA_STARVE_GRACE.
    larvaeHunger: 0,
    larvaeDying: 0,

    // Usable energy, in joules. Separate from the chemical energy locked in the
    // nutrient stores: nothing converts one into the other except a Metabolic
    // Generator, so this is what the hive can actually spend.
    energyPool: 0,

    // What the hive has learned about its own ground: how many times each item
    // (and each prey species, keyed by discovery.preyKey) has been found in
    // each biome. See discovery.js — names are learned globally, rates per
    // biome, and the forage table stays hidden until it is.
    found: {},

    // How well each standing structure is powered: 0 = dark, 1 = running. A
    // building that cannot get its watts slides to 0 over BROWNOUT_SECONDS and
    // climbs back over the same span when the power returns. Absent means 1, so
    // anything newly built starts lit. See engine.js computeCharges.
    power: {},

    // Cognition is a width, not a stock, so nothing is stored here — only the
    // blocks of bandwidth that actions are currently holding, keyed by whatever
    // is holding them. Everything else is derived. See definitions/cognition.js.
    cognition: { reservations: {} },

    // Which starting site this run began at. null = not chosen yet, which is
    // what makes the chooser appear.
    origin: null,
    growth: 0,
    starvation: 0,

    droneTypes,
    droneMolding,

    // How far each molding structure is through its current cycle, 0 to 1,
    // keyed by structure id. The same shape as `brood`.
    molding: {},

    structures,

    // How many of each structure are switched OFF their full count. Sparse on
    // purpose: NO ENTRY MEANS ALL OF THEM RUNNING. Anything that raises
    // structures[id] without a thought — a landing site, a migration, a test,
    // whatever the rebuild brings — therefore gets a running building rather
    // than a silently idle one, and only a deliberate act of idling writes
    // here. An idle building costs nothing and does nothing, which is the only
    // way back out of having overbuilt something that eats.
    active: {},

    castes,
    tech,

    // Which nutrient the hive metabolises, and what it falls back to when the
    // first runs dry. `overrides` keys are "caste:<id>" or "structure:<id>".
    energy: {
      // Fat is the deep tank and sugar is the sprint, so the generators sit on
      // fat by default and reach for sugar when it runs out. The drones are
      // the other way round: sugar is what a body actually runs on, and it is
      // the one place the hive would rather spend it. Both are one dropdown
      // away on the Metabolism tab — this is only where they start.
      preferred: 'fat',
      fallback: 'carb',
      overrides: {
        drones: { preferred: 'carb', fallback: 'fat' },
      },
    },

    // Which fuel each generator is actually on, and how long it is held there.
    // Keyed the same way the overrides are. Sparse: no entry means it has not
    // started yet and will take its preferred fuel the first time it runs. See
    // engine.js FUEL_SWITCH_SECONDS — this is what stops a generator flickering
    // between two stores every tick when the first one is nearly empty.
    fuelLock: {},

    // THIS RUN. Everything here resets when a run restarts.
    stats: {
      clicks: 0,
      ingested: 0, // grams of item mass consumed
      metabolised: 0, // joules burned
      built: 0,
      researched: 0,
      dronesLost: 0,
      larvaeLost: 0,
      molded: 0,
      explorersLost: 0,
      cachesFound: 0,
      groundFound: 0, // square metres mapped, claimed or not
      groundClaimed: 0,
      peakDrones: 0,
      ticks: 0,
      devUsed: false,
    },

    // ACROSS ALL RUNS. Survives a restart; only a full wipe clears it.
    //
    // These totals cover *completed* runs only — the run in progress is added
    // in at display time. Folding the live run in here as it happened would
    // double-count it the moment the run ended.
    lifetime: {
      firstStartedAt: Date.now(),
      runs: 1, // including the one in progress
      playtime: 0,
      clicks: 0,
      ingested: 0,
      metabolised: 0,
      built: 0,
      researched: 0,
      dronesLost: 0,
      bestDrones: 0,
      bestPlaytime: 0,
      bestResearched: 0,
      devUsed: false, // sticky: a cheat in any run marks the save forever
    },

    // Unlocked by entering the code in Settings; persists in the save.
    dev: { enabled: false },

    settings: {
      theme: 'dark',
      autosave: true,
      offlineProgress: true,
      showZeroFlows: false,
      compactNutrients: false,
    },

    ui: {
      tab: 'hive',
      buyAmount: 1,
      codexCategory: 'all',
      codexSearch: '',
      codexSort: 'name',
      selectedItem: null,
      storageSort: 'mass',
      storageSearch: '',
      territoryGather: 'forager',
      // Which building bands are folded shut. Absent = open.
      buildBands: {},
      // The same, for the caste bands on the Drones tab.
      droneBands: {},

      // Top-bar resources the player has nailed down. These are always shown,
      // in declared order; everything else competes for the room left over.
      // See definitions/topbar.js.
      pinned: [...DEFAULT_PINNED],
      pinnedTip: null,
    },

    log: [],
  };
}

/**
 * MAPS WHOSE KEYS THE PLAYER INVENTS, by dotted path from the root of the state.
 *
 * Everything else is CLOSED: when a save is loaded, only the keys this file
 * declares survive, so a field dropped from the game disappears from old saves
 * instead of haunting them. A map listed here is merged instead — what the save
 * holds wins, and anything new in the default is added alongside it.
 *
 * The test for membership is "could createInitialState possibly know the key".
 * `energy.overrides` is keyed "structure:<id>" / "caste:<id>" for whichever
 * generator or caste the player has touched; `focus` is keyed by gather type
 * and biome; `found` by biome and item. None of those are schema keys.
 *
 * WHY THIS LIST EXISTS RATHER THAN A HEURISTIC. save.js used to infer openness
 * from the default being empty. That held until v21 gave `energy.overrides` a
 * default entry for the drone ration — at which point the map read as closed
 * and every fuel choice the player had made was silently erased on their next
 * reload. Openness is a fact about what a map is FOR. It gets written down.
 *
 * A map that is empty by default does not strictly need to be here, since the
 * old heuristic still covers it, but listing it says the quiet part out loud
 * and makes it safe to give that map a default later.
 */
export const OPEN_MAPS = new Set([
  'energy.overrides', // "structure:<id>" | "caste:<id>" | "drones"
  'fuelLock', // the same keys, with what each one is actually burning
  'items', // item ids, as the hive finds them
  'spilledItems',
  'found', // biome id → item id → times seen
  'focus', // gather type → biome id → item key
  'general', // nutrient ids currently sitting in the shared pool
  'generalBans',
  'territory', // biome ids the hive holds
  'unclaimed', // biome ids it has found but not taken
  'forage', // caste/drone id → what it is working on
  'expedition',
  'brood', // structure id → cycle progress
  'molding',
  'patches',
  'power', // structure id → charge
  'active', // structure id → how many are switched on
  'droneMolding', // drone type id → { on, target }
  'cognition.reservations',
  'ui.buildBands', // band id → folded
  'ui.droneBands',
]);

// Every path in OPEN_MAPS has to name a real object in the state, or it is a
// typo quietly doing nothing — which is the exact failure the list exists to
// prevent. Checked once, at module load, in the style of the structure and cost
// tables. Cheap: one walk of a fresh state per page load.
{
  const fresh = createInitialState();
  for (const path of OPEN_MAPS) {
    let node = fresh;
    for (const key of path.split('.')) node = node?.[key];
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error(
        `OPEN_MAPS names "${path}", which is not an object in createInitialState(). `
        + 'Fix the path, or drop it from the list — see the note above OPEN_MAPS.',
      );
    }
  }
}

export const state = reactive(createInitialState());

export function replaceState(next) {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, next);
}

export function pushLog(text, type = 'info') {
  state.log.unshift({ text, type, at: Date.now(), playtime: state.playtime });
  if (state.log.length > LOG_LIMIT) state.log.length = LOG_LIMIT;
}
