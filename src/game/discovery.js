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
//
// A ROLL IS NOW A DRONE. It used to be a patch, and patches were capped at
// twelve however large the hive grew, so observations arrived at a fixed rate
// forever. Under the land rewrite every drone rolls its own ground every cycle,
// so a crew of sixty learns sixty times faster than a crew of one — which is
// both obviously right and ten times the old pace at a modest headcount. The
// thresholds went up to match. They are a count of observations, not of
// minutes, so they stay honest at any size: a big hive learns its ground
// quickly because it has a lot of drones looking at it, which is the sentence
// the mechanic should have been saying all along.
//
// Raising them rewrote history for saves that had already banked finds, so the
// v23 migration multiplies stored counts by DISCOVERY_RESCALE. Change these two
// together or a returning hive forgets what it knew.

/** Finds in one biome before the hive can bracket a rate at all. */
export const RANGE_AT = 100;

/** Finds in one biome before it has the exact figure. */
export const EXACT_AT = 350;

/**
 * What the thresholds were multiplied by when a roll stopped being a patch and
 * started being a drone. Read by the save migration, and by nothing else.
 */
export const DISCOVERY_RESCALE = 10;

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

/** Confidence levels, worst first, so two can be compared. */
const CONFIDENCE_RANK = { unknown: 0, range: 1, exact: 2 };

/**
 * How well a rate BLENDED across several biomes is understood.
 *
 * A click can turn up anywhere the hive holds ground, so the odds it reports
 * are a mixture — and a mixture is known no better than the least-known thing
 * going into it. A hive that has worked its forest to death still cannot say
 * what a click will turn up if half of it is city it has never walked.
 *
 * With no contributing ground at all there is nothing to know, so: unknown.
 */
export function blendedConfidence(state, biomeIds, key) {
  let worst = null;
  for (const biomeId of biomeIds) {
    const level = rateConfidence(state, biomeId, key);
    if (worst === null || CONFIDENCE_RANK[level] < CONFIDENCE_RANK[worst]) worst = level;
    if (worst === 'unknown') break;
  }
  return worst ?? 'unknown';
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

/**
 * How a rate reads at a given confidence. The one place that decides what a
 * percentage looks like, so every screen that quotes odds — the territory table
 * and the gather button alike — obfuscates them identically.
 */
export function labelForConfidence(level, chance) {
  switch (level) {
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

/** How a rate should be printed given what the hive has worked out so far. */
export function rateLabel(state, biomeId, key, chance) {
  return labelForConfidence(rateConfidence(state, biomeId, key), chance);
}

/** What to call something the hive may not have met yet. */
export function nameLabel(state, key, realName) {
  return isNamed(state, key) ? realName : '???';
}
