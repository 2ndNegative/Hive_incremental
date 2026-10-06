// Expeditions.
//
// An Explorer is the only drone that leaves and might not come back. It does
// not have a rate and it does not bring back a weight: it goes out for a fixed
// stretch of time and then ONE of five things is true, and which one decides
// whether the hive grows, eats, or is one drone lighter.
//
// THE TABLE
//   25%  nothing. The ground out there was ground.
//    5%  the explorer does not come back.
//   30%  a cache — 100 to 200 g of something worth carrying.
//   25%  ground the hive could take.
//   15%  ground that is held by people, or that the hive cannot live in at all.
//
// Ground found this way is NOT held. It sits unclaimed on the territory map
// until the hive pays for it — see actions.js claimTerritory. Mapping it is
// free; standing on it is not.
//
// Rolls happen in tick() and nowhere else, like forage rolls, because
// computeDerived runs many times a frame to paint the screen and a roll in
// there would mean the result changed every time anyone looked at it.

import { BIOMES, rollAdjacent, isDangerous, isColonisable, totalArea } from './definitions/biomes.js';
import { DRONE_TYPES, exploringTypes } from './definitions/drones.js';
import { poolFor } from './definitions/forage.js';
import { biomeShares } from './definitions/biomes.js';
import { recordFind } from './discovery.js';
import { ITEMS } from './definitions/items/index.js';
import { pickWeighted } from './forage.js';

/** The outcome table, in declared order. Weights are percentages and sum to 100. */
export const EXPEDITION_OUTCOMES = [
  { id: 'nothing', weight: 25, label: 'Nothing out there' },
  { id: 'lost', weight: 5, label: 'Did not come back' },
  { id: 'cache', weight: 30, label: 'Found something worth carrying' },
  { id: 'ground', weight: 25, label: 'Found ground' },
  { id: 'hostile', weight: 15, label: 'Found ground it cannot have' },
];

/** What a cache is worth, in grams. */
export const CACHE_GRAMS = { min: 100, max: 200 };

/** How big a found patch is, in square metres. */
export const PATCH_AREA = { min: 0.2, max: 8 };

/**
 * How long one expedition takes, in seconds, for this hive.
 *
 * Linear in area held: the ground an expedition has to cross to reach anywhere
 * new is the ground the hive already stands on. Never faster than the declared
 * figure — a hive smaller than the reference does not get a discount, it just
 * has nothing to cross.
 */
export function expeditionSeconds(state, typeId) {
  const def = DRONE_TYPES[typeId]?.expedition;
  if (!def) return 0;
  const scale = Math.max(1, totalArea(state) / (def.scaleArea || 36));
  return def.seconds * scale;
}

/** Pick one outcome from the table. */
export function rollOutcome(random = Math.random) {
  const total = EXPEDITION_OUTCOMES.reduce((a, o) => a + o.weight, 0);
  let roll = random() * total;
  for (const outcome of EXPEDITION_OUTCOMES) {
    roll -= outcome.weight;
    if (roll <= 0) return outcome.id;
  }
  return EXPEDITION_OUTCOMES[EXPEDITION_OUTCOMES.length - 1].id;
}

/** A number in [min, max], flat. */
function between(range, random) {
  return range.min + random() * (range.max - range.min);
}

/**
 * Resolve one completed expedition. Mutates state and returns what happened,
 * so the caller can log it — this is the one place an expedition's result is
 * decided, and the only place the unclaimed map grows.
 *
 * `hostile` and `ground` are the same roll with different ground under it: the
 * 15% branch deliberately looks for somewhere the hive would struggle, and
 * settles for whatever it finds if there is nowhere like that nearby.
 */
export function resolveExpedition(state, typeId, random = Math.random) {
  const outcome = rollOutcome(random);

  if (outcome === 'nothing') return { outcome };

  if (outcome === 'lost') {
    const held = state.droneTypes?.[typeId] || 0;
    if (held > 0) state.droneTypes[typeId] = held - 1;
    state.stats.explorersLost = (state.stats.explorersLost || 0) + 1;
    return { outcome, name: DRONE_TYPES[typeId]?.name ?? typeId };
  }

  if (outcome === 'cache') {
    // Rolled against the hive's own ground, the same two stages a forage roll
    // uses — an expedition finds what is out there, not what the hive wants.
    const shares = biomeShares(state);
    const biome = pickWeighted(
      Object.entries(shares).map(([id, share]) => ({ id, weight: share })),
      random,
    );
    if (!biome) return { outcome: 'nothing' };
    const pool = [...poolFor('forager', biome.id), ...poolFor('scavenger', biome.id)];
    const found = pickWeighted(pool, random);
    if (!found) return { outcome: 'nothing' };
    const grams = between(CACHE_GRAMS, random);
    state.items ??= {};
    state.items[found.itemId] = (state.items[found.itemId] || 0) + grams;
    recordFind(state, biome.id, found.itemId);
    state.stats.cachesFound = (state.stats.cachesFound || 0) + 1;
    return {
      outcome,
      itemId: found.itemId,
      name: ITEMS[found.itemId]?.name ?? found.itemId,
      biomeId: biome.id,
      grams,
    };
  }

  // Both ground branches roll the neighbourhood; the hostile one re-rolls a few
  // times looking for somewhere difficult, and takes what it gets if it cannot
  // find one. Rerolling rather than filtering keeps the adjacency table honest:
  // a hive nowhere near a road genuinely cannot find a road.
  let biomeId = rollAdjacent(state, random);
  if (outcome === 'hostile') {
    for (let i = 0; i < 6 && biomeId; i += 1) {
      if (isDangerous(biomeId) || !isColonisable(state, biomeId)) break;
      biomeId = rollAdjacent(state, random);
    }
  }
  if (!biomeId || !BIOMES[biomeId]) return { outcome: 'nothing' };

  const area = between(PATCH_AREA, random);
  state.unclaimed ??= {};
  state.unclaimed[biomeId] = (state.unclaimed[biomeId] || 0) + area;
  state.stats.groundFound = (state.stats.groundFound || 0) + area;

  return {
    outcome: outcome === 'hostile' ? 'hostile' : 'ground',
    biomeId,
    name: BIOMES[biomeId].name,
    area,
    dangerous: isDangerous(biomeId),
    colonisable: isColonisable(state, biomeId),
  };
}

/**
 * Advance every exploring type's progress and resolve whatever completes.
 * Returns the results, newest last, for the caller to log.
 *
 * Progress is per TYPE, not per drone — ten explorers push one shared cycle ten
 * times as fast, exactly as chambers do. It is the only model that survives
 * offline catch-up without storing a timer per drone.
 */
export function advanceExpeditions(state, dt) {
  const results = [];
  state.expedition ??= {};
  for (const typeId of exploringTypes()) {
    const count = state.droneTypes?.[typeId] || 0;
    if (count < 1) {
      delete state.expedition[typeId];
      continue;
    }
    const seconds = expeditionSeconds(state, typeId);
    if (!(seconds > 0)) continue;
    let progress = (state.expedition[typeId] || 0) + (count * dt) / seconds;
    // Bounded: a single offline step can span hours, and resolving three
    // thousand expeditions one at a time is a lot of work for a result nobody
    // watched happen. Twenty is enough to feel like a backlog cleared.
    let resolved = 0;
    while (progress >= 1 && resolved < 20) {
      progress -= 1;
      resolved += 1;
      results.push({ typeId, ...resolveExpedition(state, typeId) });
      // An explorer lost mid-batch cannot keep exploring.
      if ((state.droneTypes?.[typeId] || 0) < 1) {
        progress = 0;
        break;
      }
    }
    if (progress >= 1) progress = 0; // whatever is left over is abandoned
    state.expedition[typeId] = progress;
  }
  return results;
}
