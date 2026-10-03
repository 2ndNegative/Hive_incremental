// Player actions. Every mutation the player can cause goes through here.

import { state, pushLog } from './state.js';
import { NUTRIENTS, NUTRIENT_IDS, MICROS, isRevealed, isUsableFuel } from './definitions/nutrients.js';
import { STRUCTURES } from './definitions/structures.js';
import { CASTES, CASTE_ORDER } from './definitions/castes.js';
import { RESEARCH } from './definitions/research.js';
import { ITEMS } from './definitions/items/index.js';
import { structureCost, canAfford, computeDerived, affordableCount } from './engine.js';
import { formatMass } from './units.js';

const MANUAL_ITEM = 'pasture_grass';
const MANUAL_GRAMS = 40;

/**
 * Add an item's mass to the nutrient stores. This is the only path matter takes
 * into the hive, whether from a click, a caste or offline catch-up.
 * Returns the grams actually absorbed (overflow is lost in the usual way).
 */
export function ingestItem(itemId, grams) {
  const item = ITEMS[itemId];
  if (!item || grams <= 0) return 0;
  const derived = computeDerived(state);
  const scale = grams / 100;
  for (const [nutrient, per100] of Object.entries(item.per100g)) {
    if (!per100) continue;
    const amount = per100 * scale;
    const cap = derived.caps[nutrient];
    const next = (state.nutrients[nutrient] || 0) + amount;
    if (next > cap) {
      state.spilled[nutrient] = (state.spilled[nutrient] || 0) + (next - cap);
      state.nutrients[nutrient] = cap;
    } else {
      state.nutrients[nutrient] = next;
    }
  }
  state.stats.ingested += grams;
  return grams;
}

/** The click action. */
export function consumeBiomass() {
  state.stats.clicks += 1;
  return ingestItem(MANUAL_ITEM, MANUAL_GRAMS);
}

export const MANUAL_INTAKE = { itemId: MANUAL_ITEM, grams: MANUAL_GRAMS };

/* ----------------------------------------------------------------- structures */

export function buildStructure(id, count = 1) {
  const def = STRUCTURES[id];
  if (!def || !def.unlock(state)) return 0;

  const wanted = count === 'max' ? affordableCount(state, id) : count;
  if (wanted <= 0) return 0;

  const cost = structureCost(state, id, wanted);
  if (!canAfford(state, cost)) return 0;

  for (const [n, amount] of Object.entries(cost)) state.nutrients[n] -= amount;
  state.structures[id] += wanted;
  state.stats.built += wanted;
  pushLog(`Grew ${wanted > 1 ? `${def.name} ×${wanted}` : def.name}.`, 'build');
  return wanted;
}

/* --------------------------------------------------------------------- castes */

export function assignCaste(id, delta) {
  const def = CASTES[id];
  if (!def || !def.assignable || !def.unlock(state)) return 0;
  const derived = computeDerived(state);

  if (delta > 0) {
    const room = derived.slots[id] - state.castes[id];
    const moved = Math.min(delta, state.castes.dormant, room);
    if (moved <= 0) return 0;
    state.castes.dormant -= moved;
    state.castes[id] += moved;
    return moved;
  }

  const moved = Math.min(-delta, state.castes[id]);
  if (moved <= 0) return 0;
  state.castes[id] -= moved;
  state.castes.dormant += moved;
  return moved;
}

export function clearCastes() {
  for (const id of CASTE_ORDER) {
    if (id === 'dormant' || !CASTES[id].assignable) continue;
    state.castes.dormant += state.castes[id];
    state.castes[id] = 0;
  }
  pushLog('All drones returned to dormancy.', 'info');
}

/* -------------------------------------------------------------- energy source */

export function setGlobalFuel(preferred, fallback) {
  if (preferred && isUsableFuel(state, preferred)) state.energy.preferred = preferred;
  if (fallback && isUsableFuel(state, fallback)) state.energy.fallback = fallback;
}

export function setFuelOverride(consumerKey, preferred, fallback) {
  state.energy.overrides[consumerKey] = { preferred, fallback };
}

export function clearFuelOverride(consumerKey) {
  delete state.energy.overrides[consumerKey];
}

/* ------------------------------------------------------------------- research */

export function research(id) {
  const def = RESEARCH[id];
  if (!def || state.tech[id]) return false;
  if (!def.requires.every((req) => state.tech[req])) return false;
  if (!canAfford(state, def.cost)) return false;

  for (const [n, amount] of Object.entries(def.cost)) {
    if (n === 'insight') state.insight -= amount;
    else state.nutrients[n] -= amount;
  }

  // Snapshot which micros were invisible a moment ago, so the reveal can say
  // what the hive has been quietly sitting on.
  const hiddenBefore = MICROS.filter((n) => !isRevealed(state, n));
  state.tech[id] = true;
  state.stats.researched += 1;
  pushLog(`Research complete: ${def.name}.`, 'research');

  const revealed = hiddenBefore.filter((n) => isRevealed(state, n));
  if (revealed.length) {
    const held = revealed
      .filter((n) => (state.nutrients[n] || 0) > 0)
      .sort((a, b) => (state.nutrients[b] || 0) - (state.nutrients[a] || 0));
    pushLog(
      `${revealed.length} new compounds resolved: ${revealed.map((n) => NUTRIENTS[n].name).join(', ')}.`,
      'unlock',
    );
    if (held.length) {
      const top = held
        .slice(0, 4)
        .map((n) => `${formatMass(state.nutrients[n])} ${NUTRIENTS[n].name.toLowerCase()}`)
        .join(', ');
      pushLog(`Already in store, uncounted until now: ${top}.`, 'reveal');
      const lost = revealed.reduce((sum, n) => sum + (state.spilled[n] || 0), 0);
      if (lost > 0.001) {
        pushLog(`Records show ${formatMass(lost)} of it was discarded as overflow.`, 'reveal');
      }
    }
  }

  for (const line of def.unlocks || []) pushLog(`Unlocked: ${line}`, 'unlock');
  if (def.efficiency) {
    for (const [n, value] of Object.entries(def.efficiency)) {
      pushLog(`${NUTRIENTS[n].name} now yields ${Math.round(value * 100)}% more usable energy.`, 'unlock');
    }
  }
  return true;
}

/* ---------------------------------------------------------------------- flavour */

export function logIntro() {
  pushLog('Approach vector locked. Local biosphere is carbon-based and extraordinarily dense in energy.', 'info');
  pushLog('Select a landing site.', 'info');
}

export function logOfflineGain(seconds, before) {
  const gains = NUTRIENT_IDS.filter((n) => isRevealed(state, n))
    .map((n) => ({ n, delta: (state.nutrients[n] || 0) - (before[n] || 0) }))
    .filter((g) => g.delta > 0.01)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);
  const mins = Math.round(seconds / 60);
  const span = mins >= 1 ? `${mins} minute${mins === 1 ? '' : 's'}` : `${Math.round(seconds)}s`;
  pushLog(
    gains.length
      ? `Dormant for ${span}. Accumulated ${gains.map((g) => `${formatMass(g.delta)} ${NUTRIENTS[g.n].name.toLowerCase()}`).join(', ')}.`
      : `Dormant for ${span}. Nothing accumulated.`,
    'offline',
  );
}
