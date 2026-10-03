<script setup>
/**
 * Territory — what the hive holds, and what holding it means.
 *
 * Area does one job: it sets the odds. Every forage roll picks a biome weighted
 * by its share of the hive's land and then picks something from that biome, so
 * this tab is really a view of a probability distribution that happens to be
 * measured in square metres.
 *
 * The second panel is the part worth reading: for each gather type, what each
 * biome actually offers, so the consequences of a holding are visible before
 * the hive spends an hour discovering them.
 */
import { computed } from 'vue';
import { state, derived, showInCodex } from '../../game/useGame.js';
import { BIOMES, CLIMATES, holdings, totalArea, biomeShares } from '../../game/definitions/biomes.js';
import { GATHER_TYPES, poolFor } from '../../game/definitions/forage.js';
import { ORGANISMS, preyFor } from '../../game/definitions/organisms.js';
import { ITEMS } from '../../game/definitions/items/index.js';
import { CASTES, CASTE_ORDER } from '../../game/definitions/castes.js';
import { describeFind } from '../../game/forage.js';
import { formatMass, formatMassFlow } from '../../game/units.js';
import { isPinned, pinHandlers } from '../../game/tips.js';

const area = computed(() => totalArea(state));
const land = computed(() => holdings(state)); // already sorted largest first
const shares = computed(() => biomeShares(state));

const GATHERS = ['forager', 'scavenger', 'hunter', 'excavator', 'siphon'];
const gather = computed({
  get: () => state.ui.territoryGather || 'forager',
  set: (v) => { state.ui.territoryGather = v; },
});

/** What each held biome offers for the selected gather type, likeliest first. */
const offerings = computed(() =>
  land.value.map((h) => {
    const raw =
      gather.value === 'hunter'
        ? preyFor(h.id).map((p) => ({ id: p.organismId, name: ORGANISMS[p.organismId].name, weight: p.weight, prey: true }))
        : poolFor(gather.value, h.id).map((p) => ({ id: p.itemId, name: ITEMS[p.itemId].name, weight: p.weight }));
    const total = raw.reduce((a, e) => a + e.weight, 0);
    return {
      ...h,
      share: shares.value[h.id] || 0,
      entries: raw
        .map((e) => ({ ...e, chance: total > 0 ? e.weight / total : 0 }))
        .sort((a, b) => b.chance - a.chance),
    };
  }),
);

/** What every gathering caste is on right now. */
const working = computed(() =>
  CASTE_ORDER.filter((id) => CASTES[id].gather && (state.castes[id] || 0) > 0).map((id) => {
    const found = describeFind(state, id);
    const flow = derived.value.forage?.[id];
    return {
      id,
      def: CASTES[id],
      assigned: state.castes[id],
      found,
      rate: flow?.rate || 0,
      empty: found.empty,
    };
  }),
);
</script>

<template>
  <div class="main-col">
    <!-- ------------------------------------------------------- the holdings -->
    <div class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Holdings</span>
        <span class="muted num">{{ area.toFixed(0) }} m²</span>
      </div>

      <div class="panel-body">
        <p class="muted" style="font-size: 0.78rem; margin: 0 0 0.5rem">
          Every time a drone goes out it picks a patch of this land at random — weighted by nothing
          but area — and brings back whatever that patch had. Half city and half forest is a coin
          flip, every time.
        </p>
      </div>

      <div v-if="!land.length" class="panel-body">
        <span class="warn" style="font-size: 0.78rem">
          The hive holds no ground. Nothing can be found anywhere.
        </span>
      </div>

      <div v-else class="panel-body tight">
        <div v-for="h in land" :key="h.id" class="terr-row">
          <span class="terr-name">
            {{ h.def.name }}
            <span class="muted terr-climate">{{ CLIMATES[h.def.climate] }}</span>
          </span>
          <span class="terr-area num">{{ h.area.toFixed(0) }} m²</span>
          <span class="terr-share num">{{ ((shares[h.id] || 0) * 100).toFixed(0) }}%</span>
          <span class="terr-bar"><span :style="{ width: `${(shares[h.id] || 0) * 100}%` }" /></span>
          <span class="terr-desc muted">{{ h.def.desc }}</span>
        </div>
      </div>
    </div>

    <!-- ------------------------------------------------------- who is on what -->
    <div v-if="working.length" class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Out now</span>
        <span class="muted num">{{ working.length }}</span>
      </div>
      <div class="panel-body tight">
        <div v-for="w in working" :key="w.id" class="field-row">
          <span class="field-label">
            {{ w.def.name }} <span class="muted">×{{ w.assigned }}</span>
            <span class="field-help">
              <template v-if="w.empty">{{ w.found.label }} — nothing of this kind there.</template>
              <template v-else>
                On
                <button
                  v-if="w.found.itemId"
                  class="codex-link"
                  @click="showInCodex(w.found.itemId)"
                >{{ w.found.label.toLowerCase() }}</button>
                <strong v-else>{{ w.found.label.toLowerCase() }}</strong>
                in {{ w.found.biome.name.toLowerCase() }}. Rolls again shortly.
              </template>
            </span>
          </span>
          <span class="num" :class="w.empty ? 'bad' : 'good'">{{ formatMassFlow(w.rate) }}</span>
        </div>
      </div>
    </div>

    <!-- ----------------------------------------------------- what is out there -->
    <div class="panel-box">
      <div class="panel-head">
        <span>What the ground offers</span>
      </div>

      <div class="panel-body">
        <div class="filter-row">
          <select v-model="gather">
            <option v-for="g in GATHERS" :key="g" :value="g">{{ GATHER_TYPES[g].name }}</option>
          </select>
          <span class="muted" style="font-size: 0.76rem">{{ GATHER_TYPES[gather].desc }}</span>
        </div>
      </div>

      <div v-for="o in offerings" :key="o.id" class="panel-body tight">
        <div class="offer-head">
          <span>{{ o.def.name }}</span>
          <span class="muted num">{{ (o.share * 100).toFixed(0) }}% of the hive's land</span>
        </div>

        <div v-if="!o.entries.length" class="offer-empty warn">
          Nothing here for this caste. A drone sent out rolls this ground and comes back with
          nothing at all.
        </div>

        <div v-else class="offer-list">
          <span
            v-for="e in o.entries"
            :key="e.id"
            class="offer-chip tip"
            :class="{ 'is-pinned': isPinned(`offer:${o.id}:${e.id}`) }"
            v-on="pinHandlers(`offer:${o.id}:${e.id}`)"
          >
            <button v-if="!e.prey" class="codex-link" @click="showInCodex(e.id)">{{ e.name }}</button>
            <span v-else>{{ e.name }}</span>
            <span class="muted offer-pct">{{ (e.chance * 100).toFixed(0) }}%</span>

            <span class="tip-body">
              <span class="tip-title">{{ e.name }}</span>
              <span class="tip-row">
                <span>Chance per roll here</span>
                <span>{{ (e.chance * 100).toFixed(1) }}%</span>
              </span>
              <span class="tip-row">
                <span>Across the whole hive</span>
                <span>{{ (e.chance * o.share * 100).toFixed(1) }}%</span>
              </span>
              <template v-if="e.prey">
                <hr style="border-color: var(--border); margin: 0.3rem 0" />
                <span class="muted">{{ ORGANISMS[e.id].liveMass >= 1000
                  ? `${(ORGANISMS[e.id].liveMass / 1000).toFixed(0)} kg live`
                  : `${ORGANISMS[e.id].liveMass} g live` }}, butchers into
                  {{ Object.keys(ORGANISMS[e.id].parts).length }} separate cuts.</span>
              </template>
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
