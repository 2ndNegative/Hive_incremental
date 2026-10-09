<script setup>
import { derived } from '../../game/useGame.js';
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
            <span class="tip-row"><span>Generated</span><span>{{ formatPower(derived.energy.generated) }}</span></span>
            <!-- The row that was missing. Delivered can exceed Generated because
                 the hive spends out of its reserve as well, and without this the
                 two numbers looked like broken arithmetic. -->
            <span class="tip-row" v-if="derived.energy.fromPool > 1">
              <span class="warn">From the reserve</span>
              <span class="warn">{{ formatPower(derived.energy.fromPool) }}</span>
            </span>
            <span class="tip-row" v-else-if="derived.energy.fromPool < -1">
              <span>Into the reserve</span><span>{{ formatPower(-derived.energy.fromPool) }}</span>
            </span>
          </span>
  </span>
</template>
