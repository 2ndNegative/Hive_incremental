<script setup>
import { computed } from 'vue';
import { state, derived } from '../../game/useGame.js';
import { RESEARCH, RESEARCH_ORDER } from '../../game/definitions/research.js';
import { canAfford, etaFor } from '../../game/engine.js';
import { payableCost } from '../../game/definitions/nutrients.js';
import {
  research, queueResearch, unqueueResearch, moveResearch, clearResearchQueue,
} from '../../game/actions.js';
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

/**
 * What the hive has been told to work out next.
 *
 * Only the head has a time on it. Saying "in 4m" against the third entry would
 * be a lie — it is not four minutes away, it is however long the two in front
 * of it take plus its own, and the insight spent on those is insight this one
 * does not have.
 */
const queue = computed(() =>
  (state.researchQueue || []).map((id, index) => {
    const def = RESEARCH[id];
    const cost = def ? payableCost(state, def.cost) : {};
    return {
      index,
      id,
      name: def?.name ?? id,
      cost,
      affordable: def ? canAfford(state, cost) : false,
      eta: def ? formatEta(etaFor(state, derived.value, cost)) : null,
    };
  }),
);

const queued = computed(() => new Set(state.researchQueue || []));

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
    <!-- Lined up, in order. Uncapped: insight accrues whether anybody is
         watching or not, so the only thing a queue costs is the decision. -->
    <div class="queue-strip">
      <div class="queue-head">
        <span class="queue-title">Research queue</span>
        <span class="num queue-cap">{{ queue.length }}</span>
        <button v-if="queue.length" class="queue-clear" @click="clearResearchQueue()">clear</button>
      </div>

      <div v-if="!queue.length" class="queue-empty muted">
        Nothing lined up. Press ＋ on anything below and the hive will work it out the moment it
        can afford to — in the order you set, and however many you like.
      </div>

      <ol v-else class="queue-list">
        <li v-for="(q, i) in queue" :key="q.id" class="queue-item" :class="{ 'is-head': i === 0 }">
          <span class="queue-pos num">{{ i + 1 }}</span>
          <span class="queue-name">{{ q.name }}</span>
          <span class="queue-state" :class="q.affordable ? 'ok' : 'muted'">
            <template v-if="i > 0">waiting its turn</template>
            <template v-else-if="q.affordable">buying now</template>
            <template v-else-if="q.eta">affordable in {{ q.eta }}</template>
            <template v-else>nothing coming in to pay for it</template>
          </span>
          <button class="btn switch-btn" :disabled="i === 0"
                  title="Move it up the queue" @click="moveResearch(i, -1)">↑</button>
          <button class="btn switch-btn" :disabled="i === queue.length - 1"
                  title="Move it down the queue" @click="moveResearch(i, 1)">↓</button>
          <button class="btn switch-btn" title="Take it off" @click="unqueueResearch(i)">−</button>
        </li>
      </ol>
    </div>

    <div class="section-head" style="margin-bottom: 0.6rem">
      <span>Available</span>
      <span class="muted">{{ available.length }}</span>
    </div>

    <div class="action-grid" v-if="available.length">
      <div v-for="item in available" :key="item.id" class="action-slot">
      <button
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

      <!-- Outside the card for the same reason the build queue's controls are:
           the card is itself a button, and a button inside a button is a click
           the player cannot aim. -->
      <div class="queue-row">
        <button
          class="btn queue-btn"
          :disabled="queued.has(item.id)"
          :title="queued.has(item.id) ? 'Already lined up' : 'Work it out when the hive can afford to'"
          @click="queueResearch(item.id)"
        >＋ Queue</button>
        <span v-if="queued.has(item.id)" class="queue-mine num">lined up</span>
      </div>
      </div>
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
