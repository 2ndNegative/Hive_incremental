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

    <!-- THE ONE THING IN THE GAME THAT HAS TO INTERRUPT.
         Nothing in here was a live region, so a storage failure — the one
         failure that silently costs the player their whole run — was a red
         banner and nothing else: a screen reader user kept playing a hive
         that was not being written anywhere.
         `role="alert"` and not the running log, which is the other candidate
         and would be unbearable: the log gains a line every few seconds, and
         a live region reading all of them out would bury exactly this.
         The region is MOUNTED ALWAYS and emptied by the `v-if` inside it,
         rather than the whole banner being conditional — a live region has to
         exist before its contents change or there is nothing watching when
         they do. -->
    <div role="alert" aria-live="assertive">
      <div v-if="!saveStatus.ok" class="save-alert">
        <strong>Progress is not being saved.</strong>
        {{ saveStatus.error }}
        <button class="btn" @click="state.ui.tab = 'settings'">Open settings</button>
      </div>
    </div>

    <TopBar />

    <div class="hive-body">
      <aside class="sidebar">
        <NutrientPanel />
        <MessageLog />
      </aside>

      <main class="main-col">
        <TabBar />
        <!-- Named by whichever tab is selected, and a tab stop of its own, so
             the keyboard goes from the bar straight into the screen it just
             opened rather than back out to the page. See the roving tabindex
             in TabBar.vue for the other half. -->
        <div
          id="tab-panel"
          role="tabpanel"
          tabindex="0"
          :aria-labelledby="`tab-${state.ui.tab}`"
        >
          <component :is="currentTab" />
        </div>
      </main>
    </div>
  </div>
</template>
