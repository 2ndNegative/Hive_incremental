<script setup>
import { computed } from 'vue';
import { state, derived } from '../../game/useGame.js';
import { RESEARCH, RESEARCH_ORDER } from '../../game/definitions/research.js';
import { canAfford, etaFor } from '../../game/engine.js';
import { research } from '../../game/actions.js';
import { formatEta } from '../../game/format.js';
import CostList from '../CostList.vue';

const available = computed(() =>
  derived.value.unlocked.research.map((id) => {
    const def = RESEARCH[id];
    const affordable = canAfford(state, def.cost);
    return {
      id,
      def,
      affordable,
      eta: affordable ? null : formatEta(etaFor(state, derived.value, def.cost)),
    };
  }),
);

const done = computed(() => RESEARCH_ORDER.filter((id) => state.tech[id]).map((id) => RESEARCH[id]));

const locked = computed(() =>
  RESEARCH_ORDER.filter(
    (id) => !state.tech[id] && !RESEARCH[id].requires.every((req) => state.tech[req]),
  ).map((id) => ({
    def: RESEARCH[id],
    blockedBy: RESEARCH[id].requires.filter((req) => !state.tech[req]).map((req) => RESEARCH[req].name),
  })),
);
</script>

<template>
  <div>
    <div class="section-head" style="margin-bottom: 0.6rem">
      <span>Available</span>
      <span class="muted">{{ available.length }}</span>
    </div>

    <div class="action-grid" v-if="available.length">
      <button
        v-for="item in available"
        :key="item.id"
        class="action-card is-research"
        :class="{ 'is-affordable': item.affordable }"
        :disabled="!item.affordable"
        @click="research(item.id)"
      >
        <span class="action-head">
          <span class="action-name">{{ item.def.name }}</span>
        </span>
        <span class="action-desc">{{ item.def.desc }}</span>
        <CostList :cost="item.def.cost" />
        <span class="effect-list">{{ item.def.unlocks.join(' · ') }}</span>
        <span v-if="item.eta" class="action-desc" style="margin-bottom: 0">
          affordable in {{ item.eta }}
        </span>
      </button>
    </div>
    <p v-else class="muted">Everything currently available has been researched.</p>

    <template v-if="locked.length">
      <div class="section-head" style="margin: 0.9rem 0 0.6rem">
        <span>Locked</span>
        <span class="muted">{{ locked.length }}</span>
      </div>
      <div class="panel-box">
        <div class="panel-body">
          <div v-for="item in locked" :key="item.def.id" class="field-row">
            <span class="field-label">
              {{ item.def.name }}
              <span class="field-help">Requires {{ item.blockedBy.join(', ') }}</span>
            </span>
          </div>
        </div>
      </div>
    </template>

    <template v-if="done.length">
      <div class="section-head" style="margin: 0.9rem 0 0.6rem">
        <span>Completed</span>
        <span class="muted">{{ done.length }}</span>
      </div>
      <div class="panel-box">
        <div class="panel-body">
          <span v-for="def in done" :key="def.id" class="muted" style="margin-right: 0.9rem">
            ✓ {{ def.name }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>
