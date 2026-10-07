// WHAT THINGS COST.
//
// Every build cost in the game is written as a NAMED AMOUNT of an exactly named
// resource, plus a named growth curve. Nothing in a structure or drone
// definition spells out a number of grams.
//
//   cost: build('steady', { fiber: 'large', protein: 'small', fat: 'slight' })
//
// WHY. Thirteen live buildings used to carry thirty-three hand-written numbers
// between them: ten different fibre bases, eight protein bases and seven growth
// factors. Almost none of those were chosen against each other — 450 against
// 480 against 520 is not a decision anyone made, it is drift that accumulated
// one building at a time. Rebalancing "fibre is too tight" meant finding and
// re-judging ten numbers in ten places and hoping they still agreed afterwards.
// Now it means editing one line of the ladder below.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not decide WHICH resources a
// building costs, and it never will. A Cistern costs water because a cistern
// holds water; a Glycogen Granule costs sugar because that is what it is for.
// Those are design decisions about the thing being built and they belong in the
// thing's own definition. The ladder generalises the AMOUNT and nothing else.
//
/* --------------------------------------------------------------- THE RULES
 *
 * 1. THE SPACING IS ABOUT ×2.2, AND THAT IS NOT ARBITRARY.
 *
 *    Below about ×1.6 the rungs stop being distinguishable and you may as well
 *    type the number. At ×2.5 and above, everything bunches: at that spacing
 *    every fibre cost in the game lands on a single rung and the Vacuole costs
 *    exactly what the Crop Chamber does. The 1‑2.5‑5 series below sits in the
 *    band where a rung is a real choice and the numbers stay readable.
 *
 * 2. THE LADDER IS ABSOLUTE GRAMS, SHARED BY EVERY RESOURCE.
 *
 *    `medium` is 250 g whether it is fibre or iron. Dear resources simply use
 *    low rungs: a building asks for `large` fibre and `minuscule` iron. This
 *    keeps the mental model trivial — a rung name always means the same weight —
 *    at the cost of the names not being self-scaling per resource. That trade
 *    was made on purpose.
 *
 * 3. PICK THE RUNG, THEN CHECK THE NEIGHBOURS.
 *
 *    A cost that feels like it is between two rungs should go to the cheaper
 *    one. Costs compound through the growth curve, and a building that is 60%
 *    too dear at level one is several kilos too dear by level ten.
 *
 * 4. THE GROWTH CURVE MATTERS MORE THAN THE RUNG. Read the note on GROWTH.
 *
 * 5. NOTHING EVER COSTS MINERAL MASS. It costs a NAMED MINERAL.
 *
 *    `ash` is not a resource, it is the bag the minerals are hiding in — the
 *    undifferentiated fraction the hive has not learned to sort yet. Pricing a
 *    building in ash says the hive needs "some mineral, any mineral", which is
 *    true of nothing that is actually built: a generator needs iron because
 *    iron carries oxygen, a shell needs calcium because calcium is what shells
 *    are. So a cost names the element, whether the hive can see it yet or not.
 *
 *    It is not a lost mechanic. An unassayed mineral is charged to its parent
 *    at LOCKED_COST_MULTIPLIER — see payableCost in nutrients.js — so a young
 *    hive still pays in mineral mass, at a bad rate, and the assay that makes
 *    the element visible is also the thing that stops it overpaying. The cost
 *    ALWAYS told the truth about what the building is made of; what changes is
 *    whether the hive can pick that out of the pile.
 *
 *    MIND THE MULTIPLIER WHEN PICKING THE RUNG. At 50×, `tiny` iron is 500 g of
 *    mineral mass before the assay lands, and `trace` is 100 g. The rung you
 *    write is the price AFTER the assay; the price before it is fifty times
 *    larger, and that is the number an early hive actually pays.
 *
 *    build() and flat() refuse `ash` outright rather than leaving this to
 *    whoever reads the comment.
 *
 * 6. WHEN A NUMBER REALLY IS BESPOKE, WRITE IT.
 *
 *    `build()` takes a raw number as well as a rung name. Use it for something
 *    that genuinely has to be an odd amount — and expect to justify it in a
 *    comment, because the next person rebalancing the ladder will not see it.
 */

/**
 * THE AMOUNT LADDER, in grams.
 *
 * A 1‑2.5‑5 preferred series: round, readable, and about ×2.2 a step. Ten rungs
 * span four orders of magnitude, which is the real range the game needs — from
 * a gram of iron to several kilos of fibre.
 *
 * Roughly what each is FOR, as the table stands today:
 *   trace..tiny        micronutrients, and what a drone costs to mold
 *   slight..modest     the fat, ash, carbohydrate and water a building needs
 *   medium..large      fibre and protein, the structural pair
 *   heavy..massive     research, and whatever ends up being built once
 */
export const AMOUNT = {
  trace: 2,
  minuscule: 5,
  tiny: 10,
  slight: 25,
  small: 50,
  modest: 100,
  medium: 250,
  large: 500,
  heavy: 1000,
  massive: 2500,
};

/** The rungs in order, cheapest first. Handy for tools and for the tests. */
export const AMOUNT_ORDER = Object.keys(AMOUNT);

/**
 * THE GROWTH CURVES.
 *
 * How much dearer each one of a thing is than the last. This is the bigger
 * lever BY FAR, and it is the one that used to be least designed — the table
 * carried 1.25, 1.28, 1.3, 1.35, 1.4, 1.45 and 1.6, seven values with no system
 * behind them and no way to tell 1.28 from 1.3 on purpose.
 *
 * From a 500 g base, by the tenth one:
 *
 *   flat     ×1.0     0.5 kg      ten of them:     5 kg
 *   gentle   ×1.25    3.7 kg                      17 kg
 *   steady   ×1.4    10.3 kg                      35 kg
 *   steep    ×1.6    34.4 kg                      91 kg
 *   brutal   ×1.9   161.3 kg                     340 kg
 *
 * Gentle to brutal is a forty-four-fold spread by the tenth building. The whole
 * amount ladder spans ten-fold within a resource. So: choose the curve first
 * and the rung second, and treat a curve change as the serious edit it is.
 *
 *   flat    something the hive should be able to spam — a shelf, a bag
 *   gentle  bulk infrastructure it is expected to end up with a lot of
 *   steady  the default; a thing it wants several of
 *   steep   something where each one is a real decision
 *   brutal  a thing that should hurt to repeat. Nothing uses it yet.
 */
export const GROWTH = {
  flat: 1,
  gentle: 1.25,
  steady: 1.4,
  steep: 1.6,
  brutal: 1.9,
};

export const GROWTH_ORDER = Object.keys(GROWTH);

/**
 * Resolve a rung name — or a raw number, for the bespoke case — to grams.
 * Throws on a name that is not a rung, because a silent `undefined` here turns
 * into a free building and nothing else in the game would notice.
 */
export function amount(size) {
  if (typeof size === 'number') {
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`Bad cost amount: ${size}`);
    }
    return size;
  }
  const grams = AMOUNT[size];
  if (grams === undefined) {
    throw new Error(
      `Unknown cost amount "${size}". Use one of: ${AMOUNT_ORDER.join(', ')} — or a raw number.`,
    );
  }
  return grams;
}

/** The same, for a growth curve. */
export function growthOf(curve) {
  if (typeof curve === 'number') {
    if (!Number.isFinite(curve) || curve < 1) {
      throw new Error(`Bad growth curve: ${curve} (must be at least 1)`);
    }
    return curve;
  }
  const factor = GROWTH[curve];
  if (factor === undefined) {
    throw new Error(
      `Unknown growth curve "${curve}". Use one of: ${GROWTH_ORDER.join(', ')} — or a raw number.`,
    );
  }
  return factor;
}

/**
 * BUILD A COST FUNCTION. The one way a structure or drone states its price.
 *
 *   build('steady', { fiber: 'large', protein: 'small' })
 *
 * Returns `(n) => ({ fiber, protein })` where `n` is how many the hive already
 * has, exactly as the hand-written cost functions did. The resources and their
 * relative weights stay the author's decision, in the author's file; only the
 * magnitudes come from the ladder.
 *
 * Resolved EAGERLY, at module load, so a typo in a rung name is an error the
 * first time the game starts rather than a mystery the first time somebody
 * tries to build that one structure.
 */
export function build(curve, parts) {
  const growth = growthOf(curve);
  const base = {};
  for (const [resource, size] of Object.entries(parts)) {
    refuseUnsorted(resource);
    base[resource] = amount(size);
  }
  const entries = Object.entries(base);
  return (n = 0) => {
    const out = {};
    const scale = growth ** n;
    for (const [resource, grams] of entries) out[resource] = grams * scale;
    return out;
  };
}

/**
 * A FLAT, ONE-OFF COST — a drone's mold cost, where there is no "how many do
 * you already have" to compound against. Same ladder, no curve.
 *
 *   flat({ fat: 'minuscule' })  →  { fat: 5 }
 */
export function flat(parts) {
  const out = {};
  for (const [resource, size] of Object.entries(parts)) {
    refuseUnsorted(resource);
    out[resource] = amount(size);
  }
  return out;
}

/**
 * Rule 5, enforced rather than documented.
 *
 * Thrown at module load, so a cost priced in mineral mass is a game that does
 * not start — which is the right loudness for a rule that is otherwise very
 * easy to break by accident, because `ash` looks exactly like a resource in
 * every list it appears in.
 *
 * STORAGE is a different question and is not touched here: the Gizzard holds a
 * kilo of ash precisely because ash is what unsorted mineral mass IS. The rule
 * is about what a thing is made of, not about what a shelf can hold.
 */
function refuseUnsorted(resource) {
  if (resource !== 'ash') return;
  throw new Error(
    'Nothing costs mineral mass. Name the element the thing is actually made of — '
    + 'iron, calcium, phosphorus — and let payableCost charge it to the ash until '
    + 'the hive has assayed it. See rule 5 in definitions/costs.js.',
  );
}

/**
 * The nearest rung to a number of grams, for tools that have to go the other
 * way — a balance pass reading the old numbers, or a test checking that nothing
 * drifted when the table was converted.
 */
export function nearestAmount(grams) {
  let best = AMOUNT_ORDER[0];
  let bestError = Infinity;
  for (const name of AMOUNT_ORDER) {
    // Compared as a RATIO, not a difference: 2 g against 5 g is a bigger error
    // than 1000 g against 1003 g, and a linear comparison says the opposite.
    const error = Math.abs(Math.log(AMOUNT[name] / grams));
    if (error < bestError) {
      bestError = error;
      best = name;
    }
  }
  return best;
}
