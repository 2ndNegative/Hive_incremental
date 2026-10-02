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
import { STRUCTURE_ORDER } from './definitions/structures.js';
import { CASTE_ORDER } from './definitions/castes.js';
import { RESEARCH_ORDER } from './definitions/research.js';

export const SAVE_VERSION = 2;
export const LOG_LIMIT = 60;

export function createInitialState() {
  const nutrients = {};
  const spilled = {};
  for (const id of NUTRIENT_IDS) {
    nutrients[id] = 0;
    spilled[id] = 0;
  }
  // The hive arrives with just enough mass to metabolise its way to a first meal.
  nutrients.water = 400;
  nutrients.protein = 300;
  nutrients.fat = 250;
  nutrients.carb = 200;

  const structures = {};
  for (const id of STRUCTURE_ORDER) structures[id] = 0;

  const castes = {};
  for (const id of CASTE_ORDER) castes[id] = 0;
  castes.dormant = 2;

  const tech = {};
  for (const id of RESEARCH_ORDER) tech[id] = false;

  return {
    version: SAVE_VERSION,
    startedAt: Date.now(),
    savedAt: null,
    playtime: 0,

    nutrients,
    spilled, // lifetime mass lost to full stores, per nutrient
    insight: 0,
    drones: 2,
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
      peakDrones: 2,
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
