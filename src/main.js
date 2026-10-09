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
  structureCost,
  openStore,
  stopLoop,
  BROWNOUT_SECONDS,
  FUEL_SWITCH_SECONDS,
  fuelLockFor,
  clickMultiplier,
  larvaPace,
  cogitFocus,
  cogitFocusFrom,
  COGIT_FOCUS_SCALE,
  LARVA_CARB_PER_SECOND,
  computeHydration,
  computeRation,
  RATION_KEY,
  raiseStructure,
  advanceBuildQueue,
  buildWorkFor,
  buildSecondsFor,
  buildProgress,
  inFlightCount,
  buildQueueCap,
  queuedCount,
  queueRoom,
  BUILD_QUEUE_BASE,
} from './game/engine.js';
import { load, save, wipe, saveStatus, measureStorageHeadroom, AUTOSAVE_SECONDS } from './game/save.js';
import { SAVE_VERSION } from './game/state.js';
import { runOfflineCatchup, offline, skipOffline } from './game/offline.js';
import {
  NUTRIENTS, FUELS, itemYield, parentsOf, payableCost, LOCKED_COST_MULTIPLIER,
  isRevealed, visibleAs,
} from './game/definitions/nutrients.js';
import { ITEMS } from './game/definitions/items/index.js';
import { ORGANISMS, preyFor } from './game/definitions/organisms.js';
import {
  BIOMES, BIOME_IDS, biomeShares, totalArea, holdings, landCapacity, patchCount,
  ARIDITY, aridity, aridityOf,
  FORAGERS_PER_SQUARE_METRE, AREA_PER_PATCH, ADJACENCY, realmOf, isDangerous, isColonisable,
  rollAdjacent,
} from './game/definitions/biomes.js';
import {
  EXPEDITION_OUTCOMES, expeditionSeconds, resolveExpedition, advanceExpeditions,
  CACHE_GRAMS, PATCH_AREA,
} from './game/expedition.js';
import { FORAGE, poolFor } from './game/definitions/forage.js';
import {
  AMOUNT, AMOUNT_ORDER, GROWTH, GROWTH_ORDER, amount, growthOf, nearestAmount,
  build as buildCost, flat as flatCost,
  INSIGHT, INSIGHT_ORDER, insightAmount, nearestInsight, tech as techCost,
} from './game/definitions/costs.js';
import {
  TIME, TIME_ORDER, BUILD_COUNT_EXPONENT, duration, nearestTime, buildWork,
} from './game/definitions/times.js';
import {
  CHANNELS, CHANNEL_ORDER, channelsRead, unreadChannels,
} from './game/definitions/modifiers.js';
import {
  FOCUS_SHARE, focusStrength, isStarrable, isStarred, starsFor, setStar, toggleStar,
  clearStars, focusedOdds,
} from './game/focus.js';
import * as forage from './game/forage.js';
import * as discovery from './game/discovery.js';
import {
  research, ingestItem, consumeBiomass, manualOdds, manualOddsSummary, MANUAL_INTAKE,
  manualCombo,
  reserveCogits, releaseCogits, releaseAllCogits, buildStructure, abandonBuild,
  setGlobalFuel, setFuelOverride, clearFuelOverride, setActive, adjustActive,
  togglePinned, resetPinned, setMolding, toggleMolding, setMoldTarget,
  claimCost, claimableArea, claimTerritory, abandonTerritory,
  setGeneralBan, toggleGeneralBan, generalContents,
  queueBuild, unqueueBuild, moveQueued, clearBuildQueue,
  CLAIM_COST_PER_SQUARE_METRE, DANGEROUS_CLAIM_MULTIPLIER,
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
import { RESEARCH, RESEARCH_ORDER } from './game/definitions/research.js';
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
  adjacency: ADJACENCY,
  realmOf,
  isDangerous,
  isColonisable: (id) => isColonisable(state, id),
  rollAdjacent: () => rollAdjacent(state),
  expedition: {
    outcomes: EXPEDITION_OUTCOMES,
    seconds: (id) => expeditionSeconds(state, id),
    resolve: (id) => resolveExpedition(state, id),
    advance: (dt) => advanceExpeditions(state, dt),
    cacheGrams: CACHE_GRAMS,
    patchArea: PATCH_AREA,
  },
  claimCost: (id, area) => claimCost(id, area),
  claimableArea: (id) => claimableArea(id),
  claim: (id, area) => claimTerritory(id, area),
  abandon: (id) => abandonTerritory(id),
  claimPerSquareMetre: CLAIM_COST_PER_SQUARE_METRE,
  dangerousClaimMultiplier: DANGEROUS_CLAIM_MULTIPLIER,
  totalArea: () => totalArea(state),
  holdings: () => holdings(state),
  landCapacity: () => landCapacity(state),
  patchCount: () => patchCount(state),
  forageTable: FORAGE,
  poolFor,
  focus_: {
    share: FOCUS_SHARE,
    strength: focusStrength,
    starrable: (biomeId, key) => isStarrable(state, biomeId, key),
    starred: (gather, biomeId, key) => isStarred(state, gather, biomeId, key),
    stars: (gather, biomeId) => starsFor(state, gather, biomeId),
    set: (gather, biomeId, key, on) => setStar(state, gather, biomeId, key, on),
    toggle: (gather, biomeId, key) => toggleStar(state, gather, biomeId, key),
    clear: (gather, biomeId) => clearStars(state, gather, biomeId),
    odds: (gather, biomeId) => focusedOdds(state, gather, biomeId, poolFor(gather, biomeId)),
  },
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
  isRevealed: (id) => isRevealed(state, id),
  visibleAs: (id) => visibleAs(state, id),
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
  researchDefs: RESEARCH,
  researchOrder: RESEARCH_ORDER,
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
  hydration: () => computeHydration(state),
  ration: () => computeRation(state),
  rationKey: RATION_KEY,
  aridityTable: ARIDITY,
  aridityOf,
  aridity: () => aridity(state),
  larvaPace: () => larvaPace(state),
  cogitFocus: () => cogitFocus(state),
  cogitFocusFrom,
  cogitFocusScale: COGIT_FOCUS_SCALE,
  lockedCostMultiplier: LOCKED_COST_MULTIPLIER,
  payableCost: (cost) => payableCost(state, cost || {}),
  maxLevelOf,
  costs: {
    amounts: AMOUNT,
    amountOrder: AMOUNT_ORDER,
    growth: GROWTH,
    growthOrder: GROWTH_ORDER,
    amount,
    growthOf,
    nearest: nearestAmount,
    build: buildCost,
    flat: flatCost,
    // Research's own ladder. Separate table, same spacing — insight is not
    // mass and the two have no exchange rate.
    insight: INSIGHT,
    insightOrder: INSIGHT_ORDER,
    insightAmount,
    nearestInsight,
    tech: techCost,
    payable: payableCost,
  },
  structureCost: (id, n = 1) => structureCost(state, id, n),
  build: (id, n) => buildStructure(id, n),
  queue: {
    base: BUILD_QUEUE_BASE,
    cap: () => buildQueueCap(state),
    used: () => queuedCount(state),
    room: () => queueRoom(state),
    list: () => (state.buildQueue || []).map((e) => ({ ...e })),
    inFlight: (id) => inFlightCount(state, id),
    add: (id, n) => queueBuild(id, n),
    remove: (i, all) => unqueueBuild(i, all),
    move: (i, d) => moveQueued(i, d),
    clear: () => clearBuildQueue(),
    // dt and pace, so a poke at the console can hand it an hour of a hive that
    // is doing well. Defaults to one second at the pace the hive has.
    advance: (dt = 1, pace = computeDerived(state).buildPace) => advanceBuildQueue(state, dt, pace),
    // Straight past the queue and the clock. For setting a hive up, not for
    // playing one — see raiseStructure.
    raise: (id, n) => raiseStructure(state, id, n),
  },
  // What can be made better or worse, and whether anything is listening. The
  // channel list is the seam genetics contributes through — see
  // definitions/modifiers.js.
  mods: {
    channels: CHANNELS,
    order: CHANNEL_ORDER,
    // The live totals: what every source has contributed, this derive.
    now: () => computeDerived(state).mod,
    read: () => [...channelsRead()],
    // Should be empty. Anything here is a bonus that goes nowhere.
    unread: () => unreadChannels(),
  },
  buildTime: {
    rungs: TIME,
    order: TIME_ORDER,
    exponent: BUILD_COUNT_EXPONENT,
    duration,
    nearest: nearestTime,
    workOf: buildWork,
    work: (id) => buildWorkFor(state, id),
    seconds: (id) => buildSecondsFor(state, id, computeDerived(state).buildPace),
    pace: () => computeDerived(state).buildPace,
    now: () => buildProgress(state, computeDerived(state).buildPace),
    cancel: () => abandonBuild(),
    // Every live building, by what it takes right now. The balance view.
    table: () => STRUCTURE_ORDER.map((id) => ({
      id,
      rung: STRUCTURES[id].time,
      work: Math.round(buildWorkFor(state, id)),
      seconds: Math.round(buildSecondsFor(state, id, computeDerived(state).buildPace)),
    })),
  },
  setActive,
  adjustActive,
  activeCount: (id) => activeCount(state, id),
  openStore,
  generalBans: () => ({ ...(state.generalBans || {}) }),
  generalContents,
  setGeneralBan,
  toggleGeneralBan,
  structuresLive: STRUCTURE_ORDER.length,
  castesLive: CASTE_ORDER.filter((id) => CASTES[id].assignable).length,
};

// Best-effort save on the way out; also covers mobile tab suspension.
window.addEventListener('beforeunload', () => save());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
});
