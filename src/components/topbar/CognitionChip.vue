<script setup>
import { derived } from '../../game/useGame.js';
import { formatCogits } from '../../game/units.js';
</script>

<template>
  <span class="tip">
    <span>
      Cognition
      <strong class="num" :class="derived.cognition.over ? 'bad' : 'good'">
        {{ formatCogits(derived.cognition.used) }}
      </strong>
      <span class="muted">&nbsp;/ {{ formatCogits(derived.cognition.capacity) }}</span>
    </span>
          <span class="tip-body">
            <span class="tip-title">Cognitive bandwidth</span>
            <span class="muted" style="display: block; margin-bottom: 0.3rem">
              Measured in cogits. Not a store — a width. Everything that thinks occupies part of
              it for as long as it exists, and insight is what the hive does with whatever is
              left over.
            </span>
            <span class="tip-row">
              <span>Capacity</span><span>{{ formatCogits(derived.cognition.capacity) }}</span>
            </span>
            <span class="tip-row">
              <span>In flight</span><span>{{ formatCogits(derived.cognition.used) }}</span>
            </span>
            <span class="tip-row">
              <span>Free</span>
              <span :class="derived.cognition.over ? 'bad' : 'good'">
                {{ formatCogits(derived.cognition.free) }}
              </span>
            </span>

            <template v-if="derived.cognition.supply.length">
              <hr style="border-color: var(--border); margin: 0.3rem 0" />
              <span class="tip-title" style="font-size: 0.72rem">Thinking with</span>
              <span v-for="s in derived.cognition.supply" :key="s.key" class="tip-row">
                <span>{{ s.label }}</span><span class="good">+{{ formatCogits(s.amount) }}</span>
              </span>
            </template>

            <template v-if="derived.cognition.load.length">
              <hr style="border-color: var(--border); margin: 0.3rem 0" />
              <span class="tip-title" style="font-size: 0.72rem">Occupied by</span>
              <span v-for="l in derived.cognition.load" :key="l.key" class="tip-row">
                <span>{{ l.label }}</span><span class="bad">−{{ formatCogits(l.amount) }}</span>
              </span>
            </template>

            <span v-if="!derived.cognition.capacity" class="tip-row muted" style="margin-top: 0.25rem">
              <span>Nothing to think with yet</span><span>—</span>
            </span>
          </span>
  </span>
</template>
