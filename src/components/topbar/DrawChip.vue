<script setup>
import { derived } from '../../game/useGame.js';
import { computed } from 'vue';
import { formatPower, formatEnergy } from '../../game/units.js';

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
            <!-- A SURPLUS IS NOT BANKED. The reserve is what the hive arrived
                 with and nothing refills it, so power made and not spent goes
                 nowhere. Shown rather than silently dropped: a hive throwing
                 away two thirds of its output should be able to see that it
                 is, since the fix is to spend it rather than to make less. -->
            <span class="tip-row" v-else-if="derived.energy.wasted > 1">
              <span class="muted">Made, not used</span>
              <span class="muted">{{ formatPower(derived.energy.wasted) }}</span>
            </span>
            <span class="tip-row" v-if="derived.energy.pool > 1">
              <span>Reserve left</span>
              <span :class="derived.energy.fromPool > 1 ? 'warn' : ''">
                {{ formatEnergy(derived.energy.pool) }}
              </span>
            </span>
          </span>
  </span>
</template>
