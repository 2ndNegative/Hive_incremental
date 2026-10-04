<script setup>
import { computed } from 'vue';
import { state, derived } from './game/useGame.js';
import { formatDuration, formatNumber } from './game/format.js';
import { NUTRIENTS } from './game/definitions/nutrients.js';
import { formatEnergy, formatPower, formatCogits, formatMassFlow, formatLarvae } from './game/units.js';
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
            <strong class="num" :class="derived.energy.generated > 0 ? 'good' : 'muted'">
              {{ formatPower(derived.energy.generated) }}
            </strong>
          </span>
          <span class="tip-body">
            <span class="tip-title">Energy being made</span>
            <span class="muted" style="display: block; margin-bottom: 0.3rem">
              What the generators are producing, second by second. Nothing else in the hive turns
              stored matter into spendable energy — a hive standing on a tonne of fat with no
              generator makes nothing at all.
            </span>
            <span class="tip-row">
              <span>Processing</span><span>{{ formatMassFlow(derived.energy.massRate) }}</span>
            </span>
            <span class="tip-row"><span>Banked</span><span>{{ formatEnergy(derived.energy.pool) }}</span></span>
            <hr style="border-color: var(--border); margin: 0.3rem 0" />
            <span class="tip-title" style="font-size: 0.72rem">Usable energy</span>
            <span class="muted" style="display: block; margin-bottom: 0.3rem">
              What is in the stores the generators are actually pointed at. Change what one of
              them burns and this changes with it: a store nothing is reaching for is not fuel.
            </span>
            <span class="tip-row">
              <span>In reach</span>
              <span :class="derived.energy.usable > 0 ? 'good' : 'bad'">
                {{ formatEnergy(derived.energy.usable) }}
              </span>
            </span>
            <span v-for="f in derived.energy.fuels" :key="f" class="tip-row muted">
              <span>· {{ NUTRIENTS[f].name }}</span>
              <span>{{ formatEnergy((state.nutrients[f] || 0) * NUTRIENTS[f].kjPerGram * 1000) }}</span>
            </span>
            <span v-if="!derived.energy.fuels.length" class="tip-row bad">
              <span>No generator is pointed at anything</span><span>—</span>
            </span>
            <hr style="border-color: var(--border); margin: 0.3rem 0" />
            <span class="tip-row muted">
              <span>Chemical energy in store, all of it</span>
              <span>{{ formatEnergy(derived.energy.stored) }}</span>
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

        <span class="tip">
          <span>
            Larvae
            <strong
              class="num"
              :class="derived.larvae.dying ? 'bad' : derived.larvae.starving ? 'warn' : state.larvae > 0 ? 'good' : 'muted'"
            >
              {{ Math.floor(state.larvae) }}
            </strong>
            <span v-if="derived.larvae.dying" class="bad" style="font-size: 0.72rem">
              &nbsp;· dying
            </span>
            <span v-else-if="derived.larvae.starving" class="warn" style="font-size: 0.72rem">
              &nbsp;· {{ Math.ceil(derived.larvae.secondsToNext) }}s
            </span>
          </span>
          <span class="tip-body">
            <span class="tip-title">{{ formatLarvae(state.larvae) }} in the brood</span>
            <span class="muted" style="display: block; margin-bottom: 0.3rem">
              A store, not a width. Brood Chambers lay them out of protein; nothing spends them
              yet, and they eat the whole time they are waiting.
            </span>
            <span class="tip-row">
              <span>Eating</span>
              <span :class="derived.larvae.starving ? 'bad' : 'muted'">
                {{ formatMassFlow(-derived.larvae.want) }} carbohydrate
              </span>
            </span>
            <template v-if="derived.larvae.starving">
              <span class="tip-row bad">
                <span>Going unfed</span>
                <span>{{ formatMassFlow(-(derived.larvae.want - derived.larvae.drain)) }} short</span>
              </span>
              <span class="tip-row bad">
                <span>{{ derived.larvae.dying ? 'Next one dies in' : 'Dying starts in' }}</span>
                <span>{{ Math.ceil(derived.larvae.secondsToNext) }}s</span>
              </span>
              <span v-if="derived.larvae.dying" class="tip-row bad">
                <span>Dying at</span><span>one every {{ 1 / derived.larvae.deathRate }}s</span>
              </span>
              <span v-else class="tip-row muted">
                <span>Grace</span><span>{{ derived.larvae.grace }}s unfed, then one every 2s</span>
              </span>
            </template>
            <span v-if="derived.larvae.lost > 0" class="tip-row muted">
              <span>Starved this run</span><span>{{ derived.larvae.lost }}</span>
            </span>
            <span class="tip-row">
              <span>Being laid</span>
              <span :class="derived.broodRate > 0 ? 'good' : 'muted'">
                {{ derived.broodRate > 0 ? `${(derived.broodRate * 60).toFixed(1)}/min` : 'none' }}
              </span>
            </span>
            <span v-for="b in derived.brood" :key="b.id" class="tip-row muted">
              <span>
                · {{ b.name }} ×{{ b.count }}
                <span v-if="b.charge < 0.999" class="warn">at {{ Math.round(b.charge * 100) }}%</span>
              </span>
              <span :class="b.affordable ? '' : 'bad'">
                {{ Math.round(b.progress * 100) }}%{{ b.affordable ? '' : ' · cannot pay' }}
              </span>
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
