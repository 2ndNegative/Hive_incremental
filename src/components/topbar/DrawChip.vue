<script setup>
import { state, derived } from '../../game/useGame.js';
import { computed } from 'vue';
import { formatPower } from '../../game/units.js';

const starving = computed(() => derived.value.energy.ratio < 0.999);
</script>

<template>
  <span class="tip">
    <span>
      Draw
      <strong class="num" :class="starving ? 'bad' : 'good'">
        {{ formatPower(derived.energy.delivered) }}
      </strong>
      <span class="muted">&nbsp;/ {{ formatPower(derived.energy.demand) }}</span>
    </span>
          <span class="tip-body">
            <span class="tip-title">Metabolic draw</span>
            <span class="tip-row"><span>Demand</span><span>{{ formatPower(derived.energy.demand) }}</span></span>
            <span class="tip-row"><span>Delivered</span><span>{{ formatPower(derived.energy.delivered) }}</span></span>
            <span class="tip-row"><span>Ceiling</span><span>{{ formatPower(derived.energy.throughput) }}</span></span>
          </span>
  </span>
</template>
