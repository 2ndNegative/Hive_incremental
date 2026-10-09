// Who stands where, and how much room they have to do it in.
//
// THE OLD MODEL, AND WHY IT WENT.
//
// Land used to be one pooled ceiling. `landCapacity` counted square metres,
// multiplied by a constant, and handed back a number of drones; patches were
// 36 m² each because that was the Anthill's opening tile; and every patch rolled
// a biome against the whole territory before it rolled a find. Three
// consequences, all bad:
//
//   — Land constrained nothing. 2.5 m² a forager meant 540 m² carried 216 of
//     them, and cognition caps the hive two orders of magnitude below that. The
//     territory tab's whole job was to price something that was never scarce.
//   — Holding a sliver of everything was strictly correct. `patchCount` floored
//     at the number of biomes held, and every patch rolled the WHOLE territory,
//     so two square metres of anything bought full access to its forage table
//     for free. "Grab a bit of each" was not an exploit, it was the rule.
//   — There was no decision anywhere in it. Drones were shared out in declared
//     type order, which is a tiebreak, not a choice.
//
// WHAT REPLACED IT.
//
// A patch is one drone's ground. Its size is declared by the drone type, and
// room is counted PER BIOME:
//
//     slots(biome, type) = area(biome) / range(type)
//
// The hive no longer runs out of land. It runs out of farmland, and the ninety
// square metres of it that exist hold twenty foragers or two hunters and not
// both. That is the decision, and the player makes it by setting targets.
//
// AND THE BIOME ROLL IS GONE. A drone assigned to wetland is standing in the
// wetland; it rolls what is on that ground and nothing else. Two rolls became
// one, which makes the forage table legible — a forager on temperate forest
// draws from 29 items, not from an area-weighted blend of every biome held —
// and it makes the stars sharper, because a star now competes inside a pool the
// player chose rather than against the whole map.
//
// NOTHING HERE ROLLS AND NOTHING HERE MUTATES. It is read by computeDerived
// every frame and by the Territory tab's computeds, so it allocates as little
// as it can get away with.

import { BIOMES, BIOME_IDS } from './definitions/biomes.js';
import { DRONE_TYPES, foragingTypes } from './definitions/drones.js';
import { poolFor } from './definitions/forage.js';
import { preyFor, ORGANISMS } from './definitions/organisms.js';
import { ITEMS } from './definitions/items/index.js';
import { preyKey } from './discovery.js';

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
 * Does this ground offer this route anything at all?
 *
 * Binary now, and that is the simplification the assignment rewrite bought. It
 * used to be a probability — the share of the hive's land that had something on
 * it for this route, because every trip rolled a biome first. A drone standing
 * in a desert that offers siphons nothing comes back empty every single time,
 * and that is the correct answer rather than a bug.
 */
export function offersAnything(gather, biomeId) {
  return routePool(gather, biomeId).length > 0;
}

/** The biomes the hive actually stands on, in declared order. */
export function heldBiomes(state) {
  return BIOME_IDS.filter((id) => (state.territory?.[id] || 0) > 0);
}

/**
 * How many drones of this type the biome has room for, fractionally.
 *
 * Deliberately NOT floored. A biome with two thirds of a hunter's range in it
 * has two thirds of a slot, and that is a meaningful number — it is what the
 * crowding curve is applied to, and it is what tells the player how much more
 * ground buys the first whole hunter.
 */
export function slotsOn(state, biomeId, typeId) {
  const range = DRONE_TYPES[typeId]?.range;
  if (!range) return 0;
  return (state.territory?.[biomeId] || 0) / range;
}

/**
 * What one drone of this type actually manages, 0–1, with `drones` of them on
 * `slots` worth of room.
 *
 *     min(1, slots / drones) ** crowding
 *
 * Room to spare is not a bonus: a drone with twice the ground it needs still
 * only has two legs, so the ratio is clamped at 1. See CROWDING in drones.js
 * for what the exponent does and why one number produces both the forager's
 * gentle slope and the hunter's cliff.
 */
export function efficiencyOf(slots, drones, crowding = 1) {
  if (drones <= 0) return 0;
  if (slots <= 0) return 0;
  const share = Math.min(1, slots / drones);
  return share ** crowding;
}

/**
 * Hand out `total` whole drones across weighted buckets, largest remainder.
 *
 * Proportional, because a target is a RATIO as much as a number: asked for
 * three in the forest and two in the wetland with three drones in hand, the
 * player meant two and one, not three and none. Largest remainder rather than
 * rounding each independently, so the parts always add back up to the whole —
 * a drone lost to rounding is a drone that stands in the hive doing nothing and
 * cannot be found on any screen.
 *
 * Ties break towards the earlier bucket, which is declared biome order. It has
 * to break somewhere and an arbitrary rule that never changes is worth more
 * than a clever one that does.
 */
export function apportion(weights, total) {
  const keys = Object.keys(weights);
  const out = {};
  let sum = 0;
  for (const k of keys) {
    const w = Math.max(0, weights[k] || 0);
    out[k] = 0;
    sum += w;
  }
  if (sum <= 0 || total <= 0) return out;

  const want = Math.min(total, sum);
  let placed = 0;
  const rest = [];
  for (const k of keys) {
    const exact = ((weights[k] || 0) / sum) * want;
    const whole = Math.floor(exact);
    out[k] = whole;
    placed += whole;
    rest.push({ k, frac: exact - whole });
  }
  rest.sort((a, b) => b.frac - a.frac);
  for (let i = 0; placed < Math.floor(want) && i < rest.length; i += 1, placed += 1) {
    out[rest[i].k] += 1;
  }
  return out;
}

/**
 * Where every drone is standing: `{ [typeId]: { [biomeId]: count } }`.
 *
 * TARGETS FIRST, THEN THE REST SPREADS. A target is a plan and may name drones
 * the hive has not molded yet — that is the point of it, since the player
 * should be able to lay out a wetland hunting ground and then go and press the
 * hunters. Whatever is left over after the targets are met goes out by area
 * share, which is exactly what the game did before any of this existed. So a
 * player who never opens the assignment panel gets the old behaviour and a
 * player who sets one target gets one target honoured.
 */
export function assignmentOf(state) {
  const held = heldBiomes(state);
  const out = {};
  for (const typeId of foragingTypes()) {
    const have = Math.floor(state.droneTypes?.[typeId] || 0);
    const here = {};
    for (const id of held) here[id] = 0;
    out[typeId] = here;
    if (have <= 0 || !held.length) continue;

    // The plan, clipped to ground the hive still holds — a target left behind
    // on abandoned territory is not a claim on anything.
    const targets = {};
    let wanted = 0;
    for (const id of held) {
      const n = Math.max(0, Math.floor(state.assign?.[id]?.[typeId] || 0));
      targets[id] = n;
      wanted += n;
    }

    if (wanted >= have) {
      // More asked for than exist: hand out what there is in the ratio asked.
      Object.assign(here, apportion(targets, have));
      continue;
    }

    for (const id of held) here[id] = targets[id];
    const spare = have - wanted;
    if (spare <= 0) continue;

    // Unassigned drones go where the ground is, which is the pre-assignment
    // rule. Weighted by AREA rather than by free slots on purpose: free slots
    // would quietly pull every spare drone onto whichever biome the player had
    // deliberately left empty.
    //
    // GROUND WITH A TARGET ON IT IS SKIPPED. A target is a statement, not a
    // floor — asking for five foragers on the farm and then finding six there
    // is the interface overruling the player, and it is exactly the kind of
    // quiet correction that makes a system feel broken rather than clever. If
    // EVERY biome is spoken for, the leftovers have nowhere else to be and go
    // out by area across all of them rather than standing idle.
    const open = held.filter((id) => !targets[id]);
    const takers = open.length ? open : held;
    const byArea = {};
    for (const id of takers) byArea[id] = state.territory?.[id] || 0;
    const spread = apportion(byArea, spare);
    for (const id of takers) here[id] += spread[id] || 0;
  }
  return out;
}

/**
 * The whole picture, per biome and per type: what was asked for, who is
 * actually there, how much room they have and what that costs them.
 *
 * One pass, because the Territory tab wants all of it at once and computeDerived
 * wants the same numbers the tab is showing. `planned` is the figure that makes
 * targets useful before the drones exist — it counts room against the TARGET
 * rather than against the headcount, so a wetland laid out for four hunters
 * reads as full while the hive is still molding the first one.
 */
export function landUse(state) {
  const held = heldBiomes(state);
  const assigned = assignmentOf(state);
  const types = foragingTypes();

  const biomes = [];
  for (const biomeId of held) {
    const area = state.territory?.[biomeId] || 0;
    const crews = [];
    let claimed = 0; // m² spoken for by targets, for the "how full is it" bar
    for (const typeId of types) {
      const def = DRONE_TYPES[typeId];
      const slots = slotsOn(state, biomeId, typeId);
      const here = assigned[typeId]?.[biomeId] || 0;
      const target = Math.max(0, Math.floor(state.assign?.[biomeId]?.[typeId] || 0));
      claimed += target * def.range;
      if (!here && !target) continue;
      crews.push({
        biomeId,
        droneId: typeId,
        name: def.name,
        gather: def.gather,
        range: def.range,
        crowding: def.crowding ?? 1,
        slots,
        drones: here,
        target,
        // What each of them manages, and what the plan would manage once the
        // hive has molded it. Two figures because they answer two questions:
        // "is this working" and "will this work".
        efficiency: efficiencyOf(slots, here, def.crowding ?? 1),
        planned: efficiencyOf(slots, target, def.crowding ?? 1),
        // Whole drones of this type the biome would carry at full rate. The
        // number the player is really shopping for.
        room: Math.floor(slots),
      });
    }
    biomes.push({
      biomeId,
      def: BIOMES[biomeId],
      area,
      crews,
      drones: crews.reduce((a, c) => a + c.drones, 0),
      // Over 1 means the plan has promised the same ground to more drones than
      // it can carry — legal, and sometimes correct for a tolerant type, but
      // the tab should say so.
      claimed: area > 0 ? claimed / area : 0,
    });
  }
  return biomes;
}

/** `${typeId}:${biomeId}` — the key a crew's patches are stored under. */
export function crewKey(typeId, biomeId) {
  return `${typeId}:${biomeId}`;
}

/** Split one back apart. Biome ids never contain a colon; types never do either. */
export function splitCrewKey(key) {
  const at = key.indexOf(':');
  return at < 0 ? [key, null] : [key.slice(0, at), key.slice(at + 1)];
}
