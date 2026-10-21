// Shared reactive view of the simulation.
//
// `derived` is a Vue computed, so every component reads the same numbers and
// it only recalculates when state actually changes.

import { computed, reactive, ref } from 'vue';
import { state } from './state.js';
import { computeDerived } from './engine.js';

export const derived = computed(() => computeDerived(state));

/**
 * A NUMBER FIELD YOU CAN ACTUALLY TYPE IN.
 *
 * Every tab re-renders ten times a second, because the numbers on them move ten
 * times a second. Vue patches a bound `value` against what is in the DOM — and
 * while someone is typing, what is in the DOM is "12" and what is bound is
 * still the old figure, so Vue puts the old figure back. Every frame.
 *
 * The two ways that shows up, both reported as bugs, both this:
 *
 *   — with an `@input` handler, state is written on each keystroke and then
 *     overwritten by the next render: the spinner "takes" only on a click that
 *     lands between two frames, which reads as JITTER, up one and back.
 *   — without one, nothing is written until blur and every keystroke is wiped
 *     on the next frame: the field SITS AT ZERO however much you type.
 *
 * So a field being edited reads from a DRAFT, and the draft is what is bound.
 * State is written on the way through, so a spinner click applies immediately;
 * the draft is dropped on blur, at which point the field follows the hive again.
 *
 * `apply(key, raw)` is how a value reaches the game. Keys are the caller's
 * business — a drone type id, or "<biome>:<type>" — and only have to be unique
 * across the fields sharing one of these.
 */
export function useDrafts(apply) {
  const drafts = reactive({});
  return {
    /** What the field should show: the draft while editing, else the hive. */
    value: (key, live) => drafts[key] ?? (live ?? ''),
    /** A keystroke or a spinner click. Applies at once and remembers the text. */
    input: (key, event) => {
      drafts[key] = event.target.value;
      apply(key, event.target.value);
    },
    /** Blur: apply whatever is in the box and hand the field back to the hive. */
    commit: (key) => {
      if (key in drafts) apply(key, drafts[key]);
      delete drafts[key];
    },
    /**
     * Forget the draft without applying. For a control that writes state by
     * another route — a +/− button, a "fill" — where leaving the draft up would
     * show the player the figure they typed instead of the one they just set.
     */
    clear: (key) => { delete drafts[key]; },
  };
}

/**
 * Open an item's codex entry from anywhere in the interface.
 *
 * The filters are cleared on the way, because arriving at the Codex with the
 * entry hidden behind a stale search box looks exactly like a broken link.
 */
export function showInCodex(itemId) {
  if (!itemId) return;
  state.ui.codexCategory = 'all';
  state.ui.codexSearch = '';
  state.ui.selectedItem = itemId;
  state.ui.tab = 'codex';
}

export { state };

/**
 * A SLOW SHARED CLOCK, for anything that displays an age.
 *
 * "Saved 12s ago" is computed from `Date.now()` inside a `computed`, which has
 * no reactive dependency on the clock — so it was worked out once, at the
 * moment of the save, and then sat there saying "0s ago" for as long as you
 * left the tab open. The tab re-renders ten times a second for other reasons,
 * which is exactly why nobody noticed: the number was being re-rendered
 * constantly and recomputed never.
 *
 * One ticking ref, shared, at one second — the resolution these readouts are
 * quoted in. A `computed` that reads it is invalidated once a second, which is
 * as often as "12s ago" can change and no more often.
 */
const nowRef = ref(Date.now());
if (typeof window !== 'undefined') {
  setInterval(() => { nowRef.value = Date.now(); }, 1000);
}
export const now = nowRef;

/** Seconds since a timestamp, as a phrase. Null for "never". */
export function ageSince(stamp) {
  if (!stamp) return null;
  const secs = Math.max(0, Math.round((now.value - stamp) / 1000));
  return secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
}
