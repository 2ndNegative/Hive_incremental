// The simulation.
//
// THE ONE IDEA THIS GAME IS BUILT ON
// Energy is always destroyed matter. The chemical energy sitting in the hive's
// stores is real —
//
//     storedEnergy(J) = Σ nutrient[n] (g) × kjPerGram[n] × 1000
//
// — but it is not spendable. Nothing in the hive can touch it except a
// Metabolic Generator, which takes mass at a fixed rate and converts it at that
// mass's own energy density into `state.energyPool`, the only energy anything
// can actually draw on. 1 kW for a second means 27 mg of fat, or 59 mg of
// carbohydrate, or — if you pointed a generator at sodium — an infinite amount
// of sodium, because sodium carries no energy at all. That is what `preferred`
// and `fallback` are choosing between.
//
// A hive standing on a tonne of fat with no generator has no energy. That is
// the whole shape of the early game.
//
// RESOLUTION ORDER
//   1. charge: how well each building is powered, carried over from last tick
//   2. multipliers, efficiencies and capacities, every one scaled by charge
//   3. energy demand: basal + caste work + structure upkeep, at full rate
//   4. generation: generators convert mass into the pool
//   5. allocation: the pool is spent down the priority list, drones first and
//      then building band by band, so a shortfall lands on the bottom
//   6. brownout: who got their watts, and therefore which way charge is moving
//   7. harvest, scaled by how much of the energy demand was actually met
//   8. digestion: stored items broken down into nutrient inflow
//
// Stages 4 and 7 are deliberately circular-free: harvest never feeds the energy
// that powers the harvest within the same tick. Mass arrives, and next tick it
// is available to burn. Stage 1 is what keeps stage 4 out of its own output —
// a generator's charge was settled a tick ago, so it cannot be a function of
// the supply it is itself producing.
//
// WHERE HARVEST GOES
// Castes deliver whole matter into `state.items` — carcasses, grass, topsoil —
// and digestion draws it back out at a rate the hive's gut tissue sets. The
// hive is born with a little of that tissue (BASE_DIGESTION_WATTS' sibling
// below), so a new hive behaves exactly as it did before storage existed; a
// hive that outgrows its gut watches the backlog climb instead. The click is
// the exception: a drone chewing a mouthful needs no organ, so manual intake
// still goes straight to the nutrient stores.

import {
  NUTRIENTS,
  NUTRIENT_IDS,
  MACROS,
  MICROS,
  joulesPerGram,
  isRevealed,
  isUsableFuel,
  itemYield,
} from './definitions/nutrients.js';
import {
  STRUCTURES,
  STRUCTURE_ORDER,
  powerPriority,
  maxLevelOf,
} from './definitions/structures.js';
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
import { BIOMES } from './definitions/biomes.js';
import { BASE_COGIT_CAPACITY, COGIT_PER_DRONE } from './definitions/cognition.js';
import { advanceForage } from './forage.js';

export const TICK_MS = 100;
export const TICK_SECONDS = TICK_MS / 1000;
const MAX_CATCHUP_SECONDS = 5;
// No cap on absence: see offline.js, which scales the step size instead so the
// work stays bounded however long the player has been away.

const BASE_THROUGHPUT_WATTS = 2_000;
// The gut the hive lands with. Set to 0 to make the Digestive Caecum a hard
// gate rather than an upgrade; at 80 g/s a starting hive digests everything it
// can gather and a hive past about four harvesters starts to back up.
const BASE_DIGESTION = 80; // grams of stored item mass per second
const BASE_ITEM_CAP = 2_000; // grams, per item
const BASE_INSIGHT_CAP = 200;
const BASE_DRONE_CAP = 3;
const DRONE_PROTEIN_COST = 180; // grams of protein per new drone
const GROWTH_PER_SECOND = 0.04;
const STARVE_SECONDS = 25; // at zero energy, how long until a drone is lost

/**
 * How long an unpowered building takes to fade out — and, run the other way,
 * how long a re-powered one takes to come back.
 *
 * Deliberately short. Losing supply should be felt in seconds, not minutes,
 * because the point of the brownout is to make a shortfall a thing that
 * happens TO you rather than a number that goes slightly red.
 */
export const BROWNOUT_SECONDS = 30;

const EPSILON = 1e-12;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/* ---------------------------------------------------------------- brownout */

/**
 * How well each structure is running right now, 0 to 1.
 *
 * Read straight out of `state.power`, never recomputed from this tick's supply:
 * charge is a thing with momentum, and the only place it moves is tick(). That
 * also keeps the whole of computeDerived free of circularity — the charge that
 * scales a generator's output was settled last tick, so output never feeds the
 * supply that decides the output inside one step.
 *
 * A structure nobody has built sits at 1, so the first one built starts lit
 * instead of inheriting whatever its predecessor browned out to.
 */
export function computeCharges(state) {
  const charges = {};
  for (const id of STRUCTURE_ORDER) {
    const count = state.structures?.[id] || 0;
    if (count <= 0) {
      charges[id] = 1;
      continue;
    }
    const held = state.power?.[id];
    charges[id] = held === undefined || held === null ? 1 : clamp01(held);
  }
  return charges;
}

/**
 * How many units of a structure are effectively working.
 *
 * Six buildings at half charge do the work of three. This is the number every
 * BENEFIT is scaled by; costs use the raw count instead, which is what lets a
 * dark building keep asking for the watts that would bring it back.
 */
function working(state, charges, id) {
  return (state.structures?.[id] || 0) * (charges[id] ?? 1);
}

/* ------------------------------------------------------------ capacity groups */

/** Which capMult channel a nutrient's storage obeys. */
function capGroup(id) {
  const def = NUTRIENTS[id];
  if (def.tier === 'macro') return 'bulk';
  return def.group === 'lipidAssay' || def.group === 'aqueousAssay' ? 'vitamin' : 'mineral';
}

/* ------------------------------------------------------------------ cognition */

/**
 * The hive's bandwidth: how much thinking it can hold in flight, and how much
 * is in flight right now.
 *
 * Capacity comes from structures; load comes from drones, from structures that
 * need running, and from whatever actions are holding a reservation. Nothing
 * accumulates — this is recomputed from scratch every time, which is exactly
 * what a width should be.
 *
 * Exported and pure so it can be reasoned about on its own.
 */
export function computeCognition(state, charges = computeCharges(state)) {
  const supply = [];
  const load = [];
  let capacity = BASE_COGIT_CAPACITY;
  let used = 0;

  for (const id of STRUCTURE_ORDER) {
    const count = state.structures?.[id] || 0;
    if (!count) continue;
    const def = STRUCTURES[id];
    if (def.cogitCapacity) {
      // Bandwidth is a benefit, so it browns out with everything else: a
      // Hivecore at a third charge holds a third of the thoughts.
      const amount = def.cogitCapacity * working(state, charges, id);
      capacity += amount;
      const charge = charges[id] ?? 1;
      supply.push({
        key: `structure:${id}`,
        label: charge < 1 - 1e-9
          ? `${def.name} ×${count} at ${Math.round(charge * 100)}%`
          : `${def.name} ×${count}`,
        amount,
      });
    }
    if (def.cogitDraw) {
      // A cost, so it does NOT scale: a dark building is still sitting in the
      // hive's head taking up room.
      const amount = def.cogitDraw * count;
      used += amount;
      load.push({ key: `structure:${id}`, label: `${def.name} ×${count}`, amount });
    }
  }

  // Every drone costs bandwidth simply by being coherent, working or not.
  const drones = state.drones || 0;
  if (drones > 0 && COGIT_PER_DRONE > 0) {
    const amount = drones * COGIT_PER_DRONE;
    used += amount;
    load.push({ key: 'drones', label: `Drones ×${drones}`, amount });
  }

  // Castes that cost more than the baseline to run.
  for (const id of CASTE_ORDER) {
    const assigned = state.castes?.[id] || 0;
    const per = CASTES[id]?.cogitPerDrone;
    if (!assigned || !per) continue;
    const amount = per * assigned;
    used += amount;
    load.push({ key: `caste:${id}`, label: `${CASTES[id].name} ×${assigned}`, amount });
  }

  // Blocks held by actions in progress.
  for (const [key, held] of Object.entries(state.cognition?.reservations || {})) {
    const amount = held?.amount || 0;
    if (amount <= 0) continue;
    used += amount;
    load.push({ key: `action:${key}`, label: held.label || key, amount });
  }

  const free = capacity - used;
  return {
    capacity,
    used,
    free,
    // How much of what is asked for can actually be thought. Nothing consumes
    // this yet — the rebuild decides what being over budget costs.
    ratio: used <= EPSILON ? 1 : Math.min(1, capacity / used),
    over: used > capacity + EPSILON,
    supply,
    load,
  };
}

/* -------------------------------------------------------------------- derived */

function computeMultipliers(state, charges) {
  const mult = {};
  for (const channel of MULTIPLIERS) mult[channel] = 0;
  for (const id of STRUCTURE_ORDER) {
    const units = working(state, charges, id);
    const bonuses = STRUCTURES[id].mult;
    if (!units || !bonuses) continue;
    for (const [channel, value] of Object.entries(bonuses)) {
      mult[channel] = (mult[channel] || 0) + value * units;
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

function computeCaps(state, charges) {
  const capMult = { bulk: 0, mineral: 0, vitamin: 0 };
  for (const id of STRUCTURE_ORDER) {
    const units = working(state, charges, id);
    const m = STRUCTURES[id].capMult;
    if (!units || !m) continue;
    for (const [group, value] of Object.entries(m)) capMult[group] += value * units;
  }

  const caps = {};
  for (const id of NUTRIENT_IDS) {
    caps[id] = NUTRIENTS[id].baseCap * (1 + capMult[capGroup(id)]);
  }

  let droneCap = BASE_DRONE_CAP;
  let insightCap = BASE_INSIGHT_CAP;
  let throughput = BASE_THROUGHPUT_WATTS;
  let digestion = BASE_DIGESTION;
  let itemCapMult = 0;
  for (const id of STRUCTURE_ORDER) {
    const units = working(state, charges, id);
    if (!units) continue;
    const def = STRUCTURES[id];
    droneCap += (def.caps?.drones || 0) * units;
    insightCap += (def.insightCap || 0) * units;
    throughput += (def.throughput || 0) * units;
    digestion += (def.digestion || 0) * units;
    itemCapMult += (def.itemCapMult || 0) * units;
  }
  const itemCap = BASE_ITEM_CAP * (1 + itemCapMult);

  // A drone is a whole drone, so a browning-out nursery loses the capacity for
  // one before it loses the capacity for half of one. Floored rather than
  // rounded: the hive never gets a drone it cannot hold.
  return {
    caps,
    capMult,
    droneCap: Math.floor(droneCap),
    insightCap,
    throughput,
    digestion,
    itemCap,
  };
}

function computeSlots(state, charges) {
  const slots = {};
  for (const id of CASTE_ORDER) {
    const def = CASTES[id];
    if (!def.slots) {
      slots[id] = Infinity;
      continue;
    }
    let total = 0;
    for (const sid of STRUCTURE_ORDER) {
      const units = working(state, charges, sid);
      const provided = STRUCTURES[sid].slots?.[def.slots];
      if (units && provided) total += provided * units;
    }
    // Half a burrow is no burrow: a post a drone can stand at is a whole thing,
    // so browning out closes positions rather than shrinking them.
    slots[id] = Math.floor(total);
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
  // Charge first: every benefit below is scaled by it, and it depends on
  // nothing computed here.
  const charges = computeCharges(state);
  // The queue is derived, not stored, so a structure added to a band shows up
  // in the right place in the ordering without anything having to be kept in
  // step by hand.
  const priority = powerPriority();
  const mult = computeMultipliers(state, charges);
  const efficiency = computeEfficiency(state);
  const { caps, capMult, droneCap, insightCap, throughput, digestion, itemCap } = computeCaps(
    state,
    charges,
  );
  const slots = computeSlots(state, charges);
  const cognition = computeCognition(state, charges);

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
  // Structures are billed in powerPriority() order — band by band down the Hive
  // tab, left to right inside a band — because `perConsumer` below feeds this
  // list in order out of what the pool could actually supply. The order of this
  // array IS the priority rule: whatever the supply runs out on browns out, and
  // everything after it goes dark.
  //
  // Basal metabolism and the castes stay ahead of all of it. A building going
  // dark is recoverable; a drone that starves is gone.
  for (const id of priority) {
    const count = state.structures[id] || 0;
    const def = STRUCTURES[id];
    if (!count || !def.upkeepWatts) continue;
    demands.push({
      key: `structure:${id}`,
      label: `${def.name} ×${count}`,
      // Raw count, not charge: upkeep is a cost, and a building that stopped
      // asking for power as it faded could never come back.
      watts: def.upkeepWatts * count,
    });
  }

  const totalDemand = demands.reduce((sum, d) => sum + d.watts, 0);

  /* -- 3. generation --------------------------------------------------------- */

  // NOTHING metabolises its own fuel any more. A building that wants a watt
  // draws it from the pool, and the pool is filled by Metabolic Generators and
  // by nothing else — so a hive with demand and no generator simply stops,
  // however many tonnes of fat it is standing on.
  //
  // The generator takes mass at a fixed rate and converts it at that mass's own
  // energy density, through the metabolic efficiency the tech tree has bought.
  //
  // CHOOSING A FUEL IS A GENERATOR'S JOB AND NOBODY ELSE'S. Every other consumer
  // draws watts out of the pool and has no opinion about where they came from, so
  // the preferred/fallback pair is keyed per generating structure — `structure:<id>`,
  // falling back to the hive default. The Metabolism tab shows exactly these.
  //
  // Generators brown out like everything else — but they have no upkeep, so
  // nothing can starve them, which is what stops the hive from being able to
  // dig itself into a hole it cannot climb out of.
  const burn = {}; // nutrient -> grams per second actually consumed
  const generators = [];
  let massRate = 0; // grams per second the generators can process
  let generatedWatts = 0;
  {
    // Grams still unclaimed this step. Two generator types pointed at the same
    // store must not each spend all of it.
    const left = {};
    const unclaimed = (n) => (left[n] ??= state.nutrients[n] || 0);

    for (const id of STRUCTURE_ORDER) {
      const per = STRUCTURES[id].metabolism;
      if (!per) continue;
      const count = state.structures?.[id] || 0;
      const units = working(state, charges, id);
      const rate = per * units;
      massRate += rate;

      const key = `structure:${id}`;
      const { preferred, fallback, overridden } = fuelChoiceFor(state, key);
      const order = [preferred, fallback].filter(
        (n, i, arr) => n && arr.indexOf(n) === i && isUsableFuel(state, n),
      );

      const drew = {}; // nutrient -> grams per second this generator took
      let watts = 0;
      let gramsLeft = rate * dt;
      for (const nutrient of order) {
        if (gramsLeft <= EPSILON) break;
        const perGram = joulesPerGram(nutrient) * efficiency[nutrient];
        if (perGram <= EPSILON) continue; // a zero-energy store is not fuel
        const taken = Math.min(gramsLeft, unclaimed(nutrient));
        if (taken <= EPSILON) continue;
        left[nutrient] -= taken;
        drew[nutrient] = (drew[nutrient] || 0) + taken / dt;
        burn[nutrient] = (burn[nutrient] || 0) + taken / dt;
        watts += (taken * perGram) / dt;
        gramsLeft -= taken;
      }
      generatedWatts += watts;

      generators.push({
        id,
        key,
        name: STRUCTURES[id].name,
        count,
        charge: charges[id] ?? 1,
        // What it could process, and what it managed to find to process.
        capacity: rate,
        rate: rate - gramsLeft / Math.max(dt, EPSILON),
        watts,
        preferred,
        fallback,
        overridden,
        drew,
        // Pointed at stores that are empty, or at nothing it can open.
        dry: rate > EPSILON && watts <= EPSILON,
      });
    }
  }

  /* -- 4. drawing on the pool ------------------------------------------------ */

  // What is on hand this step: whatever was banked, plus whatever the
  // generators made during it.
  const banked = state.energyPool || 0;
  const availableJoules = banked + generatedWatts * dt;

  const wantedJoules = totalDemand * dt;
  const drawnJoules = Math.min(wantedJoules, availableJoules);
  const deliveredWatts = dt > EPSILON ? drawnJoules / dt : 0;
  const poolAfter = availableJoules - drawnJoules;

  // Consumers are fed in `demands` order out of what was drawn, so basal
  // metabolism is satisfied before the workforce — the hive keeps itself alive
  // first.
  const perConsumer = {};
  let remaining = drawnJoules;
  for (const demand of demands) {
    const wants = demand.watts * dt;
    const got = Math.min(wants, Math.max(0, remaining));
    remaining -= got;
    perConsumer[demand.key] = {
      label: demand.label,
      watts: demand.watts,
      delivered: dt > EPSILON ? got / dt : 0,
      ratio: wants > EPSILON ? got / wants : 1,
      from: {},
    };
  }

  /* -- 4b. brownout ---------------------------------------------------------- */

  // A BUILDING SETTLES AT THE SHARE OF ITS UPKEEP IT IS ACTUALLY GETTING.
  //
  // Not at zero. Three hundred and forty kilowatts into a megawatt of Hivecore
  // is a Hivecore running at 34%, held there for as long as that is what it is
  // being paid — the same way a motor on two thirds of its voltage turns slowly
  // rather than stopping. Charge walks towards that target at a constant rate,
  // so a shortfall is still felt over seconds rather than instantly, and the
  // thirty seconds is now the time for the FULL swing: halving the supply takes
  // fifteen.
  //
  // Asking for nothing settles at full. That is the generators' exemption, and
  // it is the reason the lights can ever come back on at all.
  //
  // tick() is what moves the charge; this only works out where it is heading,
  // so the interface can say "settling at 34%" rather than showing a number
  // that happens to be going down.
  const power = {};
  let starved = 0;
  let faded = 0;
  for (const id of STRUCTURE_ORDER) {
    const count = state.structures?.[id] || 0;
    const fed = perConsumer[`structure:${id}`];
    const target = fed ? clamp01(fed.ratio) : 1;
    const charge = charges[id] ?? 1;
    const satisfied = target >= 1 - 1e-9;
    if (count > 0 && !satisfied) starved += 1;
    if (count > 0 && charge < 1 - 1e-9) faded += 1;
    power[id] = {
      id,
      count,
      charge,
      target,
      satisfied,
      // 1-based place in the queue, so the interface can explain the ordering
      // without knowing the rule.
      priority: priority.indexOf(id) + 1,
      watts: fed?.watts ?? 0,
      delivered: fed?.delivered ?? 0,
      // Where its charge is heading, and how long it has left to get there.
      //   steady     running, fully paid
      //   holding    settled below full and staying there — the new resting state
      //   failing    on its way down to a lower target
      //   recovering on its way up to a higher one
      direction:
        charge > target + 1e-9
          ? 'failing'
          : charge < target - 1e-9
            ? 'recovering'
            : satisfied
              ? 'steady'
              : 'holding',
      secondsLeft: Math.abs(charge - target) * BROWNOUT_SECONDS,
    };
  }

  // How much of what the hive asked for it actually got. Everything that does
  // work is scaled by this, so a hive that has outrun its generators visibly
  // slows down.
  const energyRatio = totalDemand > EPSILON ? deliveredWatts / totalDemand : 1;

  // Kept under its old name so the interface and the save keep working: it now
  // means "how much the generators can supply against what is being asked",
  // which is the ceiling that actually bites.
  const throughputRatio = totalDemand > EPSILON ? Math.min(1, generatedWatts / totalDemand) : 1;

  /* -- 5 & 6. harvest and nutrient inflow ----------------------------------- */

  const itemFlow = {}; // itemId -> grams per second harvested
  // Who is bringing each item in. This is what lets the interface answer "where
  // is all this beef coming from" without the player having to work it out from
  // the caste table.
  const itemSources = {}; // itemId -> [{ label, amount, casteId, organism }]
  let insightRate = 0;

  // What each caste is currently bringing in. The find was rolled in tick();
  // this only reads it, so the same numbers come back however many times the
  // interface asks.
  const forage = {};

  for (const id of CASTE_ORDER) {
    const assigned = state.castes[id] || 0;
    const def = CASTES[id];
    if (!assigned || !def.assignable) continue;
    const scale = (1 + (def.mult ? mult[def.mult] || 0 : 0)) * energyRatio;

    if (def.gather && def.harvestRate) {
      const slot = state.forage?.[id];
      const biome = slot?.biomeId ? BIOMES[slot.biomeId] : null;
      const where = biome ? ` in ${biome.name.toLowerCase()}` : '';
      forage[id] = {
        casteId: id,
        gather: def.gather,
        biomeId: slot?.biomeId ?? null,
        itemId: slot?.itemId ?? null,
        organismId: slot?.organismId ?? null,
        rate: def.harvestRate * assigned * scale,
        empty: !slot?.itemId && !slot?.organismId,
      };

      if (def.gather === 'hunter' && slot?.organismId) {
        // A hunter brings back a carcass, not a cut: one roll becomes a dozen
        // different items at once, which is what makes hunting feel unlike
        // every other caste.
        const org = ORGANISMS[slot.organismId];
        const liveGrams = def.harvestRate * assigned * scale;
        for (const [itemId, fraction] of Object.entries(org.parts)) {
          const amount = liveGrams * fraction;
          itemFlow[itemId] = (itemFlow[itemId] || 0) + amount;
          (itemSources[itemId] ||= []).push({
            label: `${def.name} ×${assigned} working ${org.name}${where}`,
            amount,
            casteId: id,
            organism: slot.organismId,
            biomeId: slot.biomeId,
          });
        }
      } else if (slot?.itemId) {
        const amount = def.harvestRate * assigned * scale;
        itemFlow[slot.itemId] = (itemFlow[slot.itemId] || 0) + amount;
        (itemSources[slot.itemId] ||= []).push({
          label: `${def.name} ×${assigned}${where}`,
          amount,
          casteId: id,
          biomeId: slot.biomeId,
        });
      }
    }

    if (def.insight) insightRate += def.insight * assigned * scale;
  }

  /* -- 6. digestion --------------------------------------------------------- */

  // Digestion reaches what is already stored plus what is arriving this step,
  // and takes the same fraction of every pile, so nothing sits at the back of
  // the queue starving while something else drains. Whatever it cannot get
  // through stays in storage, and storage spoils at its cap.
  const reachable = {};
  let reachableTotal = 0;
  for (const itemId of new Set([...Object.keys(state.items || {}), ...Object.keys(itemFlow)])) {
    if (!ITEMS[itemId]) continue;
    const amount = (state.items?.[itemId] || 0) + (itemFlow[itemId] || 0) * dt;
    if (amount <= EPSILON) continue;
    reachable[itemId] = amount;
    reachableTotal += amount;
  }

  const digestCapacity = digestion * dt;
  const digestShare = reachableTotal > EPSILON ? Math.min(1, digestCapacity / reachableTotal) : 0;
  const digestRatio = digestShare; // 1 = the gut keeps up with everything

  const digestFlow = {}; // itemId -> grams per second broken down
  const itemNet = {}; // itemId -> grams per second change in storage
  const itemSpill = {}; // itemId -> grams per second spoiling at the cap
  let harvestRate = 0;
  let digestRate = 0;

  for (const itemId of Object.keys(reachable)) {
    const held = state.items?.[itemId] || 0;
    const arriving = itemFlow[itemId] || 0;
    const taken = reachable[itemId] * digestShare;
    harvestRate += arriving;
    if (taken > EPSILON) {
      digestFlow[itemId] = taken / dt;
      digestRate += taken / dt;
    }

    let after = held + arriving * dt - taken;
    if (after > itemCap) {
      itemSpill[itemId] = (after - itemCap) / dt;
      after = itemCap;
    }
    if (after < 0) after = 0;
    itemNet[itemId] = (after - held) / dt;
  }

  const inflow = {};
  const flowSources = {}; // nutrient -> [{ label, amount, itemId }]
  for (const [itemId, gramsPerSecond] of Object.entries(digestFlow)) {
    const item = ITEMS[itemId];
    if (!item || gramsPerSecond <= EPSILON) continue;
    // itemYield carves resolved micronutrients out of the macro fraction that
    // was carrying them, so a gram of potassium arriving in the ash is counted
    // once, as potassium, and the ash figure drops to match.
    for (const [nutrient, amount] of Object.entries(itemYield(state, item.per100g, gramsPerSecond))) {
      if (amount <= EPSILON) continue;
      inflow[nutrient] = (inflow[nutrient] || 0) + amount;
      (flowSources[nutrient] ||= []).push({ label: item.name, amount, itemId });
    }
  }
  const ingestRate = digestRate;
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
    cognition,
    demands,
    perConsumer,
    charges,
    power,
    // Every structure that turns mass into energy, with the fuel pair it is
    // pointed at. The only things in the hive that choose a fuel at all.
    generators,
    powerPriority: priority,
    // How many standing buildings are losing their supply, and how many are
    // already running at less than full output for any reason.
    starvedCount: starved,
    fadedCount: faded,
    energy: {
      demand: totalDemand,
      delivered: deliveredWatts,
      ratio: energyRatio,
      // What the generators are making, and what they could make if the stores
      // could keep up with them.
      generated: generatedWatts,
      massRate,
      throughput: generatedWatts,
      throughputRatio,
      // Usable energy banked, after this step's generation and draw.
      pool: poolAfter,
      // Chemical energy still locked in the stores. Not spendable: only a
      // generator can turn any of it into the pool above.
      stored: storedEnergy(state),
      locked: usableEnergy(state),
      // `usable` used to mean "chemical energy in fuels the hive can open".
      // It now means what it says: energy the hive can actually spend.
      usable: poolAfter,
    },
    burn,
    inflow,
    net,
    flowSources,
    itemFlow,
    itemSources,
    forage,
    itemNet,
    itemSpill,
    itemCap,
    digestFlow,
    digestion,
    digestRatio,
    harvestRate,
    digestRate,
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
  // A levelled structure cannot go past its cap, so "max" means "up to the cap".
  const ceiling = Math.min(max, maxLevelOf(id) - owned);
  while (count < ceiling) {
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
  // Derived first, forage after: this tick delivers what the castes were
  // already carrying, and only then do they go out and find the next thing.
  // Rolling first would mean a find the player never saw arrive.
  const derived = computeDerived(state, dt);

  // Storage first: `itemNet` already has the cap and the spoilage folded in,
  // because the amount digestion could reach depended on both.
  state.items ??= {};
  state.spilledItems ??= {};
  for (const [itemId, rate] of Object.entries(derived.itemNet)) {
    const next = (state.items[itemId] || 0) + rate * dt;
    if (next > EPSILON) state.items[itemId] = next;
    else delete state.items[itemId];
  }
  for (const [itemId, rate] of Object.entries(derived.itemSpill)) {
    state.spilledItems[itemId] = (state.spilledItems[itemId] || 0) + rate * dt;
  }

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

  state.energyPool = derived.energy.pool;

  // Brownout. Every standing building walks towards the share of its upkeep it
  // is actually being paid, at a constant rate — a full swing takes
  // BROWNOUT_SECONDS either way, so a building cut off entirely is dark in
  // thirty seconds and one cut to a third settles there in twenty. Linear on
  // purpose: the player can count the seconds and know where they stand.
  state.power ??= {};
  const chargeStep = dt / BROWNOUT_SECONDS;
  for (const id of STRUCTURE_ORDER) {
    const p = derived.power[id];
    if (!p || p.count <= 0) {
      // Nothing standing. Forget its charge so that the next one built starts
      // lit rather than inheriting a dead predecessor's.
      delete state.power[id];
      continue;
    }
    const gap = p.target - p.charge;
    // Landing exactly on the target once it is within a step stops the charge
    // oscillating around it, and keeps thirty seconds of hundred-millisecond
    // arithmetic from leaving a few parts in 10^16 of rounding behind.
    let next = Math.abs(gap) <= chargeStep ? p.target : p.charge + Math.sign(gap) * chargeStep;
    next = clamp01(next);
    if (next < 1e-9) next = 0;
    else if (next > 1 - 1e-9) next = 1;
    state.power[id] = next;
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

  advanceForage(state, dt);

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
