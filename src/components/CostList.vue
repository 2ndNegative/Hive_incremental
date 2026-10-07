<script setup>
import { computed } from 'vue';
import { state } from '../game/useGame.js';
import { NUTRIENTS, isRevealed, costWasSubstituted } from '../game/definitions/nutrients.js';
import { formatMass } from '../game/units.js';
import { formatNumber } from '../game/format.js';

const props = defineProps({ cost: { type: Object, required: true } });

/**
 * Whether anything in this price is actually standing in for something else.
 *
 * A building names the element it is made of whether the hive can see that
 * element or not, so an early hive is charged fifty times the amount in the
 * parent macro — see payableCost. Without saying so, a Metabolic Generator
 * reads as wanting half a kilo of mineral mass for no reason anybody can see,
 * and the assay that fixes it looks like an unrelated piece of research.
 */
const substituted = computed(() => costWasSubstituted(props.cost));

const entries = computed(() =>
  Object.entries(props.cost).map(([n, amount]) => {
    if (n === 'insight') {
      return {
        n,
        text: `Insight ${formatNumber(amount)}`,
        short: state.insight < amount,
        unknown: false,
      };
    }
    const known = isRevealed(state, n);
    return {
      n,
      text: `${NUTRIENTS[n]?.name ?? n} ${formatMass(amount)}`,
      short: (state.nutrients[n] ?? 0) < amount,
      // A cost in an unassayed compound cannot be paid at all — the hive may be
      // holding plenty, but it cannot tell which of its mass is which.
      unknown: !known,
    };
  }),
);
</script>

<template>
  <div class="cost-list">
    <span
      v-for="entry in entries"
      :key="entry.n"
      :class="entry.unknown ? 'cost-unknown' : entry.short ? 'cost-short' : 'cost-ok'"
    >
      {{ entry.unknown ? 'unresolved compound' : entry.text }}
    </span>
    <span v-if="substituted" class="cost-substituted">
      unassayed — paid in bulk until the element can be told apart
    </span>
  </div>
</template>
