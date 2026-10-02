<script setup>
import { computed } from 'vue';
import { offline, skipOffline } from '../game/offline.js';
import { state } from '../game/useGame.js';
import { formatDuration } from '../game/format.js';
import { formatMass, formatEnergy } from '../game/units.js';
import { derived } from '../game/useGame.js';

const percent = computed(() =>
  offline.total > 0 ? Math.min(100, (offline.done / offline.total) * 100) : 0,
);

const remaining = computed(() => Math.max(0, offline.total - offline.done));
</script>

<template>
  <div v-if="offline.active" class="modal-backdrop">
    <div class="modal-card">
      <div class="modal-head">Simulating time away</div>
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
