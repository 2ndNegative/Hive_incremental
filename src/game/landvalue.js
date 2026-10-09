// What ground is worth — before the hive pays for it.
//
// The territory tab could always say how big a patch was and what it cost. It
// could never say what taking it would DO, so every claim was a guess followed
// by an hour of watching the intake to find out. This module is the answer to
// "and then what", and it is an expectation rather than a roll: the same
// arithmetic tick() runs, with the dice replaced by their averages.
//
// THE ONE RESULT WORTH KNOWING UP FRONT.
//
// Work the engine's forage sum through symbolically and the patches cancel out.
// Per drone type, computeDerived has:
//
//   open    = min(patches, floor(working))
//   perPatch = working / open
//   rate    = Σ over the `open` live patches of grams × perPatch × vigour / CYCLE
//
// Every live patch draws from the same distribution, so in expectation each one
// carries the same grams, and `open × perPatch` is just `working` again:
//
//   rate = working × E[grams] × vigour / CYCLE × harvest
//
// So the expected intake depends on how many drones the land will CARRY and on
// nothing else about its shape. Patch count decides the VARIANCE — twelve
// patches bring in twelve things at a twelfth the rate each instead of one thing
// in a lump — and variance is worth real money downstream, because a narrow
// intake overflows one item's shelf while the gut idles. But it is not intake,
// and a preview that promised otherwise would be lying.
//
// Which leaves two honest things to tell a player about a patch of ground:
//
//   1. How many more foragers it will carry — and therefore, at today's drone
//      count, whether it adds any intake AT ALL. A hive with no landless drones
//      gains nothing today from more of the same ground. That is the fact the
//      tab was hiding, and it is the one that decides whether to claim now or
//      hatch first.
//   2. What it changes about WHAT comes in. Share of the roll is area over total
//      area, so a new biome rewrites the mix and more of a held one barely moves
//      it. This is where a strange patch earns a price a familiar one does not.
//
// NOTHING HERE ROLLS, AND NOTHING HERE MUTATES. It is called from computeds in
// the interface, several times a second, and `poolFor` is memoised — but it
// walks every held biome's table, so it does not belong in tick().
//
// AND IT DOES NOT SPOIL. An item the hive has never found reads as ??? here
// exactly as it does in the offerings panel: a preview that named the contents
// of unexplored ground would hand the player the forage table for free.

import { BIOMES, landCapacity, patchCount, biomeShares } from './definitions/biomes.js';
import { DRONE_TYPES, foragingTypes } from './definitions/drones.js';
import { poolFor } from './definitions/forage.js';
import { preyFor, ORGANISMS } from './definitions/organisms.js';
import { ITEMS } from './definitions/items/index.js';
import { focusedOdds } from './focus.js';
import { isNamed, preyKey } from './discovery.js';
import { FORAGE_CYCLE } from './forage.js';

/**
 * Mean grams one trip brings back, for one drone of this type.
 *
 * Flat between the bounds, so the mean is the midpoint — see rollLoad. The load
 * belongs to the DRONE and not to the find: a forager that comes back with
 * hazelnuts comes back with the same weight of them as it would of bread, which
 * is why this figure does not depend on the biome.
 */
export function meanLoad(typeId) {
  const load = DRONE_TYPES[typeId]?.load;
  if (!load) return 0;
  const { min = 0, max = min } = load;
  return (min + max) / 2;
}

/**
 * What a gather route can find on one biome: items, plus prey for a hunter.
 *
 * Shaped for `focusedOdds`, which reads `key` first — so the prey entries carry
 * their prey key rather than being re-derived downstream.
 */
export function routePool(gather, biomeId) {
  if (gather === 'hunter') {
    return [
      ...preyFor(biomeId).map((p) => ({
        key: preyKey(p.organismId),
        organismId: p.organismId,
        name: ORGANISMS[p.organismId].name,
        weight: p.weight,
      })),
      ...poolFor('hunter', biomeId).map((p) => ({
        key: p.itemId, itemId: p.itemId, name: ITEMS[p.itemId].name, weight: p.weight,
      })),
    ];
  }
  return poolFor(gather, biomeId).map((p) => ({
    key: p.itemId, itemId: p.itemId, name: ITEMS[p.itemId].name, weight: p.weight,
  }));
}

/**
 * The chance one roll of this route finds anything at all, on this land.
 *
 * A roll picks a biome by area and then picks from what that biome offers the
 * route — and a biome can offer it nothing. A siphon working a hive of pure
 * desert comes back empty every single time, and that is the correct answer
 * rather than a bug, so the expectation has to carry it.
 */
export function hitChance(shares, gather) {
  let hit = 0;
  for (const [biomeId, share] of Object.entries(shares)) {
    if (routePool(gather, biomeId).length > 0) hit += share;
  }
  return hit;
}

/**
 * What the hive would find, and in what proportions, on a given set of
 * holdings. Keys are item ids and prey keys; values sum to the hit chance.
 *
 * The stars are honoured, because a player who has pointed a route at acorns
 * wants the preview to answer the question they are actually asking.
 */
export function findMix(state, territory, gather) {
  const shares = biomeShares({ territory });
  const mix = {};
  for (const [biomeId, share] of Object.entries(shares)) {
    const pool = routePool(gather, biomeId);
    if (!pool.length) continue;
    const odds = focusedOdds(state, gather, biomeId, pool);
    for (const entry of pool) {
      const chance = odds[entry.key] ?? 0;
      if (chance <= 0) continue;
      mix[entry.key] = (mix[entry.key] || 0) + share * chance;
    }
  }
  return mix;
}

/**
 * What foraging is worth on a given set of holdings, in grams a second.
 *
 * `drones` is a type -> count map, normally `state.droneTypes`; pass a different
 * one to ask what the same ground would be worth with a different hive on it.
 * The land is shared out in declared type order, exactly as computeDerived does
 * it, because which type goes landless first is a rule and not an accident.
 */
export function expectedForage(state, territory, {
  drones = state.droneTypes,
  vigour = 1,
  harvest = 1,
} = {}) {
  const shim = { territory };
  const capacity = landCapacity(shim);
  const patches = patchCount(shim);
  const shares = biomeShares(shim);

  const byType = [];
  const byFind = {};
  let total = 0;
  let working = 0;
  let landless = 0;
  let roomLeft = capacity;

  for (const typeId of foragingTypes()) {
    const count = drones?.[typeId] || 0;
    if (!count) continue;
    const def = DRONE_TYPES[typeId];
    const out = Math.max(0, Math.min(count, roomLeft));
    roomLeft -= out;

    const hit = hitChance(shares, def.gather);
    // The whole sum, with the patches already cancelled — see the header.
    const rate = (out * hit * meanLoad(typeId) * vigour * harvest) / FORAGE_CYCLE;

    byType.push({
      droneId: typeId,
      name: def.name,
      gather: def.gather,
      count,
      working: out,
      landless: count - out,
      hit,
      rate,
    });
    total += rate;
    working += out;
    landless += count - out;

    if (rate > 0) {
      // Split this type's rate across what it would find. The mix sums to the
      // hit chance rather than to 1, so dividing by it turns "chance of finding
      // this" into "share of what comes back".
      const mix = findMix(state, territory, def.gather);
      for (const [key, chance] of Object.entries(mix)) {
        byFind[key] = (byFind[key] || 0) + (rate * chance) / (hit || 1);
      }
    }
  }

  return { capacity, patches, working, landless, total, byType, byFind };
}

/** A find's name as the hive may say it — ??? until it has turned one up. */
export function labelFor(state, key) {
  if (!isNamed(state, key)) return null;
  if (key.startsWith('@')) return ORGANISMS[key.slice(1)]?.name ?? null;
  return ITEMS[key]?.name ?? null;
}

/**
 * WHAT CLAIMING THIS WOULD ACTUALLY GAIN.
 *
 * Both sides of the same sum: the hive's foraging as it stands, and as it would
 * stand on the larger holding. Everything the panel says is a difference between
 * two runs of one function, so the preview cannot drift away from the game.
 *
 * `shifts` is the mix comparison, biggest mover first, and it is deliberately
 * signed: taking more of the ground the hive already stands on makes a strange
 * biome's share FALL, and a player who is about to drown their acorn supply in
 * roadkill should be able to see it coming.
 */
export function claimPreview(state, biomeId, want, { vigour = 1, harvest = 1 } = {}) {
  const now = { ...(state.territory || {}) };
  const after = { ...now, [biomeId]: (now[biomeId] || 0) + Math.max(0, want) };
  const opts = { vigour, harvest };

  const before = expectedForage(state, now, opts);
  const gained = expectedForage(state, after, opts);

  const keys = new Set([...Object.keys(before.byFind), ...Object.keys(gained.byFind)]);
  const shifts = [...keys]
    .map((key) => ({
      key,
      label: labelFor(state, key),
      before: before.byFind[key] || 0,
      after: gained.byFind[key] || 0,
      delta: (gained.byFind[key] || 0) - (before.byFind[key] || 0),
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Ground the hive has never stood on. Its whole value is in the second list,
  // and if the hive has no foragers spare it is ENTIRELY in the second list.
  const fresh = !(now[biomeId] > 0);

  return {
    biomeId,
    def: BIOMES[biomeId],
    want,
    fresh,
    before,
    after: gained,
    // The three deltas that decide whether to buy.
    capacityGain: gained.capacity - before.capacity,
    patchGain: gained.patches - before.patches,
    // Drones standing around today that this ground would put to work. This is
    // the figure that makes the rate gain non-zero, and the reason a full hive
    // should hatch before it expands.
    employs: gained.working - before.working,
    // Snapped to zero at a thousandth of a microgram. The two sides are sums of
    // the same terms in a different order, so "no change" comes out as −1e−16 —
    // and a panel reading "−0 µg/s" looks like a bug in a way that "0" does not.
    rateGain: Math.abs(gained.total - before.total) < 1e-9 ? 0 : gained.total - before.total,
    // True when the land is already carrying every forager the hive owns, so
    // the claim buys headroom and a changed mix rather than intake today.
    headroomOnly: gained.working - before.working <= 0,
    shifts,
  };
}
