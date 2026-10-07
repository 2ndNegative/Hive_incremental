<script setup>
import { computed } from 'vue';
import { derived } from '../../game/useGame.js';
import { formatMass, formatMassFlow } from '../../game/units.js';

const h = computed(() => derived.value.hydration);
const net = computed(() => derived.value.net?.water ?? 0);
const pct = computed(() => Math.round(h.value.ratio * 100));

/**
 * Three states, because thirst has three meanings. Full is nothing to think
 * about; short is a thing to notice; badly short is the reason everything on
 * every other screen is running slowly, and that connection has to be one hover
 * away or the player goes looking for a balance bug that is not there.
 */
const tone = computed(() => (h.value.ratio >= 1 ? 'good' : h.value.ratio > 0.6 ? 'warn' : 'bad'));

/** How long the reserve lasts at the current net, when it is falling. */
const dry = computed(() => {
  if (net.value >= -1e-9) return null;
  const secs = h.value.held / -net.value;
  if (secs > 3600) return `${Math.round(secs / 3600)}h`;
  if (secs > 60) return `${Math.round(secs / 60)}m`;
  return `${Math.round(secs)}s`;
});
</script>

<template>
  <span class="tip">
    <span>
      Hydration
      <strong class="num" :class="tone">{{ pct }}%</strong>
    </span>
    <span class="tip-body">
      <span class="tip-title">Hydration</span>
      <span class="muted" style="display: block; margin-bottom: 0.3rem">
        The hive is mostly water and loses it constantly. This is what it holds against what a
        colony this size wants — and everything it DOES is scaled by it, so a dry hive is slow
        at everything at once rather than stopped at any one thing.
      </span>
      <span class="tip-row">
        <span>Held</span>
        <span>{{ formatMass(h.held) }} of {{ formatMass(h.target) }}</span>
      </span>
      <span class="tip-row">
        <span>Losing</span>
        <span>{{ formatMassFlow(-h.draw) }}</span>
      </span>
      <span class="tip-row" v-if="h.aridity > 1.05 || h.aridity < 0.95">
        <span>{{ h.aridity > 1 ? 'Dry ground' : 'Wet ground' }}</span>
        <span :class="h.aridity > 1 ? 'warn' : 'good'">×{{ h.aridity.toFixed(1) }}</span>
      </span>
      <span class="tip-row">
        <span>Net</span>
        <span :class="net > 0 ? 'good' : net < 0 ? 'bad' : 'muted'">
          {{ Math.abs(net) > 1e-9 ? formatMassFlow(net) : 'steady' }}
        </span>
      </span>
      <span class="tip-row" v-if="dry">
        <span class="bad">Dry in</span><span class="bad">{{ dry }}</span>
      </span>
      <hr style="border-color: var(--border); margin: 0.3rem 0" />
      <span class="tip-row">
        <span>Everything is running at</span>
        <span :class="tone">{{ Math.round(h.multiplier * 100) }}%</span>
      </span>
      <span v-if="h.ratio >= 1" class="muted" style="display: block; margin-top: 0.25rem">
        Above the mark there is no penalty at all — holding more than this costs nothing and
        buys nothing. It is a buffer, not a stat.
      </span>
    </span>
  </span>
</template>
