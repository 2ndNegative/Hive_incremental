<script setup>
import { computed } from 'vue';
import { state } from './game/useGame.js';
import { saveStatus } from './game/save.js';
import TopBar from './components/TopBar.vue';
import NutrientPanel from './components/NutrientPanel.vue';
import MessageLog from './components/MessageLog.vue';
import TabBar from './components/TabBar.vue';
import HiveTab from './components/tabs/HiveTab.vue';
import DronesTab from './components/tabs/DronesTab.vue';
import GeneticsTab from './components/tabs/GeneticsTab.vue';
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
  genetics: GeneticsTab,
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

    <TopBar />

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
