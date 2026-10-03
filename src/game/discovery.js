// What the hive knows about its own ground.
//
// The forage table is complete from the first tick — every weight, in every
// biome, for every one of five hundred items. The hive does not get to see it.
// It learns the same way anything learns: by going out, bringing something
// back, and doing that enough times for the pattern to mean something.
//
// THREE THINGS ARE LEARNED SEPARATELY
//   the name    known the first time a thing is found ANYWHERE. A hazelnut
//               found in a forest is a hazelnut in a hedgerow too, so naming is
//               global — it is knowledge about the thing, not about the ground.
//   the rate    learned per BIOME, because how common a hazelnut is somewhere
//               is a fact about that place. Below RANGE_AT finds it is not
//               known at all; past it the hive can bracket it; past EXACT_AT it
//               has the number.
//
// Counting happens on the ROLL, not on the gram: one forage cycle that comes
// back with hazelnuts is one observation of hazelnuts, however long the caste
// then spends gathering them. That is what makes the sample size mean
// something — it is a count of draws from the distribution.

/** Finds in one biome before the hive can bracket a rate at all. */
export const RANGE_AT = 10;

/** Finds in one biome before it has the exact figure. */
export const EXACT_AT = 25;

/**
 * The brackets a rate is reported in while it is still being learned.
 *
 * Coarse on purpose, and coarse in the way people actually estimate: the gap
 * between 1% and 2% matters, the gap between 51% and 52% does not.
 */
const BANDS = [0, 1, 2, 5, 10, 25, 50, 100];

/** Key for a prey species, kept clear of item ids. */
export function preyKey(organismId) {
  return `@${organismId}`;
}

function bucket(state, biomeId) {
  return state.found?.[biomeId];
}

/**
 * Record one observation. `key` is an item id, or preyKey(organismId).
 * Returns the new count in that biome.
 */
export function recordFind(state, biomeId, key) {
  if (!biomeId || !key) return 0;
  state.found ??= {};
  state.found[biomeId] ??= {};
  const next = (state.found[biomeId][key] || 0) + 1;
  state.found[biomeId][key] = next;
  return next;
}

/** How many times this has been found in this biome. */
export function timesFound(state, biomeId, key) {
  return bucket(state, biomeId)?.[key] || 0;
}

/** How many times this has been found anywhere. */
export function timesFoundAnywhere(state, key) {
  let total = 0;
  for (const biome of Object.values(state.found || {})) total += biome[key] || 0;
  return total;
}

/**
 * Does the hive know what this is? Global: finding a thing once names it
 * everywhere it occurs, including in ground the hive has never worked.
 */
export function isNamed(state, key) {
  for (const biome of Object.values(state.found || {})) {
    if (biome[key] > 0) return true;
  }
  return false;
}

/** 'unknown' | 'range' | 'exact' — how well the rate here is understood. */
export function rateConfidence(state, biomeId, key) {
  const seen = timesFound(state, biomeId, key);
  if (seen >= EXACT_AT) return 'exact';
  if (seen >= RANGE_AT) return 'range';
  return 'unknown';
}

/**
 * The bracket containing `chance` (0-1), as whole percents. Always contains the
 * true value — the hive's estimate is coarse, never wrong.
 */
export function bandFor(chance) {
  const pct = chance * 100;
  for (let i = 0; i < BANDS.length - 1; i += 1) {
    if (pct >= BANDS[i] && pct < BANDS[i + 1]) return [BANDS[i], BANDS[i + 1]];
  }
  return [BANDS[BANDS.length - 2], 100];
}

/** How a rate should be printed given what the hive has worked out so far. */
export function rateLabel(state, biomeId, key, chance) {
  switch (rateConfidence(state, biomeId, key)) {
    case 'exact':
      return `${(chance * 100).toFixed(0)}%`;
    case 'range': {
      const [lo, hi] = bandFor(chance);
      return `${lo}–${hi}%`;
    }
    default:
      return '?%';
  }
}

/** What to call something the hive may not have met yet. */
export function nameLabel(state, key, realName) {
  return isNamed(state, key) ? realName : '???';
}

/** Totals for the interface: how much of the ground has been worked out. */
export function discoverySummary(state) {
  const named = new Set();
  let observations = 0;
  let biomes = 0;
  for (const biome of Object.values(state.found || {})) {
    biomes += 1;
    for (const [key, count] of Object.entries(biome)) {
      if (count > 0) named.add(key);
      observations += count;
    }
  }
  return { named: named.size, observations, biomes };
}
