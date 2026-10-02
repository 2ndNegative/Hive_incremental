<script setup>
import { computed } from 'vue';
import { state, derived } from '../../game/useGame.js';
import { BUILDINGS } from '../../game/definitions/buildings.js';
import { RESOURCES } from '../../game/definitions/resources.js';
import { JOBS } from '../../game/definitions/jobs.js';
import { buildingCost, canAfford, etaFor, affordableCount } from '../../game/engine.js';
import { buyBuilding } from '../../game/actions.js';
import { formatNumber, formatEta } from '../../game/format.js';
import CostList from '../CostList.vue';

const BUY_OPTIONS = [1, 5, 25, 'max'];

/** Human-readable per-unit effects, built from the definition. */
function effectLines(def) {
  const lines = [];
  for (const [res, value] of Object.entries(def.caps || {})) {
    lines.push(`+${formatNumber(value)} ${RESOURCES[res].name} storage`);
  }
  if (def.power > 0) lines.push(`+${def.power} power`);
  if (def.power < 0) lines.push(`${def.power} power`);
  for (const [res, value] of Object.entries(def.inputs || {})) {
    lines.push(`-${value}/s ${RESOURCES[res].name}`);
  }
  for (const [res, value] of Object.entries(def.outputs || {})) {
    lines.push(`+${value}/s ${RESOURCES[res].name}`);
  }
  for (const [job, value] of Object.entries(def.jobSlots || {})) {
    lines.push(`+${value} ${JOBS[job]?.name ?? job} slot`);
  }
  for (const [channel, value] of Object.entries(def.mult || {})) {
    lines.push(`+${Math.round(value * 100)}% ${JOBS[channel]?.name ?? channel} output`);
  }
  return lines;
}

const cards = computed(() =>
  derived.value.unlocked.buildings.map((id) => {
    const def = BUILDINGS[id];
    const want = state.ui.buyAmount;
    const count = want === 'max' ? Math.max(1, affordableCount(state, id)) : want;
    const cost = buildingCost(state, id, count);
    const affordable = canAfford(state, cost);
    return {
      id,
      def,
      owned: state.buildings[id] || 0,
      count,
      cost,
      affordable,
      eta: affordable ? null : formatEta(etaFor(state, derived.value, cost)),
      effects: effectLines(def),
    };
  }),
);

const capped = computed(() =>
  // Warn when a cost can never be paid because storage is too small for it.
  cards.value.filter((card) =>
    Object.entries(card.cost).some(([res, amount]) => amount > (derived.value.caps[res] ?? Infinity)),
  ),
);
</script>

<template>
  <div>
    <div class="notice" v-if="derived.power.demand > 0 && derived.power.ratio < 0.999">
      <strong class="bad">Power deficit.</strong>
      Consumers are running at {{ Math.floor(derived.power.ratio * 100) }}%. Build another
      generator or shut something down.
    </div>

    <div class="notice is-warn" v-else-if="capped.length">
      <strong>Storage too small.</strong>
      {{ capped.map((c) => c.def.name).join(', ') }} costs more than you can currently hold —
      build storage first.
    </div>

    <div class="field-row">
      <span class="field-label">Buy amount</span>
      <div class="stepper">
        <button
          v-for="option in BUY_OPTIONS"
          :key="option"
          class="btn"
          :class="{ 'is-active': state.ui.buyAmount === option }"
          style="width: auto; height: auto"
          @click="state.ui.buyAmount = option"
        >
          {{ option === 'max' ? 'Max' : `x${option}` }}
        </button>
      </div>
    </div>

    <div class="action-grid">
      <button
        v-for="card in cards"
        :key="card.id"
        class="action-card"
        :class="{ 'is-affordable': card.affordable }"
        :disabled="!card.affordable"
        @click="buyBuilding(card.id, state.ui.buyAmount)"
      >
        <span class="action-head">
          <span class="action-name">
            {{ card.def.name }}
            <span v-if="card.count > 1" class="muted">x{{ card.count }}</span>
          </span>
          <span class="action-count">{{ card.owned }}</span>
        </span>
        <span class="action-desc">{{ card.def.desc }}</span>
        <CostList :cost="card.cost" />
        <span class="effect-list">{{ card.effects.join(' · ') }}</span>
        <span v-if="card.eta" class="action-desc" style="margin-bottom: 0">
          affordable in {{ card.eta }}
        </span>
      </button>
    </div>
  </div>
</template>
