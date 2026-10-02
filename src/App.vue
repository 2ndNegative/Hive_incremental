<script setup>
import { computed } from 'vue';
import { state, derived } from './game/useGame.js';
import { formatDuration, formatNumber } from './game/format.js';
import { formatEnergy, formatPower } from './game/units.js';
import { save, saveStatus } from './game/save.js';
import NutrientPanel from './components/NutrientPanel.vue';
import MessageLog from './components/MessageLog.vue';
import TabBar from './components/TabBar.vue';
import HiveTab from './components/tabs/HiveTab.vue';
import DronesTab from './components/tabs/DronesTab.vue';
import MetabolismTab from './components/tabs/MetabolismTab.vue';
import ResearchTab from './components/tabs/ResearchTab.vue';
import CodexTab from './components/tabs/CodexTab.vue';
import StatsTab from './components/tabs/StatsTab.vue';
import SettingsTab from './components/tabs/SettingsTab.vue';
import DevTab from './components/tabs/DevTab.vue';
import OfflineModal from './components/OfflineModal.vue';

const TABS = {
  hive: HiveTab,
  drones: DronesTab,
  metabolism: MetabolismTab,
  research: ResearchTab,
  codex: CodexTab,
  stats: StatsTab,
  settings: SettingsTab,
  dev: DevTab,
};

const currentTab = computed(() => {
  if (state.ui.tab === 'dev' && !state.dev?.enabled) return HiveTab;
  return TABS[state.ui.tab] ?? HiveTab;
});
const starving = computed(() => derived.value.energy.ratio < 0.999);

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
  <div class="hive-shell">
    <OfflineModal />

    <div v-if="!saveStatus.ok" class="save-alert">
      <strong>Progress is not being saved.</strong>
      {{ saveStatus.error }}
      <button class="btn" @click="state.ui.tab = 'settings'">Open settings</button>
    </div>

    <header class="topbar">
      <span class="brand">HiveIdle <small>v0.2</small></span>

      <span class="meta">
        <span class="tip">
          <span>
            Energy
            <strong class="num">{{ formatEnergy(derived.energy.usable) }}</strong>
          </span>
          <span class="tip-body">
            <span class="tip-title">Stored energy</span>
            <span class="muted" style="display: block; margin-bottom: 0.3rem">
              The sum of the energy held in every nutrient the hive is carrying. There is no
              separate energy resource — this is the mass, valued as fuel.
            </span>
            <span class="tip-row"><span>Total in store</span><span>{{ formatEnergy(derived.energy.stored) }}</span></span>
            <span class="tip-row"><span>Burnable now</span><span>{{ formatEnergy(derived.energy.usable) }}</span></span>
          </span>
        </span>

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

        <span>Insight <strong class="num">{{ formatNumber(state.insight) }}</strong><span class="muted">/{{ formatNumber(derived.insightCap) }}</span></span>
      </span>

      <span class="spacer" />

      <span class="meta">
        <span v-if="state.starvation > 1" class="bad">starving</span>
        <span>{{ formatDuration(state.playtime) }}</span>
        <span :class="{ bad: !saveStatus.ok }">Saved {{ savedAgo }}</span>
        <button class="btn" @click="save({ quiet: false })">Save</button>
      </span>
    </header>

    <div class="hive-body">
      <aside class="sidebar">
        <NutrientPanel />
        <MessageLog />
      </aside>

      <main class="main-col">
        <TabBar />
        <component :is="currentTab" />
      </main>
    </div>
  </div>
</template>
