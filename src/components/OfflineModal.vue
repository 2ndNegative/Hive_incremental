<script setup>
import { computed, ref } from 'vue';
import { offline, skipOffline } from '../game/offline.js';
import { useDialog, dialogId } from './useDialog.js';
import { state, derived } from '../game/useGame.js';
import { formatDuration } from '../game/format.js';
import { formatMass, formatEnergy } from '../game/units.js';

const percent = computed(() =>
  offline.total > 0 ? Math.min(100, (offline.done / offline.total) * 100) : 0,
);

const remaining = computed(() => Math.max(0, offline.total - offline.done));

// Escape does what the Skip button does — this dialog's "close" is "stop
// simulating", and there is nothing else it could honestly mean.
const card = ref(null);
const titleId = dialogId();
useDialog(card, () => offline.active, () => skipOffline());
</script>

<template>
  <div v-if="offline.active" class="modal-backdrop">
    <div ref="card" class="modal-card" role="dialog" aria-modal="true"
         :aria-labelledby="titleId" tabindex="-1">
      <div :id="titleId" class="modal-head">Simulating time away</div>
      <div class="modal-body">
        <p class="muted" style="font-size: 0.82rem; margin-bottom: 0.8rem">
          The hive kept running while you were gone. It has been dormant for
          <strong>{{ formatDuration(offline.total) }}</strong> and is catching up at
          {{ formatDuration(offline.stepSeconds) }} per step.
        </p>

        <div class="progress-track">
          <span :style="{ width: `${percent}%` }" />
        </div>

        <div class="progress-figures num">
          <span>{{ formatDuration(offline.done) }}</span>
          <span class="muted">{{ percent.toFixed(1) }}%</span>
          <span class="muted">{{ formatDuration(remaining) }} left</span>
        </div>

        <div class="stat-grid" style="margin-top: 0.9rem">
          <div class="stat-tile">
            <div class="label">Drones</div>
            <div class="value">{{ state.drones }}</div>
          </div>
          <div class="stat-tile">
            <div class="label">Energy</div>
            <div class="value">{{ formatEnergy(derived.energy.usable) }}</div>
          </div>
          <div class="stat-tile">
            <div class="label">Protein</div>
            <div class="value">{{ formatMass(state.nutrients.protein) }}</div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <span class="muted" style="font-size: 0.76rem">
          Skipping forfeits whatever is left unsimulated.
        </span>
        <button class="btn is-danger" @click="skipOffline()">Skip the rest</button>
      </div>
    </div>
  </div>
</template>
