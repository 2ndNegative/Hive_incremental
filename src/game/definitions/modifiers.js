// WHAT CAN BE MADE BETTER OR WORSE, and the one way anything says so.
//
// A modifier is a named CHANNEL — "how fast the brood lays", "how much a
// gathering drone brings back" — that any number of sources contribute to, and
// that exactly one place in the engine reads. Structures contribute through
// their `mult` map, research through its own, and genetics will contribute
// through its.
//
// WHY THIS EXISTS. There was already a multiplier layer: `MULTIPLIERS` in
// castes.js, summed by `computeMultipliers` in the engine, every tick. It had
// six channels, all of them named for castes that are parked, no live structure
// fed it, and NOTHING READ THE RESULT — `derived.mult` was computed and
// discarded on every derive. Meanwhile the nine things it was supposed to
// govern were each hard-coded at their point of use, scattered across three
// files. So "this gene makes the brood 20% faster" had nowhere to be written
// down, and the only way to add it would have been to find all nine sites and
// edit them by hand — which is how you end up with a tenth that got missed.
//
/* --------------------------------------------------------------- THE RULES
 *
 * 1. A CHANNEL IS A FACT ABOUT THE GAME, NOT ABOUT ITS SOURCE.
 *
 *    `broodRate` is "how fast larvae are laid", whoever is making it faster.
 *    The old list failed this: `forager`, `analyst` and `hunter` were named
 *    after the castes that happened to supply them, so when the castes were
 *    parked the channels became unreadable — a channel called `forager` tells
 *    you nothing about what it multiplies.
 *
 * 2. BONUSES ADD; THE RESULT MULTIPLIES.
 *
 *    Every source contributes a number to a channel's running total, and the
 *    engine applies `1 + total`. Two sources of +20% give +40%, not +44%. This
 *    is the ordinary idle-game convention and it is the one that stays legible
 *    when a dozen sources stack — a product of a dozen terms is a number nobody
 *    can predict from the screen.
 *
 *    A total of -1 or below means the thing stops entirely. `factor()` clamps
 *    there rather than going negative, because a negative harvest is matter
 *    appearing out of nowhere in the other direction.
 *
 * 3. A CHANNEL NAMED FOR A COST MEANS MORE COST.
 *
 *    This is the sharp edge, and it is handled by naming rather than by
 *    machinery. `harvest` is a benefit: +0.2 is good. `rationCost` is a cost:
 *    +0.2 means the drones eat twenty per cent MORE, and a gene that makes them
 *    frugal contributes -0.2. There is no `lower: true` flag, deliberately —
 *    a flag is a thing you can forget to read, whereas a name ending in `Cost`
 *    is read every time anybody types it.
 *
 * 4. ONE READER PER CHANNEL.
 *
 *    Each channel is applied in exactly one place in the engine. If a second
 *    place wants it, that is a sign the two places are computing the same thing
 *    twice — which is the bug the brood rate had, where `computeDerived` and
 *    `tick` each worked out the lay rate from scratch and agreed only because
 *    somebody kept them in step by hand.
 *
 * 5. SCALED BY CHARGE, WHERE THE SOURCE IS A BUILDING.
 *
 *    A structure contributes its `mult` times how many of it are RUNNING, at
 *    the charge they are running at — a browned-out building gives a browned-out
 *    bonus. That falls out of `working()` and is not something a channel has to
 *    opt into.
 */

/**
 * THE CHANNELS.
 *
 * `applied` names the one place in the engine that reads it, so a channel and
 * its reader can be found from each other. Keep it true — it is the only thing
 * making rule 4 checkable, and the load-time check at the bottom of engine.js
 * does not know where the code is, only that something read it.
 */
export const CHANNELS = {
  broodRate: {
    name: 'Brood rate',
    desc: 'How fast the brood chambers lay larvae.',
    applied: 'computeDerived, the brood block',
  },
  moldRate: {
    name: 'Molding rate',
    desc: 'How fast a molding chamber presses a larva into a drone.',
    applied: 'computeDerived, the molding block',
  },
  harvest: {
    name: 'Harvest',
    desc: 'How much a gathering drone brings back from a patch.',
    applied: 'computeDerived, the drone forage block',
  },
  insight: {
    name: 'Insight',
    desc: 'How fast the hive works things out.',
    applied: 'computeDerived, the insight block',
  },
  digestion: {
    name: 'Digestion',
    desc: 'Grams of raw matter the gut breaks down per second.',
    applied: 'computeDerived, digestCapacity',
  },
  storage: {
    name: 'Storage',
    desc: 'Room for macronutrients.',
    applied: 'computeCaps',
  },
  mineralStorage: {
    name: 'Mineral storage',
    desc: 'Room for minerals.',
    applied: 'computeCaps',
  },
  vitaminStorage: {
    name: 'Vitamin storage',
    desc: 'Room for vitamins.',
    applied: 'computeCaps',
  },

  // Costs. Rule 3: a positive number here is WORSE for the hive.
  rationCost: {
    name: 'Appetite',
    desc: 'How much energy a drone\'s ration costs. Higher is hungrier.',
    applied: 'computeRation',
  },
  waterCost: {
    name: 'Thirst',
    desc: 'How much water the colony draws just to stand still. Higher is thirstier.',
    applied: 'computeDerived, the water draw',
  },

  // Parked, and kept only because two parked structures still declare them.
  // They break rule 1 — they are named after castes rather than after what they
  // multiply — so when those structures come back, rename them to whatever they
  // actually make better rather than reviving these.
  forager: { name: 'Forager output', desc: 'Parked with the Forager caste.', applied: 'nothing' },
  analyst: { name: 'Analyst output', desc: 'Parked with the Analyst caste.', applied: 'nothing' },
  hunter: { name: 'Hunter output', desc: 'Parked with the Hunter caste.', applied: 'nothing' },
};

export const CHANNEL_ORDER = Object.keys(CHANNELS);

/** A fresh, empty set of bonuses. Every channel present, every one at zero. */
export function emptyModifiers() {
  const mod = {};
  for (const id of CHANNEL_ORDER) mod[id] = 0;
  return mod;
}

/**
 * Add a source's contributions in. `scale` is how much of that source there is
 * — units of a structure, at their charge — and defaults to one whole thing.
 *
 * Throws on a channel nobody declared. A typo'd channel name is otherwise a
 * bonus that silently does nothing, which is the hardest kind of balance bug to
 * see: the number is in the file, the screen says the building is built, and
 * the effect is simply absent.
 */
export function addModifiers(mod, bonuses, scale = 1) {
  if (!bonuses) return mod;
  for (const [channel, value] of Object.entries(bonuses)) {
    if (!(channel in CHANNELS)) {
      throw new Error(
        `Unknown modifier channel "${channel}". Declare it in definitions/modifiers.js, `
        + `or use one of: ${CHANNEL_ORDER.join(', ')}.`,
      );
    }
    mod[channel] += value * scale;
  }
  return mod;
}

/**
 * The multiplier to actually apply. Rule 2: `1 + total`, floored at zero.
 *
 * Takes a possibly-absent map so a caller mid-refactor, or a test driving a
 * hand-built state, gets 1 rather than NaN — a NaN here spreads through every
 * rate in the game before anything complains.
 */
export function factor(mod, channel) {
  READ.add(channel);
  return Math.max(0, 1 + (mod?.[channel] ?? 0));
}

/**
 * The raw total, for the few readers that already have a running total of their
 * own to fold it into.
 *
 * The storage channels are the case: `computeCaps` is already summing every
 * building's `capMult` into one number per group and applying `1 +` once at the
 * end. Reading those through `factor` would apply the `1 +` twice — the gene
 * would land as a separate multiplier and compound with the buildings instead
 * of adding to them, which is rule 2 broken in the one place it is easiest to
 * break by accident.
 *
 * Counts as a read, exactly as `factor` does. A channel is connected or it is
 * not; which of the two shapes its reader happens to want is nobody else's
 * business.
 */
export function channelTotal(mod, channel) {
  READ.add(channel);
  return mod?.[channel] ?? 0;
}

/* ------------------------------------------- is anybody actually reading these?
 *
 * Rule 4 says every channel is applied in exactly one place. `applied` names
 * that place in prose, which is worth having for a reader and worth nothing as
 * a guarantee — prose cannot tell you that somebody deleted the line.
 *
 * And an unread channel is the exact failure this whole file was built to end.
 * The thing it replaced had six channels, a summing pass that ran every tick,
 * and no reader at all; it looked completely healthy from the inside, because
 * everything it did, it did correctly. Nothing was wrong except that the answer
 * went nowhere.
 *
 * So `factor` writes down which channels it has been asked for, and a test
 * drives one derive and checks the list. It is not a load-time check — at load
 * nothing has run yet, and a channel is only provably read once the engine has
 * been through its paces. See tests/modifier-test.mjs.
 */
const READ = new Set();

/** Channels something has asked `factor` for since the page loaded. */
export function channelsRead() {
  return new Set(READ);
}

/**
 * Channels NOBODY has read, excluding the ones openly parked. Empty is the
 * healthy answer. Anything in it is a bonus that can be written, will be
 * summed, and will do nothing whatsoever.
 */
export function unreadChannels() {
  return CHANNEL_ORDER.filter(
    (id) => CHANNELS[id].applied !== 'nothing' && !READ.has(id),
  );
}
