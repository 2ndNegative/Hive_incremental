// Player actions. Every mutation the player can cause goes through here.

import { state, pushLog } from './state.js';
import {
  NUTRIENTS,
  NUTRIENT_IDS,
  MICROS,
  isRevealed,
  isUsableFuel,
  itemYield,
  settleReveal,
} from './definitions/nutrients.js';
import { STRUCTURES, maxLevelOf } from './definitions/structures.js';
import { CASTES, CASTE_ORDER } from './definitions/castes.js';
import { RESEARCH } from './definitions/research.js';
import { ITEMS } from './definitions/items/index.js';
import { structureCost, canAfford, computeDerived, affordableCount } from './engine.js';
import { formatMass } from './units.js';
import { biomeShares } from './definitions/biomes.js';
import { poolFor } from './definitions/forage.js';
import { pickWeighted } from './forage.js';
import {
  recordFind,
  isNamed,
  blendedConfidence,
  labelForConfidence,
  timesFoundAnywhere,
} from './discovery.js';

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
  for (const [nutrient, amount] of Object.entries(itemYield(state, item.per100g, grams))) {
    if (amount <= 0) continue;
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

/**
 * The click action: a drone picks up whatever is within reach and eats it.
 *
 * Reach means the hive's own land, so the roll is the same two-stage roll every
 * caste makes — a biome by area share, then something from it. It draws on the
 * foraged and scavenged pools together, because those are the two things a
 * drone can simply pick up; rock has to be dug and water has to be siphoned.
 *
 * Unlike a caste's harvest this goes straight to the nutrient stores rather
 * than into storage. One drone chewing a mouthful does not need an organ.
 */
export function consumeBiomass() {
  state.stats.clicks += 1;

  const shares = biomeShares(state);
  const biome = pickWeighted(Object.entries(shares).map(([id, weight]) => ({ id, weight })));
  if (!biome) {
    state.lastGather = { itemId: null, biomeId: null, grams: 0 };
    return 0;
  }

  const pool = [...poolFor('forager', biome.id), ...poolFor('scavenger', biome.id)];
  const found = pickWeighted(pool);
  if (!found) {
    state.lastGather = { itemId: null, biomeId: biome.id, grams: 0 };
    return 0;
  }

  state.lastGather = { itemId: found.itemId, biomeId: biome.id, grams: MANUAL_GRAMS };
  recordFind(state, biome.id, found.itemId);
  return ingestItem(found.itemId, MANUAL_GRAMS);
}

export const MANUAL_INTAKE = { grams: MANUAL_GRAMS };

/**
 * What a click could turn up, likeliest first — the whole distribution rather
 * than a prediction, since the roll happens on the click. Shares are folded in,
 * so a hive that is nine parts city shows city food at the top.
 *
 * AS FAR AS THE HIVE KNOWS
 * The true table is in here and the hive does not get to read it. Exactly the
 * same discovery log the Territory tab works from decides what this list says:
 * a thing it has never picked up is `???` at `?%`, finding it once anywhere
 * names it here too, and the rate sharpens as the ground gets walked. Because
 * both screens read `state.found` and nothing else, they can never disagree —
 * naming a hazelnut by clicking names it in the territory table in the same
 * frame.
 *
 * A click can land in any biome the hive holds, so its odds are a BLEND, and a
 * blend is only as well understood as the worst-known ground in it. That is
 * what `blendedConfidence` is for: a hive that knows its forest exactly still
 * reports `?%` for anything that might instead have come out of ground it has
 * never worked.
 */
export function manualOdds(limit = 8) {
  const shares = biomeShares(state);
  const weights = {};
  const sources = {}; // itemId -> biome ids that could produce it
  let total = 0;
  for (const [biomeId, share] of Object.entries(shares)) {
    const pool = [...poolFor('forager', biomeId), ...poolFor('scavenger', biomeId)];
    const sum = pool.reduce((a, e) => a + e.weight, 0);
    if (sum <= 0) continue;
    for (const { itemId, weight } of pool) {
      const p = share * (weight / sum);
      weights[itemId] = (weights[itemId] || 0) + p;
      (sources[itemId] ||= new Set()).add(biomeId);
      total += p;
    }
  }
  return Object.entries(weights)
    .map(([itemId, p]) => {
      const chance = total > 0 ? p / total : 0;
      const biomeIds = [...(sources[itemId] || [])];
      const named = isNamed(state, itemId);
      const level = blendedConfidence(state, biomeIds, itemId);
      return {
        itemId,
        name: ITEMS[itemId].name,
        chance,
        // What the interface is allowed to print.
        label: named ? ITEMS[itemId].name : '???',
        rate: labelForConfidence(level, chance),
        named,
        level,
        biomeIds,
        seen: timesFoundAnywhere(state, itemId),
      };
    })
    // Still sorted by the TRUE chance: the order of the list is itself the
    // weak hint, exactly as it is in the territory table.
    .sort((a, b) => b.chance - a.chance)
    .slice(0, limit);
}

/** How much of what a click could turn up the hive can actually read. */
export function manualOddsSummary() {
  const all = manualOdds(Infinity);
  return {
    total: all.length,
    named: all.filter((o) => o.named).length,
    exact: all.filter((o) => o.level === 'exact').length,
  };
}

/* ----------------------------------------------------------------- structures */

export function buildStructure(id, count = 1) {
  const def = STRUCTURES[id];
  if (!def || !def.unlock(state)) return 0;

  let wanted = count === 'max' ? affordableCount(state, id) : count;
  // A levelled structure is one thing you upgrade, so "build 5" means "take it
  // five levels higher" and it stops at its cap rather than quietly overshooting.
  const headroom = maxLevelOf(id) - (state.structures[id] || 0);
  wanted = Math.min(wanted, headroom);
  if (wanted <= 0) return 0;

  const cost = structureCost(state, id, wanted);
  if (!canAfford(state, cost)) return 0;

  const had = state.structures[id] || 0;
  for (const [n, amount] of Object.entries(cost)) state.nutrients[n] -= amount;
  state.structures[id] += wanted;
  state.stats.built += wanted;

  // Something raised from nothing is raised lit, whatever the last one of its
  // kind browned out to. Upgrading one that is already standing does NOT reset
  // it: a dark Hivecore taken up a level is a bigger dark Hivecore.
  if (had === 0) {
    state.power ??= {};
    state.power[id] = 1;
  }
  pushLog(
    def.leveled
      ? `${def.name} raised to level ${state.structures[id]}.`
      : `Grew ${wanted > 1 ? `${def.name} ×${wanted}` : def.name}.`,
    'build',
  );
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

/* ------------------------------------------------------------------ cognition */

/**
 * Hold a block of bandwidth while something is under way.
 *
 * Cognition is a width, so an action does not spend cogits — it occupies them,
 * and gives them back when it finishes. The key is whatever is holding it, so a
 * second call with the same key replaces rather than stacks; that way an action
 * that restarts cannot leak its own reservation.
 *
 * Returns false if the hive does not have the free bandwidth to hold it.
 */
export function reserveCogits(key, amount, label) {
  if (!key || !(amount > 0)) return false;
  state.cognition ??= { reservations: {} };
  state.cognition.reservations ??= {};

  const existing = state.cognition.reservations[key]?.amount || 0;
  const { free } = computeDerived(state).cognition;
  if (amount - existing > free) return false;

  state.cognition.reservations[key] = { amount, label: label || key };
  return true;
}

/** Give a block of bandwidth back. */
export function releaseCogits(key) {
  if (state.cognition?.reservations) delete state.cognition.reservations[key];
}

/** Give all of it back — used when a run ends or an origin is chosen. */
export function releaseAllCogits() {
  state.cognition = { reservations: {} };
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

      // Those grams were never extra mass — they have been riding inside the
      // macros all along. Now that the hive can tell them apart, they come out.
      const drawn = settleReveal(state, revealed);
      const bill = Object.entries(drawn)
        .filter(([, grams]) => grams > 0.001)
        .sort((a, b) => b[1] - a[1])
        .map(([n, grams]) => `${formatMass(grams)} off the ${NUTRIENTS[n].name.toLowerCase()}`);
      if (bill.length) {
        pushLog(`Separating it out draws ${bill.join(' and ')}. The mass was always the same mass.`, 'reveal');
      }

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
