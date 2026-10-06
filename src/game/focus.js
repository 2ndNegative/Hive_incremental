// Telling drones what to look for.
//
// A gathering route is a lottery: the drone walks onto a patch and brings back
// whatever that patch had. That is the right default — it is what makes land
// composition matter — but a hive that has worked a forest for an hour knows
// that ground better than the lottery implies, and it should be able to say so.
//
// A STAR IS NOT A FILTER. Discarding every trip that came back with the wrong
// thing would give perfect purity at the item's natural abundance, which in a
// forest of forty roughly-even items is a 95% waste of the route. What a star
// does instead is reserve a SHARE of the trips:
//
//   with probability F, the trip goes to something starred
//   otherwise it rolls the ground normally, starred items included
//
// So one star on a 5% item does not make it a 5% item that wastes 95% of the
// route — it makes it a ~76% item, which is fifteen times what chance gave and
// still visibly short of "every trip". The share is the whole knob, and it is
// readable off the screen in the form the player actually cares about: three
// trips in four come back with what you asked for.
//
// WHY THE SECOND STAR COSTS YOU
//
// F falls as 1/√n, so breadth is paid for rather than free:
//
//   1 star   75% to that item
//   2 stars  53% total, ~26% each
//   3 stars  43% total, ~14% each
//
// A flat F split n ways would be more intuitive and completely toothless —
// starring the whole table would simply reproduce the natural distribution, so
// there would be no reason not to. The √n curve is what makes "focus on one
// thing" a decision instead of a formality.
//
// THE REAL COST IS ELSEWHERE, and it needs no mechanism. A hive needs
// thirty-five nutrients. Tell a route to fetch one of them and it will fetch
// one of them. That is what makes "the forest does fat, the river does protein"
// the correct play rather than a flavour preference, and it is why there is no
// throughput penalty here yet.
//
// WHAT IS STARRABLE: ground whose rate the hive has actually pinned down, 25
// finds in that biome. Focus is a reward for having mapped a place properly,
// not an opening move — and it gives the discovery system a payoff it has been
// missing.

import { rateConfidence, preyKey } from './discovery.js';

/** The share of trips a single star claims. The one tuning knob. */
export const FOCUS_SHARE = 0.75;

/**
 * How much of the route n stars claim between them. Falls as 1/√n: two stars
 * claim less in total than one did, so spreading is a real cost rather than a
 * free split. See the table at the top of the file.
 */
export function focusStrength(n) {
  if (!n || n < 1) return 0;
  return FOCUS_SHARE / Math.sqrt(n);
}

/** Can this be starred yet? Only ground the hive has pinned down. */
export function isStarrable(state, biomeId, key) {
  return rateConfidence(state, biomeId, key) === 'exact';
}

/** The raw star set for one route on one biome, as a sparse object. */
function bucket(state, gather, biomeId) {
  return state.focus?.[gather]?.[biomeId];
}

/** Is this one starred? */
export function isStarred(state, gather, biomeId, key) {
  return Boolean(bucket(state, gather, biomeId)?.[key]);
}

/** Every key starred for this route on this biome. */
export function starsFor(state, gather, biomeId) {
  const set = bucket(state, gather, biomeId);
  return set ? Object.keys(set) : [];
}

/**
 * Star or unstar one entry. Refuses ground the hive has not pinned down, so
 * the rule holds wherever a star comes from — the panel, a test, the console.
 * Unstarring is always allowed: a star can outlive the knowledge that earned
 * it (see below), and the player must be able to take it off again.
 */
export function setStar(state, gather, biomeId, key, on) {
  if (!gather || !biomeId || !key) return false;
  if (on && !isStarrable(state, biomeId, key)) return false;
  state.focus ??= {};
  if (on) {
    state.focus[gather] ??= {};
    state.focus[gather][biomeId] ??= {};
    state.focus[gather][biomeId][key] = true;
    return true;
  }
  const set = bucket(state, gather, biomeId);
  if (!set) return true;
  delete set[key];
  // Sparse all the way down, so a save never carries empty scaffolding.
  if (!Object.keys(set).length) delete state.focus[gather][biomeId];
  if (!Object.keys(state.focus[gather] || {}).length) delete state.focus[gather];
  return true;
}

export function toggleStar(state, gather, biomeId, key) {
  return setStar(state, gather, biomeId, key, !isStarred(state, gather, biomeId, key));
}

/** Drop every star on one route and biome. */
export function clearStars(state, gather, biomeId) {
  const set = bucket(state, gather, biomeId);
  if (!set) return 0;
  const n = Object.keys(set).length;
  delete state.focus[gather][biomeId];
  if (!Object.keys(state.focus[gather] || {}).length) delete state.focus[gather];
  return n;
}

/**
 * The starred entries of a pool, and what share of the route they claim.
 *
 * `pool` is whatever the roll was going to draw from — [{ weight, itemId }] or
 * the hunter's mixture, each carrying the `key` the stars are filed under.
 *
 * A star on something this ground does not actually offer claims nothing. That
 * happens: stars are kept when the hive abandons ground (they are a standing
 * preference, not a fact about the land, and a player who reclaims a forest
 * should find their forest orders still there), so a star can be sitting on a
 * biome the hive is not holding, or on an item a changed mix no longer has.
 * Such a star is inert rather than an error — and because it still counts
 * against nothing, it cannot quietly dilute the stars that are working.
 */
export function focusOf(state, gather, biomeId, pool, keyOf) {
  const set = bucket(state, gather, biomeId);
  if (!set) return { starred: [], strength: 0 };
  const starred = pool.filter((e) => set[keyOf(e)]);
  return { starred, strength: focusStrength(starred.length) };
}

/**
 * The key a pool entry's stars are filed under. The same key discovery counts
 * finds against, so "starrable" and "pinned down" are the same question: an
 * item id, or a prey key for a hunter's quarry.
 */
export function keyOfEntry(entry) {
  if (entry.key) return entry.key;
  if (entry.organismId) return preyKey(entry.organismId);
  return entry.itemId ?? null;
}

/**
 * Draw one entry, honouring the stars.
 *
 * Two draws, not a reweighting: first whether this trip is a focused one, then
 * which starred thing it goes to — by natural abundance, so starring a common
 * and a rare item together does not flatten them into equals. A trip that is
 * not focused rolls the whole ground exactly as it always did, which is why
 * the effective rate of a starred item is slightly ABOVE the share: it keeps
 * its natural chance on the unfocused trips too.
 */
export function pickFocused(state, gather, biomeId, pool, pick, random = Math.random) {
  if (!pool.length) return null;
  const { starred, strength } = focusOf(state, gather, biomeId, pool, keyOfEntry);
  if (starred.length && random() < strength) {
    const got = pick(starred, random);
    if (got) return got;
  }
  return pick(pool, random);
}

/**
 * What each entry's chance per trip ACTUALLY is once the stars are on — the
 * figure the interface quotes and the yield estimate walks. Returns a map from
 * key to chance, summing to 1.
 */
export function focusedOdds(state, gather, biomeId, pool) {
  const out = {};
  const total = pool.reduce((a, e) => a + e.weight, 0);
  if (total <= 0) return out;
  const { starred, strength } = focusOf(state, gather, biomeId, pool, keyOfEntry);
  const starredTotal = starred.reduce((a, e) => a + e.weight, 0);
  const starSet = new Set(starred.map(keyOfEntry));

  for (const entry of pool) {
    const key = keyOfEntry(entry);
    const natural = entry.weight / total;
    // The unfocused trips are the whole table as usual; the focused ones are
    // split among the starred entries in proportion to their natural weight.
    const focused = starSet.has(key) && starredTotal > 0
      ? strength * (entry.weight / starredTotal)
      : 0;
    out[key] = focused + (1 - strength) * natural;
  }
  return out;
}
