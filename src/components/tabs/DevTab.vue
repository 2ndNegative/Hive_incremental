<script setup>
import { ref, computed } from 'vue';
import { state, derived } from '../../game/useGame.js';
import { NUTRIENTS, NUTRIENT_IDS, MACROS, MICROS, isRevealed } from '../../game/definitions/nutrients.js';
import { RESEARCH, RESEARCH_ORDER } from '../../game/definitions/research.js';
import { ITEMS, ITEM_IDS, ITEMS_BY_CATEGORY } from '../../game/definitions/items/index.js';
import { formatMass } from '../../game/units.js';
import * as dev from '../../game/dev.js';

const nutrientId = ref('protein');
const nutrientAmount = ref(10000);
const itemId = ref('beef_liver');
const itemGrams = ref(10000);
const insightAmount = ref(5000);
const droneCount = ref(10);
const skipHours = ref(1);

const nutrientOptions = computed(() =>
  NUTRIENT_IDS.map((id) => ({
    id,
    label: `${NUTRIENTS[id].name}${isRevealed(state, id) ? '' : ' (unresolved)'}`,
  })),
);

const held = computed(() => state.nutrients[nutrientId.value] ?? 0);
const cap = computed(() => derived.value.caps[nutrientId.value] ?? 0);

const SKIP_PRESETS = [
  { label: '1 hour', hours: 1 },
  { label: '8 hours', hours: 8 },
  { label: '1 day', hours: 24 },
  { label: '1 week', hours: 168 },
  { label: '1 year', hours: 8760 },
];
</script>

<template>
  <div>
    <div class="notice is-warn">
      <strong>Developer mode.</strong>
      Everything here is a cheat. Any save you touch with these is flagged
      <code>devUsed</code> so a doctored run is never mistaken for a real one.
      <template v-if="state.stats.devUsed"> This save is already flagged.</template>
    </div>

    <div class="panel-box" style="margin-bottom: 0.9rem">
      <div class="panel-head"><span>Stores</span></div>
      <div class="panel-body">
        <div class="field-row">
          <span class="field-label">
            Fill everything
            <span class="field-help">
              Sets every nutrient to its current capacity. "Resolved only" leaves the
              compounds you have not assayed alone, which is the honest way to test.
            </span>
          </span>
          <button class="btn is-primary" @click="dev.fillAllStores()">Fill all</button>
          <button class="btn" @click="dev.fillRevealedStores()">Resolved only</button>
          <button class="btn is-danger" @click="dev.emptyAllStores()">Empty all</button>
        </div>

        <div class="field-row">
          <span class="field-label">
            Single nutrient
            <span class="field-help">
              Holding {{ formatMass(held) }} of {{ formatMass(cap) }} capacity.
            </span>
          </span>
          <select class="fuel-select" style="max-width: 14rem" v-model="nutrientId">
            <option v-for="o in nutrientOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select>
          <input class="dev-number num" type="number" v-model.number="nutrientAmount" min="0" />
          <button class="btn" @click="dev.addNutrient(nutrientId, nutrientAmount)">Add grams</button>
          <button class="btn" @click="dev.fillNutrient(nutrientId, 1)">To cap</button>
        </div>

        <div class="field-row">
          <span class="field-label">
            Ingest an item
            <span class="field-help">
              Goes through the normal intake path, so the item's real composition applies —
              including the compounds you cannot see yet.
            </span>
          </span>
          <select class="fuel-select" style="max-width: 16rem" v-model="itemId">
            <optgroup v-for="group in ITEMS_BY_CATEGORY" :key="group.category" :label="group.name">
              <option v-for="id in group.items" :key="id" :value="id">{{ ITEMS[id].name }}</option>
            </optgroup>
          </select>
          <input class="dev-number num" type="number" v-model.number="itemGrams" min="0" />
          <button class="btn" @click="dev.grantItem(itemId, itemGrams)">Ingest grams</button>
        </div>
      </div>
    </div>

    <div class="panel-box" style="margin-bottom: 0.9rem">
      <div class="panel-head"><span>Hive</span></div>
      <div class="panel-body">
        <div class="field-row">
          <span class="field-label">
            Insight
            <span class="field-help">
              {{ Math.floor(state.insight) }} of {{ derived.insightCap }} capacity. Research
              cannot exceed the cap, so grow Assay Chambers if you need more.
            </span>
          </span>
          <input class="dev-number num" type="number" v-model.number="insightAmount" min="0" />
          <button class="btn" @click="dev.addInsight(insightAmount)">Add</button>
          <button class="btn" @click="dev.fillInsight()">To cap</button>
        </div>

        <div class="field-row">
          <span class="field-label">
            Drones
            <span class="field-help">
              {{ state.drones }} of {{ derived.droneCap }} housed. Extras beyond capacity are
              refused rather than silently dropped.
            </span>
          </span>
          <input class="dev-number num" type="number" v-model.number="droneCount" min="0" />
          <button class="btn" @click="dev.addDrones(droneCount)">Add drones</button>
        </div>

        <div class="field-row">
          <span class="field-label">
            Time
            <span class="field-help">
              Runs the real tick, in coarse steps. Long skips drift the same way offline
              catch-up does.
            </span>
          </span>
          <button
            v-for="preset in SKIP_PRESETS"
            :key="preset.label"
            class="btn"
            @click="dev.skipTime(preset.hours * 3600)"
          >
            {{ preset.label }}
          </button>
        </div>
      </div>
    </div>

    <div class="panel-box" style="margin-bottom: 0.9rem">
      <div class="panel-head"><span>Research</span></div>
      <div class="panel-body">
        <div class="field-row">
          <span class="field-label">
            Bulk
            <span class="field-help">
              "All assays" resolves every micronutrient without granting the rest of the
              ladder — the quickest way to inspect the full panel.
            </span>
          </span>
          <button class="btn is-primary" @click="dev.grantAllAssays()">All assays</button>
          <button class="btn" @click="dev.grantAllResearch()">All research</button>
          <button class="btn is-danger" @click="dev.revokeAllResearch()">Revoke all</button>
        </div>
        <div class="dev-tech-grid">
          <button
            v-for="id in RESEARCH_ORDER"
            :key="id"
            class="btn"
            :class="{ 'is-active': state.tech[id] }"
            @click="state.tech[id] ? null : dev.grantResearch(id)"
          >
            {{ state.tech[id] ? '✓' : '+' }} {{ RESEARCH[id].name }}
          </button>
        </div>
      </div>
    </div>

    <div class="panel-box">
      <div class="panel-head"><span>Access</span></div>
      <div class="panel-body">
        <div class="field-row">
          <span class="field-label">
            Lock developer mode
            <span class="field-help">Hides this tab again. The code re-opens it.</span>
          </span>
          <button class="btn is-danger" @click="dev.lockDev()">Lock</button>
        </div>
      </div>
    </div>
  </div>
</template>
