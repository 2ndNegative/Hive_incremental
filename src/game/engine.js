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
  visibleAs,
  isUsableFuel,
  itemYield,
  payableCost,
} from './definitions/nutrients.js';
import {
  STRUCTURES,
  STRUCTURE_ORDER,
  powerPriority,
  isLeveled,
  maxLevelOf,
} from './definitions/structures.js';
import {
  CASTES,
  CASTE_ORDER,
  DRONE_RATION_JOULES,
  BASAL_WATER_PER_SECOND,
  WATER_PER_DRONE_TARGET,
  HYDRATION_FLOOR,
  MULTIPLIERS,
} from './definitions/castes.js';
import { RESEARCH, RESEARCH_ORDER } from './definitions/research.js';
import { ITEMS } from './definitions/items/index.js';
import { ORGANISMS } from './definitions/organisms.js';
import { BIOMES, totalArea, landCapacity, patchCount, aridity } from './definitions/biomes.js';
import { BASE_COGIT_CAPACITY, COGIT_PER_DRONE } from './definitions/cognition.js';
import {
  DRONE_TYPES,
  DRONE_TYPE_ORDER,
  nextMoldable,
  foragingTypes,
  exploringTypes,
} from './definitions/drones.js';
import { advanceForage, FORAGE_CYCLE } from './forage.js';
import { advanceExpeditions, expeditionSeconds, EXPEDITION_OUTCOMES } from './expedition.js';
import { formatMass, formatArea } from './units.js';

export const TICK_MS = 100;
export const TICK_SECONDS = TICK_MS / 1000;
const MAX_CATCHUP_SECONDS = 5;
// No cap on absence: see offline.js, which scales the step size instead so the
// work stays bounded however long the player has been away.

const BASE_THROUGHPUT_WATTS = 2_000;
/**
 * The gut the hive lands with: NONE.
 *
 * A seed has no digestive tissue, so raw matter is exactly as useful to it as a
 * rock until it grows some. Everything a forager brings home sits whole in the
 * larder, fills it, and spoils — which makes the Digestive Caecum a hard gate
 * rather than a nice-to-have, and makes the first one the most consequential
 * building in the opening.
 */
const BASE_DIGESTION = 0; // grams of raw matter per second
/**
 * What a hive can hold before it builds anything: nothing, of anything. Every
 * nutrient's baseCap is zero too. All storage comes from a structure's
 * `storage` map, and the Hivecore is where the first of it comes from.
 */
const BASE_ITEM_CAP = 0; // grams of raw matter, across the whole larder
const BASE_INSIGHT_CAP = 200;
const BASE_DRONE_CAP = 3;
const DRONE_PROTEIN_COST = 180; // grams of protein per new drone
const GROWTH_PER_SECOND = 0.04;

/**
 * Does the hive grow drones by itself? No — parked for the drone rebuild, which
 * replaces spontaneous growth with larvae. Flip this back on and the old
 * behaviour returns exactly as it was.
 */
const AUTOMATIC_DRONE_GROWTH = false;
const STARVE_SECONDS = 25; // at zero energy, how long until a drone is lost

/** What one larva eats, every second it exists. */
export const LARVA_CARB_PER_SECOND = 0.1;

/**
 * A FULL BROOD WORKS FASTER THAN AN EMPTY ONE.
 *
 * Larvae are not just stock waiting to be spent — a packed brood is warm, and
 * warmth is what a chamber is for. Every cycle in the hive that handles larvae
 * (laying them and pressing them into drones) runs at a multiplier that starts
 * at exactly 1 with an empty brood and climbs from there.
 *
 * Square root, not linear: five larvae doubles the pace, which is enough to
 * make the first handful feel like an achievement, and a thousand does not
 * multiply it by a hundred. Only ever ≥ 1 — a young hive is never punished for
 * having nothing in the nursery, it simply gets no help.
 */
export const LARVA_PACE_SCALE = 5;

export function larvaPace(state) {
  return 1 + Math.sqrt(Math.max(0, state.larvae || 0) / LARVA_PACE_SCALE);
}

/* ------------------------------------------------------------- cogit focus */

/**
 * How many spare cogits it takes to double the hive's thinking.
 *
 * The same shape and the same scale as LARVA_PACE_SCALE, deliberately: the two
 * are the same idea pointed at different things, and a player who has learned
 * one should not have to learn the other.
 */
export const COGIT_FOCUS_SCALE = 5;

/**
 * WHAT THE HIVE DOES WITH BANDWIDTH IT IS NOT USING.
 *
 * Cognition was a ceiling and nothing else: a cogit either held a drone
 * coherent or sat there. So the correct play was always to fill every cogit
 * with drones, and a Nerve Node was a drone slot wearing a different hat.
 *
 * Now the slack thinks. Every cogit the hive is not spending on a drone widens
 * what it can hold in mind and speeds up what it works out — the same
 * square-root curve a full brood gives the chambers, so the first few spare
 * cogits matter a great deal and the fiftieth does not.
 *
 *   free   0 → ×1.0      free  20 → ×3.0
 *   free   5 → ×2.0      free  45 → ×4.0
 *
 * That makes bandwidth a REAL choice for the first time. A hive can run forty
 * drones and learn nothing, or run twenty and think twice as fast, and neither
 * is wrong. It also gives a young hive something to do with a Nerve Node it
 * cannot yet fill.
 *
 * Over budget is not negative: a hive that has overcommitted its cogits is
 * already punished by being over budget, and compounding that into "and you
 * also forget things" is a hole with no bottom.
 */
export function cogitFocusFrom(free) {
  return 1 + Math.sqrt(Math.max(0, free) / COGIT_FOCUS_SCALE);
}

/** The same, for a caller that has not already computed cognition. */
export function cogitFocus(state) {
  return cogitFocusFrom(computeCognition(state).free);
}

/* --------------------------------------------------------------- the click */

/**
 * CLICKING FAST IS WORTH MORE THAN CLICKING SLOWLY.
 *
 * The hive reaching out and taking something is the one thing the player does
 * with their hands, and it was worth exactly the same whether they tapped it
 * once a minute or hammered it. So it builds heat: every press raises it, every
 * second without one bleeds it away, and what the hive takes is multiplied by
 * where that heat has got to.
 *
 * Deliberately NOT a stacking counter that survives walking away — it is a
 * reward for the thirty seconds somebody is actually leaning on the button, not
 * a number to be protected. Cold to full in MANUAL_COMBO_CLICKS presses, full
 * to cold in MANUAL_COMBO_COOL_SECONDS of leaving it alone.
 */
export const MANUAL_COMBO_MAX = 3;
export const MANUAL_COMBO_CLICKS = 12;
export const MANUAL_COMBO_COOL_SECONDS = 2;

/** Heat gained per press, before any decay. */
export const MANUAL_COMBO_PER_CLICK = 1 / MANUAL_COMBO_CLICKS;

/** What the next press is worth, given where the heat has got to: 1× to 3×. */
export function clickMultiplier(state) {
  const heat = Math.max(0, Math.min(1, state.clickHeat || 0));
  return 1 + heat * (MANUAL_COMBO_MAX - 1);
}

/**
 * How long a brood can go unfed before it starts dying, and how fast it then
 * goes. Five seconds of grace is not much — and it is not meant to be. A larva
 * is a thing that only eats; the moment the sugar stops it is the first thing
 * in the hive with nothing to live on.
 */
export const LARVA_STARVE_GRACE = 5; // seconds unfed before the first death
export const LARVA_DEATH_SECONDS = 2; // seconds per death after that

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

/**
 * Put a line in the message log of the state being ticked.
 *
 * Deliberately not state.js's `pushLog`: that one writes to the module's single
 * live state, and `tick` takes whichever state it is handed. A test ticking a
 * scratch hive must not post into the real one's log.
 */
function log(state, text, type = 'info') {
  if (!Array.isArray(state.log)) return;
  state.log.unshift({ text, type, at: Date.now(), playtime: state.playtime });
  if (state.log.length > 60) state.log.length = 60; // mirrors LOG_LIMIT
}

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
 * How many of a structure are switched ON.
 *
 * A building can be idled from the Hive tab, which is the only way back out of
 * having built something that eats more than the hive can feed it. An idle
 * building costs nothing and does nothing: it is not billed for upkeep, it
 * metabolises nothing, it occupies no bandwidth, and it holds nothing.
 *
 * An absent entry means all of them, so a save written before idling existed —
 * and any code path that forgets to set it — behaves exactly as it used to.
 */
export function activeCount(state, id) {
  const built = state.structures?.[id] || 0;
  const on = state.active?.[id];
  if (on === undefined || on === null) return built;
  // A levelled structure is ONE thing. Its entry is a flag, not a count, so a
  // Hivecore taken from level 1 to level 8 is a level 8 Hivecore running —
  // never a level 8 Hivecore running at one.
  if (isLeveled(id)) return on > 0 ? built : 0;
  return Math.max(0, Math.min(built, on));
}

/**
 * How many separate THINGS of a structure are standing and switched on.
 *
 * The difference from activeCount is levelled buildings: a Hivecore at level 9
 * is one Hivecore, not nine. This is the number for anything granted per thing
 * rather than per level — storage, above all, which is why taking the core up a
 * level widens what it can think and not what it can hold.
 */
function instances(state, id) {
  const on = activeCount(state, id);
  if (!on) return 0;
  return isLeveled(id) ? 1 : on;
}

/**
 * How many units of a structure are effectively working.
 *
 * Six buildings at half charge do the work of three. This is the number every
 * benefit that is a RATE or a PROCESS is scaled by. Costs use the active count
 * without the charge, which is what lets a dark building keep asking for the
 * watts that would bring it back. Storage capacity uses it without the charge
 * too — see computeCaps.
 */
function working(state, charges, id) {
  return activeCount(state, id) * (charges[id] ?? 1);
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
    // Idled buildings neither think nor take up room to think in.
    const count = activeCount(state, id);
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
      // A cost, so it does not shrink with charge: a dark building is still
      // sitting in the hive's head taking up room. An idled one is not.
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

  // Every drone the hive has MOLDED, by type. A cost, so like a structure's
  // draw it does not shrink with anything: a drone standing idle in the dark is
  // still a drone the hive is holding together. This is the ceiling the drone
  // economy runs into — a Forager is one cogit, so a bare hive can hold a
  // handful of them and no more until it widens.
  for (const id of DRONE_TYPE_ORDER) {
    const count = state.droneTypes?.[id] || 0;
    const per = DRONE_TYPES[id]?.cogitDraw || 0;
    if (!count || !per) continue;
    const amount = per * count;
    used += amount;
    load.push({ key: `drone:${id}`, label: `${DRONE_TYPES[id].name} ×${count}`, amount });
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

/**
 * STORAGE IS STRUCTURE, NOT PROCESS.
 *
 * Capacity is the one benefit that does NOT scale with charge: a sac is a sac
 * whether it is lit or not. It still respects being switched off, because an
 * idle building is not part of the hive's working body — but a browning-out
 * hive keeps everything it was already holding.
 *
 * That is not only flavour. The Anthill's only storage is its Hivecore, and the
 * Hivecore is the first thing to brown out; if capacity faded with charge, a
 * new hive would spill the very mass it needs to build the generator that would
 * have saved it, within thirty seconds of landing, every time.
 */
function computeCaps(state, charges) {
  const capMult = { bulk: 0, mineral: 0, vitamin: 0 };
  for (const id of STRUCTURE_ORDER) {
    const units = activeCount(state, id);
    const m = STRUCTURES[id].capMult;
    if (!units || !m) continue;
    for (const [group, value] of Object.entries(m)) capMult[group] += value * units;
  }

  // The hive holds NOTHING on its own — every nutrient's baseCap is zero. Room
  // is a flat sum of what each standing structure declares, and only then do
  // the multiplicative bonuses apply to it.
  const room = {};
  for (const id of NUTRIENT_IDS) room[id] = NUTRIENTS[id].baseCap;
  for (const id of STRUCTURE_ORDER) {
    const store = STRUCTURES[id].storage;
    if (!store) continue;
    const count = instances(state, id);
    if (!count) continue;
    for (const [nutrient, grams] of Object.entries(store)) {
      room[nutrient] = (room[nutrient] || 0) + grams * count;
    }
  }

  // DEDICATED room: a shelf cut to the shape of one nutrient and no use to any
  // other. The multiplicative bonuses apply here and nowhere else.
  const dedicated = {};
  for (const id of NUTRIENT_IDS) {
    dedicated[id] = (room[id] || 0) * (1 + capMult[capGroup(id)]);
  }

  // GENERAL room: one shared volume that will take anything, and what the hive
  // uses to catch what will not fit on its shelves.
  let general = 0;
  for (const id of STRUCTURE_ORDER) {
    const per = STRUCTURES[id].generalStorage;
    if (per) general += per * instances(state, id);
  }

  const held = state.general || {};
  let generalUsed = 0;
  for (const id of NUTRIENT_IDS) generalUsed += held[id] || 0;
  const generalFree = Math.max(0, general - generalUsed);

  // WHAT THE PANEL SHOWS. A nutrient's ceiling is its own shelf plus however
  // much of the shared volume it has actually taken: the hive cannot see room
  // it is not using, so a store spilling into the general pool always reads as
  // full. Hold 2 kg of fat on a 2 kg shelf and it is 2 kg of 2 kg; take 200 g
  // more into the pool and it becomes 2.2 kg of 2.2 kg.
  const caps = {};
  // What it COULD hold if it took everything free in the pool. Not displayed —
  // this is the figure for working out whether a cost is reachable at all.
  const capsMax = {};
  const bans = state.generalBans || {};
  for (const id of NUTRIENT_IDS) {
    const mine = held[id] || 0;
    caps[id] = dedicated[id] + mine;
    // A banned nutrient cannot reach the pool, so the pool is not headroom for
    // it — etaFor would otherwise promise a cost it can never save up for.
    capsMax[id] = dedicated[id] + mine + (bans[visibleAs(state, id)] ? 0 : generalFree);
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
  // Whole matter obeys the same rule: nowhere to put it until something is
  // built that can hold it.
  //
  // ONE POOL, not a shelf per item. The larder is a sac with things in it, so
  // five hundred grams of room is five hundred grams whether that is all acorns
  // or nine different things — and a hive with no gut fills it with whatever it
  // happened to find and then spoils, which is the point.
  const itemRoom =
    BASE_ITEM_CAP +
    STRUCTURE_ORDER.reduce(
      (sum, id) => sum + (STRUCTURES[id].itemStorage || 0) * instances(state, id),
      0,
    );
  const itemCap = itemRoom * (1 + itemCapMult);

  // A drone is a whole drone, so a browning-out nursery loses the capacity for
  // one before it loses the capacity for half of one. Floored rather than
  // rounded: the hive never gets a drone it cannot hold.
  return {
    caps,
    capsMax,
    storage: { dedicated, general, generalUsed, generalFree },
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
 * How long a generator stays on a fuel after changing to it.
 *
 * WHY THERE IS A COOLDOWN AT ALL. A generator burns its preferred fuel and
 * falls back to the second when the first runs out — and a store that has run
 * out is also a store that digestion is dripping into. Without this, every
 * single tick went: a crumb of carbohydrate arrived, the generator jumped back
 * onto carbohydrate, burned the crumb, found it empty, jumped to fat. Ten times
 * a second, for as long as the hive was short. The numbers were right and the
 * screen was unreadable.
 *
 * So: one fuel at a time, and a changeover costs a quiet spell.
 */
export const FUEL_SWITCH_SECONDS = 10;

/** Enough of a store to be worth crossing the room for: one second of work. */
const FUEL_SWITCH_MINIMUM_SECONDS = 1;

/**
 * Below this, a store is dregs rather than fuel: a tenth of a second of work.
 *
 * Without it a generator parks on a store that digestion is dripping into and
 * burns each crumb as it lands — no flicker, but no power either, and the full
 * tank of the other fuel sits untouched. Dregs do not count as having fuel, so
 * it leaves, and the cooldown decides when it is worth coming back.
 */
const FUEL_DREGS_SECONDS = 0.1;

/** What a generator is burning right now, and whether it may change its mind. */
export function fuelLockFor(state, key) {
  const lock = state.fuelLock?.[key];
  return { on: lock?.on ?? null, hold: lock?.hold ?? 0 };
}

/**
 * Decide which single fuel a generator burns this step.
 *
 * TWO KINDS OF CHANGE, and only one of them is gated:
 *   - FLEEING an empty store is forced and immediate. Nothing is gained by
 *     making a generator sit idle in front of a fuel that is not there.
 *   - GOING BACK UP the preference list is what stutters, so it waits out the
 *     cooldown AND wants the store to hold at least a second of work. A trickle
 *     of the preferred fuel is not a reason to abandon a full tank of the other.
 *
 * Pure: it reads the lock and says what it would become. tick() is what writes.
 */
function chooseFuel(state, key, order, rate) {
  const { on, hold } = fuelLockFor(state, key);
  const grams = (n) => (n ? state.nutrients[n] || 0 : 0);
  const alive = (n) =>
    order.includes(n) && grams(n) > EPSILON && grams(n) >= rate * FUEL_DREGS_SECONDS;
  const worthIt = (n) => alive(n) && grams(n) >= rate * FUEL_SWITCH_MINIMUM_SECONDS;

  // Still burning something that is there: the only question is whether it is
  // allowed to trade up, and whether there is anything better to trade up to.
  if (alive(on)) {
    if (hold > EPSILON) return { nutrient: on, switched: false, hold };
    const better = order.find(worthIt) ?? on;
    return better === on
      ? { nutrient: on, switched: false, hold: 0 }
      : { nutrient: better, switched: true, hold: FUEL_SWITCH_SECONDS };
  }

  // Nothing in the tank. Take whatever there is, in preference order.
  const next = order.find(alive) ?? order[0] ?? null;
  if (!next) return { nutrient: null, switched: false, hold: Math.max(0, hold) };
  return next === on
    ? { nutrient: next, switched: false, hold: Math.max(0, hold) }
    : { nutrient: next, switched: true, hold: FUEL_SWITCH_SECONDS };
}

/* ------------------------------------------------------ water and the ration */

/**
 * EVERY DRONE THE HIVE IS ACTUALLY HOLDING.
 *
 * Deliberately `droneTypes` and not `state.drones`. The old caste population is
 * parked for the rebuild and capped at BASE_DRONE_CAP, so counting it would
 * charge a hive of forty foragers for three — the ration and the thirst would
 * both be rounding errors, which is the exact failure this system exists to
 * stop. Both are counted off the live population, the same one cognition bills
 * and the land caps.
 */
export function droneCount(state) {
  let total = 0;
  for (const id of DRONE_TYPE_ORDER) total += state.droneTypes?.[id] || 0;
  return total;
}

/**
 * HOW WET THE HIVE IS, and what that costs it.
 *
 * Water is the only resource whose absence is felt everywhere at once rather
 * than in one system, which is the whole of its identity: everything else stops
 * a particular thing, and water slows the colony down.
 *
 * `target` is 250 g a drone. Above it there is no penalty at all — a dead zone
 * on purpose, so a healthy hive is never nagged — and below it the multiplier
 * falls in a straight line to the floor. Straight rather than curved because a
 * curve would hide the first 20% of the problem, and the first 20% is when the
 * player can still cheaply fix it.
 *
 * `draw` is what the hive is losing a second, and it is the land that decides
 * it: see biomes.js ARIDITY.
 */
export function computeHydration(state) {
  const drones = droneCount(state);
  const target = drones * WATER_PER_DRONE_TARGET;
  const held = state.nutrients?.water || 0;
  // A hive with nobody in it is not thirsty.
  const ratio = target > EPSILON ? Math.min(1, held / target) : 1;
  const multiplier = ratio >= 1 ? 1 : HYDRATION_FLOOR + (1 - HYDRATION_FLOOR) * ratio;
  const dryness = aridity(state);
  return {
    drones,
    held,
    target,
    ratio,
    multiplier,
    aridity: dryness,
    draw: drones * BASAL_WATER_PER_SECOND * dryness,
    parched: ratio < 1,
  };
}

/** The consumer key the drone ration's fuel choice is filed under. */
export const RATION_KEY = 'drones';

/**
 * WHAT THE DRONES ARE EATING, and whether there is enough of it.
 *
 * The hive owes DRONE_RATION_JOULES a drone a second, as chemical energy, and
 * pays it in whichever fuel the Metabolism tab is pointed at — so the bill is
 * fixed in joules and variable in grams. A sugar hive pays 0.15 g/s a drone; a
 * hive living on fat pays 0.069. That is the point of letting the player
 * choose: ground with no sugar on it can still feed a colony.
 *
 * It uses the same preferred/fallback pair and the same changeover cooldown the
 * generators use, because it is the same decision and should not need learning
 * twice.
 *
 * Short rations do NOT kill. They scale the colony down the same way thirst
 * does, for the same reason — a hive that starves to death while the player is
 * asleep is a hive nobody comes back to.
 */
export function computeRation(state, efficiency = {}) {
  const drones = droneCount(state);
  const joules = drones * DRONE_RATION_JOULES;
  const empty = {
    drones,
    joules,
    nutrient: null,
    grams: 0,
    wantGrams: 0,
    ratio: 1,
    multiplier: 1,
    hungry: false,
  };
  if (joules <= EPSILON) return empty;

  const { preferred, fallback } = fuelChoiceFor(state, RATION_KEY);
  const order = [preferred, fallback].filter(
    (n, i, arr) => n && arr.indexOf(n) === i && isUsableFuel(state, n),
  );
  // Rate in grams of the preferred fuel, which is all chooseFuel needs it for.
  const nominal = order[0] ? joules / Math.max(EPSILON, joulesPerGram(order[0])) : 0;
  const nutrient = chooseFuel(state, RATION_KEY, order, nominal).nutrient;
  if (!nutrient) return { ...empty, ratio: 0, multiplier: HYDRATION_FLOOR, hungry: true };

  const perGram = joulesPerGram(nutrient) * (efficiency[nutrient] ?? 1);
  const wantGrams = perGram > EPSILON ? joules / perGram : 0;
  const have = state.nutrients?.[nutrient] || 0;
  // Per second: what it wants against what a second of eating could find.
  const grams = Math.min(wantGrams, have);
  const ratio = wantGrams > EPSILON ? grams / wantGrams : 1;
  return {
    drones,
    joules,
    nutrient,
    grams,
    wantGrams,
    ratio,
    multiplier: ratio >= 1 ? 1 : HYDRATION_FLOOR + (1 - HYDRATION_FLOOR) * ratio,
    hungry: ratio < 1,
  };
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
  const { caps, capsMax, storage, capMult, droneCap, insightCap, throughput, digestion, itemCap } =
    computeCaps(state, charges);
  const slots = computeSlots(state, charges);
  const cognition = computeCognition(state, charges);

  /* -- 1a. water, food, and how well the hive is doing ----------------------- */

  // WORKED OUT FIRST, because both of them scale almost everything below.
  //
  // These are not energy. The hive does not generate hydration and cannot bank
  // it as watts: it is holding enough water or it is not, and it is being fed
  // or it is not. Both come out as a number between the floor and 1, and both
  // multiply what the colony can DO — never what the generators make, because a
  // hive that cannot make energy cannot fetch water or food, and that is a hole
  // with no bottom.
  const hydration = computeHydration(state);
  const ration = computeRation(state, efficiency);

  // One number, because they compound honestly: a hive that is both parched and
  // hungry is in twice the trouble, and should feel it.
  const vigour = hydration.multiplier * ration.multiplier;

  // Spare bandwidth is thinking time. Applied to BOTH what the hive can hold
  // and what it works out, so an idle cogit is never simply wasted — see
  // cogitFocusFrom. Worked out here, once, because the cap is read in several
  // places and they must all agree.
  const focus = cogitFocusFrom(cognition.free);
  const focusedInsightCap = insightCap * focus;

  /* -- 1b. molding ----------------------------------------------------------- */

  // WHAT A MOLDING CHAMBER WANTS TO MAKE, settled before anything is billed —
  // because a chamber with work draws five times what an idle one does, and the
  // demand list below needs to know which it is.
  //
  // A chamber is ACTIVE when it is actually pressing: something it is allowed
  // to make, and a larva to make it from. Anything short of that is idle, and
  // an idle chamber costs the lower figure — nothing switched on, nothing left
  // under its target, or an empty brood all come to the same thing.
  //
  // Deliberately NOT a function of charge. If it were, a chamber would drop to
  // idle whenever it browned out, which would let it afford its watts again,
  // which would wake it up — a slow oscillation with no way to read it. Larvae
  // are safe to depend on: they move on a twenty-second cadence, not a
  // hundred-millisecond one.
  // How much faster a full brood runs. Used by both the molding block here and
  // the brood block further down, so it is worked out once, up here.
  // Scaled by vigour, so thirst and hunger slow the chambers along with
  // everything else rather than leaving the nursery the one part of a parched
  // hive still running at full speed.
  const pace = larvaPace(state) * vigour;

  // A chamber will not press a drone the hive has no bandwidth left to hold
  // coherent, and will not press one it cannot pay for. Both are checked here,
  // before anything is billed, so an unaffordable drone idles the chamber at
  // its lower draw rather than running it at five times the watts for nothing.
  const moldTarget = nextMoldable(state, cognition.free);
  const moldCost = moldTarget ? payableCost(state, DRONE_TYPES[moldTarget].cost) : {};
  const moldAffordable = Object.entries(moldCost).every(
    ([n, g]) => (state.nutrients[n] || 0) >= g - EPSILON,
  );
  const larvaeOnHand = (state.larvae || 0) >= 1;
  const molding = [];
  for (const id of STRUCTURE_ORDER) {
    const def = STRUCTURES[id].molding;
    if (!def) continue;
    const running = activeCount(state, id);
    const units = working(state, charges, id);
    // Something it is allowed to make, whether or not it can make it yet.
    const wants = running > 0 && Boolean(moldTarget);
    const active = wants && larvaeOnHand && moldAffordable;
    molding.push({
      id,
      name: STRUCTURES[id].name,
      count: running,
      units,
      charge: charges[id] ?? 1,
      seconds: def.seconds,
      wants,
      active,
      makes: moldTarget,
      makesName: moldTarget ? DRONE_TYPES[moldTarget]?.name ?? moldTarget : null,
      cost: moldCost,
      affordable: moldAffordable,
      pace,
      progress: state.molding?.[id] || 0,
      // Drones per second at this many chambers, at this charge, at this pace.
      rate: active ? (units * pace) / def.seconds : 0,
      // Work in front of it and an empty brood behind it.
      starved: wants && larvaeOnHand === false,
      // Work in front of it and nothing to build it out of.
      broke: wants && larvaeOnHand && !moldAffordable,
    });
  }
  const moldRate = molding.reduce((sum, m) => sum + m.rate, 0);

  /* -- 2. energy demand ---------------------------------------------------- */

  // NOTHING PER-DRONE IN HERE ANY MORE. Drones used to draw twenty watts each
  // out of the pool; they eat instead now, straight out of the stores, and the
  // hive picks what off the Metabolism tab. See the ration below.
  const demands = []; // { key, label, watts }

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
  // The castes stay ahead of all of it. A building going dark is recoverable;
  // a drone that starves is gone.
  for (const id of priority) {
    const running = activeCount(state, id);
    const def = STRUCTURES[id];
    if (!running || !def.upkeepWatts) continue;
    // A structure that works harder when it has work says so with activeWatts.
    const busy = molding.find((m) => m.id === id)?.active;
    const each = busy && def.activeWatts ? def.activeWatts : def.upkeepWatts;
    demands.push({
      key: `structure:${id}`,
      label: busy ? `${def.name} ×${running} (working)` : `${def.name} ×${running}`,
      // Active count, un-scaled by charge: upkeep is a cost, and a building
      // that stopped asking for power as it faded could never come back. An
      // idled one is not billed at all, which is the whole point of idling it.
      watts: each * running,
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
    // THE DRONES EAT FIRST. A building that goes dark comes back when the
    // power does; a colony that went hungry so a generator could run has lost
    // something it cannot get back by switching the generator off again.
    const unclaimed = (n) =>
      (left[n] ??= Math.max(
        0,
        (state.nutrients[n] || 0) - (ration.nutrient === n ? ration.grams * dt : 0),
      ));

    for (const id of STRUCTURE_ORDER) {
      const per = STRUCTURES[id].metabolism;
      if (!per) continue;
      const count = state.structures?.[id] || 0;
      const running = activeCount(state, id);
      const units = working(state, charges, id);
      const rate = per * units; // what it can process right now, per gram

      const key = `structure:${id}`;
      const { preferred, fallback, overridden } = fuelChoiceFor(state, key);
      const order = [preferred, fallback].filter(
        (n, i, arr) => n && arr.indexOf(n) === i && isUsableFuel(state, n),
      );

      // ONE FUEL AT A TIME. Topping up from the second store the moment the
      // first runs dry inside a single step is the other half of the stutter:
      // it made every tick a blend, and no two ticks the same blend. A
      // generator burns what it is on, and if that store empties mid-step it
      // simply makes less this step and moves next step.
      const choice = chooseFuel(state, key, order, rate);
      const using = choice.nutrient;

      const drew = {}; // nutrient -> grams per second this generator took
      let watts = 0;
      // How fast this particular fuel goes through, and how much survives the
      // trip. Data on the nutrient rather than a special case here: sugar runs
      // at three times the rate and loses a tenth doing it, which is what makes
      // it the thing to switch to when the lights go out and the thing that
      // empties first. See nutrients.js carb.
      const burnRate = using ? (NUTRIENTS[using]?.burnRate ?? 1) : 1;
      const burnLoss = using ? (NUTRIENTS[using]?.burnEfficiency ?? 1) : 1;
      // What it will ACTUALLY pull off the shelf, which is the figure the
      // interface quotes and the one a player checks a store against. Sugar at
      // three times the rate means three times the grams, and reporting the
      // nominal rate here would have the hive eating 60 g/s while the screen
      // said 20.
      massRate += rate * burnRate;
      let gramsLeft = rate * burnRate * dt;
      if (using) {
        const perGram = joulesPerGram(using) * efficiency[using] * burnLoss;
        const taken = perGram > EPSILON ? Math.min(gramsLeft, unclaimed(using)) : 0;
        if (taken > EPSILON) {
          left[using] -= taken;
          drew[using] = taken / dt;
          burn[using] = (burn[using] || 0) + taken / dt;
          watts += (taken * perGram) / dt;
          gramsLeft -= taken;
        }
      }
      generatedWatts += watts;

      generators.push({
        id,
        key,
        name: STRUCTURES[id].name,
        count,
        running,
        idle: count - running,
        charge: charges[id] ?? 1,
        // owned: what this many of it could ever process
        // capacity: what the ones switched on, at their charge, can process now
        // rate: what they actually found to process
        owned: per * count,
        capacity: rate,
        rate: rate - gramsLeft / Math.max(dt, EPSILON),
        watts,
        preferred,
        fallback,
        overridden,
        drew,
        // What it is actually burning, and how long until it is allowed to
        // change its mind about that. `switched` is this step's changeover.
        using,
        switched: choice.switched,
        hold: choice.hold,
        onFallback: Boolean(using) && using !== preferred,
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
    const running = activeCount(state, id);
    const fed = perConsumer[`structure:${id}`];
    // Nothing is asked of an idled building, so it settles at full and is ready
    // the moment it is switched back on.
    const target = fed ? clamp01(fed.ratio) : 1;
    const charge = charges[id] ?? 1;
    const satisfied = target >= 1 - 1e-9;
    if (running > 0 && !satisfied) starved += 1;
    if (running > 0 && charge < 1 - 1e-9) faded += 1;
    power[id] = {
      id,
      count,
      running,
      idle: count - running,
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

  // WHAT THE GENERATORS CAN ACTUALLY REACH.
  //
  // Not every fuel in the stores — only the ones something is currently pointed
  // at. A hive sitting on forty kilos of fat with every generator set to
  // carbohydrate has, as far as it is concerned, no fat: nothing in the hive is
  // reaching for it. Change the setting and the figure changes with it.
  const fuelled = new Set();
  for (const g of generators) {
    if (g.running <= 0) continue;
    for (const n of [g.preferred, g.fallback]) {
      if (n && isUsableFuel(state, n)) fuelled.add(n);
    }
  }
  let fuelEnergy = 0; // chemical energy sitting in those stores
  let fuelYield = 0; // …and what the generators would get out of it
  for (const n of fuelled) {
    const grams = state.nutrients[n] || 0;
    fuelEnergy += grams * joulesPerGram(n);
    fuelYield += grams * joulesPerGram(n) * efficiency[n];
  }

  // How much of what the hive asked for it actually got. Everything that does
  // work is scaled by this, so a hive that has outrun its generators visibly
  // slows down.
  const energyRatio = totalDemand > EPSILON ? deliveredWatts / totalDemand : 1;

  // Kept under its old name so the interface and the save keep working: it now
  // means "how much the generators can supply against what is being asked",
  // which is the ceiling that actually bites.
  const throughputRatio = totalDemand > EPSILON ? Math.min(1, generatedWatts / totalDemand) : 1;

  /* -- 4c. the brood --------------------------------------------------------- */

  // What is working towards a larva, and how fast. The protein is not taken
  // here — tick() takes it when a cycle actually completes, because a cycle is
  // an attempt that can fail rather than a steady drain.
  const brood = [];
  for (const id of STRUCTURE_ORDER) {
    const def = STRUCTURES[id].brood;
    if (!def) continue;
    const units = working(state, charges, id);
    brood.push({
      id,
      name: STRUCTURES[id].name,
      // How many are standing, and how much of one they add up to once the
      // power is accounted for. A chamber on a tenth of its watts works a tenth
      // as fast, which is why these two differ.
      count: activeCount(state, id),
      charge: charges[id] ?? 1,
      units,
      seconds: def.seconds,
      cost: def.cost,
      yield: def.yield ?? 1,
      progress: state.brood?.[id] || 0,
      // How much faster a full brood makes this go. One with nothing in it.
      pace,
      // Larvae per second at this many chambers, at this charge, at this pace.
      rate: (units * pace * (def.yield ?? 1)) / def.seconds,
      affordable: Object.entries(def.cost).every(
        ([n, g]) => (state.nutrients[n] || 0) >= g - EPSILON,
      ),
    });
  }
  const broodRate = brood.reduce((sum, b) => sum + b.rate, 0);

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
    const scale = (1 + (def.mult ? mult[def.mult] || 0 : 0)) * energyRatio * vigour;

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

  // Buildings that think. Scaled by how well each is being paid, the same as
  // everything else a structure does — a browned-out Interlocutor argues more
  // slowly — and multiplied below by whatever bandwidth is going spare.
  for (const id of STRUCTURE_ORDER) {
    const per = STRUCTURES[id].insight;
    if (!per) continue;
    insightRate += per * working(state, charges, id);
  }

  // And the drones, which is where foraging lives now.
  //
  // TWO THINGS LAND DOES, and they are different things. It CAPS how many
  // drones can be out at once — a hive with forty foragers and nine square
  // metres has nine foragers and thirty-one standing around — and it decides
  // how many PATCHES are worked at the same time, each its own find, rolled
  // separately and worked by its own share of the drones.
  //
  // A trip, not a tap: a patch holds what it found and what that weighs, and
  // its rate is that weight spread over the cycle it takes to walk it home. So
  // every figure here is an average of something lumpy, and the patches drift
  // out of step with each other rather than all stepping at once.
  //
  // Not scaled by charge or by energy: a drone type declares no upkeep yet, so
  // there is nothing for a brownout to take away from it. When one does, this
  // is where that multiplier goes.
  // EXPEDITIONS. Not a rate and not a yield: a count of drones out there, how
  // long a trip takes this hive, and how far through the current one they are.
  const expeditions = [];
  for (const typeId of exploringTypes()) {
    const count = state.droneTypes?.[typeId] || 0;
    if (!count) continue;
    const seconds = expeditionSeconds(state, typeId);
    expeditions.push({
      droneId: typeId,
      name: DRONE_TYPES[typeId].name,
      count,
      seconds,
      progress: state.expedition?.[typeId] || 0,
      // Expeditions a minute, at this many explorers.
      rate: seconds > 0 ? count / seconds : 0,
      outcomes: EXPEDITION_OUTCOMES,
    });
  }

  const area = totalArea(state);
  const capacity = landCapacity(state);
  const patchesAvailable = patchCount(state);
  const droneForage = {};
  let roomLeft = capacity;

  for (const typeId of foragingTypes()) {
    const count = state.droneTypes?.[typeId] || 0;
    if (!count) continue;
    const def = DRONE_TYPES[typeId];

    // Declared order shares out the ground, the same rule the molding chambers
    // use to decide what to press: predictable beats clever.
    const working = Math.max(0, Math.min(count, roomLeft));
    roomLeft -= working;

    // One patch per drone until the land runs out of patches. A single forager
    // works one patch properly rather than a twelfth of twelve.
    const held = state.patches?.[typeId] ?? [];
    const open = Math.min(held.length || patchesAvailable, Math.max(1, Math.floor(working)));
    const perPatch = open > 0 ? working / open : 0;

    const patches = [];
    let rate = 0;
    for (let i = 0; i < held.length; i += 1) {
      const patch = held[i];
      const live = i < open;
      const grams = patch.grams || 0;
      const perSecond = live ? (grams * perPatch * vigour) / FORAGE_CYCLE : 0;
      const biome = patch.biomeId ? BIOMES[patch.biomeId] : null;
      patches.push({
        index: i,
        droneId: typeId,
        biomeId: patch.biomeId ?? null,
        itemId: patch.itemId ?? null,
        grams,
        drones: live ? perPatch : 0,
        rate: perSecond,
        worked: live,
        empty: !patch.itemId,
      });
      rate += perSecond;

      if (live && patch.itemId && perSecond > EPSILON) {
        const where = biome ? ` in ${biome.name.toLowerCase()}` : '';
        itemFlow[patch.itemId] = (itemFlow[patch.itemId] || 0) + perSecond;
        (itemSources[patch.itemId] ||= []).push({
          label: `${def.name}${where}`,
          amount: perSecond,
          droneId: typeId,
          biomeId: patch.biomeId,
        });
      }
    }

    droneForage[typeId] = {
      droneId: typeId,
      name: def.name,
      gather: def.gather,
      count,
      working,
      // Drones the land cannot find room for. The whole point of the cap.
      landless: count - working,
      patches,
      open,
      rate,
    };
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

  // A parched or hungry colony breaks matter down more slowly too — the gut is
  // tissue like everything else.
  const digestCapacity = digestion * vigour * dt;
  const digestShare = reachableTotal > EPSILON ? Math.min(1, digestCapacity / reachableTotal) : 0;
  const digestRatio = digestShare; // 1 = the gut keeps up with everything

  const digestFlow = {}; // itemId -> grams per second broken down
  const itemNet = {}; // itemId -> grams per second change in storage
  const itemSpill = {}; // itemId -> grams per second spoiling at the cap
  let harvestRate = 0;
  let digestRate = 0;

  // What each pile would be once the gut has taken its share, before the larder
  // has its say.
  const after = {};
  let afterTotal = 0;
  for (const itemId of Object.keys(reachable)) {
    const arriving = itemFlow[itemId] || 0;
    const taken = reachable[itemId] * digestShare;
    harvestRate += arriving;
    if (taken > EPSILON) {
      digestFlow[itemId] = taken / dt;
      digestRate += taken / dt;
    }
    const left = Math.max(0, (state.items?.[itemId] || 0) + arriving * dt - taken);
    after[itemId] = left;
    afterTotal += left;
  }

  // THE LARDER IS ONE SAC, so it overflows as one. What spoils is taken in
  // proportion from every pile rather than from whichever happened to be
  // biggest: a full larder is full, and the next gram of anything displaces a
  // gram of the mixture already in there.
  const keep = afterTotal > itemCap + EPSILON ? itemCap / afterTotal : 1;
  let itemHeld = 0;
  for (const itemId of Object.keys(after)) {
    const held = state.items?.[itemId] || 0;
    const kept = after[itemId] * keep;
    if (keep < 1) itemSpill[itemId] = (after[itemId] - kept) / dt;
    itemHeld += kept;
    itemNet[itemId] = (kept - held) / dt;
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

  // The brood eats. A larva is not a consumer of ENERGY — it is a consumer of
  // sugar, directly, the way the water loss below is a loss of water, so it is
  // drawn straight off the store rather than going through the pool.
  const larvaeCount = Math.floor(state.larvae || 0);
  const larvaeWant = larvaeCount * LARVA_CARB_PER_SECOND;
  const larvaeDrain = Math.min(larvaeWant, (state.nutrients.carb || 0) / Math.max(dt, EPSILON));
  const larvaeStarving = larvaeCount > 0 && larvaeWant - larvaeDrain > EPSILON;
  const hunger = larvaeStarving ? state.larvaeHunger || 0 : 0;
  if (larvaeWant > EPSILON) {
    // Burn what there is, but SHOW what they want. A brood eating nothing
    // because the sugar ran out has to read as a brood going unfed, not as a
    // brood that costs nothing — the second is how a player ends up with a
    // thousand larvae and no idea why the carbohydrate never moves.
    burn.carb = (burn.carb || 0) + larvaeDrain;
    (flowSources.carb ||= []).push({
      label:
        larvaeWant - larvaeDrain > EPSILON
          ? `Larvae ×${larvaeCount} (unfed)`
          : `Larvae ×${larvaeCount}`,
      amount: -larvaeWant,
    });
  }

  // The drones eat. Taken as mass out of whatever the hive is feeding them on,
  // never as watts — see computeRation. Shown as what it WANTS, so a hive that
  // is short reads as short rather than as thrifty.
  if (ration.nutrient && ration.grams > EPSILON) {
    burn[ration.nutrient] = (burn[ration.nutrient] || 0) + ration.grams;
    (flowSources[ration.nutrient] ||= []).push({
      label: ration.hungry
        ? `Drones ×${ration.drones} (short)`
        : `Drones ×${ration.drones}`,
      amount: -ration.wantGrams,
    });
  }

  // Water is lost continuously and is not an energy source, so it is drawn
  // directly rather than going through the fuel allocation above. How much
  // depends on the ground: see biomes.js ARIDITY.
  const waterLoss = Math.min(
    hydration.draw,
    (state.nutrients.water || 0) / Math.max(dt, EPSILON),
  );
  if (waterLoss > 0) {
    burn.water = (burn.water || 0) + waterLoss;
    (flowSources.water ||= []).push({
      label: hydration.aridity > 1.05
        ? `Transpiration ×${hydration.drones} (arid ground, ×${hydration.aridity.toFixed(1)})`
        : `Transpiration ×${hydration.drones}`,
      amount: -hydration.draw,
    });
  }

  const net = {};
  for (const id of NUTRIENT_IDS) net[id] = (inflow[id] || 0) - (burn[id] || 0);

  /* -- population ----------------------------------------------------------- */

  // PARKED FOR THE DRONE REBUILD. A hive used to grow a drone out of spare
  // protein whenever it had the room, the mass and the energy; the replacement
  // goes through larvae instead, so until that exists nothing grows on its own.
  // The condition is kept rather than deleted because it is the shape the new
  // one will be written against.
  const hasProtein = (state.nutrients.protein || 0) >= DRONE_PROTEIN_COST;
  const couldGrow = state.drones < droneCap - EPSILON && hasProtein && energyRatio > 0.5;
  const growthRate = AUTOMATIC_DRONE_GROWTH && couldGrow ? GROWTH_PER_SECOND : 0;

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
    capsMax,
    storage,
    capMult,
    droneCap,
    // The focused figure, not the raw one: everything that reads a ceiling
    // should read the same ceiling, and `insightCap` is what tick() clamps to.
    insightCap: focusedInsightCap,
    // What it would be with every cogit spoken for, and what the slack is
    // worth — so the interface can say where the difference came from.
    insightCapBase: insightCap,
    cogitFocus: focus,
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
      // The stores the generators are POINTED AT, and what is in them. Not the
      // pool and not every fuel in the hive: the fuel it is actually working.
      usable: fuelEnergy,
      reachableYield: fuelYield,
      fuels: [...fuelled],
    },
    brood,
    broodRate,
    molding,
    moldRate,
    moldTarget,
    larvae: {
      count: larvaeCount,
      want: larvaeWant,
      drain: larvaeDrain,
      starving: larvaeStarving,
      // How long the brood has gone without, and what that is about to cost.
      hunger,
      grace: LARVA_STARVE_GRACE,
      dying: larvaeStarving && hunger >= LARVA_STARVE_GRACE,
      // Seconds until the next one dies — the grace period first, then the
      // gap between deaths.
      // null rather than Infinity: a brood that is eating has no clock on it,
      // and Infinity does not survive a JSON round trip.
      secondsToNext: !larvaeStarving
        ? null
        : hunger < LARVA_STARVE_GRACE
          ? LARVA_STARVE_GRACE - hunger
          : Math.max(0, (1 - (state.larvaeDying || 0)) * LARVA_DEATH_SECONDS),
      deathRate: larvaeStarving && hunger >= LARVA_STARVE_GRACE ? 1 / LARVA_DEATH_SECONDS : 0,
      lost: state.stats?.larvaeLost || 0,
    },
    // How wet and how fed the colony is, and the one number the two come to.
    // Everything the hive DOES is multiplied by `vigour`; nothing it GENERATES
    // is, which is what keeps a bad patch recoverable.
    hydration,
    ration,
    vigour,
    burn,
    inflow,
    net,
    flowSources,
    itemFlow,
    itemSources,
    forage,
    // What the land is worth: how many drones it will keep working, how many
    // patches it is worked in, and what each type is actually doing on it.
    land: {
      area,
      capacity,
      patches: patchesAvailable,
      working: Object.values(droneForage).reduce((a, f) => a + f.working, 0),
      landless: Object.values(droneForage).reduce((a, f) => a + f.landless, 0),
      full: capacity > 0 && roomLeft <= EPSILON,
    },
    droneForage,
    // What is out past the edge of the map, and how far through it is.
    expeditions,
    itemNet,
    itemSpill,
    itemCap, // the whole larder, shared
    itemHeld, // what is in it after this step
    itemFull: itemCap > 0 && itemHeld >= itemCap - EPSILON,
    digestFlow,
    digestion,
    digestRatio,
    harvestRate,
    digestRate,
    ingestRate,
    // Scaled by the same slack. A hive thinking with twenty spare cogits both
    // holds three times as much and gets there three times as fast.
    insightRate: insightRate * focus,
    insightRateBase: insightRate,
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
  // THROUGH payableCost, like a drone's mold cost and a claim already were.
  // A building names the element it is made of whether the hive can see that
  // element yet or not — see rule 5 in definitions/costs.js — so without this
  // a Metabolic Generator priced in iron is simply unbuildable until the Trace
  // Metal Assay, which is not a gate anybody designed. The substitution is
  // linear, so charging the total is the same as charging each unit.
  const payable = payableCost(state, total);
  // Ceil IN PLACE: payableCost marks the object with a non-enumerable flag that
  // the interface reads to say "paid in mineral mass", and rebuilding the
  // object here would quietly drop it.
  for (const n of Object.keys(payable)) payable[n] = Math.ceil(payable[n]);
  return payable;
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
    // Payable, not raw — otherwise "max" would refuse to count anything priced
    // in a mineral the hive has not assayed, while the Build button next to it
    // happily grows one.
    const next = payableCost(state, STRUCTURES[id].cost(owned + count));
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
    // The MOST it could hold, pool included — a cost that only fits by using
    // the general store is still reachable, so it must not read as impossible.
    const cap = n === 'insight' ? derived.insightCap : derived.capsMax[n];
    if (amount > cap + EPSILON) return null; // storage can never hold it
    worst = Math.max(worst, (amount - have) / rate);
  }
  return worst;
}

/* ---------------------------------------------------------------- the store */

/**
 * THE TWO-TIER STORE.
 *
 * Every nutrient has its own DEDICATED room, cut to its shape and no use to
 * anything else. On top of that the hive may have a volume of GENERAL room: one
 * shared pool, which anything can use and which exists to catch what will not
 * fit on a shelf.
 *
 * The pool is LAST IN, FIRST OUT. Matter only reaches it once its own shelf is
 * full, and it is the first thing taken back out — so the pool stays as empty
 * as the hive can keep it, ready for the next overflow, and the shelves hold
 * the long-term stock. That is the whole behaviour: a buffer, not a bigger
 * cupboard.
 *
 * `state.nutrients[id]` stays the TOTAL held, so every cost, fuel draw and
 * display in the game goes on reading it unchanged. `state.general[id]` says
 * how much of that total is sitting in the shared pool rather than on the
 * shelf. The invariant is:
 *
 *     0 <= general[id] <= nutrients[id]
 *     nutrients[id] - general[id] <= dedicated[id]
 *     Σ general <= generalCapacity
 *
 * Open a handle with `openStore` and the three are kept true for you.
 */
export function openStore(state, storage) {
  state.general ??= {};
  const dedicated = storage.dedicated;
  const capacity = storage.general;
  // Nutrients the player has forbidden from the shared pool. A banned nutrient
  // fills its own shelf and then spills, however much room the pool has — which
  // is the point: the pool is a scarce buffer, and a flood of water or fibre
  // will take all of it and leave nothing for the protein that needed it.
  const banned = state.generalBans || {};
  // A rule is set on a name the player can see, so it has to govern the mass
  // riding under that name: bar mineral mass and the unassayed iron inside it
  // is barred too, or the rule would leak most of what it was meant to stop.
  const isBanned = (id) => Boolean(banned[visibleAs(state, id)]);
  let used = 0;
  for (const id of NUTRIENT_IDS) used += state.general[id] || 0;

  function setGeneral(id, grams) {
    used += grams - (state.general[id] || 0);
    if (grams <= EPSILON) delete state.general[id];
    else state.general[id] = grams;
  }

  return {
    get generalUsed() { return used; },
    get generalFree() { return Math.max(0, capacity - used); },

    /**
     * Move `delta` grams in or out. Returns the grams that could not be stored
     * and were lost, which is always 0 for a withdrawal.
     */
    apply(id, delta) {
      const total = state.nutrients[id] || 0;
      const mine = state.general[id] || 0;
      const shelf = dedicated[id] || 0;

      if (delta >= 0) {
        // Shelf first, pool with whatever will not fit, and the rest is gone.
        const shelfHeld = total - mine;
        const toShelf = Math.min(delta, Math.max(0, shelf - shelfHeld));
        let left = delta - toShelf;
        const room = isBanned(id) ? 0 : Math.max(0, capacity - used);
        const toPool = Math.min(left, room);
        left -= toPool;
        if (toPool > 0) setGeneral(id, mine + toPool);
        state.nutrients[id] = total + toShelf + toPool;
        return left; // spilled
      }

      // LAST IN, FIRST OUT: what is in the pool leaves before what is on the
      // shelf, so the pool frees itself up again as fast as it filled.
      const taking = Math.min(-delta, total);
      const fromPool = Math.min(taking, mine);
      if (fromPool > 0) setGeneral(id, mine - fromPool);
      state.nutrients[id] = total - taking;
      return 0;
    },

    /**
     * Put the invariant back after the shelves themselves have changed —
     * a storage building idled, switched off, or a save loaded from before any
     * of this existed. Returns grams lost, by nutrient.
     */
    reconcile() {
      const lost = {};
      // A nutrient banned AFTER it had already pooled is evicted: what is in
      // the pool is overflow by definition, so it spills rather than moving
      // back onto a shelf that was already full.
      for (const id of NUTRIENT_IDS) {
        const mine = state.general[id] || 0;
        if (!isBanned(id) || mine <= EPSILON) continue;
        setGeneral(id, 0);
        state.nutrients[id] = Math.max(0, (state.nutrients[id] || 0) - mine);
        lost[id] = (lost[id] || 0) + mine;
      }
      // Anything over its shelf that is not already counted as pooled is
      // pooled now, or lost if there is nowhere to put it.
      for (const id of NUTRIENT_IDS) {
        const total = state.nutrients[id] || 0;
        let mine = Math.min(state.general[id] || 0, total);
        if (mine !== (state.general[id] || 0)) setGeneral(id, mine);
        const over = total - mine - (dedicated[id] || 0);
        if (over <= EPSILON) continue;
        const room = isBanned(id) ? 0 : Math.max(0, capacity - used);
        const toPool = Math.min(over, room);
        if (toPool > 0) {
          setGeneral(id, mine + toPool);
          mine += toPool;
        }
        const gone = over - toPool;
        if (gone > EPSILON) {
          state.nutrients[id] = total - gone;
          lost[id] = (lost[id] || 0) + gone;
        }
      }

      // The pool itself may have shrunk under what is in it. Everything in it
      // arrived as overflow, so the excess is lost in proportion.
      if (used > capacity + EPSILON) {
        const excess = used - capacity;
        const before = used;
        for (const id of NUTRIENT_IDS) {
          const mine = state.general[id] || 0;
          if (mine <= EPSILON) continue;
          const gone = Math.min(mine, (mine / before) * excess);
          setGeneral(id, mine - gone);
          state.nutrients[id] = Math.max(0, (state.nutrients[id] || 0) - gone);
          lost[id] = (lost[id] || 0) + gone;
        }
      }
      return lost;
    },
  };
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

  // Stores. Dedicated room fills first, the shared general pool catches what
  // will not fit, and whatever will not fit in either is gone — for a macro or
  // an assayed micro the hive notices, and for one it cannot yet detect the
  // surplus simply vanishes with nothing in the interface to say so.
  const store = openStore(state, derived.storage);
  for (const id of NUTRIENT_IDS) {
    const delta = derived.net[id] * dt;
    if (delta === 0) continue;
    const lost = store.apply(id, delta);
    if (lost > 0) state.spilled[id] = (state.spilled[id] || 0) + lost;
  }
  // Shelves can shrink between ticks — a storage building idled, a save loaded.
  for (const [id, lost] of Object.entries(store.reconcile())) {
    state.spilled[id] = (state.spilled[id] || 0) + lost;
  }

  state.energyPool = derived.energy.pool;

  // Where each generator is in its fuel cooldown. computeDerived worked out
  // what the lock WOULD be — it is called many times a frame to paint the
  // screen, so it may not write — and this is the one place that applies it.
  state.fuelLock ??= {};
  for (const g of derived.generators) {
    const held = g.switched ? FUEL_SWITCH_SECONDS : Math.max(0, (g.hold || 0) - dt);
    if (!g.using && held <= 0) {
      delete state.fuelLock[g.key];
      continue;
    }
    state.fuelLock[g.key] = { on: g.using, hold: held };
  }

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
    if (p.running <= 0) {
      // Switched off. Not starving — resting. It comes back ready, which is
      // what makes idling a way OUT of trouble rather than a thirty-second
      // penalty for having used it.
      state.power[id] = 1;
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

  // The brood. Each chamber works towards one larva at its own charge; when a
  // cycle completes it ATTEMPTS to pay for it, and an attempt that cannot be
  // paid for is simply lost — the chamber starts the next one rather than
  // banking the failure and laying a backlog the moment protein arrives.
  state.brood ??= {};
  if (derived.brood.length) {
    const broodStore = openStore(state, derived.storage);
    for (const b of derived.brood) {
      let progress = b.progress;
      // The pace is read from derived rather than recomputed, so one step is
      // worked at one pace however many larvae the step itself lays.
      if (b.units > 0) progress += (b.units * b.pace * dt) / b.seconds;
      while (progress >= 1) {
        progress -= 1;
        const canPay = Object.entries(b.cost).every(
          ([n, grams]) => (state.nutrients[n] || 0) >= grams - 1e-12,
        );
        if (!canPay) break;
        for (const [n, grams] of Object.entries(b.cost)) broodStore.apply(n, -grams);
        state.larvae = (state.larvae || 0) + b.yield;
      }
      state.brood[b.id] = progress;
    }
  }

  // STARVATION. A brood that cannot get its sugar has five seconds, and then it
  // starts dying at one every two. Feeding is not an optimisation.
  if (derived.larvae.starving && state.larvae > 0) {
    const before = state.larvaeHunger || 0;
    const after = before + dt;
    state.larvaeHunger = after;

    if (before < LARVA_STARVE_GRACE && after >= LARVA_STARVE_GRACE) {
      log(state, 'The brood is going unfed. Larvae will start dying.', 'error');
    }

    const past = Math.max(0, after - LARVA_STARVE_GRACE);
    const pastBefore = Math.max(0, before - LARVA_STARVE_GRACE);
    state.larvaeDying = (state.larvaeDying || 0) + (past - pastBefore) / LARVA_DEATH_SECONDS;

    let lost = 0;
    while (state.larvaeDying >= 1 && state.larvae > 0) {
      state.larvaeDying -= 1;
      state.larvae -= 1;
      lost += 1;
    }
    if (lost > 0) {
      state.stats.larvaeLost = (state.stats.larvaeLost || 0) + lost;
      // Once per episode, not once per death: a line every two seconds would
      // bury everything else in the log.
      if (pastBefore < LARVA_DEATH_SECONDS) {
        log(state, 'Larvae are dying of hunger, one every two seconds.', 'error');
      }
    }
    if (state.larvae <= 0) {
      state.larvae = 0;
      state.larvaeHunger = 0;
      state.larvaeDying = 0;
      if (lost > 0) log(state, 'The brood is gone.', 'error');
    }
  } else if (state.larvaeHunger || state.larvaeDying) {
    if ((state.larvaeHunger || 0) >= LARVA_STARVE_GRACE && state.larvae > 0) {
      log(state, `The brood is feeding again. ${state.larvae} left.`, 'info');
    }
    state.larvaeHunger = 0;
    state.larvaeDying = 0;
  }

  // MOLDING. A chamber with work pushes through its cycle at its own charge;
  // when one completes it takes a larva and turns it into a drone. No larva
  // means the attempt is lost, the same as a brood cycle that cannot be paid
  // for — a chamber does not bank a queue of drones it could not make.
  //
  // What it makes is re-read at the moment of completion rather than taken from
  // `derived`, so a target reached mid-cycle stops the next one rather than
  // overshooting by however many chambers were mid-press.
  state.molding ??= {};
  if (derived.molding.length) {
    // Bandwidth is spent a drone at a time, so it is tracked a drone at a time:
    // the headroom is read once and then walked down as each one is pressed,
    // which is what stops a hive on its last free cogit pressing four drones in
    // the same step and waking up over budget.
    let free = derived.cognition.free;
    for (const m of derived.molding) {
      let progress = m.progress;
      if (m.active && m.units > 0) progress += (m.units * m.pace * dt) / m.seconds;
      while (progress >= 1) {
        progress -= 1;
        // Re-read at the moment of completion rather than taken from `derived`,
        // so a target reached, a store spent or a cogit taken mid-cycle stops
        // the next one instead of overshooting by however many chambers were
        // part-way through.
        const makes = nextMoldable(state, free);
        if (!makes || (state.larvae || 0) < 1) break;
        const cost = payableCost(state, DRONE_TYPES[makes].cost);
        const payable = Object.entries(cost).every(
          ([n, g]) => (state.nutrients[n] || 0) >= g - EPSILON,
        );
        // An attempt it cannot pay for is LOST, the same as a brood cycle that
        // cannot find its protein. A chamber does not bank a queue of drones.
        if (!payable) break;
        for (const [n, g] of Object.entries(cost)) {
          state.nutrients[n] = Math.max(0, (state.nutrients[n] || 0) - g);
        }
        state.larvae -= 1;
        state.droneTypes[makes] = (state.droneTypes[makes] || 0) + 1;
        state.stats.molded = (state.stats.molded || 0) + 1;
        free -= DRONE_TYPES[makes].cogitDraw || 0;
      }
      state.molding[m.id] = progress;
    }
  }

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

  // The queue builds what it can now that this tick's income has landed. After
  // the stores are settled and before the next derived snapshot, so a building
  // that goes up here is paid for out of the mass that just arrived.
  advanceBuildQueue(state);

  advanceForage(state, dt);

  // Expeditions come home. Every one of them is worth a line in the log: this
  // is the only system in the hive where something either happens or does not,
  // and a player who was not watching should be able to read what they missed.
  for (const result of advanceExpeditions(state, dt)) {
    if (result.outcome === 'nothing') continue; // not worth a line
    if (result.outcome === 'lost') {
      log(state, `An ${result.name} did not come back.`, 'error');
    } else if (result.outcome === 'cache') {
      log(state, `An expedition brought back ${formatMass(result.grams)} of ${result.name.toLowerCase()}.`, 'info');
    } else if (result.outcome === 'hostile') {
      log(
        state,
        result.colonisable
          ? `Found ${formatArea(result.area)} m² of ${result.name.toLowerCase()} — people are on it.`
          : `Found ${formatArea(result.area)} m² of ${result.name.toLowerCase()}, which the hive cannot live in.`,
        'warn',
      );
    } else {
      log(state, `Found ${formatArea(result.area)} m² of ${result.name.toLowerCase()}. Unclaimed.`, 'unlock');
    }
  }

  // The click combo bleeds away in real time. Offline catch-up runs the same
  // line with a dt of hours, which lands it at zero — which is right: nobody
  // was clicking.
  if (state.clickHeat > 0) {
    state.clickHeat = Math.max(0, state.clickHeat - dt / MANUAL_COMBO_COOL_SECONDS);
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

/* ======================================================= raising a structure */

/**
 * GROW ONE OR MORE OF SOMETHING. The one place a structure ever actually goes
 * up, so the button on the Hive tab and the build queue cannot drift apart —
 * the queue is not a second way to build, it is the same way, called later.
 *
 * Takes the state being ticked rather than the live one, because the queue
 * drains inside tick() and a test ticking a scratch hive must not grow
 * buildings in the real one. `onLog` is how the caller says it; the two call
 * sites write to different logs.
 *
 * Returns how many went up, which is 0 for anything refused.
 */
export function raiseStructure(state, id, count = 1, onLog = null) {
  const def = STRUCTURES[id];
  if (!def || !def.unlock(state)) return 0;

  // A levelled structure is one thing you upgrade, so "build 5" means "take it
  // five levels higher" and it stops at its cap rather than quietly overshooting.
  const wanted = Math.min(count, maxLevelOf(id) - (state.structures[id] || 0));
  if (wanted <= 0) return 0;

  const cost = structureCost(state, id, wanted);
  if (!canAfford(state, cost)) return 0;

  const had = state.structures[id] || 0;
  // How many were running BEFORE this. Absent means all of them, so this has to
  // be read before the count moves.
  const wasRunning = state.active?.[id] ?? had;
  for (const [n, amount] of Object.entries(cost)) state.nutrients[n] -= amount;
  // `had + wanted`, not `+= wanted`: a structure id that is not already a key —
  // a new building on an old save, or a hand-built test fixture — would make
  // that NaN, and a NaN count spreads silently through every capacity in the
  // game before anything complains.
  state.structures[id] = had + wanted;
  // Something newly built is switched on. Idling is a thing the player chooses,
  // never a thing that happens to them.
  state.active ??= {};
  state.active[id] = isLeveled(id)
    // A levelled entry is a flag. Upgrading something you deliberately shut
    // down leaves it shut down; the first one ever raised comes up running.
    ? (had === 0 || wasRunning > 0 ? state.structures[id] : 0)
    : Math.min(state.structures[id], wasRunning + wanted);
  state.stats.built += wanted;

  // Something raised from nothing is raised lit, whatever the last one of its
  // kind browned out to. Upgrading one that is already standing does NOT reset
  // it: a dark Hivecore taken up a level is a bigger dark Hivecore.
  if (had === 0) {
    state.power ??= {};
    state.power[id] = 1;
  }
  if (onLog) {
    onLog(
      def.leveled
        ? `${def.name} raised to level ${state.structures[id]}.`
        : `Grew ${wanted > 1 ? `${def.name} ×${wanted}` : def.name}.`,
      'build',
    );
  }
  return wanted;
}

/* ------------------------------------------------------------- build queue */

/**
 * THE BUILD QUEUE.
 *
 * A hive that cannot queue work makes the player sit and watch a number climb
 * so they can press a button at the right moment. The queue is the hive being
 * told what to do next and getting on with it — the resources are still the
 * only constraint, and nothing here makes anything cheaper or faster.
 *
 * STRICTLY IN ORDER, head first. A queue that skipped past an item it could
 * not afford to build the cheap thing behind it would quietly invert the
 * player's priorities every time they lined up something expensive, which is
 * exactly when the order matters most. So the head waits, and the player is
 * the one who decides what goes first.
 */
export const BUILD_QUEUE_BASE = 2;

/** How many builds can be lined up at once. Research widens it. */
export function buildQueueCap(state) {
  let cap = BUILD_QUEUE_BASE;
  for (const id of RESEARCH_ORDER) {
    if (state.tech?.[id]) cap += RESEARCH[id].queue || 0;
  }
  return cap;
}

/** How many builds are lined up right now. Entries hold runs of the same one. */
export function queuedCount(state) {
  return (state.buildQueue || []).reduce((sum, e) => sum + (e.n || 0), 0);
}

/** Room left in the queue. */
export function queueRoom(state) {
  return Math.max(0, buildQueueCap(state) - queuedCount(state));
}

/**
 * Is this entry still something the hive could ever build? A queue outlives the
 * situation it was written in — a structure can hit its level cap from the
 * button while an upgrade for it is still sitting in the queue — and an entry
 * that can never be built would otherwise block everything behind it forever.
 */
export function queueEntryLegal(state, id) {
  const def = STRUCTURES[id];
  if (!def || !def.unlock(state)) return false;
  return maxLevelOf(id) - (state.structures[id] || 0) > 0;
}

/**
 * Build what can be built off the head of the queue. Called once per tick.
 *
 * Several in one tick is deliberate: offline catch-up hands this hours at a
 * time, and a queue that could only advance one step per tick would come back
 * from a night away with the same two things still waiting on resources that
 * arrived before dawn.
 */
export function advanceBuildQueue(state) {
  const queue = state.buildQueue;
  if (!Array.isArray(queue) || !queue.length) return 0;
  let built = 0;

  // Bounded by the queue's own length: every pass either builds something or
  // drops something, and both shorten it.
  for (let guard = queue.length * 2; guard > 0 && queue.length; guard -= 1) {
    const head = queue[0];
    if (!head || !(head.n > 0)) { queue.shift(); continue; }

    if (!queueEntryLegal(state, head.id)) {
      log(
        state,
        `${STRUCTURES[head.id]?.name ?? head.id} cannot be built any further — dropped from the queue.`,
        'warn',
      );
      queue.shift();
      continue;
    }

    if (!raiseStructure(state, head.id, 1, (text, type) => log(state, text, type))) break;
    built += 1;
    head.n -= 1;
    if (head.n <= 0) queue.shift();
  }
  return built;
}
