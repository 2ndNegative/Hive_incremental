// GENES, AND THE TRAITS THEY MOVE.
//
// A gene is written into a SUBJECT — one drone type today, a structure type
// later — and every one of that subject gets it. It is not a thing an
// individual drone carries: the hive has one genome per kind of body, and
// rewriting it rewrites every body of that kind at once. That is the whole
// reason the subject list on the left of the tab is a list of TYPES and not a
// list of drones.
//
// ============================================================================
// WHY THIS IS NOT definitions/modifiers.js
//
// The modifier layer already does "a named thing any number of sources make
// better or worse". It is hive-wide: `harvest` is how much A GATHERING DRONE
// brings back, all of them, and a structure that raises it raises it for
// everything that gathers.
//
// A gene is the other shape. "Foragers eat less" is not a fact about the hive,
// it is a fact about foragers, and there is no honest way to write it into a
// global channel — the moment a second drone type exists, a global `appetite`
// is either wrong for one of them or has to be split per type anyway. So this
// is a parallel layer with the same grammar and a different scope, and the two
// stack: the hive-wide channel and the subject's own trait both apply.
//
// The grammar is deliberately IDENTICAL to the modifier layer's, because the
// two will be read side by side for the rest of the project:
//
//   — bonuses ADD, the result MULTIPLIES. Two genes at +15% give +30%.
//   — a trait named for a cost means MORE cost. `appetite` +0.2 is hungrier,
//     and a gene that makes a drone frugal contributes -0.2.
//   — ONE READER per trait. `applied` names it.
//
// The one thing this layer has that the modifier layer refuses to have is a
// statement of which DIRECTION is better. The engine does not need it — it
// gets the sign from the name, which is the argument modifiers.js makes and it
// is right. The INTERFACE does need it: a screen whose job is to show you what
// a gene would change has to know whether to paint +15% green or red, and
// working that out from a substring of the trait's name would be a guess.
// ============================================================================

import { DRONE_TYPES } from './drones.js';

/**
 * THE TRAITS.
 *
 * `applied` names the one place that reads it, the same contract CHANNELS
 * keeps. `floor` is the lowest the multiplier may fall to — it matters for a
 * trait something DIVIDES by, where zero is not a slow drone but a crash.
 */
export const TRAITS = {
  pace: {
    name: 'Pace',
    desc:
      'How fast it gets through a work cycle. A forager at +20% comes home every ten seconds '
      + 'instead of twelve; an explorer at +20% is back off the map that much sooner.',
    // A divisor in both readers, hence a floor well clear of zero: a pace of
    // nothing is not a drone standing still, it is a cycle length of infinity
    // and a NaN in every rate on the screen.
    floor: 0.1,
    better: 'up',
    applied: 'forage.js cycleFor, and expedition.js expeditionSeconds',
  },
  appetite: {
    name: 'Appetite',
    desc: 'How much of a ration one of them eats. Higher is hungrier.',
    // Free is a legitimate target for a gene. Below free is the hive being paid
    // to hold drones, which is matter from nowhere.
    floor: 0,
    better: 'down',
    applied: 'engine.js computeRation, the per-type bill',
  },
};

export const TRAIT_ORDER = Object.keys(TRAITS);

/**
 * THE GENES.
 *
 * `blocks(subject)` returns the REASON this gene cannot go into that subject,
 * or null if it can. A reason rather than a boolean because the interface has
 * to print it: "you cannot have this" with no explanation is the worst kind of
 * locked door, and a gene that only suits one body is making a claim about
 * that body which is worth saying out loud.
 *
 * `effects` is trait id → contribution, on the ladder above.
 */
export const GENES = {
  quickstep: {
    id: 'quickstep',
    name: 'Quickstep',
    desc:
      'A shorter stride and a faster turnaround. It covers the same ground in less time and '
      + 'does not carry any more for it — more trips of the same size, not bigger trips.',
    effects: { pace: 0.15 },
    // Every body that does anything on a cycle, which so far is every body.
    blocks: (subject) => (subject.kind === 'drone'
      ? null
      : 'Only a drone has a work cycle to shorten.'),
  },

  thrift: {
    id: 'thrift',
    name: 'Thrift',
    desc:
      'A longer gut that gets more out of what goes into it. The drone runs on less of the '
      + 'hive\'s stores without working any slower.',
    effects: { appetite: -0.2 },
    // Deliberately narrow, so the tab has something to refuse and a reason to
    // give for refusing it.
    blocks: (subject) => (subject.kind === 'drone' && subject.typeId === 'forager'
      ? null
      : 'Only a Forager. The gut this lengthens is the one that breaks down standing '
        + 'vegetation, and nothing else the hive grows lives on it.'),
  },
};

export const GENE_ORDER = Object.keys(GENES);

/* ------------------------------------------------------------------ subjects
 *
 * A subject is identified by "<kind>:<id>" for the same reason a crew is
 * "<type>:<biome>": it is one string, so it keys a plain object in the save and
 * survives a round trip without anything having to rebuild a pair.
 */

export function subjectKey(kind, id) {
  return `${kind}:${id}`;
}

export function splitSubjectKey(key) {
  const cut = key.indexOf(':');
  return cut < 0
    ? { kind: key, id: '' }
    : { kind: key.slice(0, cut), id: key.slice(cut + 1) };
}

/**
 * The kinds of thing genetics can be written into, in the order the tab lists
 * them.
 *
 * Structures are declared here and empty on purpose. The tab is built to show a
 * kind with nothing in it rather than to hide it — "buildings, not yet" is a
 * true and useful thing for the screen to say, and it means the second kind
 * arriving is a change to this list and nothing else.
 */
export const SUBJECT_KINDS = {
  drone: {
    name: 'Drones',
    blurb: 'A genome per kind of body. Rewrite it and every drone of that kind is rewritten.',
  },
  structure: {
    name: 'Buildings',
    blurb: 'Nothing yet. Buildings will take genes of their own.',
    empty: 'The hive cannot grow a building to a plan it has written down. Not yet.',
  },
};

export const SUBJECT_KIND_ORDER = Object.keys(SUBJECT_KINDS);

/* ----------------------------------------------- load-time checks, as always
 *
 * Both of these catch the same class of mistake the cost and structure tables
 * catch at load: a name that looks right, reads right, and refers to nothing.
 * A gene naming a trait that does not exist would be summed into a key nobody
 * reads and do precisely nothing, which is the failure modifiers.js was
 * written to end.
 */
{
  for (const [id, gene] of Object.entries(GENES)) {
    if (gene.id !== id) {
      throw new Error(`Gene "${id}" declares id "${gene.id}". They have to match.`);
    }
    if (typeof gene.blocks !== 'function') {
      throw new Error(`Gene "${id}" has no blocks(subject). Return null to allow, a reason to refuse.`);
    }
    for (const trait of Object.keys(gene.effects || {})) {
      if (!(trait in TRAITS)) {
        throw new Error(
          `Gene "${id}" moves unknown trait "${trait}". Declare it in definitions/genes.js, `
          + `or use one of: ${TRAIT_ORDER.join(', ')}.`,
        );
      }
    }
  }
  // A gene that fits nothing at all is almost certainly a typo in `blocks`.
  for (const [id, gene] of Object.entries(GENES)) {
    const fitsSomething = Object.keys(DRONE_TYPES).some(
      (typeId) => gene.blocks({ kind: 'drone', typeId, id: typeId }) === null,
    );
    if (!fitsSomething) {
      throw new Error(`Gene "${id}" fits no drone type that exists. Check its blocks().`);
    }
  }
}
