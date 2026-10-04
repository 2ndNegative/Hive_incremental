<script setup>
import { state, derived } from '../../game/useGame.js';
import { NUTRIENTS } from '../../game/definitions/nutrients.js';
import { formatEnergy, formatPower, formatMassFlow } from '../../game/units.js';
</script>

<template>
  <span class="tip">
    <span>
      Energy
      <strong class="num" :class="derived.energy.generated > 0 ? 'good' : 'muted'">
        {{ formatPower(derived.energy.generated) }}
      </strong>
    </span>
          <span class="tip-body">
            <span class="tip-title">Energy being made</span>
            <span class="muted" style="display: block; margin-bottom: 0.3rem">
              What the generators are producing, second by second. Nothing else in the hive turns
              stored matter into spendable energy — a hive standing on a tonne of fat with no
              generator makes nothing at all.
            </span>
            <span class="tip-row">
              <span>Processing</span><span>{{ formatMassFlow(derived.energy.massRate) }}</span>
            </span>
            <span class="tip-row"><span>Banked</span><span>{{ formatEnergy(derived.energy.pool) }}</span></span>
            <hr style="border-color: var(--border); margin: 0.3rem 0" />
            <span class="tip-title" style="font-size: 0.72rem">Usable energy</span>
            <span class="muted" style="display: block; margin-bottom: 0.3rem">
              What is in the stores the generators are actually pointed at. Change what one of
              them burns and this changes with it: a store nothing is reaching for is not fuel.
            </span>
            <span class="tip-row">
              <span>In reach</span>
              <span :class="derived.energy.usable > 0 ? 'good' : 'bad'">
                {{ formatEnergy(derived.energy.usable) }}
              </span>
            </span>
            <span v-for="f in derived.energy.fuels" :key="f" class="tip-row muted">
              <span>· {{ NUTRIENTS[f].name }}</span>
              <span>{{ formatEnergy((state.nutrients[f] || 0) * NUTRIENTS[f].kjPerGram * 1000) }}</span>
            </span>
            <span v-if="!derived.energy.fuels.length" class="tip-row bad">
              <span>No generator is pointed at anything</span><span>—</span>
            </span>
            <hr style="border-color: var(--border); margin: 0.3rem 0" />
            <span class="tip-row muted">
              <span>Chemical energy in store, all of it</span>
              <span>{{ formatEnergy(derived.energy.stored) }}</span>
            </span>
          </span>
  </span>
</template>
