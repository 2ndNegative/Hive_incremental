// Shared reactive view of the simulation.
//
// `derived` is a Vue computed, so every component reads the same numbers and
// it only recalculates when state actually changes.

import { computed } from 'vue';
import { state } from './state.js';
import { computeDerived } from './engine.js';

export const derived = computed(() => computeDerived(state));

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
