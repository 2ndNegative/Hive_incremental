// What ground is worth — before the hive pays for it.
//
// The territory tab could always say how big a patch was and what it cost. It
// could never say what taking it would DO, so every claim was a guess followed
// by an hour of watching the intake. This module is the answer to "and then
// what", and it is an expectation rather than a roll: the same arithmetic tick()
// runs, with the dice replaced by their averages.
//
// WHAT THE LAND REWRITE DID TO THIS FILE.
//
// The first version of it proved something true and useless. Under the old
// pooled-capacity model the patch count cancelled out of the forage sum, so the
// whole thing reduced to `working × hit × load × vigour / cycle`, and since the
// hive never came close to filling its ground, the honest answer to "what would
// claiming this gain" was almost always NOTHING. The preview had a warning box
// for it. A preview whose main job is to talk you out of the purchase is a sign
// that the purchase has no mechanics behind it, not that the player is wrong.
//
// Room is counted per biome now, and per drone type, with a range and a crowding
// curve each (land.js, drones.js). So the question has an answer with edges in
// it:
//
//   — how many more of each type this ground would carry, which is a count of
//     whole drones and not a ratio;
//   — whether it crosses a THRESHOLD. Fourteen more square metres of wetland
//     is the difference between no hunters and one hunter, and that is the most
//     useful sentence this file can produce;
//   — what it does to the hive's intake under the assignment it currently has,
//     which may be nothing if the player has not told anyone to go there.
//
// AND THE BIOME ROLL IS GONE, which simplifies the expectation rather than
// complicating it. A drone works the ground it was put on, so "what does this
// crew find" is one biome's table, and a biome that offers a route nothing
// yields exactly zero rather than diluting an average.
//
// NOTHING HERE ROLLS, AND NOTHING HERE MUTATES. It is called from computeds in
// the interface, several times a second, and `poolFor` is memoised — but it
// walks every held biome's table, so it does not belong in tick().
//
// AND IT DOES NOT SPOIL. An item the hive has never found reads as ??? here
// exactly as it does in the offerings panel: a preview that named the contents
// of unexplored ground would hand the player the forage table for free.

import { BIOMES } from './definitions/biomes.js';
import { DRONE_TYPES, foragingTypes } from './definitions/drones.js';
import { ORGANISMS } from './definitions/organisms.js';
import { ITEMS } from './definitions/items/index.js';
import { focusedOdds } from './focus.js';
import { isNamed } from './discovery.js';
import { FORAGE_CYCLE } from './forage.js';
import {
  assignmentOf, slotsOn, efficiencyOf, heldBiomes, routePool, offersAnything,
} from './land.js';

// Re-exported: callers of this module think in terms of what ground is worth,
// and "does it offer this route anything" is the first question they ask. The
// definitions live in land.js because the ENGINE needs them for the ration, and
// the engine should not be importing a valuation module.
export { routePool, offersAnything };

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
 * What the hive would find on one biome, and in what proportions. Keys are item
 * ids and prey keys; values sum to 1.
 *
 * The stars are honoured, because a player who has pointed a route at acorns
 * wants the preview to answer the question they are actually asking — and they
 * bite harder than they used to, since the pool a star competes inside is one
 * biome's rather than the whole map's.
 */
export function findMix(state, gather, biomeId) {
  const pool = routePool(gather, biomeId);
  if (!pool.length) return {};
  const odds = focusedOdds(state, gather, biomeId, pool);
  const mix = {};
  for (const entry of pool) {
    const chance = odds[entry.key] ?? 0;
    if (chance > 0) mix[entry.key] = chance;
  }
  return mix;
}

/**
 * What foraging is worth on a given set of holdings, in grams a second.
 *
 * `drones` is a type -> count map, normally `state.droneTypes`; `assign` is the
 * target plan, normally `state.assign`. Pass different ones to ask what the same
 * ground would be worth with a different hive or a different plan on it — which
 * is exactly what the claim preview does.
 */
export function expectedForage(state, territory, {
  drones = state.droneTypes,
  assign = state.assign,
  vigour = 1,
  harvest = 1,
} = {}) {
  const shim = { territory, assign, droneTypes: drones };
  const held = heldBiomes(shim);
  const assigned = assignmentOf(shim);

  const crews = [];
  const byFind = {};
  const room = {}; // type -> whole drones this territory would carry anywhere
  let total = 0;
  let working = 0;

  for (const typeId of foragingTypes()) {
    const def = DRONE_TYPES[typeId];
    room[typeId] = 0;
    for (const biomeId of held) {
      const slots = slotsOn(shim, biomeId, typeId);
      room[typeId] += Math.floor(slots);
      const here = assigned[typeId]?.[biomeId] || 0;
      if (here < 1) continue;

      const efficiency = efficiencyOf(slots, here, def.crowding ?? 1);
      const live = offersAnything(def.gather, biomeId);
      // No patch count in it: a patch IS a drone, so the crew's rate is simply
      // its headcount times what one of them manages.
      const rate = live
        ? (here * efficiency * meanLoad(typeId) * vigour * harvest) / FORAGE_CYCLE
        : 0;

      crews.push({
        droneId: typeId, biomeId, drones: here, slots, efficiency, live, rate,
      });
      total += rate;
      working += here;

      if (rate > 0) {
        const mix = findMix(state, def.gather, biomeId);
        for (const [key, chance] of Object.entries(mix)) {
          byFind[key] = (byFind[key] || 0) + rate * chance;
        }
      }
    }
  }

  const headcount = foragingTypes()
    .reduce((a, t) => a + Math.floor(drones?.[t] || 0), 0);
  return { crews, byFind, room, total, working, idle: headcount - working };
}

/** A find's name as the hive may say it — null until it has turned one up. */
export function labelFor(state, key) {
  if (!isNamed(state, key)) return null;
  if (key.startsWith('@')) return ORGANISMS[key.slice(1)]?.name ?? null;
  return ITEMS[key]?.name ?? null;
}

/**
 * How much more of this biome it would take to fit one more drone of each type.
 *
 * THE THRESHOLD IS THE POINT. Room is area over range, and range is per type, so
 * ground arrives in lumps of different sizes — fifty square metres of wetland is
 * twelve more foragers or one more hunter, and a two square metre sliver is
 * neither. A player who can see "14 m² short of your first hunter here" has an
 * expansion goal; one who can see only a price has a shrug.
 */
export function nextWholeDrone(state, biomeId, territory = state.territory) {
  const area = territory?.[biomeId] || 0;
  const out = [];
  for (const typeId of foragingTypes()) {
    const def = DRONE_TYPES[typeId];
    if (!def.range) continue;
    const slots = area / def.range;
    const have = Math.floor(slots);
    out.push({
      droneId: typeId,
      name: def.name,
      range: def.range,
      have,
      // Square metres to the next whole one. Exactly `range` when the ground is
      // empty, which is the honest reading: the first of anything costs a full
      // range, there is no founder's discount.
      needed: (have + 1) * def.range - area,
      // True when this ground does not hold even one, which is the case the
      // player most needs flagged — a biome can be bought and still be useless
      // to the type they wanted it for.
      none: have < 1,
      offers: offersAnything(def.gather, biomeId),
    });
  }
  return out;
}

/**
 * WHAT CLAIMING THIS WOULD ACTUALLY GAIN.
 *
 * Both sides of the same sum: the hive's foraging as it stands, and as it would
 * stand on the larger holding. Everything the panel says is a difference between
 * two runs of one function, so the preview cannot drift away from the game.
 *
 * `rateGain` is what the hive would ACTUALLY bring in more of, under the plan it
 * currently has — which is nothing at all if every drone is already pinned to a
 * target somewhere else. That is not a flaw in the preview, it is the answer:
 * ground with nobody on it grows nothing. `room` is the other half, and the half
 * a player is usually really buying.
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

  // Room, per type, on THIS biome rather than across the hive — the whole
  // reason the rewrite happened. Each entry says what the ground carries now,
  // what it would carry, and whether the claim crosses a whole-drone line.
  // Who ends up standing on this particular ground, before and after. Summed
  // over types out of the crew lists rather than re-running the assignment,
  // so it cannot disagree with the rates above it.
  const onHere = (run) => run.crews
    .filter((c) => c.biomeId === biomeId)
    .reduce((a, c) => a + c.drones, 0);
  const moving = onHere(gained) - onHere(before);

  const beforeRoom = nextWholeDrone(state, biomeId, now);
  const afterRoom = nextWholeDrone(state, biomeId, after);
  const capacity = afterRoom.map((a, i) => ({
    ...a,
    was: beforeRoom[i].have,
    gain: a.have - beforeRoom[i].have,
    // The sentence worth printing when the gain is zero: how much further it
    // would have to go before this type gets anything out of the purchase.
    shortBy: a.have > beforeRoom[i].have ? 0 : a.needed,
  }));

  return {
    biomeId,
    def: BIOMES[biomeId],
    want,
    fresh: !(now[biomeId] > 0),
    before,
    after: gained,
    capacity,
    // Snapped to zero at a thousandth of a microgram. The two sides are sums of
    // the same terms in a different order, so "no change" comes out as −1e−16 —
    // and a panel reading "−0 µg/s" looks like a bug in a way that "0" does not.
    rateGain: Math.abs(gained.total - before.total) < 1e-9 ? 0 : gained.total - before.total,
    // Drones that would end up standing HERE, rather than drones newly put to
    // work. Under per-biome room nobody is ever truly idle — a crowded crew is
    // inefficient, not unemployed — so "how many more are working" is almost
    // always zero and would be a useless thing to print. "How many walk over
    // here" is the question with an answer, and it is zero exactly when every
    // drone is pinned by a target somewhere else.
    employs: moving,
    // True when the claim buys room and nothing else today. Not a warning: it
    // is the normal case once the player is assigning deliberately, and the
    // room is what was being bought.
    roomOnly: moving <= 0,
    shifts,
  };
}
