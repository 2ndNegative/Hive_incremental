<script setup>
import { state, derived } from '../../game/useGame.js';
import { formatMassFlow, formatLarvae } from '../../game/units.js';
</script>

<template>
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
</template>
