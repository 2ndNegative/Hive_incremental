import { createApp } from 'vue';
import './styles/bulma.scss';
import './styles/theme.css';
import App from './App.vue';
import { state } from './game/state.js';
import {
  startLoop,
  computeDerived,
  advance,
  canAfford,
  computeCognition,
  computeCharges,
  activeCount,
  openStore,
  stopLoop,
  BROWNOUT_SECONDS,
  FUEL_SWITCH_SECONDS,
  fuelLockFor,
  clickMultiplier,
  MANUAL_COMBO_MAX,
  larvaPace,
  LARVA_CARB_PER_SECOND,
} from './game/engine.js';
import { load, save, wipe, saveStatus, measureStorageHeadroom, AUTOSAVE_SECONDS } from './game/save.js';
import { SAVE_VERSION } from './game/state.js';
import { runOfflineCatchup, offline, skipOffline } from './game/offline.js';
import {
  NUTRIENTS, FUELS, itemYield, parentsOf, payableCost, LOCKED_COST_MULTIPLIER,
} from './game/definitions/nutrients.js';
import { ITEMS } from './game/definitions/items/index.js';
import { ORGANISMS, preyFor } from './game/definitions/organisms.js';
import {
  BIOMES, BIOME_IDS, biomeShares, totalArea, holdings, landCapacity, patchCount,
  FORAGERS_PER_SQUARE_METRE, AREA_PER_PATCH,
} from './game/definitions/biomes.js';
import { FORAGE, poolFor } from './game/definitions/forage.js';
import * as forage from './game/forage.js';
import * as discovery from './game/discovery.js';
import {
  research, ingestItem, consumeBiomass, manualOdds, manualOddsSummary, MANUAL_INTAKE,
  manualCombo,
  reserveCogits, releaseCogits, releaseAllCogits, buildStructure,
  setGlobalFuel, setFuelOverride, clearFuelOverride, setActive, adjustActive,
  togglePinned, resetPinned, setMolding, toggleMolding, setMoldTarget,
} from './game/actions.js';
import {
  STRUCTURES,
  STRUCTURE_ORDER,
  powerPriority,
  BUILDING_CATEGORY_ORDER,
  maxLevelOf,
} from './game/definitions/structures.js';
import { CASTES, CASTE_ORDER } from './game/definitions/castes.js';
import { formatMass, formatEnergy, formatPower, formatCogits, formatLarvae } from './game/units.js';
import { installTipDismiss, pinned, unpinAll } from './game/tips.js';
import {
  DRONE_CASTES, DRONE_CASTE_ORDER, DRONE_TYPES, DRONE_TYPE_ORDER, typesInCaste, unfiledTypes,
  foragingTypes, cogitDrawOf,
  nextMoldable, moldStatus,
} from './game/definitions/drones.js';
import {
  TOPBAR, TOPBAR_ORDER, TOPBAR_SLOTS, DEFAULT_PINNED, topbarLayout, urgencyRank,
} from './game/definitions/topbar.js';
import * as dev from './game/dev.js';
import * as run from './game/run.js';

// Restore before the first render so the UI never flashes a fresh game.
const { offlineSeconds } = load();

document.documentElement.dataset.theme = state.settings.theme;

createApp(App).mount('#app');

// Escape, or a click outside, releases a pinned tooltip.
installTipDismiss();

/**
 * Catch up on time away, then start the live loop. The catch-up runs in chunks
 * between frames so the modal can show progress and the Skip button works; the
 * live loop must not start until it is done, or the two would both be ticking.
 */
// A run with no landing site has no hive to simulate, so there is nothing for
// offline time to do but confuse the player with an empty progress bar.
const pendingOffline = state.origin ? offlineSeconds : 0;

runOfflineCatchup(state, pendingOffline).then(() => {
  save();
  startLoop(state);
});

setInterval(() => {
  if (state.settings.autosave && !offline.active) save();
}, AUTOSAVE_SECONDS * 1000);

// Debug handle, in the spirit of Evolve's `global`. Handy from the devtools
// console: hive.state.nutrients.fat = 1e6, hive.derived(), hive.save().
window.hive = {
  state,
  derived: () => computeDerived(state),
  nutrients: NUTRIENTS,
  fuels: FUELS,
  items: ITEMS,
  organisms: ORGANISMS,
  biomes: BIOMES,
  biomeIds: BIOME_IDS,
  biomeShares: () => biomeShares(state),
  totalArea: () => totalArea(state),
  holdings: () => holdings(state),
  landCapacity: () => landCapacity(state),
  patchCount: () => patchCount(state),
  forageTable: FORAGE,
  poolFor,
  preyFor,
  forage,
  consumeBiomass,
  manualOdds,
  manualOddsSummary,
  manualIntake: MANUAL_INTAKE,
  manualCombo,
  clickMultiplier: () => clickMultiplier(state),
  setGlobalFuel,
  setFuelOverride,
  clearFuelOverride,
  canAfford,
  itemYield,
  parentsOf,
  research,
  ingestItem,
  formatMass,
  formatEnergy,
  formatPower,
  formatCogits,
  formatLarvae,
  cognition: () => computeCognition(state),
  reserveCogits,
  releaseCogits,
  releaseAllCogits,
  save,
  load,
  wipe,
  saveVersion: SAVE_VERSION,
  saveStatus,
  measureStorageHeadroom,
  // `step` is the simulated slice per iteration, as offline catch-up scales it:
  // a month at one-second steps is 2.6 million of them, which is minutes of
  // wall clock for a result a coarse step reaches in a moment.
  tick: (seconds, step = 1) => advance(state, seconds, step),
  // Hand control of the clock, so a test can take exact samples instead of
  // racing the live loop.
  loop: { start: () => startLoop(state), stop: stopLoop },
  offline,
  skipOffline,
  dev,
  run,
  tips: { pinned, unpinAll },
  drones: {
    castes: DRONE_CASTES,
    casteOrder: DRONE_CASTE_ORDER,
    types: DRONE_TYPES,
    typeOrder: DRONE_TYPE_ORDER,
    typesInCaste,
    unfiled: unfiledTypes,
    foraging: foragingTypes,
    cogitDrawOf,
    patches: (id) => forage.patchesFor(state, id),
    rollPatch: (id, patch) => forage.rollPatch(state, id, patch),
    nextMoldable: () => nextMoldable(state, computeCognition(state).free),
    moldStatus: (id, free) => moldStatus(state, id, free ?? computeCognition(state).free),
    nextMoldableFree: (free) => nextMoldable(state, free ?? computeCognition(state).free),
    setMolding,
    toggleMolding,
    setMoldTarget,
  },
  topbar: {
    defs: TOPBAR,
    order: TOPBAR_ORDER,
    slots: TOPBAR_SLOTS,
    defaultPinned: DEFAULT_PINNED,
    urgencyRank,
    layout: () => topbarLayout(state, computeDerived(state)),
    toggle: togglePinned,
    reset: resetPinned,
  },
  // How much of the game is actually live. The test suites read these to tell
  // "parked for the rebuild" apart from "broken", so they flip back on by
  // themselves once the new structures and castes land.
  discovery,
  structureDefs: STRUCTURES,
  structureOrder: STRUCTURE_ORDER,
  powerPriority: () => powerPriority(),
  buildingCategoryOrder: BUILDING_CATEGORY_ORDER,
  charges: () => computeCharges(state),
  brownoutSeconds: BROWNOUT_SECONDS,
  foragersPerSquareMetre: FORAGERS_PER_SQUARE_METRE,
  areaPerPatch: AREA_PER_PATCH,
  fuelSwitchSeconds: FUEL_SWITCH_SECONDS,
  fuelLock: (key) => fuelLockFor(state, key),
  larvaCarbPerSecond: LARVA_CARB_PER_SECOND,
  larvaPace: () => larvaPace(state),
  lockedCostMultiplier: LOCKED_COST_MULTIPLIER,
  payableCost: (cost) => payableCost(state, cost || {}),
  maxLevelOf,
  build: (id, n) => buildStructure(id, n),
  setActive,
  adjustActive,
  activeCount: (id) => activeCount(state, id),
  openStore,
  structuresLive: STRUCTURE_ORDER.length,
  castesLive: CASTE_ORDER.filter((id) => CASTES[id].assignable).length,
};

// Best-effort save on the way out; also covers mobile tab suspension.
window.addEventListener('beforeunload', () => save());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
});
