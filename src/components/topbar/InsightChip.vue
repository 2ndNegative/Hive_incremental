<script setup>
import { state, derived } from '../../game/useGame.js';
import { formatNumber } from '../../game/format.js';
</script>

<template>
  <span class="tip">
    <span>
      Insight
      <strong class="num" :class="state.insight > 0 ? 'good' : 'muted'">
        {{ formatNumber(state.insight) }}
      </strong>
      <span class="muted">&nbsp;/ {{ formatNumber(derived.insightCap) }}</span>
    </span>
    <span class="tip-body">
      <span class="tip-title">Insight</span>
      <span class="muted" style="display: block; margin-bottom: 0.3rem">
        What the hive has worked out and not yet spent. Bandwidth is what lets it happen;
        research is what it goes on.
      </span>
      <span class="tip-row">
        <span>Held</span><span>{{ formatNumber(state.insight) }}</span>
      </span>
      <span class="tip-row">
        <span>Ceiling</span><span>{{ formatNumber(derived.insightCap) }}</span>
      </span>
      <span class="tip-row">
        <span>Coming in</span>
        <span :class="derived.insightRate > 0 ? 'good' : 'muted'">
          {{ derived.insightRate > 0 ? `+${derived.insightRate.toFixed(2)}/s` : 'nothing' }}
        </span>
      </span>
    </span>
  </span>
</template>
