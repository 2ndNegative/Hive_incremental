<script setup>
import { computed } from 'vue';
import { state, derived } from '../../game/useGame.js';
import { STRUCTURES } from '../../game/definitions/structures.js';
import { NUTRIENTS } from '../../game/definitions/nutrients.js';
import { CASTES } from '../../game/definitions/castes.js';
import { structureCost, canAfford, etaFor, affordableCount } from '../../game/engine.js';
import { buildStructure } from '../../game/actions.js';
import { formatMass, formatPower } from '../../game/units.js';
import { formatEta } from '../../game/format.js';
import CostList from '../CostList.vue';

const BUY_OPTIONS = [1, 5, 25, 'max'];

function effectLines(def) {
  const lines = [];
  if (def.caps?.drones) lines.push(`+${def.caps.drones} drone capacity`);
  for (const [group, value] of Object.entries(def.capMult || {})) {
    const label = { bulk: 'macronutrient', mineral: 'mineral', vitamin: 'vitamin' }[group] ?? group;
    lines.push(`+${Math.round(value * 100)}% ${label} storage`);
  }
  if (def.throughput) lines.push(`+${formatPower(def.throughput)} metabolic ceiling`);
  if (def.insightCap) lines.push(`+${def.insightCap} insight storage`);
  for (const [caste, value] of Object.entries(def.slots || {})) {
    lines.push(`+${value} ${CASTES[caste]?.name ?? caste} slot`);
  }
  for (const [channel, value] of Object.entries(def.mult || {})) {
    lines.push(`+${Math.round(value * 100)}% ${CASTES[channel]?.name ?? channel} output`);
  }
  if (def.upkeepWatts) lines.push(`${formatPower(def.upkeepWatts)} upkeep`);
  return lines;
}

const cards = computed(() =>
  derived.value.unlocked.structures.map((id) => {
    const def = STRUCTURES[id];
    const want = state.ui.buyAmount;
    const count = want === 'max' ? Math.max(1, affordableCount(state, id)) : want;
    const cost = structureCost(state, id, count);
    const affordable = canAfford(state, cost);
    return {
      id,
      def,
      owned: state.structures[id] || 0,
      count,
      cost,
      affordable,
      eta: affordable ? null : formatEta(etaFor(state, derived.value, cost)),
      effects: effectLines(def),
    };
  }),
);

const starving = computed(() => derived.value.energy.ratio < 0.999);
const throttled = computed(() => derived.value.energy.throughputRatio < 0.999);

const overCapacity = computed(() =>
  cards.value.filter((card) =>
    Object.entries(card.cost).some(([n, amount]) => amount > (derived.value.caps[n] ?? Infinity)),
  ),
);
</script>

<template>
  <div>
    <div v-if="starving" class="notice is-warn">
      <strong class="bad">Energy deficit.</strong>
      The hive is running at {{ Math.floor(derived.energy.ratio * 100) }}% of demand
      <template v-if="throttled">
        — the metabolic ceiling is {{ formatPower(derived.energy.throughput) }} against
        {{ formatPower(derived.energy.demand) }} of demand. Grow a Metabolic Core.
      </template>
      <template v-else>
        — it has run out of fuel it can burn. Check your energy sources, or put drones on intake.
      </template>
    </div>

    <div v-else-if="overCapacity.length" class="notice is-warn">
      <strong>Storage too small.</strong>
      {{ overCapacity.map((c) => c.def.name).join(', ') }} costs more than the hive can hold.
      Grow a Gut Sac first.
    </div>

    <div class="field-row">
      <span class="field-label">Build amount</span>
      <div class="stepper">
        <button
          v-for="option in BUY_OPTIONS"
          :key="option"
          class="btn"
          style="width: auto; height: auto"
          :class="{ 'is-active': state.ui.buyAmount === option }"
          @click="state.ui.buyAmount = option"
        >
          {{ option === 'max' ? 'Max' : `×${option}` }}
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
        @click="buildStructure(card.id, state.ui.buyAmount)"
      >
        <span class="action-head">
          <span class="action-name">
            {{ card.def.name }}
            <span v-if="card.count > 1" class="muted">×{{ card.count }}</span>
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
