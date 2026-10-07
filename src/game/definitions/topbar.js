// What the top bar can show, and how it decides what to show.
//
// THE PROBLEM THIS EXISTS FOR
// There are five headline figures today and there will be more than fit. Two
// things keep that from turning into a wall of numbers:
//
//   PINNING    the player nails a resource to the bar and it is always there.
//              The five it starts with are pinned, so nothing moves until
//              somebody asks it to.
//   ORDERING   whatever room is left goes to whatever is actually doing
//              something. A resource that is MOVING beats one that is sitting
//              still, and a resource that is LOSING beats one that is gaining —
//              because a number going down is the one you needed to see.
//
// Pinned resources hold their declared order and never shuffle: a bar whose
// contents rearrange themselves as you watch is a bar you cannot learn. Only
// the unpinned overflow is sorted by urgency.
//
// ADDING ONE
// Give it an entry here, a chip component in components/topbar/, and a line in
// TOPBAR_ORDER. `read` is the whole of its data contract — the bar, the picker
// and the ordering all go through it, so nothing else has to know the resource
// exists.

import { formatNumber } from '../format.js';
import { formatEnergy, formatPower, formatCogits, formatMass, formatMassFlow } from '../units.js';

/**
 * How many resources the bar will carry before it starts leaving things out.
 *
 * Pinned ones are never left out, so this is really a cap on the overflow: a
 * player who pins nine things gets nine, and takes responsibility for it.
 */
// Eight, not seven: hydration is a SIXTH thing a hive always wants nailed up,
// and leaving the count alone would have squeezed the overflow — the part that
// surfaces whatever is currently going wrong — down to a single slot.
export const TOPBAR_SLOTS = 8;

/**
 * Every top-bar resource.
 *
 *   read(state, derived) -> {
 *     text      the headline figure, formatted
 *     sub       the "/ capacity" half, or null
 *     tone      'good' | 'warn' | 'bad' | 'muted' — colours the headline
 *     store     what the picker lists under "Held"
 *     rate      change per second as a NUMBER. Only the sign is used for
 *               ordering; 0 means stagnant.
 *     rateText  that rate, formatted for the picker, or null when stagnant
 *     note      a short warning for the picker, or null
 *   }
 */
export const TOPBAR = {
  energy: {
    id: 'energy',
    name: 'Energy',
    desc: 'What the generators are making, and what is banked.',
    read: (state, derived) => {
      const e = derived.energy;
      // Generation is the headline, but the POOL is the thing that rises and
      // falls — so the pool's net change is what decides where this sits.
      const net = e.generated - e.delivered;
      return {
        text: formatPower(e.generated),
        sub: null,
        tone: e.generated > 0 ? 'good' : 'muted',
        store: formatEnergy(e.pool),
        rate: net,
        rateText: Math.abs(net) > 1e-9 ? `${formatPower(net)} to the pool` : null,
        note: e.generated <= 0 && e.demand > 0 ? 'nothing is generating' : null,
      };
    },
  },

  draw: {
    id: 'draw',
    name: 'Draw',
    desc: 'What the hive is asking for, and what it is getting.',
    read: (state, derived) => {
      const e = derived.energy;
      const short = e.delivered - e.demand; // negative while starved
      return {
        text: formatPower(e.delivered),
        sub: formatPower(e.demand),
        tone: e.ratio < 0.999 ? 'bad' : 'good',
        store: `${formatPower(e.delivered)} of ${formatPower(e.demand)}`,
        // A deficit is the only way a draw can be "losing"; a hive paying its
        // bills in full is a hive with nothing to say here.
        rate: short < -1e-9 ? short : 0,
        rateText: short < -1e-9 ? `${formatPower(short)} short` : null,
        note: e.ratio < 0.999 ? `${Math.floor(e.ratio * 100)}% of demand met` : null,
      };
    },
  },

  /**
   * HYDRATION EARNS A SLOT BECAUSE IT CAN KILL A HIVE UNWATCHED.
   *
   * Everything else on this bar is a thing the player chose to spend. Water is
   * a thing that leaves on its own, faster on dry ground, and the first sign of
   * a problem is that the whole colony is quietly running slower — which reads
   * as a balance mistake rather than as thirst unless the bar says otherwise.
   */
  hydration: {
    id: 'hydration',
    name: 'Hydration',
    desc: 'Water held against what the colony needs. Everything it does is scaled by this.',
    read: (state, derived) => {
      const h = derived.hydration;
      const net = derived.net?.water ?? 0;
      const pct = Math.round(h.ratio * 100);
      return {
        text: `${pct}%`,
        sub: null,
        tone: h.ratio >= 1 ? 'good' : h.ratio > 0.6 ? 'warn' : 'bad',
        store: `${formatMass(h.held)} of ${formatMass(h.target)}`,
        rate: net,
        rateText: Math.abs(net) > 1e-9 ? `${formatMassFlow(net)}` : null,
        note: h.ratio < 1
          ? `everything is running at ${Math.round(h.multiplier * 100)}%`
          : h.aridity > 1.05
            ? `arid ground — losing ${formatMassFlow(-h.draw)}`
            : null,
      };
    },
  },

  cognition: {
    id: 'cognition',
    name: 'Cognition',
    desc: 'Bandwidth: how much the hivemind can hold in flight at once.',
    read: (state, derived) => {
      const c = derived.cognition;
      return {
        text: formatCogits(c.used),
        sub: formatCogits(c.capacity),
        tone: c.over ? 'bad' : 'good',
        store: `${formatCogits(c.used)} of ${formatCogits(c.capacity)}`,
        // A width does not drift on its own. Being over budget is the one
        // thing that makes it worth looking at.
        rate: c.over ? -(c.used - c.capacity) : 0,
        rateText: c.over ? `${formatCogits(c.used - c.capacity)} over` : null,
        note: c.over ? 'over capacity' : null,
      };
    },
  },

  larvae: {
    id: 'larvae',
    name: 'Larvae',
    desc: 'The brood. Laid out of protein, and eating the whole time.',
    read: (state, derived) => {
      const l = derived.larvae;
      const net = (derived.broodRate || 0) - (l.deathRate || 0);
      return {
        text: String(Math.floor(state.larvae || 0)),
        sub: null,
        tone: l.dying ? 'bad' : l.starving ? 'warn' : state.larvae > 0 ? 'good' : 'muted',
        store: String(Math.floor(state.larvae || 0)),
        rate: net,
        rateText: Math.abs(net) > 1e-9 ? `${net > 0 ? '+' : ''}${(net * 60).toFixed(1)}/min` : null,
        note: l.dying ? 'starving to death' : l.starving ? 'going unfed' : null,
      };
    },
  },

  insight: {
    id: 'insight',
    name: 'Insight',
    desc: 'What the hive has worked out and not yet spent.',
    read: (state, derived) => {
      const rate = derived.insightRate || 0;
      return {
        text: formatNumber(state.insight),
        sub: formatNumber(derived.insightCap),
        tone: state.insight > 0 ? 'good' : 'muted',
        store: `${formatNumber(state.insight)} of ${formatNumber(derived.insightCap)}`,
        rate,
        rateText: rate > 1e-9 ? `+${rate.toFixed(2)}/s` : null,
        note: null,
      };
    },
  },
};

/** Declaration order. Pinned resources appear in this order and stay put. */
export const TOPBAR_ORDER = ['energy', 'draw', 'hydration', 'cognition', 'larvae', 'insight'];

/** What a new hive starts with nailed to the bar: everything there is. */
export const DEFAULT_PINNED = [...TOPBAR_ORDER];

/**
 * Losing beats gaining beats standing still.
 *
 * Only the SIGN of the rate matters, never the size: a store bleeding a
 * milligram a second is as much "losing" as one bleeding a kilo, and ranking
 * by magnitude would make the bar reshuffle every time a number wobbled.
 */
export function urgencyRank(rate) {
  if (rate < -1e-9) return 0; // losing
  if (rate > 1e-9) return 1; // gaining
  return 2; // stagnant
}

/**
 * Work out what the bar shows and what it leaves for the picker.
 *
 * Returns { shown, hidden }, both lists of { id, def, pinned, ...read }.
 */
export function topbarLayout(state, derived, slots = TOPBAR_SLOTS) {
  const pins = Array.isArray(state.ui?.pinned) ? state.ui.pinned : DEFAULT_PINNED;

  const entries = TOPBAR_ORDER.filter((id) => TOPBAR[id]).map((id) => {
    const def = TOPBAR[id];
    let read;
    try {
      read = def.read(state, derived);
    } catch {
      // A resource that cannot read itself must not take the whole bar down
      // with it. It shows as unknown and sorts last.
      read = { text: '—', sub: null, tone: 'muted', store: '—', rate: 0, rateText: null, note: null };
    }
    return { id, def, name: def.name, pinned: pins.includes(id), ...read };
  });

  // Pinned keep their declared order. Nothing the player nailed down moves.
  const shown = entries.filter((e) => e.pinned);

  const rest = entries
    .filter((e) => !e.pinned)
    .sort((a, b) => {
      const rank = urgencyRank(a.rate) - urgencyRank(b.rate);
      if (rank !== 0) return rank;
      // Same urgency: declaration order, so the tail is stable too.
      return TOPBAR_ORDER.indexOf(a.id) - TOPBAR_ORDER.indexOf(b.id);
    });

  const room = Math.max(0, slots - shown.length);
  return { shown: [...shown, ...rest.slice(0, room)], hidden: rest.slice(room) };
}
