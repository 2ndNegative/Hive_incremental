<script setup>
import { computed } from 'vue';
import { state } from '../game/useGame.js';
import { NUTRIENTS, isRevealed, substitutedEntries } from '../game/definitions/nutrients.js';
import { formatMass } from '../game/units.js';
import { formatNumber } from '../game/format.js';

const props = defineProps({ cost: { type: Object, required: true } });

/**
 * Which lines of this price are standing in for something else.
 *
 * A building names the element it is made of whether the hive can see that
 * element or not, so an early hive is charged fifty times the amount in the
 * parent macro — see payableCost. That figure is drawn in warning yellow and
 * nothing is written underneath it: the colour is the convention, it means the
 * same thing on every screen, and a sentence of explanation under every card
 * is noise once the player has learned it.
 */
const substituted = computed(() => substitutedEntries(props.cost));

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
      // Bulk being spent in place of an element the hive cannot see yet.
      standingIn: substituted.value.has(n),
    };
  }),
);
</script>

<template>
  <div class="cost-list">
    <span
      v-for="entry in entries"
      :key="entry.n"
      :class="entry.unknown ? 'cost-unknown'
        : entry.standingIn ? 'cost-unassayed'
        : entry.short ? 'cost-short' : 'cost-ok'"
      :title="entry.standingIn
        ? 'Bulk, standing in for an element the hive cannot pick out yet. Assaying it cuts the price fifty-fold.'
        : null"
    >
      {{ entry.unknown ? 'unresolved compound' : entry.text }}
    </span>
  </div>
</template>
