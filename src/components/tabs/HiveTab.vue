<script setup>
import { computed } from 'vue';
import { state, derived } from '../../game/useGame.js';
import {
  STRUCTURES,
  BUILDING_CATEGORIES,
  BUILDING_CATEGORY_ORDER,
  maxLevelOf,
} from '../../game/definitions/structures.js';
import { NUTRIENTS } from '../../game/definitions/nutrients.js';
import { CASTES } from '../../game/definitions/castes.js';
import { structureCost, canAfford, etaFor, affordableCount } from '../../game/engine.js';
import { buildStructure } from '../../game/actions.js';
import { formatMass, formatMassFlow, formatPower, formatCogits } from '../../game/units.js';
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
  if (def.cogitCapacity) lines.push(`+${formatCogits(def.cogitCapacity)} cognition`);
  if (def.cogitDraw) lines.push(`${formatCogits(def.cogitDraw)} cognition occupied`);
  if (def.metabolism) lines.push(`metabolises ${formatMassFlow(def.metabolism)} into energy`);
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
    const owned = state.structures[id] || 0;
    const headroom = maxLevelOf(id) - owned;
    const count = Math.max(
      1,
      Math.min(headroom, want === 'max' ? Math.max(1, affordableCount(state, id)) : want),
    );
    const cost = structureCost(state, id, count);
    const maxed = headroom <= 0;
    const affordable = !maxed && canAfford(state, cost);
    return {
      id,
      def,
      owned,
      leveled: Boolean(def.leveled),
      maxed,
      // A levelled structure reads as what it would become, not how many of it
      // you would end up with.
      action: def.leveled
        ? (maxed ? 'At maximum level' : `Upgrade to level ${owned + count}`)
        : null,
      count,
      cost,
      affordable,
      eta: affordable ? null : formatEta(etaFor(state, derived.value, cost)),
      effects: effectLines(def),
    };
  }),
);

/**
 * The Hive tab is banded by what a building is FOR, and each band folds. Bands
 * show even when empty: an empty Cognition band answers "where does thinking
 * come from" better than no band at all, and during the rebuild that is most
 * of what this screen has to say.
 */
const bands = computed(() =>
  BUILDING_CATEGORY_ORDER.map((id) => {
    const def = BUILDING_CATEGORIES[id];
    return {
      id,
      def,
      cards: cards.value.filter((c) => c.def.category === id),
      open: !state.ui.buildBands?.[id],
    };
  }),
);

function toggleBand(id) {
  state.ui.buildBands ??= {};
  state.ui.buildBands[id] = !state.ui.buildBands[id];
}

/** Buildings whose category is missing or unknown — a rebuild tripwire. */
const unfiled = computed(() => cards.value.filter((c) => !BUILDING_CATEGORIES[c.def.category]));

const nothingBuildable = computed(() => cards.value.length === 0);

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
        — the generators are making {{ formatPower(derived.energy.generated) }} against
        {{ formatPower(derived.energy.demand) }} of demand. Grow more Metabolic Generators, or
        the pool will run dry.
      </template>
      <template v-else>
        — the pool is empty. Nothing converts stored matter into usable energy except a Metabolic
        Generator.
      </template>
    </div>

    <div v-else-if="overCapacity.length" class="notice is-warn">
      <strong>Storage too small.</strong>
      {{ overCapacity.map((c) => c.def.name).join(', ') }} costs more than the hive can hold.
      Grow a Gut Sac first.
    </div>

    <div v-if="nothingBuildable" class="notice">
      <strong>Nothing can be built.</strong>
      The building and drone systems are being rebuilt, so every structure and every caste is
      parked. The bands below are where the new ones will appear.
    </div>

    <div v-else class="field-row">
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

    <div class="band-stack">
      <section v-for="band in bands" :key="band.id" class="band">
        <h2 class="band-head">
          <button
            class="band-toggle"
            :aria-expanded="band.open ? 'true' : 'false'"
            :aria-controls="`band-${band.id}`"
            @click="toggleBand(band.id)"
          >
            <span class="band-arrow" aria-hidden="true">{{ band.open ? '▾' : '▸' }}</span>
            <span class="band-name">{{ band.def.name }}</span>
            <span class="band-desc">{{ band.def.desc }}</span>
            <span class="band-count num">{{ band.cards.length || '—' }}</span>
          </button>
        </h2>

        <div v-show="band.open" :id="`band-${band.id}`" class="band-body">
          <div v-if="!band.cards.length" class="band-empty">Nothing here yet.</div>

          <div v-else class="action-grid">
            <button
              v-for="card in band.cards"
              :key="card.id"
              class="action-card"
              :class="{ 'is-affordable': card.affordable }"
              :disabled="!card.affordable"
              @click="buildStructure(card.id, state.ui.buyAmount)"
            >
              <span class="action-head">
                <span class="action-name">
                  {{ card.def.name }}
                  <span v-if="!card.leveled && card.count > 1" class="muted">×{{ card.count }}</span>
                </span>
                <span class="action-count">
                  <template v-if="card.leveled">Lv {{ card.owned }}</template>
                  <template v-else>{{ card.owned }}</template>
                </span>
              </span>
              <span class="action-desc">{{ card.def.desc }}</span>
              <span v-if="card.action" class="action-upgrade" :class="{ muted: card.maxed }">
                {{ card.action }}
              </span>
              <CostList :cost="card.cost" />
              <span class="effect-list">{{ card.effects.join(' · ') }}</span>
              <span v-if="card.eta" class="action-desc" style="margin-bottom: 0">
                affordable in {{ card.eta }}
              </span>
            </button>
          </div>
        </div>
      </section>
    </div>

    <div v-if="unfiled.length" class="notice is-warn">
      <strong>Unfiled buildings.</strong>
      {{ unfiled.map((c) => c.def.name).join(', ') }} name no band, so nothing lists them. Give
      each a <code>category</code> from BUILDING_CATEGORIES.
    </div>
  </div>
</template>
