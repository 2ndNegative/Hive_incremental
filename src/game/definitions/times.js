// HOW LONG THINGS TAKE TO GROW.
//
// The companion to costs.js. Every structure states a NAMED DURATION, never a
// number of seconds, for exactly the reasons the cost ladder exists: thirteen
// hand-written times would be thirteen undesigned numbers, and "buildings feel
// slow" would be thirteen separate judgement calls instead of one line here.
//
//   time: 'short'
//
// WHAT BUILD TIME IS FOR. Cost asks "can the hive pay for this". Time asks
// "and is it ready yet". Before it existed, a hive that could pay for six
// Vacuoles had six Vacuoles in the same instant, so a windfall turned
// immediately into finished buildings and the queue was an auto-buy list. With
// time, the queue is a plan the hive works through, a windfall is a head start
// rather than a shopping spree, and the difference between a shelf and a
// Hivecore is something the player feels rather than reads.
//
/* --------------------------------------------------------------- THE RULES
 *
 * 1. COST GATES. TIME TEXTURES.
 *
 *    This is the whole philosophy and every number below follows from it. The
 *    thing standing between the hive and its next building should almost always
 *    be the mass, because mass is what the player has levers on — where the
 *    drones are, what is being burnt, which biome is being worked. Time is what
 *    stops an affordable thing being instant. It is not a second economy and it
 *    must never become the binding constraint for long, which is why:
 *
 *      — the rungs top out at half an hour, not hours;
 *      — the count curve is almost flat (rule 3);
 *      — and the whole thing is divided by how fast the hive is growing
 *        (rule 4), so a hive that is doing well builds faster.
 *
 * 2. THE SPACING IS ABOUT ×2.2, AS IN THE AMOUNT LADDER.
 *
 *    Same reasoning: below ×1.6 a rung stops being a distinguishable choice,
 *    and much above ×2.5 everything bunches. Six rungs span 30 s to 30 min,
 *    which is the real range — from throwing up a shelf to growing a mind.
 *
 * 3. THE COUNT CURVE IS DELIBERATELY THE GENTLEST IN THE GAME.
 *
 *    `(1 + n) ** 0.25`. The fiftieth Cistern takes 2.7× as long to grow as the
 *    first. Compare the cost side, where `steady` makes the fiftieth cost
 *    fourteen million times the first. That asymmetry is rule 1 expressed as
 *    arithmetic: cost is allowed to run away, time is not. The alternatives
 *    were measured and rejected —
 *
 *      nth      (1+n)^0.25   1+0.15√n    √(1+n)    cost ×1.4
 *      1st        1.00         1.00       1.00        1.0
 *      5th        1.50         1.30       2.24        3.8
 *      10th       1.78         1.45       3.16       20.7
 *      25th       2.24         1.73       5.00    3 214
 *      50th       2.66         2.05       7.07   14.5 million
 *
 *    — because √(1+n) is already a wall at twenty-five, and 1+0.15√n is so
 *    flat that a hive with fifty of something may as well have one. The
 *    quarter-power sits where the slowdown is felt and never fought.
 *
 * 4. A GROWING HIVE BUILDS FASTER. The rung is WORK, not wall-clock.
 *
 *    What a rung names is a number of PACE-SECONDS, and the hive works through
 *    them at `derived.buildPace` — which is `larvaPace × vigour`, the same
 *    number already driving the brood and molding chambers. So:
 *
 *      — larvae make everything the hive is doing faster, build included;
 *      — thirst and hunger slow construction along with everything else.
 *
 *    This is why the rungs read long. `glacial` is thirty minutes in a hive
 *    with no brood at all; at five larvae it is fifteen, and at forty-five it
 *    is seven and a half. The headline number is the worst case, which is the
 *    right way round — a player who has just landed should find a Hivecore
 *    slow, and a player with a working nursery should find it brisk.
 *
 *    It also means progress is stored as work REMAINING rather than as a
 *    deadline: a brood hatching halfway through a build speeds up the rest of
 *    it, which is the behaviour anyone would expect and the one a stored
 *    finish-time could not give.
 *
 * 5. PICK THE RUNG FROM WHAT THE THING IS, NOT FROM WHAT IT COSTS.
 *
 *    A Cistern is cheap and quick because it is a bag. An Interlocutor is dear
 *    and slow because it is a second mind. Those happen to correlate, and when
 *    they do not, the thing's nature wins: cost already says "expensive", and
 *    having time say it again just doubles the same statement.
 *
 * 6. WHEN A NUMBER REALLY IS BESPOKE, WRITE IT. As in costs.js, `duration`
 *    takes a raw number of seconds — and expect to justify it in a comment.
 */

/**
 * THE DURATION LADDER, in pace-seconds.
 *
 * Read these as the time in a hive with NO larvae and full vigour. See rule 4:
 * anything with a nursery is faster, often much.
 *
 * Roughly what each is FOR, as the table stands today:
 *   moment            nothing yet. Room below `brief` for something trivial.
 *   brief..short      storage. A bag is a bag.
 *   middling          working organs — generators, nodes, a caecum
 *   long              chambers and the Memory Bank: things that change the shape
 *                     of the hive
 *   glacial           a mind. The Hivecore and the Interlocutor, and nothing else.
 */
export const TIME = {
  moment: 30,
  brief: 60,
  short: 120,
  middling: 300,
  long: 720,
  glacial: 1800,
};

/** The rungs in order, quickest first. Handy for tools and for the tests. */
export const TIME_ORDER = Object.keys(TIME);

/**
 * How much slower the nth one is than the first. Rule 3.
 *
 * Exported as its own constant because it is the single most dangerous number
 * in this file: raising it to 0.5 turns build time from texture into the thing
 * the whole mid-game is waiting on.
 */
export const BUILD_COUNT_EXPONENT = 0.25;

/**
 * Resolve a rung name — or a raw number of seconds, for the bespoke case.
 * Throws on anything else, because a silent `undefined` here is an instant
 * building and nothing else in the game would notice.
 */
export function duration(size) {
  if (typeof size === 'number') {
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`Bad build duration: ${size}`);
    }
    return size;
  }
  const seconds = TIME[size];
  if (seconds === undefined) {
    throw new Error(
      `Unknown build duration "${size}". Use one of: ${TIME_ORDER.join(', ')} — `
      + 'or a raw number of seconds. Every structure must declare a `time`.',
    );
  }
  return seconds;
}

/** The count multiplier for something the hive already has `owned` of. */
export function countFactor(owned = 0) {
  return (1 + Math.max(0, owned)) ** BUILD_COUNT_EXPONENT;
}

/**
 * THE WHOLE CALCULATION, in one place: how much work the next one of something
 * is, in pace-seconds.
 *
 * Divided by nothing. The pace belongs to the hive, not to the building, so it
 * is applied as the work is done rather than baked in here — see rule 4.
 */
export function buildWork(size, owned = 0) {
  return duration(size) * countFactor(owned);
}

/**
 * The nearest rung to a number of seconds, for tools that have to go the other
 * way — a balance pass, or a test checking that nothing drifted.
 */
export function nearestTime(seconds) {
  let best = TIME_ORDER[0];
  let bestError = Infinity;
  for (const name of TIME_ORDER) {
    // As a RATIO, as in costs.js: 30 s against 60 s is a bigger error than
    // 1800 s against 1830 s, and a linear comparison says the opposite.
    const error = Math.abs(Math.log(TIME[name] / seconds));
    if (error < bestError) {
      bestError = error;
      best = name;
    }
  }
  return best;
}
