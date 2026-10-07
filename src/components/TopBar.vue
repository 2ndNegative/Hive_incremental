<script setup>
import { computed, ref } from 'vue';
import { state, derived } from '../game/useGame.js';
import { topbarLayout } from '../game/definitions/topbar.js';
import { formatDuration } from '../game/format.js';
import { save, saveStatus } from '../game/save.js';
import TopBarPicker from './TopBarPicker.vue';
import EnergyChip from './topbar/EnergyChip.vue';
import DrawChip from './topbar/DrawChip.vue';
import HydrationChip from './topbar/HydrationChip.vue';
import CognitionChip from './topbar/CognitionChip.vue';
import LarvaeChip from './topbar/LarvaeChip.vue';
import InsightChip from './topbar/InsightChip.vue';

/**
 * Which component draws which resource.
 *
 * The registry in definitions/topbar.js decides WHETHER and in what order; this
 * decides what it looks like. A resource with an entry there and no chip here
 * simply does not draw, which is a loud enough failure to notice in the first
 * second and quiet enough not to take the bar down.
 */
const CHIPS = {
  energy: EnergyChip,
  draw: DrawChip,
  hydration: HydrationChip,
  cognition: CognitionChip,
  larvae: LarvaeChip,
  insight: InsightChip,
};

const layout = computed(() => topbarLayout(state, derived.value));
const shown = computed(() => layout.value.shown.filter((r) => CHIPS[r.id]));
const hiddenCount = computed(() => layout.value.hidden.length);

const picking = ref(false);

const savedAgo = computed(() => {
  // Never report a time when the last attempt failed — a stale "saved 3s ago"
  // next to a broken save is worse than saying nothing.
  if (!saveStatus.ok) return 'FAILING';
  if (!state.savedAt) return 'not yet';
  const secs = Math.max(0, Math.round((Date.now() - state.savedAt) / 1000));
  return secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
});
</script>

<template>
  <header class="topbar">
    <span class="brand">HiveIdle <small>v0.2</small></span>

    <!-- Clicking anywhere across the resources opens the picker. The chips
         themselves only react to hover, so there is nothing to collide with. -->
    <span
      class="meta topbar-resources"
      :class="{ 'is-picking': picking }"
      role="button"
      tabindex="0"
      :aria-label="`Choose which resources the bar shows (${shown.length} of ${shown.length + hiddenCount})`"
      @click="picking = true"
      @keydown.enter.prevent="picking = true"
      @keydown.space.prevent="picking = true"
    >
      <component :is="CHIPS[r.id]" v-for="r in shown" :key="r.id" />
      <span v-if="hiddenCount" class="topbar-more muted">+{{ hiddenCount }}</span>
    </span>

    <span class="spacer" />

    <span class="meta">
      <span v-if="state.starvation > 1" class="bad">starving</span>
      <span>{{ formatDuration(state.playtime) }}</span>
      <span :class="{ bad: !saveStatus.ok }">Saved {{ savedAgo }}</span>
      <button class="btn" @click="save({ quiet: false })">Save</button>
    </span>

    <TopBarPicker v-if="picking" @close="picking = false" />
  </header>
</template>
