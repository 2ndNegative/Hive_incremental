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

export const SAVE_VERSION = 7;
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

  const tech = {};
  for (const id of RESEARCH_ORDER) tech[id] = false;

  return {
    version: SAVE_VERSION,
    startedAt: Date.now(),
    savedAt: null,
    playtime: 0,

    nutrients,
    spilled, // lifetime mass lost to full stores, per nutrient

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

    // What each gathering caste is working on right now: the biome it rolled,
    // the item (or prey) it found there, and how long it has been on it. Rolled
    // in tick(), never in computeDerived — the interface reads this, so it has
    // to be the same from one frame to the next.
    forage: {},
    insight: 0,
    drones: 0,

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

    structures,
    castes,
    tech,

    // Which nutrient the hive metabolises, and what it falls back to when the
    // first runs dry. `overrides` keys are "caste:<id>" or "structure:<id>".
    energy: {
      preferred: 'carb',
      fallback: 'fat',
      overrides: {},
    },

    // THIS RUN. Everything here resets when a run restarts.
    stats: {
      clicks: 0,
      ingested: 0, // grams of item mass consumed
      metabolised: 0, // joules burned
      built: 0,
      researched: 0,
      dronesLost: 0,
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
      pinnedTip: null,
    },

    log: [],
  };
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
