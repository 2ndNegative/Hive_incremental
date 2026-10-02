<script setup>
import { computed, ref } from 'vue';
import { state, derived } from '../game/useGame.js';
import { NUTRIENTS, MACROS, MICROS, ASSAY_GROUPS, isRevealed } from '../game/definitions/nutrients.js';
import { formatMass, formatMassFlow, formatEnergy } from '../game/units.js';
import { consumeBiomass, MANUAL_INTAKE } from '../game/actions.js';
import { ITEMS } from '../game/definitions/items/index.js';

const collapsed = ref({});
function toggle(key) {
  collapsed.value[key] = !collapsed.value[key];
}

function row(id) {
  const def = NUTRIENTS[id];
  const amount = state.nutrients[id] ?? 0;
  const cap = derived.value.caps[id];
  const rate = derived.value.net[id] ?? 0;
  return {
    id,
    def,
    amount,
    cap,
    rate,
    full: cap > 0 && amount >= cap - 1e-9,
    fill: cap > 0 ? Math.min(100, (amount / cap) * 100) : 0,
    energy: amount * def.kjPerGram * 1000,
    sources: derived.value.flowSources[id] ?? [],
    spilled: state.spilled[id] ?? 0,
  };
}

// Groups appear only once their assay is done. Before that the nutrients are
// accumulating all the same — there is simply nothing in the interface to say so.
const groups = computed(() => {
  const out = [{ key: 'bulk', name: 'Macronutrients', rows: MACROS.map(row) }];
  for (const assay of ASSAY_GROUPS) {
    if (!state.tech[assay.id]) continue;
    const ids = MICROS.filter((id) => NUTRIENTS[id].group === assay.id);
    out.push({ key: assay.id, name: assay.name, rows: ids.map(row) });
  }
  return out;
});

const hiddenCount = computed(() => MICROS.filter((id) => !isRevealed(state, id)).length);

/**
 * What one manual intake yields — showing ONLY what the hive can identify.
 * Naming an unassayed compound here would hand the player the whole
 * micronutrient panel for free and undo the point of assay research, so
 * unresolved compounds are counted, never listed.
 */
const manualItem = ITEMS[MANUAL_INTAKE.itemId];
const manualYield = computed(() => {
  const known = [];
  let unresolved = 0;
  for (const [n, per100] of Object.entries(manualItem.per100g)) {
    if (!per100) continue;
    if (isRevealed(state, n)) {
      known.push({ n, name: NUTRIENTS[n].name, grams: (per100 * MANUAL_INTAKE.grams) / 100 });
    } else {
      unresolved += 1;
    }
  }
  return { known, unresolved };
});
</script>

<template>
  <div class="panel-box">
    <div class="panel-head">
      <span>Stores</span>
      <span class="muted num">{{ state.drones }} drones</span>
    </div>

    <div class="panel-body">
      <span class="tip tip-side" style="display: block">
        <button class="gather-btn" @click="consumeBiomass()">Consume biomass</button>
        <span class="tip-body">
          <span class="tip-title">
            {{ formatMass(MANUAL_INTAKE.grams) }} of {{ manualItem.name.toLowerCase() }}
          </span>
          <span v-for="entry in manualYield.known" :key="entry.n" class="tip-row">
            <span>{{ entry.name }}</span>
            <span>{{ formatMass(entry.grams) }}</span>
          </span>
          <span v-if="manualYield.unresolved" class="tip-row muted" style="margin-top: 0.25rem">
            <span>+{{ manualYield.unresolved }} unresolved in this sample</span>
            <span>?</span>
          </span>
        </span>
      </span>
    </div>

    <div v-for="group in groups" :key="group.key">
      <button class="group-head" @click="toggle(group.key)">
        <span>{{ collapsed[group.key] ? '▸' : '▾' }} {{ group.name }}</span>
        <span class="muted">{{ group.rows.length }}</span>
      </button>

      <div v-show="!collapsed[group.key]" class="panel-body tight">
        <div v-for="r in group.rows" :key="r.id" class="res-row tip tip-side">
          <span class="res-name">{{ r.def.name }}</span>

          <span class="res-amount num">
            <span :class="{ warn: r.full }">{{ formatMass(r.amount) }}</span>
            <span class="cap"> / {{ formatMass(r.cap) }}</span>
          </span>

          <span
            v-if="r.rate !== 0 || state.settings.showZeroFlows"
            class="res-rate num"
            :class="r.rate > 0 ? 'good' : r.rate < 0 ? 'bad' : 'muted'"
          >
            {{ formatMassFlow(r.rate) }}
          </span>

          <span class="res-bar" :class="{ 'is-full': r.full }">
            <span :style="{ width: `${r.fill}%` }" />
          </span>

          <span class="tip-body">
            <span class="tip-title">{{ r.def.name }}</span>
            <span class="muted" style="display: block; margin-bottom: 0.3rem">{{ r.def.desc }}</span>
            <span class="tip-row">
              <span>Energy density</span>
              <span>{{ r.def.kjPerGram ? `${r.def.kjPerGram} kJ/g` : 'none' }}</span>
            </span>
            <span class="tip-row">
              <span>Energy held</span>
              <span :class="r.energy > 0 ? 'good' : 'muted'">{{ formatEnergy(r.energy) }}</span>
            </span>
            <span v-if="r.def.fuelRequires && !state.tech[r.def.fuelRequires]" class="tip-row warn">
              <span>Locked</span><span>needs {{ r.def.fuelRequires }}</span>
            </span>
            <hr style="border-color: var(--border); margin: 0.3rem 0" />
            <span v-for="(s, i) in r.sources" :key="i" class="tip-row">
              <span>{{ s.label }}</span>
              <span :class="s.amount > 0 ? 'good' : 'bad'">{{ formatMassFlow(s.amount) }}</span>
            </span>
            <span v-if="!r.sources.length" class="tip-row muted"><span>No flow</span><span>—</span></span>
            <span v-if="r.spilled > 0.001" class="tip-row warn">
              <span>Lost to overflow</span><span>{{ formatMass(r.spilled) }}</span>
            </span>
          </span>
        </div>
      </div>
    </div>

    <div v-if="hiddenCount" class="panel-body">
      <span class="muted" style="font-size: 0.76rem">
        {{ hiddenCount }} compound{{ hiddenCount === 1 ? '' : 's' }} in the intake stream remain
        unresolved. Assay research will tell you what they are.
      </span>
    </div>
  </div>
</template>
