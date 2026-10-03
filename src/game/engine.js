// The simulation.
//
// THE ONE IDEA THIS GAME IS BUILT ON
// There is no energy resource. The hive's energy is the energy held in the mass
// it is standing on:
//
//     storedEnergy(J) = Σ nutrient[n] (g) × kjPerGram[n] × 1000
//
// Spending energy is therefore always an act of destroying matter. A consumer
// that wants 1 kW for a second must metabolise 27 mg of fat, or 59 mg of
// carbohydrate, or — if you pointed it at sodium — an infinite amount of
// sodium, because sodium carries no energy at all. That is what `preferred` and
// `fallback` are choosing between.
//
// RESOLUTION ORDER
//   1. multipliers, metabolic efficiencies and capacities
//   2. energy demand: basal + caste work + structure upkeep
//   3. throughput ceiling (structures cap how fast mass can be oxidised)
//   4. fuel allocation: preferred store, then fallback, then starvation
//   5. harvest, scaled by how much of the energy demand was actually met
//   6. item mass decomposed into nutrient inflow
//
// Stages 4 and 5 are deliberately circular-free: harvest never feeds the energy
// that powers the harvest within the same tick. Mass arrives, and next tick it
// is available to burn.

import {
  NUTRIENTS,
  NUTRIENT_IDS,
  MACROS,
  MICROS,
  joulesPerGram,
  isRevealed,
  isUsableFuel,
} from './definitions/nutrients.js';
import { STRUCTURES, STRUCTURE_ORDER } from './definitions/structures.js';
import {
  CASTES,
  CASTE_ORDER,
  BASAL_WATTS,
  BASAL_WATER_PER_SECOND,
  MULTIPLIERS,
} from './definitions/castes.js';
import { RESEARCH, RESEARCH_ORDER } from './definitions/research.js';
import { ITEMS } from './definitions/items/index.js';
import { ORGANISMS } from './definitions/organisms.js';

export const TICK_MS = 100;
export const TICK_SECONDS = TICK_MS / 1000;
const MAX_CATCHUP_SECONDS = 5;
// No cap on absence: see offline.js, which scales the step size instead so the
// work stays bounded however long the player has been away.

const BASE_THROUGHPUT_WATTS = 2_000;
const BASE_INSIGHT_CAP = 200;
const BASE_DRONE_CAP = 3;
const DRONE_PROTEIN_COST = 180; // grams of protein per new drone
const GROWTH_PER_SECOND = 0.04;
const STARVE_SECONDS = 25; // at zero energy, how long until a drone is lost

const EPSILON = 1e-12;

/* ------------------------------------------------------------ capacity groups */

/** Which capMult channel a nutrient's storage obeys. */
function capGroup(id) {
  const def = NUTRIENTS[id];
  if (def.tier === 'macro') return 'bulk';
  return def.group === 'lipidAssay' || def.group === 'aqueousAssay' ? 'vitamin' : 'mineral';
}

/* -------------------------------------------------------------------- derived */

function computeMultipliers(state) {
  const mult = {};
  for (const channel of MULTIPLIERS) mult[channel] = 0;
  for (const id of STRUCTURE_ORDER) {
    const count = state.structures[id] || 0;
    const bonuses = STRUCTURES[id].mult;
    if (!count || !bonuses) continue;
    for (const [channel, value] of Object.entries(bonuses)) {
      mult[channel] = (mult[channel] || 0) + value * count;
    }
  }
  return mult;
}

/** Metabolic efficiency per fuel: joules extracted per joule of stored mass. */
function computeEfficiency(state) {
  const eff = {};
  for (const id of NUTRIENT_IDS) eff[id] = 1;
  for (const tid of RESEARCH_ORDER) {
    if (!state.tech[tid]) continue;
    const bonus = RESEARCH[tid].efficiency;
    if (!bonus) continue;
    for (const [n, value] of Object.entries(bonus)) eff[n] += value;
  }
  return eff;
}

function computeCaps(state) {
  const capMult = { bulk: 0, mineral: 0, vitamin: 0 };
  for (const id of STRUCTURE_ORDER) {
    const count = state.structures[id] || 0;
    const m = STRUCTURES[id].capMult;
    if (!count || !m) continue;
    for (const [group, value] of Object.entries(m)) capMult[group] += value * count;
  }

  const caps = {};
  for (const id of NUTRIENT_IDS) {
    caps[id] = NUTRIENTS[id].baseCap * (1 + capMult[capGroup(id)]);
  }

  let droneCap = BASE_DRONE_CAP;
  let insightCap = BASE_INSIGHT_CAP;
  let throughput = BASE_THROUGHPUT_WATTS;
  for (const id of STRUCTURE_ORDER) {
    const count = state.structures[id] || 0;
    if (!count) continue;
    const def = STRUCTURES[id];
    droneCap += (def.caps?.drones || 0) * count;
    insightCap += (def.insightCap || 0) * count;
    throughput += (def.throughput || 0) * count;
  }

  return { caps, capMult, droneCap, insightCap, throughput };
}

function computeSlots(state) {
  const slots = {};
  for (const id of CASTE_ORDER) {
    const def = CASTES[id];
    if (!def.slots) {
      slots[id] = Infinity;
      continue;
    }
    let total = 0;
    for (const sid of STRUCTURE_ORDER) {
      const count = state.structures[sid] || 0;
      const provided = STRUCTURES[sid].slots?.[def.slots];
      if (count && provided) total += provided * count;
    }
    slots[id] = total;
  }
  return slots;
}

/** Total energy currently held in the hive's mass, in joules. */
export function storedEnergy(state) {
  let total = 0;
  for (const id of NUTRIENT_IDS) {
    total += (state.nutrients[id] || 0) * joulesPerGram(id);
  }
  return total;
}

/** Energy available right now — only from fuels the hive can actually open. */
export function usableEnergy(state) {
  let total = 0;
  for (const id of NUTRIENT_IDS) {
    if (!isUsableFuel(state, id)) continue;
    total += (state.nutrients[id] || 0) * joulesPerGram(id);
  }
  return total;
}

/** The fuel pair a given consumer uses, honouring any per-consumer override. */
export function fuelChoiceFor(state, consumerKey) {
  const override = state.energy.overrides?.[consumerKey];
  const preferred = override?.preferred ?? state.energy.preferred;
  const fallback = override?.fallback ?? state.energy.fallback;
  return { preferred, fallback, overridden: Boolean(override) };
}

/**
 * Turn authored state into every number the game and UI need.
 *
 * `dt` is the window the fuel allocation is planned over. It only matters at
 * the moment a store empties, where it decides how much of this step the
 * preferred fuel can still cover before the fallback takes the rest.
 */
export function computeDerived(state, dt = TICK_SECONDS) {
  const mult = computeMultipliers(state);
  const efficiency = computeEfficiency(state);
  const { caps, capMult, droneCap, insightCap, throughput } = computeCaps(state);
  const slots = computeSlots(state);

  /* -- 2. energy demand ---------------------------------------------------- */

  const demands = []; // { key, label, watts }
  const basal = (state.drones || 0) * BASAL_WATTS;
  if (basal > 0) demands.push({ key: 'basal', label: `Basal metabolism ×${state.drones}`, watts: basal });

  for (const id of CASTE_ORDER) {
    const assigned = state.castes[id] || 0;
    const def = CASTES[id];
    if (!assigned || !def.workWatts) continue;
    demands.push({
      key: `caste:${id}`,
      label: `${def.name} ×${assigned}`,
      watts: def.workWatts * assigned,
    });
  }
  for (const id of STRUCTURE_ORDER) {
    const count = state.structures[id] || 0;
    const def = STRUCTURES[id];
    if (!count || !def.upkeepWatts) continue;
    demands.push({
      key: `structure:${id}`,
      label: `${def.name} ×${count}`,
      watts: def.upkeepWatts * count,
    });
  }

  const totalDemand = demands.reduce((sum, d) => sum + d.watts, 0);

  /* -- 3. throughput ceiling ----------------------------------------------- */

  const throughputRatio = totalDemand > EPSILON ? Math.min(1, throughput / totalDemand) : 1;

  /* -- 4. fuel allocation --------------------------------------------------- */

  // Plan against a virtual budget so two consumers cannot each spend the last
  // gram of fat. Order follows `demands`, so basal metabolism is fed first —
  // the hive keeps itself alive before it powers its workforce.
  const budget = {};
  for (const id of NUTRIENT_IDS) budget[id] = state.nutrients[id] || 0;

  const burn = {}; // nutrient -> grams per second
  let deliveredWatts = 0;
  const perConsumer = {}; // key -> { watts, delivered, ratio, from: {nutrient: g/s} }

  for (const demand of demands) {
    const wanted = demand.watts * throughputRatio;
    const { preferred, fallback } = fuelChoiceFor(state, demand.key);
    const order = [preferred, fallback].filter(
      (n, i, arr) => n && arr.indexOf(n) === i && isUsableFuel(state, n),
    );

    let remainingJoules = wanted * dt;
    const from = {};
    for (const nutrient of order) {
      if (remainingJoules <= EPSILON) break;
      const perGram = joulesPerGram(nutrient) * efficiency[nutrient];
      if (perGram <= EPSILON) continue; // a zero-energy "fuel" can never pay
      const gramsWanted = remainingJoules / perGram;
      const gramsTaken = Math.min(gramsWanted, budget[nutrient]);
      if (gramsTaken <= EPSILON) continue;
      budget[nutrient] -= gramsTaken;
      burn[nutrient] = (burn[nutrient] || 0) + gramsTaken / dt;
      from[nutrient] = (from[nutrient] || 0) + gramsTaken / dt;
      remainingJoules -= gramsTaken * perGram;
    }

    const deliveredJoules = wanted * dt - remainingJoules;
    deliveredWatts += deliveredJoules / dt;
    perConsumer[demand.key] = {
      label: demand.label,
      watts: demand.watts,
      delivered: deliveredJoules / dt,
      ratio: wanted > EPSILON ? deliveredJoules / (wanted * dt) : 1,
      from,
    };
  }

  // How much of what the hive asked for it actually got. Everything that does
  // work is scaled by this, so a starving hive visibly slows down.
  const energyRatio = totalDemand > EPSILON ? deliveredWatts / totalDemand : 1;

  /* -- 5 & 6. harvest and nutrient inflow ----------------------------------- */

  const itemFlow = {}; // itemId -> grams per second
  let insightRate = 0;

  for (const id of CASTE_ORDER) {
    const assigned = state.castes[id] || 0;
    const def = CASTES[id];
    if (!assigned || !def.assignable) continue;
    const scale = (1 + (def.mult ? mult[def.mult] || 0 : 0)) * energyRatio;

    for (const [itemId, perDrone] of Object.entries(def.harvest || {})) {
      itemFlow[itemId] = (itemFlow[itemId] || 0) + perDrone * assigned * scale;
    }

    // Hunters butcher a whole organism; the yield table does the rest.
    if (def.organism && def.harvestRate) {
      const org = ORGANISMS[def.organism];
      const liveGrams = def.harvestRate * assigned * scale;
      for (const [itemId, fraction] of Object.entries(org.parts)) {
        itemFlow[itemId] = (itemFlow[itemId] || 0) + liveGrams * fraction;
      }
    }

    if (def.insight) insightRate += def.insight * assigned * scale;
  }

  const inflow = {};
  const flowSources = {}; // nutrient -> [{ label, amount }]
  let ingestRate = 0;
  for (const [itemId, gramsPerSecond] of Object.entries(itemFlow)) {
    const item = ITEMS[itemId];
    if (!item || gramsPerSecond <= EPSILON) continue;
    ingestRate += gramsPerSecond;
    const scale = gramsPerSecond / 100;
    for (const [nutrient, per100] of Object.entries(item.per100g)) {
      if (!per100) continue;
      const amount = per100 * scale;
      inflow[nutrient] = (inflow[nutrient] || 0) + amount;
      (flowSources[nutrient] ||= []).push({ label: item.name, amount });
    }
  }
  for (const [nutrient, grams] of Object.entries(burn)) {
    (flowSources[nutrient] ||= []).push({ label: 'Metabolised', amount: -grams });
  }

  // Water is lost continuously and is not an energy source, so it is drawn
  // directly rather than going through the fuel allocation above.
  const waterLoss = Math.min(
    (state.drones || 0) * BASAL_WATER_PER_SECOND,
    (state.nutrients.water || 0) / Math.max(dt, EPSILON),
  );
  if (waterLoss > 0) {
    burn.water = (burn.water || 0) + waterLoss;
    (flowSources.water ||= []).push({ label: `Transpiration ×${state.drones}`, amount: -waterLoss });
  }

  const net = {};
  for (const id of NUTRIENT_IDS) net[id] = (inflow[id] || 0) - (burn[id] || 0);

  /* -- population ----------------------------------------------------------- */

  const hasProtein = (state.nutrients.protein || 0) >= DRONE_PROTEIN_COST;
  const growthRate =
    state.drones < droneCap - EPSILON && hasProtein && energyRatio > 0.5 ? GROWTH_PER_SECOND : 0;

  /* -- unlocks and reveals --------------------------------------------------- */

  const revealed = NUTRIENT_IDS.filter((id) => isRevealed(state, id));
  const unlocked = {
    structures: STRUCTURE_ORDER.filter((id) => STRUCTURES[id].unlock(state)),
    castes: CASTE_ORDER.filter((id) => CASTES[id].unlock(state)),
    research: RESEARCH_ORDER.filter(
      (id) => !state.tech[id] && RESEARCH[id].requires.every((req) => state.tech[req]),
    ),
  };

  return {
    mult,
    efficiency,
    caps,
    capMult,
    droneCap,
    insightCap,
    slots,
    demands,
    perConsumer,
    energy: {
      demand: totalDemand,
      delivered: deliveredWatts,
      ratio: energyRatio,
      throughput,
      throughputRatio,
      stored: storedEnergy(state),
      usable: usableEnergy(state),
    },
    burn,
    inflow,
    net,
    flowSources,
    itemFlow,
    ingestRate,
    insightRate,
    growthRate,
    revealed,
    unlocked,
  };
}

/* --------------------------------------------------------------- cost helpers */

export function structureCost(state, id, count = 1) {
  const def = STRUCTURES[id];
  const owned = state.structures[id] || 0;
  const total = {};
  for (let i = 0; i < count; i += 1) {
    for (const [n, amount] of Object.entries(def.cost(owned + i))) {
      total[n] = (total[n] || 0) + amount;
    }
  }
  for (const n of Object.keys(total)) total[n] = Math.ceil(total[n]);
  return total;
}

/**
 * Can the hive pay this cost? A cost in an unrevealed micronutrient can never
 * be paid — the hive may be holding tonnes of it, but it cannot tell which
 * tonnes, so it cannot spend them.
 */
export function canAfford(state, cost) {
  return Object.entries(cost).every(([n, amount]) => {
    if (n === 'insight') return state.insight >= amount - EPSILON;
    if (!isRevealed(state, n)) return false;
    return (state.nutrients[n] || 0) >= amount - EPSILON;
  });
}

export function affordableCount(state, id, max = 1000) {
  let count = 0;
  const spent = {};
  const owned = state.structures[id] || 0;
  while (count < max) {
    const next = STRUCTURES[id].cost(owned + count);
    const ok = Object.entries(next).every(([n, amount]) => {
      if (!isRevealed(state, n)) return false;
      return (state.nutrients[n] || 0) - (spent[n] || 0) >= amount;
    });
    if (!ok) break;
    for (const [n, amount] of Object.entries(next)) spent[n] = (spent[n] || 0) + amount;
    count += 1;
  }
  return count;
}

/** Seconds until a cost becomes affordable at current rates, or null. */
export function etaFor(state, derived, cost) {
  let worst = 0;
  for (const [n, amount] of Object.entries(cost)) {
    const have = n === 'insight' ? state.insight : state.nutrients[n] || 0;
    if (have >= amount) continue;
    const rate = n === 'insight' ? derived.insightRate : derived.net[n] || 0;
    if (rate <= EPSILON) return null;
    const cap = n === 'insight' ? derived.insightCap : derived.caps[n];
    if (amount > cap + EPSILON) return null; // storage can never hold it
    worst = Math.max(worst, (amount - have) / rate);
  }
  return worst;
}

/* ------------------------------------------------------------------- the tick */

export function tick(state, dt) {
  const derived = computeDerived(state, dt);

  for (const id of NUTRIENT_IDS) {
    const cap = derived.caps[id];
    let next = (state.nutrients[id] || 0) + derived.net[id] * dt;

    if (next > cap) {
      // Overflow. For a macro or an assayed micro the hive notices; for a
      // micronutrient it cannot yet detect, the surplus is simply gone, and
      // nothing in the interface says so until the assay is done.
      state.spilled[id] = (state.spilled[id] || 0) + (next - cap);
      next = cap;
    }
    state.nutrients[id] = next < 0 ? 0 : next;
  }

  state.stats.metabolised += derived.energy.delivered * dt;
  state.stats.ingested += derived.ingestRate * dt;

  state.insight = Math.min(derived.insightCap, state.insight + derived.insightRate * dt);

  // Growth: a new drone is grown out of protein.
  if (derived.growthRate > 0) {
    state.growth += derived.growthRate * dt;
    while (state.growth >= 1 && state.drones < derived.droneCap) {
      if ((state.nutrients.protein || 0) < DRONE_PROTEIN_COST) break;
      state.growth -= 1;
      state.nutrients.protein -= DRONE_PROTEIN_COST;
      state.drones += 1;
      state.castes.dormant += 1;
    }
  }
  if (state.growth > 1) state.growth = 1;

  // Starvation: sustained unmet energy demand costs drones.
  if (derived.energy.ratio < 0.5 && state.drones > 0) {
    state.starvation += (1 - derived.energy.ratio) * dt;
    while (state.starvation >= STARVE_SECONDS && state.drones > 1) {
      state.starvation -= STARVE_SECONDS;
      state.drones -= 1;
      state.stats.dronesLost += 1;
      for (const id of [...CASTE_ORDER].reverse()) {
        if (state.castes[id] > 0) {
          state.castes[id] -= 1;
          break;
        }
      }
    }
  } else {
    state.starvation = Math.max(0, state.starvation - dt * 2);
  }

  // Invariants: drones fit their cap and assignments sum to the population.
  if (state.drones > derived.droneCap) {
    let excess = state.drones - derived.droneCap;
    state.drones = derived.droneCap;
    for (const id of [...CASTE_ORDER].reverse()) {
      if (excess <= 0) break;
      const taken = Math.min(excess, state.castes[id] || 0);
      state.castes[id] -= taken;
      excess -= taken;
    }
  }
  const assigned = CASTE_ORDER.reduce((sum, id) => sum + (state.castes[id] || 0), 0);
  if (assigned !== state.drones) {
    state.castes.dormant = Math.max(0, state.castes.dormant + (state.drones - assigned));
  }

  state.stats.peakDrones = Math.max(state.stats.peakDrones, state.drones);
  state.playtime += dt;
  state.stats.ticks += 1;

  return derived;
}

/** Synchronous catch-up, used by the tools and the debug handle. */
export function advance(state, seconds, step = 1) {
  const total = seconds;
  let done = 0;
  while (done < total) {
    const dt = Math.min(step, total - done);
    tick(state, dt);
    done += dt;
  }
  return done;
}

/* -------------------------------------------------------------------- the loop */

let timer = null;
let lastStamp = 0;

export function startLoop(state, onTick) {
  stopLoop();
  lastStamp = performance.now();
  timer = setInterval(() => {
    const now = performance.now();
    let elapsed = (now - lastStamp) / 1000;
    lastStamp = now;
    // A run that has not been given a landing site has not started. Ticking
    // would advance the clock and the statistics for a hive that does not exist
    // yet, which is both wrong and enough to confuse save migration later.
    if (!state.origin) return;
    if (elapsed <= 0) return;
    if (elapsed > MAX_CATCHUP_SECONDS) elapsed = MAX_CATCHUP_SECONDS;
    while (elapsed > 0) {
      const dt = Math.min(TICK_SECONDS, elapsed);
      tick(state, dt);
      elapsed -= dt;
    }
    onTick?.();
  }, TICK_MS);
}

export function stopLoop() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

export { MACROS, MICROS, DRONE_PROTEIN_COST };
