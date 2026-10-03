import { createApp } from 'vue';
import './styles/bulma.scss';
import './styles/theme.css';
import App from './App.vue';
import { state } from './game/state.js';
import { startLoop, computeDerived, advance, canAfford } from './game/engine.js';
import { load, save, wipe, saveStatus, measureStorageHeadroom, AUTOSAVE_SECONDS } from './game/save.js';
import { runOfflineCatchup, offline, skipOffline } from './game/offline.js';
import { NUTRIENTS, FUELS, itemYield, parentsOf } from './game/definitions/nutrients.js';
import { ITEMS } from './game/definitions/items/index.js';
import { ORGANISMS, preyFor } from './game/definitions/organisms.js';
import { BIOMES, BIOME_IDS, biomeShares, totalArea, holdings } from './game/definitions/biomes.js';
import { FORAGE, poolFor } from './game/definitions/forage.js';
import * as forage from './game/forage.js';
import { research, ingestItem, consumeBiomass, manualOdds } from './game/actions.js';
import { formatMass, formatEnergy, formatPower } from './game/units.js';
import { installTipDismiss, pinned, unpinAll } from './game/tips.js';
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
  forageTable: FORAGE,
  poolFor,
  preyFor,
  forage,
  consumeBiomass,
  manualOdds,
  canAfford,
  itemYield,
  parentsOf,
  research,
  ingestItem,
  formatMass,
  formatEnergy,
  formatPower,
  save,
  load,
  wipe,
  saveStatus,
  measureStorageHeadroom,
  tick: (seconds) => advance(state, seconds),
  offline,
  skipOffline,
  dev,
  run,
  tips: { pinned, unpinAll },
};

// Best-effort save on the way out; also covers mobile tab suspension.
window.addEventListener('beforeunload', () => save());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
});
