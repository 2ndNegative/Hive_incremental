// Shared reactive view of the simulation.
//
// `derived` is a Vue computed, so every component reads the same numbers and
// it only recalculates when state actually changes.

import { computed } from 'vue';
import { state } from './state.js';
import { computeDerived } from './engine.js';

export const derived = computed(() => computeDerived(state));

export { state };
