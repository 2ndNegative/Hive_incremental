<script setup>
import { computed } from 'vue';
import { state, derived } from '../game/useGame.js';
import { RESOURCES } from '../game/definitions/resources.js';
import { formatNumber, formatRate } from '../game/format.js';
import { gatherMatter } from '../game/actions.js';

const rows = computed(() =>
  derived.value.unlocked.resources.map((id) => {
    const def = RESOURCES[id];
    const amount = state.amounts[id] ?? 0;
    const cap = derived.value.caps[id];
    const rate = derived.value.net[id] ?? 0;
    return {
      id,
      def,
      amount,
      cap,
      rate,
      isRate: def.kind === 'rate',
      isPop: def.kind === 'pop',
      full: def.kind !== 'rate' && cap > 0 && amount >= cap - 1e-6,
      fill: def.kind === 'rate' || !cap ? 0 : Math.min(100, (amount / cap) * 100),
      flows: derived.value.flows[id] ?? [],
    };
  }),
);

const notation = computed(() => state.settings.notation);

function fmt(value) {
  return formatNumber(value, { notation: notation.value });
}
</script>

<template>
  <div class="panel-box">
    <div class="panel-head">
      <span>Resources</span>
      <span class="muted num">{{ formatNumber(state.amounts.workers) }} pop</span>
    </div>

    <div class="panel-body">
      <button class="gather-btn" @click="gatherMatter()">Scavenge Matter</button>
    </div>

    <div class="panel-body tight">
      <div v-for="row in rows" :key="row.id" class="res-row tip">
        <span class="res-name">{{ row.def.name }}</span>

        <span v-if="row.isRate" class="res-amount num">
          {{ fmt(derived.power.supply) }}<span class="cap"> / {{ fmt(derived.power.demand) }}</span>
        </span>
        <span v-else class="res-amount num">
          <span :class="{ warn: row.full }">{{ fmt(row.amount) }}</span>
          <span class="cap"> / {{ fmt(row.cap) }}</span>
        </span>

        <span
          v-if="!row.isRate && (row.rate !== 0 || state.settings.showZeroRates)"
          class="res-rate num"
          :class="row.rate > 0 ? 'good' : row.rate < 0 ? 'bad' : 'muted'"
        >
          {{ formatRate(row.rate, { notation }) }}
        </span>
        <span v-else-if="row.isRate" class="res-rate num" :class="derived.power.net < 0 ? 'bad' : 'good'">
          {{ derived.power.net >= 0
            ? `${fmt(derived.power.net)} spare`
            : `${fmt(-derived.power.net)} short` }}
        </span>

        <span v-if="!row.isRate" class="res-bar" :class="{ 'is-full': row.full }">
          <span :style="{ width: `${row.fill}%` }" />
        </span>

        <!-- Hover breakdown: where the rate comes from. -->
        <span class="tip-body">
          <span class="tip-title">{{ row.def.name }}</span>
          <span class="muted" style="display: block; margin-bottom: 0.3rem">{{ row.def.desc }}</span>
          <template v-if="row.flows.length">
            <span v-for="(flow, i) in row.flows" :key="i" class="tip-row">
              <span>{{ flow.label }}</span>
              <span :class="flow.amount > 0 ? 'good' : 'bad'">{{ formatRate(flow.amount) }}</span>
            </span>
          </template>
          <span v-else class="tip-row muted"><span>No production</span><span>—</span></span>
          <span v-if="row.isPop && derived.growthRate > 0" class="tip-row">
            <span>Next worker</span>
            <span>{{ Math.ceil((1 - state.growth) / derived.growthRate) }}s</span>
          </span>
          <span v-else-if="row.isPop" class="tip-row warn">
            <span>Housing full</span><span>—</span>
          </span>
        </span>
      </div>
    </div>
  </div>
</template>
