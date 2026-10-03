<script setup>
import { computed } from 'vue';
import { state, derived } from '../game/useGame.js';
import { canAfford } from '../game/engine.js';
import { RESEARCH } from '../game/definitions/research.js';

const affordableResearch = computed(
  () => derived.value.unlocked.research.filter((id) => canAfford(state, RESEARCH[id].cost)).length,
);

const tabs = computed(() => [
  { id: 'hive', label: 'Hive' },
  { id: 'drones', label: 'Drones', badge: state.castes.dormant || 0 },
  // The alert is the one thing the player needs to notice without looking:
  // matter is spoiling because the gut cannot keep up with the harvest.
  { id: 'storage', label: 'Storage', alert: Object.values(derived.value.itemSpill).some((r) => r > 0) },
  { id: 'metabolism', label: 'Metabolism', alert: derived.value.energy.ratio < 0.999 },
  { id: 'research', label: 'Research', badge: affordableResearch.value },
  { id: 'codex', label: 'Codex' },
  { id: 'stats', label: 'Stats' },
  { id: 'settings', label: 'Settings' },
  ...(state.dev?.enabled ? [{ id: 'dev', label: 'Dev' }] : []),
]);
</script>

<template>
  <nav class="tab-bar">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      :class="{ 'is-active': state.ui.tab === tab.id }"
      @click="state.ui.tab = tab.id"
    >
      {{ tab.label }}
      <span v-if="tab.badge" class="badge">{{ tab.badge }}</span>
      <span v-else-if="tab.alert" class="badge is-alert">!</span>
    </button>
  </nav>
</template>
