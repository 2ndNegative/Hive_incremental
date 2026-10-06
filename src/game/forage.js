// Forage rolls.
//
// A gathering caste does not have a shopping list. Every forage cycle it picks
// a patch of the hive's land and brings back whatever that patch had, which is
// why the same forager returns hazelnuts on one run and discarded bread on the
// next.
//
// THE TWO-STAGE ROLL
//   1. Pick a biome, weighted purely by how much of it the hive holds. A hive
//      that is half city and half forest flips a coin.
//   2. Pick from what that biome offers this caste, weighted by abundance.
//
// Doing it in that order — rather than merging everything into one pool — is
// what makes territory composition matter rather than territory contents. Ten
// square metres of coast is ten square metres whether it holds four species or
// forty.
//
// Rolls happen in tick() and nowhere else. computeDerived is called many times
// a frame to paint the interface, and a roll inside it would mean the numbers
// changed every time anyone looked at them.

import { BIOMES, biomeShares, patchCount } from './definitions/biomes.js';
import { poolFor } from './definitions/forage.js';
import { preyFor, ORGANISMS } from './definitions/organisms.js';
import { CASTES, CASTE_ORDER } from './definitions/castes.js';
import { DRONE_TYPES, foragingTypes } from './definitions/drones.js';
import { recordFind, preyKey } from './discovery.js';
import { pickFocused, keyOfEntry, focusedOdds } from './focus.js';
import { ITEMS } from './definitions/items/index.js';


/** How long a caste stays on one find before rolling again, in seconds. */
export const FORAGE_CYCLE = 12;

/** Weighted pick from [{ weight, ... }]. Returns null for an empty pool. */
export function pickWeighted(pool, random = Math.random) {
  let total = 0;
  for (const entry of pool) total += entry.weight;
  if (total <= 0) return null;
  let roll = random() * total;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return pool[pool.length - 1];
}

/**
 * Roll one find for a caste. Mutates `state.forage[casteId]` and returns it.
 *
 * A roll can legitimately come up empty: a siphon working a hive made entirely
 * of desert finds no standing water, and that is the correct answer rather than
 * a bug. The slot records which biome it tried, so the interface can say so.
 */
export function rollForage(state, casteId, random = Math.random) {
  const def = CASTES[casteId];
  state.forage ??= {};
  const slot = (state.forage[casteId] ||= { elapsed: 0 });
  slot.itemId = null;
  slot.organismId = null;
  slot.biomeId = null;

  if (!def?.gather) return slot;

  const shares = biomeShares(state);
  const biomes = Object.entries(shares).map(([id, share]) => ({ id, weight: share }));
  const biome = pickWeighted(biomes, random);
  if (!biome) return slot; // no territory at all
  slot.biomeId = biome.id;

  if (def.gather === 'hunter') {
    // A hunter's pool is prey AND huntable items together. A deer is worth
    // butchering into a dozen cuts, so it is an organism; a shoal of anchovies
    // or a single lanternfish is just the thing itself, and giving every small
    // species its own butchery table would say nothing the item does not.
    const caught = pickFocused(
      state, 'hunter', biome.id,
      [...preyFor(biome.id), ...poolFor('hunter', biome.id)],
      pickWeighted, random,
    );
    if (caught?.organismId) {
      slot.organismId = caught.organismId;
      recordFind(state, biome.id, preyKey(caught.organismId));
    } else if (caught?.itemId) {
      slot.itemId = caught.itemId;
      recordFind(state, biome.id, caught.itemId);
    }
    return slot;
  }

  const found = pickFocused(
    state, def.gather, biome.id, poolFor(def.gather, biome.id), pickWeighted, random,
  );
  if (found) {
    slot.itemId = found.itemId;
    // One roll is one observation of this ground, whatever the caste then
    // spends twelve seconds carrying back.
    recordFind(state, biome.id, found.itemId);
  }
  return slot;
}

/**
 * How heavy this trip turned out to be, in grams, for one drone of this type.
 *
 * FLAT between the two bounds. The manual gather is weighted towards its middle
 * because a player feels every single press and a long tail reads as the button
 * being broken; nobody watches an individual forager, so the simple answer is
 * the right one here.
 */
export function rollLoad(def, random = Math.random) {
  const load = def?.load;
  if (!load) return 0;
  const { min = 0, max = min } = load;
  return min + random() * (max - min);
}

/**
 * Roll one trip for one patch. Mutates it and returns it.
 *
 * TWO ROLLS, NOT ONE: where this patch is and what is on it, exactly as a caste
 * did, and then how much of it came back. The weight is per TRIP and not per
 * drone — the drones on a patch are all working the same ground at the same
 * time, so they share its luck.
 *
 * Every patch rolls independently against the WHOLE territory, so a hive that
 * is half forest and half city will usually be working one of each — but not
 * always, and that is the point of holding more of one than the other.
 */
export function rollPatch(state, typeId, patch, random = Math.random) {
  const def = DRONE_TYPES[typeId];
  patch.itemId = null;
  patch.biomeId = null;
  patch.grams = 0;
  if (!def?.gather) return patch;

  const shares = biomeShares(state);
  const biome = pickWeighted(
    Object.entries(shares).map(([id, share]) => ({ id, weight: share })),
    random,
  );
  if (!biome) return patch; // no territory at all
  patch.biomeId = biome.id;

  // Through the stars: a route the player has focused on this ground sends a
  // share of its trips to what they asked for. See focus.js — an unfocused
  // trip still rolls the whole ground, so nothing is ever locked out.
  const found = pickFocused(
    state, def.gather, biome.id, poolFor(def.gather, biome.id), pickWeighted, random,
  );
  if (found) {
    patch.itemId = found.itemId;
    patch.grams = rollLoad(def, random);
    recordFind(state, biome.id, found.itemId);
  }
  return patch;
}

/** The patches a drone type is working, created and trimmed to fit the land. */
export function patchesFor(state, typeId) {
  state.patches ??= {};
  const want = patchCount(state);
  const have = (state.patches[typeId] ||= []);
  // Staggered rather than synchronised: patches created together would then
  // roll together forever, and the whole intake would step at once every
  // twelve seconds instead of drifting.
  while (have.length < want) {
    have.push({ elapsed: (FORAGE_CYCLE * have.length) / Math.max(1, want), itemId: null });
  }
  if (have.length > want) have.length = want;
  return have;
}

/**
 * Advance every caste's forage cycle. At most one roll per caste per tick:
 * during offline catch-up a single tick can span an hour, and queueing up three
 * hundred rolls to throw away two hundred and ninety-nine of them would be a
 * lot of work for the same answer.
 */
export function advanceForage(state, dt) {
  state.forage ??= {};
  for (const casteId of CASTE_ORDER) {
    const def = CASTES[casteId];
    if (!def.gather) continue;
    const slot = (state.forage[casteId] ||= { elapsed: FORAGE_CYCLE });
    slot.elapsed = (slot.elapsed || 0) + dt;
    const nothingYet = !slot.itemId && !slot.organismId;
    if (slot.elapsed >= FORAGE_CYCLE || nothingYet) {
      slot.elapsed = FORAGE_CYCLE > 0 ? slot.elapsed % FORAGE_CYCLE : 0;
      rollForage(state, casteId);
    }
  }

  // And the drones, which is where foraging lives now. One cycle per PATCH: a
  // type the hive holds none of does not roll at all, because a roll teaches
  // the hive about its own ground (see recordFind) and a hive with no foragers
  // has not learned anything by having none.
  state.patches ??= {};
  for (const typeId of foragingTypes()) {
    if ((state.droneTypes?.[typeId] || 0) < 1) {
      delete state.patches[typeId];
      continue;
    }
    for (const patch of patchesFor(state, typeId)) {
      patch.elapsed = (patch.elapsed || 0) + dt;
      if (patch.elapsed >= FORAGE_CYCLE || !patch.itemId) {
        patch.elapsed = FORAGE_CYCLE > 0 ? patch.elapsed % FORAGE_CYCLE : 0;
        rollPatch(state, typeId, patch);
      }
    }
  }
}

/** Drop every current find, so the next tick re-rolls against new land. */
export function resetForage(state) {
  state.forage = {};
  state.patches = {};
}

/** A readable description of a find, for the interface. Patch or caste slot. */
export function describeSlot(slot) {
  const biome = slot?.biomeId ? BIOMES[slot.biomeId] : null;
  if (!slot || !biome) return { label: 'Nothing — the hive holds no land', empty: true };
  if (slot.organismId) {
    return { label: ORGANISMS[slot.organismId].name, biome, organismId: slot.organismId };
  }
  if (slot.itemId) {
    return { label: ITEMS[slot.itemId].name, biome, itemId: slot.itemId };
  }
  return { label: `Nothing in the ${biome.name.toLowerCase()}`, biome, empty: true };
}

/** The same, for one of the parked castes' slots. */
export function describeFind(state, casteId) {
  return describeSlot(state.forage?.[casteId]);
}

/**
 * What a caste is worth per drone, averaged over everything it could roll.
 *
 * A caste no longer has a fixed yield, so "is this drone paying for itself"
 * cannot be read off its definition any more — it depends on the ground. This
 * walks the same two-stage distribution the roll uses and returns the expected
 * joules per second per drone, counting only fuels the hive can actually open.
 */
export function expectedYield(state, casteId, nutrients, tech, efficiency = {}) {
  const def = CASTES[casteId];
  if (!def?.gather || !def.harvestRate) return 0;

  const itemJoules = (itemId, grams) => {
    const item = ITEMS[itemId];
    if (!item) return 0;
    let total = 0;
    for (const [n, per100] of Object.entries(item.per100g)) {
      const nut = nutrients[n];
      if (!nut?.fuel) continue;
      if (nut.fuelRequires && !tech[nut.fuelRequires]) continue;
      total += ((per100 * grams) / 100) * nut.kjPerGram * 1000 * (efficiency[n] ?? 1);
    }
    return total;
  };

  let expected = 0;
  for (const [biomeId, share] of Object.entries(biomeShares(state))) {
    const pool =
      def.gather === 'hunter'
        ? preyFor(biomeId).map((p) => ({ weight: p.weight, organismId: p.organismId }))
        : poolFor(def.gather, biomeId);
    const total = pool.reduce((a, e) => a + e.weight, 0);
    if (total <= 0) continue; // this ground offers this caste nothing

    // The focused distribution, not the natural one: a player who has told
    // this route to fetch hazelnuts has changed what a drone is worth, and the
    // figure that answers "is this drone paying for itself" has to know it.
    const odds = focusedOdds(state, def.gather, biomeId, pool);

    for (const entry of pool) {
      const chance = odds[keyOfEntry(entry)] ?? entry.weight / total;
      let joules = 0;
      if (entry.organismId) {
        const org = ORGANISMS[entry.organismId];
        for (const [itemId, fraction] of Object.entries(org.parts)) {
          joules += itemJoules(itemId, def.harvestRate * fraction);
        }
      } else {
        joules = itemJoules(entry.itemId, def.harvestRate);
      }
      expected += share * chance * joules;
    }
  }
  return expected;
}
