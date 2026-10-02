<script setup>
import { computed } from 'vue';
import { state } from '../game/useGame.js';
import { NUTRIENTS, isRevealed } from '../game/definitions/nutrients.js';
import { formatMass } from '../game/units.js';
import { formatNumber } from '../game/format.js';

const props = defineProps({ cost: { type: Object, required: true } });

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
  </div>
</template>
