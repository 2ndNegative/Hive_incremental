// Player actions. Every mutation the player can cause goes through here.

import { state, pushLog } from './state.js';
import {
  NUTRIENTS,
  NUTRIENT_IDS,
  MICROS,
  isRevealed,
  visibleAs,
  isUsableFuel,
  itemYield,
  settleReveal,
  payableCost,
} from './definitions/nutrients.js';
import { STRUCTURES, maxLevelOf, isLeveled } from './definitions/structures.js';
import { CASTES } from './definitions/castes.js';
import { RESEARCH, RESEARCH_ORDER } from './definitions/research.js';
import { ITEMS } from './definitions/items/index.js';
import {
  canAfford,
  placeStructure,
  storageFor,
  slotsFor,
  cognitionFor,
  cancelBuild,
  inFlightCount,
  queueRoom,
  queuedCount,
  openStore,
  clickMultiplier,
  MANUAL_COMBO_MAX,
  MANUAL_COMBO_PER_CLICK,
  MANUAL_COMBO_COOL_SECONDS,
} from './engine.js';
import { formatMass, formatArea } from './units.js';

/** Below this, a figure is dust rather than a quantity. */
const EPSILON_GRAMS = 1e-9;
import {
  biomeShares, BIOMES, isDangerous, isColonisable,
} from './definitions/biomes.js';
import { poolFor } from './definitions/forage.js';
import { pickWeighted } from './forage.js';
import { TOPBAR, TOPBAR_ORDER, DEFAULT_PINNED } from './definitions/topbar.js';
import { DRONE_TYPES } from './definitions/drones.js';
import {
  recordFind,
  isNamed,
  blendedConfidence,
  labelForConfidence,
  timesFoundAnywhere,
} from './discovery.js';

const MANUAL_GRAMS = 40;

/** How far either side of that a single mouthful can land. */
const MANUAL_SPREAD = 0.3;

/**
 * What one drone actually comes back with.
 *
 * Two draws averaged rather than one, so the distribution is a triangle peaked
 * on MANUAL_GRAMS instead of a flat band: a mouthful is usually about a
 * mouthful, and only occasionally a very good or a very poor one. Flat
 * randomness reads as noise; this reads as variation.
 */
function manualGrams() {
  const roll = (Math.random() + Math.random()) / 2; // 0..1, centred
  return MANUAL_GRAMS * (1 + (roll * 2 - 1) * MANUAL_SPREAD);
}

/**
 * Add an item's mass to the nutrient stores. This is the only path matter takes
 * into the hive, whether from a click, a caste or offline catch-up.
 * Returns the grams actually absorbed (overflow is lost in the usual way).
 */
export function ingestItem(itemId, grams) {
  const item = ITEMS[itemId];
  if (!item || grams <= 0) return 0;
  // The storage shape only — see storageFor. This is the Consume button, so it
  // runs on every press, and a full derive here cost about a millisecond for
  // one field of it.
  // Same two-tier store as the tick: dedicated room first, the shared general
  // pool after it, and whatever fits in neither is lost.
  const store = openStore(state, storageFor(state));
  for (const [nutrient, amount] of Object.entries(itemYield(state, item.per100g, grams))) {
    if (amount <= 0) continue;
    const lost = store.apply(nutrient, amount);
    if (lost > 0) state.spilled[nutrient] = (state.spilled[nutrient] || 0) + lost;
  }
  state.stats.ingested += grams;
  return grams;
}

/**
 * The click action: a drone picks up whatever is within reach and eats it.
 *
 * Reach means the hive's own land, so the roll is the same two-stage roll every
 * caste makes — a biome by area share, then something from it. It draws on the
 * foraged and scavenged pools together, because those are the two things a
 * drone can simply pick up; rock has to be dug and water has to be siphoned.
 *
 * Unlike a caste's harvest this goes straight to the nutrient stores rather
 * than into storage. One drone chewing a mouthful does not need an organ.
 */
export function consumeBiomass() {
  state.stats.clicks += 1;
  // Heat first, so this press is worth what the player just earned. tick() is
  // what bleeds it away again — see MANUAL_COMBO_COOL_SECONDS.
  state.clickHeat = Math.min(1, (state.clickHeat || 0) + MANUAL_COMBO_PER_CLICK);

  const shares = biomeShares(state);
  const biome = pickWeighted(Object.entries(shares).map(([id, weight]) => ({ id, weight })));
  if (!biome) {
    state.lastGather = { itemId: null, biomeId: null, grams: 0 };
    return 0;
  }

  const pool = [...poolFor('forager', biome.id), ...poolFor('scavenger', biome.id)];
  const found = pickWeighted(pool);
  if (!found) {
    state.lastGather = { itemId: null, biomeId: biome.id, grams: 0 };
    return 0;
  }

  // The press counts towards its own multiplier: the click you just made is
  // the one that gets better, which is the whole feel of the thing.
  const multiplier = clickMultiplier(state);
  const grams = manualGrams() * multiplier;
  state.lastGather = { itemId: found.itemId, biomeId: biome.id, grams, multiplier };
  recordFind(state, biome.id, found.itemId);
  return ingestItem(found.itemId, grams);
}

export const MANUAL_INTAKE = {
  grams: MANUAL_GRAMS,
  spread: MANUAL_SPREAD,
  min: MANUAL_GRAMS * (1 - MANUAL_SPREAD),
  max: MANUAL_GRAMS * (1 + MANUAL_SPREAD),
  // What a run of fast presses builds up to, and how long it survives being
  // left alone. The interface reads these rather than restating them.
  comboMax: MANUAL_COMBO_MAX,
  comboCool: MANUAL_COMBO_COOL_SECONDS,
};

/** Where the click combo has got to: the multiplier, and 0..1 for a bar. */
export function manualCombo() {
  return {
    multiplier: clickMultiplier(state),
    heat: Math.max(0, Math.min(1, state.clickHeat || 0)),
    hot: (state.clickHeat || 0) > 1e-6,
  };
}

/**
 * What a click could turn up, likeliest first — the whole distribution rather
 * than a prediction, since the roll happens on the click. Shares are folded in,
 * so a hive that is nine parts city shows city food at the top.
 *
 * AS FAR AS THE HIVE KNOWS
 * The true table is in here and the hive does not get to read it. Exactly the
 * same discovery log the Territory tab works from decides what this list says:
 * a thing it has never picked up is `???` at `?%`, finding it once anywhere
 * names it here too, and the rate sharpens as the ground gets walked. Because
 * both screens read `state.found` and nothing else, they can never disagree —
 * naming a hazelnut by clicking names it in the territory table in the same
 * frame.
 *
 * A click can land in any biome the hive holds, so its odds are a BLEND, and a
 * blend is only as well understood as the worst-known ground in it. That is
 * what `blendedConfidence` is for: a hive that knows its forest exactly still
 * reports `?%` for anything that might instead have come out of ground it has
 * never worked.
 */
export function manualOdds(limit = 8) {
  const shares = biomeShares(state);
  const weights = {};
  const sources = {}; // itemId -> biome ids that could produce it
  let total = 0;
  for (const [biomeId, share] of Object.entries(shares)) {
    const pool = [...poolFor('forager', biomeId), ...poolFor('scavenger', biomeId)];
    const sum = pool.reduce((a, e) => a + e.weight, 0);
    if (sum <= 0) continue;
    for (const { itemId, weight } of pool) {
      const p = share * (weight / sum);
      weights[itemId] = (weights[itemId] || 0) + p;
      (sources[itemId] ||= new Set()).add(biomeId);
      total += p;
    }
  }
  return Object.entries(weights)
    .map(([itemId, p]) => {
      const chance = total > 0 ? p / total : 0;
      const biomeIds = [...(sources[itemId] || [])];
      const named = isNamed(state, itemId);
      const level = blendedConfidence(state, biomeIds, itemId);
      return {
        itemId,
        name: ITEMS[itemId].name,
        chance,
        // What the interface is allowed to print.
        label: named ? ITEMS[itemId].name : '???',
        rate: labelForConfidence(level, chance),
        named,
        level,
        biomeIds,
        seen: timesFoundAnywhere(state, itemId),
      };
    })
    // Still sorted by the TRUE chance: the order of the list is itself the
    // weak hint, exactly as it is in the territory table.
    .sort((a, b) => b.chance - a.chance)
    .slice(0, limit);
}

/** How much of what a click could turn up the hive can actually read. */
export function manualOddsSummary() {
  const all = manualOdds(Infinity);
  return {
    total: all.length,
    named: all.filter((o) => o.named).length,
    exact: all.filter((o) => o.level === 'exact').length,
  };
}

/* ----------------------------------------------------------------- structures */

/**
 * BUILD SOMETHING. Which now means: line it up.
 *
 * There is no instant build any more — everything takes time, so every build in
 * the game starts life as a queue entry and the card on the Hive tab is simply
 * the shortest way to add one. This is a thin alias on purpose: a second path
 * that put a structure up without going through the queue would be a second set
 * of rules about payment, ordering and cancellation.
 *
 * 'max' means "fill the queue with this", not "as many as the hive can afford".
 * Affordability is no longer the limit on how many of something you can ask
 * for — the queue is — and a Max press that quietly spent everything the hive
 * had would be the old behaviour wearing the new label.
 */
export function buildStructure(id, count = 1) {
  return queueBuild(id, count);
}

/** Give up on whatever is being grown. The mass goes back — see engine.js. */
export function abandonBuild() {
  return cancelBuild(state, pushLog);
}

/* ---------------------------------------------------------- research queue */

/**
 * THE RESEARCH QUEUE.
 *
 * Insight accumulates whether anybody is watching or not, so without a queue
 * the player's job between techs is to come back and press a button at the
 * right moment — which is not a decision, it is an alarm clock.
 *
 * UNCAPPED. The build queue is capped because a build spends mass the instant
 * it starts, so holding five in mind is a real commitment; research spends
 * insight the hive was going to bank regardless, and lining up the whole
 * available tree costs nothing and promises nothing. The only limit is what is
 * ACTUALLY AVAILABLE — a tech whose prerequisites are unmet cannot be queued,
 * because the order it would then be bought in depends on a tree the player
 * cannot see from here.
 *
 * STRICTLY IN ORDER, head first, for the same reason the build queue is: a
 * queue that skipped an expensive head to buy the cheap thing behind it would
 * invert the player's priorities at exactly the moment the order matters.
 */
export function queueResearch(id) {
  const def = RESEARCH[id];
  if (!def || state.tech[id]) return false;
  if (!RESEARCH_ORDER.includes(id)) return false;
  if (!def.requires.every((req) => state.tech[req])) return false;
  state.researchQueue ??= [];
  if (state.researchQueue.includes(id)) return false;
  state.researchQueue.push(id);
  return true;
}

export function unqueueResearch(index) {
  const q = state.researchQueue;
  if (!Array.isArray(q) || index < 0 || index >= q.length) return false;
  q.splice(index, 1);
  return true;
}

/** Move one entry up or down. The order is the whole point of it. */
export function moveResearch(index, delta) {
  const q = state.researchQueue;
  if (!Array.isArray(q)) return false;
  const to = index + delta;
  if (!q[index] || to < 0 || to >= q.length) return false;
  const [entry] = q.splice(index, 1);
  q.splice(to, 0, entry);
  return true;
}

export function clearResearchQueue() {
  const n = (state.researchQueue || []).length;
  state.researchQueue = [];
  return n;
}

/**
 * Buy what can be bought off the head of the queue.
 *
 * Called from the game loop and from the offline catch-up, which is two places
 * and deliberately not inside `tick()`: tick lives in engine.js, `research()`
 * lives here, and actions.js already imports the engine — so the engine calling
 * back into it would be this codebase's first import cycle, with two
 * throw-on-load validation loops in the graph. The two call sites are both
 * "drive the game forward" sites and both pass through here, so there is no
 * second copy of the rule, only a second invocation of it.
 *
 * Loops, because finishing one tech can make the next affordable in the same
 * instant — an assay that reveals a stockpile, or a catch-up step that banked
 * hours of insight at once.
 */
export function advanceResearchQueue() {
  const q = state.researchQueue;
  if (!Array.isArray(q) || !q.length) return 0;
  let bought = 0;
  for (let guard = q.length + 1; guard > 0 && q.length; guard -= 1) {
    const id = q[0];
    // Already known, or no longer legal: drop it rather than letting it sit at
    // the head blocking everything behind it forever.
    if (state.tech[id] || !RESEARCH_ORDER.includes(id)) { q.shift(); continue; }
    if (!RESEARCH[id]?.requires.every((req) => state.tech[req])) { q.shift(); continue; }
    if (!research(id)) break; // cannot pay for it yet; it keeps its place
    q.shift();
    bought += 1;
  }
  return bought;
}

/* ------------------------------------------------------------- build queue */

/**
 * Line something up to be built when the hive can pay for it.
 *
 * Adds up to `count`, clamped by what is left in the queue and by how far the
 * structure can still go — asking for five with two slots free queues two
 * rather than refusing, because the player's intent is clear and a refusal
 * here would just mean clicking again.
 *
 * Repeats of the same building merge into the entry in front of them, so a
 * queue of three Nerve Nodes reads as one line rather than three.
 *
 * Returns how many were added.
 */
export function queueBuild(id, count = 1) {
  const def = STRUCTURES[id];
  if (!def || !def.unlock(state)) return 0;
  state.buildQueue ??= [];

  // What is already promised counts against the cap AND against the structure's
  // own ceiling: queuing a fifth level of something that caps at four is a
  // promise the hive cannot keep, and it would sit at the head blocking
  // everything behind it until the drain threw it out. The one on the bench
  // counts as promised too — its level is paid for, it just has not landed.
  const headroom = maxLevelOf(id) - (state.structures[id] || 0) - inFlightCount(state, id);

  const want = count === 'max' ? queueRoom(state) : count;
  const adding = Math.min(want, queueRoom(state), headroom);
  if (adding <= 0) return 0;

  const last = state.buildQueue[state.buildQueue.length - 1];
  if (last && last.id === id) last.n += adding;
  else state.buildQueue.push({ id, n: adding });
  return adding;
}

/**
 * Take one entry out. `all` drops the whole run of that building; otherwise a
 * single unit comes off, so a queued ×3 can be walked back one at a time.
 */
export function unqueueBuild(index, all = false) {
  const queue = state.buildQueue;
  if (!Array.isArray(queue) || !queue[index]) return 0;
  const entry = queue[index];
  const taken = all ? entry.n : 1;
  entry.n -= taken;
  if (entry.n <= 0) queue.splice(index, 1);
  return taken;
}

/** Move one entry up or down the queue. The order is the whole point of it. */
export function moveQueued(index, delta) {
  const queue = state.buildQueue;
  if (!Array.isArray(queue)) return false;
  const to = index + delta;
  if (!queue[index] || to < 0 || to >= queue.length) return false;
  const [entry] = queue.splice(index, 1);
  queue.splice(to, 0, entry);
  return true;
}

export function clearBuildQueue() {
  const n = queuedCount(state);
  state.buildQueue = [];
  return n;
}

/**
 * Switch some of a structure on or off.
 *
 * The counterpart of assigning drones, and the only way back out of having
 * overbuilt something that eats: four generators chewing through the stores
 * faster than the hive can gather is otherwise a hole with no bottom, because
 * nothing in the game takes a building down again.
 *
 * An idle building is not billed for upkeep, metabolises nothing, holds
 * nothing and occupies no bandwidth. It is still there, and still cost what it
 * cost. A levelled structure is one thing, so it is simply on or off.
 *
 * `count` may be 'all' or 'none'. Returns the number now running.
 */
export function setActive(id, count) {
  const built = state.structures?.[id] || 0;
  if (!STRUCTURES[id]) return 0;
  state.active ??= {};

  let next;
  if (count === 'all') next = built;
  else if (count === 'none') next = 0;
  else next = Math.round(Number(count) || 0);

  // One thing you upgrade cannot be half switched on.
  if (isLeveled(id)) next = next > 0 ? built : 0;

  state.active[id] = Math.max(0, Math.min(built, next));
  return state.active[id];
}

/** Nudge the number running by `delta`. */
export function adjustActive(id, delta) {
  const built = state.structures?.[id] || 0;
  const now = state.active?.[id] ?? built;
  if (isLeveled(id)) return setActive(id, delta > 0 ? 'all' : 'none');
  return setActive(id, now + delta);
}

/* --------------------------------------------------------------------- castes */

export function assignCaste(id, delta) {
  const def = CASTES[id];
  if (!def || !def.assignable || !def.unlock(state)) return 0;
  const slots = slotsFor(state);

  if (delta > 0) {
    const room = slots[id] - state.castes[id];
    const moved = Math.min(delta, state.castes.dormant, room);
    if (moved <= 0) return 0;
    state.castes.dormant -= moved;
    state.castes[id] += moved;
    return moved;
  }

  const moved = Math.min(-delta, state.castes[id]);
  if (moved <= 0) return 0;
  state.castes[id] -= moved;
  state.castes.dormant += moved;
  return moved;
}

/* -------------------------------------------------------------- energy source */

/**
 * THE COOLDOWN IS FOR THE GENERATOR, NOT FOR THE PLAYER.
 *
 * A generator waits out FUEL_SWITCH_SECONDS before changing its own mind, which
 * is what stops it flickering between two stores. Being TOLD to change is not
 * changing its mind: a player who picks a different fuel and then watches the
 * old one keep draining for ten seconds has been given a broken switch. So
 * every one of these drops the lock it affects, and the next tick starts fresh
 * on the new choice.
 */
function releaseFuelLock(consumerKey) {
  if (!state.fuelLock) return;
  if (consumerKey) delete state.fuelLock[consumerKey];
  else state.fuelLock = {};
}

export function setGlobalFuel(preferred, fallback) {
  if (preferred && isUsableFuel(state, preferred)) state.energy.preferred = preferred;
  if (fallback && isUsableFuel(state, fallback)) state.energy.fallback = fallback;
  // Everything without its own setting follows the default, so everything
  // without its own setting is free to move.
  for (const key of Object.keys(state.fuelLock || {})) {
    if (!state.energy.overrides?.[key]) releaseFuelLock(key);
  }
}

export function setFuelOverride(consumerKey, preferred, fallback) {
  state.energy.overrides[consumerKey] = { preferred, fallback };
  releaseFuelLock(consumerKey);
}

export function clearFuelOverride(consumerKey) {
  delete state.energy.overrides[consumerKey];
  releaseFuelLock(consumerKey);
}

/* -------------------------------------------------------------- general store */

/**
 * Forbid a nutrient from the shared pool, or let it back in.
 *
 * The pool is a buffer, not a cupboard: it is small, it is last-in-first-out,
 * and whatever gets there first owns it. A hive gathering forest floor fills it
 * with water and fibre within seconds and then has nowhere to put the protein
 * that actually mattered. Banning is how the player says which overflow is
 * worth catching.
 *
 * Banning something that is ALREADY pooled evicts it on the spot. That mass is
 * overflow by definition — there was never room for it on its own shelf — so it
 * spills rather than moving back, and the log says how much.
 */
export function setGeneralBan(nutrientId, banned) {
  if (!NUTRIENTS[nutrientId]) return false;
  state.generalBans ??= {};
  if (banned) state.generalBans[nutrientId] = true;
  else delete state.generalBans[nutrientId];

  if (banned) {
    // What this rule now covers: the nutrient itself plus every unassayed
    // micronutrient riding inside it. A ban on mineral mass evicts the iron
    // hiding in the pool under that name, so the gate has to count it too —
    // looking only at the macro's own grams would skip the eviction entirely
    // whenever the shadow tally is the thing filling the pool.
    const covers = NUTRIENT_IDS.filter((id) => visibleAs(state, id) === nutrientId);
    let pooled = 0;
    for (const id of covers) pooled += state.general?.[id] || 0;
    if (pooled > EPSILON_GRAMS) {
      // reconcile() is what performs the eviction; this only reports it.
      const lost = openStore(state, storageFor(state)).reconcile();
      let gone = 0;
      for (const id of covers) {
        const mass = lost[id] || 0;
        if (mass <= EPSILON_GRAMS) continue;
        state.spilled[id] = (state.spilled[id] || 0) + mass;
        gone += mass;
      }
      if (gone > EPSILON_GRAMS) {
        // Reported under the name the player set the rule on: the hive cannot
        // tell them apart, which is the whole reason the rule reaches them.
        pushLog(
          `${formatMass(gone)} of ${NUTRIENTS[nutrientId].name.toLowerCase()} spilled out of ` +
            'general storage.',
          'warn',
        );
      }
    }
  }
  return true;
}

export function toggleGeneralBan(nutrientId) {
  return setGeneralBan(nutrientId, !state.generalBans?.[nutrientId]);
}

/**
 * What is in the shared pool right now, heaviest first — as the HIVE sees it.
 *
 * An unassayed micronutrient is reported under the macro that is carrying it,
 * because that is the only name the hive has for those grams yet. Listing them
 * separately would name resources the player has not discovered and make the
 * tooltip disagree with the rules dialog, which has always filtered them out.
 * The grams still add up against the free space, because the roll-up moves the
 * mass between lines rather than dropping it.
 */
export function generalContents() {
  const tally = {};
  for (const id of NUTRIENT_IDS) {
    const grams = state.general?.[id] || 0;
    if (grams <= EPSILON_GRAMS) continue;
    const shown = visibleAs(state, id);
    tally[shown] = (tally[shown] || 0) + grams;
  }
  return Object.entries(tally)
    .map(([id, grams]) => ({ id, def: NUTRIENTS[id], grams }))
    .sort((a, b) => b.grams - a.grams);
}

/* ------------------------------------------------------------------ territory */

/**
 * WHAT A SQUARE METRE COSTS.
 *
 * Mapping ground is free; standing on it is not. A claim is the hive growing
 * itself out over the ground — water to move with, protein to build with, iron
 * for the tissue that holds it together, and fibre for the bulk of it.
 *
 * Iron is unassayed at the start, so a young hive pays 50 g of mineral mass a
 * square metre instead of 1 g of iron — see payableCost. That is the single
 * biggest line on the bill until the assay is run, which is the point.
 */
export const CLAIM_COST_PER_SQUARE_METRE = { water: 400, protein: 60, fiber: 120, iron: 1 };

/**
 * What ground people are standing on costs on top. The hive is not taking an
 * empty field; it is moving in around something that will notice.
 */
export const DANGEROUS_CLAIM_MULTIPLIER = 2.5;

/** The bill for claiming `area` of this biome, as the hive can actually pay it. */
export function claimCost(biomeId, area) {
  const scale = area * (isDangerous(biomeId) ? DANGEROUS_CLAIM_MULTIPLIER : 1);
  const raw = {};
  for (const [n, per] of Object.entries(CLAIM_COST_PER_SQUARE_METRE)) raw[n] = per * scale;
  return payableCost(state, raw);
}

/** The most of this patch the hive could pay for right now. */
export function claimableArea(biomeId) {
  const mapped = state.unclaimed?.[biomeId] || 0;
  if (mapped <= 0) return 0;
  const unit = claimCost(biomeId, 1);
  let most = mapped;
  for (const [n, per] of Object.entries(unit)) {
    if (per <= 0) continue;
    most = Math.min(most, (state.nutrients[n] || 0) / per);
  }
  return Math.max(0, Math.min(mapped, most));
}

/**
 * Take `area` square metres of mapped ground. Pays the bill, moves the area out
 * of `unclaimed` and into the holdings, and returns what it took — or 0 if the
 * hive cannot have it or cannot pay.
 */
export function claimTerritory(biomeId, area) {
  const mapped = state.unclaimed?.[biomeId] || 0;
  const want = Math.min(Number(area) || 0, mapped);
  if (!(want > 0) || !BIOMES[biomeId]) return 0;
  if (!isColonisable(state, biomeId)) return 0;

  const cost = claimCost(biomeId, want);
  if (!canAfford(state, cost)) return 0;

  const store = openStore(state, storageFor(state));
  for (const [n, grams] of Object.entries(cost)) store.apply(n, -grams);

  state.unclaimed[biomeId] = mapped - want;
  if (state.unclaimed[biomeId] <= 1e-9) delete state.unclaimed[biomeId];
  state.territory[biomeId] = (state.territory[biomeId] || 0) + want;
  state.stats.groundClaimed = (state.stats.groundClaimed || 0) + want;

  pushLog(
    `Claimed ${formatArea(want)} m² of ${BIOMES[biomeId].name.toLowerCase()}.`,
    'unlock',
  );
  return want;
}

/** Walk away from mapped ground, so a patch nobody wants stops cluttering the map. */
export function abandonTerritory(biomeId) {
  if (!state.unclaimed?.[biomeId]) return false;
  delete state.unclaimed[biomeId];
  return true;
}

/* --------------------------------------------------------------------- drones */

/**
 * Switch a drone type on or off for the molding chambers.
 *
 * Off is the default and off means off: a chamber with nothing switched on has
 * nothing to make, idles at its lower draw, and eats no larvae.
 */
export function setMolding(typeId, on) {
  if (!DRONE_TYPES[typeId]) return false;
  state.droneMolding ??= {};
  state.droneMolding[typeId] ??= { on: false, target: null };
  state.droneMolding[typeId].on = Boolean(on);
  return state.droneMolding[typeId].on;
}

export function toggleMolding(typeId) {
  return setMolding(typeId, !state.droneMolding?.[typeId]?.on);
}

/**
 * How many of a type to stop at. null is no ceiling; a number is a ceiling,
 * including zero, which is a way of saying "not these" without switching the
 * line off.
 */
export function setMoldTarget(typeId, target) {
  if (!DRONE_TYPES[typeId]) return null;
  state.droneMolding ??= {};
  state.droneMolding[typeId] ??= { on: false, target: null };
  if (target === null || target === undefined || target === '') {
    state.droneMolding[typeId].target = null;
  } else {
    const n = Math.max(0, Math.floor(Number(target)));
    state.droneMolding[typeId].target = Number.isFinite(n) ? n : null;
  }
  return state.droneMolding[typeId].target;
}

/* -------------------------------------------------------------------- top bar */

/**
 * Nail a resource to the top bar, or let it go.
 *
 * An unpinned resource is not hidden — it competes for whatever room is left,
 * and wins that room by being the one that is moving. Pinning is how the player
 * says "I want to see this whether or not it is interesting".
 */
export function togglePinned(id) {
  if (!TOPBAR[id]) return false;
  state.ui.pinned = Array.isArray(state.ui.pinned) ? state.ui.pinned : [...DEFAULT_PINNED];
  const at = state.ui.pinned.indexOf(id);
  if (at >= 0) state.ui.pinned.splice(at, 1);
  else {
    // Kept in declared order rather than in the order they were clicked, so the
    // bar reads the same however the player got there.
    state.ui.pinned.push(id);
    state.ui.pinned.sort((a, b) => TOPBAR_ORDER.indexOf(a) - TOPBAR_ORDER.indexOf(b));
  }
  return state.ui.pinned.includes(id);
}

/** Back to the five the hive starts with. */
export function resetPinned() {
  state.ui.pinned = [...DEFAULT_PINNED];
  return state.ui.pinned;
}

/* ------------------------------------------------------------------ cognition */

/**
 * Hold a block of bandwidth while something is under way.
 *
 * Cognition is a width, so an action does not spend cogits — it occupies them,
 * and gives them back when it finishes. The key is whatever is holding it, so a
 * second call with the same key replaces rather than stacks; that way an action
 * that restarts cannot leak its own reservation.
 *
 * Returns false if the hive does not have the free bandwidth to hold it.
 */
export function reserveCogits(key, amount, label) {
  if (!key || !(amount > 0)) return false;
  state.cognition ??= { reservations: {} };
  state.cognition.reservations ??= {};

  const existing = state.cognition.reservations[key]?.amount || 0;
  const { free } = cognitionFor(state);
  if (amount - existing > free) return false;

  state.cognition.reservations[key] = { amount, label: label || key };
  return true;
}

/** Give a block of bandwidth back. */
export function releaseCogits(key) {
  if (state.cognition?.reservations) delete state.cognition.reservations[key];
}

/** Give all of it back — used when a run ends or an origin is chosen. */
export function releaseAllCogits() {
  state.cognition = { reservations: {} };
}

/* ------------------------------------------------------------------- research */

export function research(id) {
  const def = RESEARCH[id];
  if (!def || state.tech[id]) return false;
  // A tech defined but left out of RESEARCH_ORDER is PARKED: nothing shows it
  // and nothing can buy it, including this. Checked here rather than only in
  // the interface, so the debug handle and the tests see the same ladder the
  // player does.
  if (!RESEARCH_ORDER.includes(id)) return false;
  if (!def.requires.every((req) => state.tech[req])) return false;

  // THROUGH payableCost, like a building's cost and a drone's mold cost.
  //
  // A tech priced in an element the hive cannot see yet is otherwise not
  // expensive, it is IMPOSSIBLE: `canAfford` refuses any unrevealed nutrient,
  // so the entry would sit greyed out forever with no way to tell that from
  // "cannot afford it yet". Substitution charges it to the parent at
  // LOCKED_COST_MULTIPLIER instead — a bad rate the assay later fixes, which is
  // the same bargain every other cost in the game offers.
  //
  // It matters most for what has not been written yet. Nothing in the live tree
  // is priced in a micro today; a genetics tree almost certainly will be.
  const cost = payableCost(state, def.cost);
  if (!canAfford(state, cost)) return false;

  for (const [n, amount] of Object.entries(cost)) {
    if (n === 'insight') state.insight -= amount;
    else state.nutrients[n] -= amount;
  }

  // Snapshot which micros were invisible a moment ago, so the reveal can say
  // what the hive has been quietly sitting on.
  const hiddenBefore = MICROS.filter((n) => !isRevealed(state, n));
  state.tech[id] = true;
  state.stats.researched += 1;
  pushLog(`Research complete: ${def.name}.`, 'research');

  // A tech that creates a need for a building hands over the first one. See
  // the `grants` note at the top of definitions/research.js — placeStructure,
  // not raiseStructure, because this is given rather than bought and must not
  // fail for want of mass the player does not have yet.
  for (const [id, count] of Object.entries(def.grants || {})) {
    const put = placeStructure(state, id, count, pushLog);
    if (put > 0) {
      pushLog(
        `${STRUCTURES[id]?.name ?? id} grown from the new understanding, at no cost.`,
        'unlock',
      );
    }
  }

  const revealed = hiddenBefore.filter((n) => isRevealed(state, n));
  if (revealed.length) {
    const held = revealed
      .filter((n) => (state.nutrients[n] || 0) > 0)
      .sort((a, b) => (state.nutrients[b] || 0) - (state.nutrients[a] || 0));
    pushLog(
      `${revealed.length} new compounds resolved: ${revealed.map((n) => NUTRIENTS[n].name).join(', ')}.`,
      'unlock',
    );
    if (held.length) {
      const top = held
        .slice(0, 4)
        .map((n) => `${formatMass(state.nutrients[n])} ${NUTRIENTS[n].name.toLowerCase()}`)
        .join(', ');
      pushLog(`Already in store, uncounted until now: ${top}.`, 'reveal');

      // Those grams were never extra mass — they have been riding inside the
      // macros all along. Now that the hive can tell them apart, they come out.
      const drawn = settleReveal(state, revealed);
      const bill = Object.entries(drawn)
        .filter(([, grams]) => grams > 0.001)
        .sort((a, b) => b[1] - a[1])
        .map(([n, grams]) => `${formatMass(grams)} off the ${NUTRIENTS[n].name.toLowerCase()}`);
      if (bill.length) {
        pushLog(`Separating it out draws ${bill.join(' and ')}. The mass was always the same mass.`, 'reveal');
      }

      const lost = revealed.reduce((sum, n) => sum + (state.spilled[n] || 0), 0);
      if (lost > 0.001) {
        pushLog(`Records show ${formatMass(lost)} of it was discarded as overflow.`, 'reveal');
      }
    }
  }

  for (const line of def.unlocks || []) pushLog(`Unlocked: ${line}`, 'unlock');
  if (def.efficiency) {
    for (const [n, value] of Object.entries(def.efficiency)) {
      pushLog(`${NUTRIENTS[n].name} now yields ${Math.round(value * 100)}% more usable energy.`, 'unlock');
    }
  }
  return true;
}

/* ---------------------------------------------------------------------- flavour */

export function logIntro() {
  pushLog('Approach vector locked. Local biosphere is carbon-based and extraordinarily dense in energy.', 'info');
  pushLog('Select a landing site.', 'info');
}

export function logOfflineGain(seconds, before) {
  const gains = NUTRIENT_IDS.filter((n) => isRevealed(state, n))
    .map((n) => ({ n, delta: (state.nutrients[n] || 0) - (before[n] || 0) }))
    .filter((g) => g.delta > 0.01)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);
  const mins = Math.round(seconds / 60);
  const span = mins >= 1 ? `${mins} minute${mins === 1 ? '' : 's'}` : `${Math.round(seconds)}s`;
  pushLog(
    gains.length
      ? `Dormant for ${span}. Accumulated ${gains.map((g) => `${formatMass(g.delta)} ${NUTRIENTS[g.n].name.toLowerCase()}`).join(', ')}.`
      : `Dormant for ${span}. Nothing accumulated.`,
    'offline',
  );
}
