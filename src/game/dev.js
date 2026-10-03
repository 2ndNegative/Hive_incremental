// Developer tools.
//
// Locked behind a code entered in Settings, persisted in the save once unlocked.
// Everything here is a cheat: each action flags the save with `stats.devUsed` so
// a doctored run is never mistaken for a real one.

import { state, pushLog } from './state.js';
import { NUTRIENT_IDS, NUTRIENTS, MICROS, isRevealed } from './definitions/nutrients.js';
import { RESEARCH, RESEARCH_ORDER } from './definitions/research.js';
import { ASSAY_GROUPS } from './definitions/nutrients.js';
import { computeDerived, advance } from './engine.js';
import { ingestItem } from './actions.js';
import { ITEMS } from './definitions/items/index.js';
import { BIOMES, BIOME_IDS } from './definitions/biomes.js';
import { grantTerritory } from './run.js';
import { resetForage } from './forage.js';
import { formatMass } from './units.js';
import { formatDuration } from './format.js';

export const DEV_CODE = 'code midas';

/** Returns true if the code was correct. */
export function tryUnlockDev(input) {
  if (String(input).trim().toLowerCase() !== DEV_CODE) return false;
  if (state.dev.enabled) return true;
  state.dev.enabled = true;
  pushLog('Developer mode unlocked.', 'unlock');
  return true;
}

export function lockDev() {
  state.dev.enabled = false;
  pushLog('Developer mode locked.', 'info');
}

function touch() {
  state.stats.devUsed = true;
}

/* ------------------------------------------------------------------ stores */

/** Fill every nutrient store to capacity, hidden ones included. */
export function fillAllStores() {
  const derived = computeDerived(state);
  for (const id of NUTRIENT_IDS) state.nutrients[id] = derived.caps[id];
  touch();
  pushLog('All stores filled to capacity.', 'info');
}

/** Fill only what the hive can currently see. */
export function fillRevealedStores() {
  const derived = computeDerived(state);
  for (const id of NUTRIENT_IDS) {
    if (isRevealed(state, id)) state.nutrients[id] = derived.caps[id];
  }
  touch();
  pushLog('Resolved stores filled to capacity.', 'info');
}

export function fillNutrient(id, fraction = 1) {
  const derived = computeDerived(state);
  state.nutrients[id] = derived.caps[id] * fraction;
  touch();
  pushLog(`Set ${NUTRIENTS[id].name} to ${formatMass(state.nutrients[id])}.`, 'info');
}

export function addNutrient(id, grams) {
  const derived = computeDerived(state);
  state.nutrients[id] = Math.min(derived.caps[id], (state.nutrients[id] || 0) + grams);
  touch();
}

export function emptyAllStores() {
  for (const id of NUTRIENT_IDS) state.nutrients[id] = 0;
  touch();
  pushLog('All stores emptied.', 'info');
}

/** Push an item through the normal intake path, so composition still applies. */
export function grantItem(itemId, grams) {
  ingestItem(itemId, grams);
  touch();
  pushLog(`Ingested ${formatMass(grams)} of ${itemId.replace(/_/g, ' ')}.`, 'info');
}

/* ------------------------------------------------------------------ storage */

/** Fill every item the hive is currently gathering to its storage cap. */
export function fillStorage() {
  const d = computeDerived(state);
  const ids = new Set([...Object.keys(state.items || {}), ...Object.keys(d.itemFlow)]);
  state.items ??= {};
  for (const id of ids) {
    if (ITEMS[id]) state.items[id] = d.itemCap;
  }
  touch();
  pushLog(`Storage filled: ${ids.size} item${ids.size === 1 ? '' : 's'} at ${formatMass(d.itemCap)}.`, 'info');
}

/** Drop matter into storage without digesting it, to watch the backlog behave. */
export function stockStorage(itemId, grams) {
  if (!ITEMS[itemId]) return;
  state.items ??= {};
  state.items[itemId] = (state.items[itemId] || 0) + grams;
  touch();
  pushLog(`Stored ${formatMass(grams)} of ${itemId.replace(/_/g, ' ')} whole.`, 'info');
}

export function emptyStorage() {
  state.items = {};
  touch();
  pushLog('Storage emptied.', 'info');
}

/* ---------------------------------------------------------------- territory */

/**
 * Hand the hive land. There is no legitimate way to gain territory yet, so this
 * is also the only way to see a mixed holding behave before expansion exists.
 */
export function addTerritory(biomeId, squareMetres) {
  const area = grantTerritory(biomeId, squareMetres);
  if (!area) return 0;
  resetForage(state); // every caste re-rolls against the new ground
  touch();
  pushLog(`Claimed ${squareMetres} m² of ${BIOMES[biomeId].name.toLowerCase()}.`, 'unlock');
  return area;
}

export function clearTerritory() {
  state.territory = {};
  resetForage(state);
  touch();
  pushLog('All territory released.', 'info');
}

/** Force every caste to find something new right now. */
export function rerollForage() {
  resetForage(state);
  touch();
  pushLog('Every caste sent back out.', 'info');
}

/* ------------------------------------------------- insight, drones, research */

export function addInsight(amount) {
  const derived = computeDerived(state);
  state.insight = Math.min(derived.insightCap, state.insight + amount);
  touch();
}

export function fillInsight() {
  const derived = computeDerived(state);
  state.insight = derived.insightCap;
  touch();
}

export function addDrones(count) {
  const derived = computeDerived(state);
  const room = derived.droneCap - state.drones;
  const added = Math.max(0, Math.min(count, room));
  state.drones += added;
  state.castes.dormant += added;
  touch();
  if (added < count) pushLog(`Only ${added} drones fit — grow more Nerve Nodes.`, 'info');
}

export function grantResearch(id) {
  if (state.tech[id]) return;
  state.tech[id] = true;
  state.stats.researched += 1;
  touch();
  pushLog(`Granted research: ${RESEARCH[id].name}.`, 'research');
}

export function grantAllResearch() {
  for (const id of RESEARCH_ORDER) {
    if (!state.tech[id]) {
      state.tech[id] = true;
      state.stats.researched += 1;
    }
  }
  touch();
  pushLog('All research granted.', 'research');
}

/** Just the assays — useful for inspecting the micronutrient panel. */
export function grantAllAssays() {
  for (const assay of ASSAY_GROUPS) {
    if (!state.tech[assay.id]) {
      state.tech[assay.id] = true;
      state.stats.researched += 1;
    }
  }
  touch();
  pushLog(`All assays granted: ${MICROS.length} compounds resolved.`, 'unlock');
}

export function revokeAllResearch() {
  for (const id of RESEARCH_ORDER) state.tech[id] = false;
  state.stats.researched = 0;
  touch();
  pushLog('All research revoked.', 'info');
}

/* -------------------------------------------------------------------- time */

/** Fast-forward the simulation. Uses the same tick the game always uses. */
export function skipTime(seconds) {
  advance(state, seconds, Math.max(1, seconds / 5000));
  touch();
  pushLog(`Fast-forwarded ${formatDuration(seconds)}.`, 'info');
}
