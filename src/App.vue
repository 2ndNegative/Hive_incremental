<script setup>
import { computed } from 'vue';
import { state, derived } from './game/useGame.js';
import { formatDuration, formatNumber } from './game/format.js';
import { formatEnergy, formatPower, formatCogits, formatMassFlow } from './game/units.js';
import { save, saveStatus } from './game/save.js';
import NutrientPanel from './components/NutrientPanel.vue';
import MessageLog from './components/MessageLog.vue';
import TabBar from './components/TabBar.vue';
import HiveTab from './components/tabs/HiveTab.vue';
import DronesTab from './components/tabs/DronesTab.vue';
import StorageTab from './components/tabs/StorageTab.vue';
import TerritoryTab from './components/tabs/TerritoryTab.vue';
import MetabolismTab from './components/tabs/MetabolismTab.vue';
import ResearchTab from './components/tabs/ResearchTab.vue';
import CodexTab from './components/tabs/CodexTab.vue';
import StatsTab from './components/tabs/StatsTab.vue';
import SettingsTab from './components/tabs/SettingsTab.vue';
import DevTab from './components/tabs/DevTab.vue';
import OfflineModal from './components/OfflineModal.vue';
import OriginChooser from './components/OriginChooser.vue';

const TABS = {
  hive: HiveTab,
  drones: DronesTab,
  storage: StorageTab,
  territory: TerritoryTab,
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
    <OriginChooser />

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
            <strong class="num" :class="derived.energy.pool > 0 ? 'good' : 'muted'">
              {{ formatEnergy(derived.energy.pool) }}
            </strong>
          </span>
          <span class="tip-body">
            <span class="tip-title">Usable energy</span>
            <span class="muted" style="display: block; margin-bottom: 0.3rem">
              Energy the hive can actually spend. Nothing turns stored matter into this except a
              Metabolic Generator — a hive standing on a tonne of fat with no generator has no
              energy at all.
            </span>
            <span class="tip-row"><span>Banked</span><span>{{ formatEnergy(derived.energy.pool) }}</span></span>
            <span class="tip-row">
              <span>Being generated</span>
              <span :class="derived.energy.generated > 0 ? 'good' : 'muted'">
                {{ formatPower(derived.energy.generated) }}
              </span>
            </span>
            <span class="tip-row">
              <span>Processing</span><span>{{ formatMassFlow(derived.energy.massRate) }}</span>
            </span>
            <hr style="border-color: var(--border); margin: 0.3rem 0" />
            <span class="tip-row muted">
              <span>Chemical energy in store</span><span>{{ formatEnergy(derived.energy.stored) }}</span>
            </span>
            <span class="tip-row muted">
              <span>…of it in fuels it can open</span><span>{{ formatEnergy(derived.energy.locked) }}</span>
            </span>
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

        <span class="tip">
          <span>
            Cognition
            <strong class="num" :class="derived.cognition.over ? 'bad' : 'good'">
              {{ formatCogits(derived.cognition.used) }}
            </strong>
            <span class="muted">&nbsp;/ {{ formatCogits(derived.cognition.capacity) }}</span>
          </span>
          <span class="tip-body">
            <span class="tip-title">Cognitive bandwidth</span>
            <span class="muted" style="display: block; margin-bottom: 0.3rem">
              Measured in cogits. Not a store — a width. Everything that thinks occupies part of
              it for as long as it exists, and insight is what the hive does with whatever is
              left over.
            </span>
            <span class="tip-row">
              <span>Capacity</span><span>{{ formatCogits(derived.cognition.capacity) }}</span>
            </span>
            <span class="tip-row">
              <span>In flight</span><span>{{ formatCogits(derived.cognition.used) }}</span>
            </span>
            <span class="tip-row">
              <span>Free</span>
              <span :class="derived.cognition.over ? 'bad' : 'good'">
                {{ formatCogits(derived.cognition.free) }}
              </span>
            </span>

            <template v-if="derived.cognition.supply.length">
              <hr style="border-color: var(--border); margin: 0.3rem 0" />
              <span class="tip-title" style="font-size: 0.72rem">Thinking with</span>
              <span v-for="s in derived.cognition.supply" :key="s.key" class="tip-row">
                <span>{{ s.label }}</span><span class="good">+{{ formatCogits(s.amount) }}</span>
              </span>
            </template>

            <template v-if="derived.cognition.load.length">
              <hr style="border-color: var(--border); margin: 0.3rem 0" />
              <span class="tip-title" style="font-size: 0.72rem">Occupied by</span>
              <span v-for="l in derived.cognition.load" :key="l.key" class="tip-row">
                <span>{{ l.label }}</span><span class="bad">−{{ formatCogits(l.amount) }}</span>
              </span>
            </template>

            <span v-if="!derived.cognition.capacity" class="tip-row muted" style="margin-top: 0.25rem">
              <span>Nothing to think with yet</span><span>—</span>
            </span>
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
