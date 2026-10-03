<script setup>
import { computed } from 'vue';
import { state, derived } from '../../game/useGame.js';
import { NUTRIENTS, NUTRIENT_IDS, isUsableFuel } from '../../game/definitions/nutrients.js';
import { fuelChoiceFor } from '../../game/engine.js';
import { setGlobalFuel, setFuelOverride, clearFuelOverride } from '../../game/actions.js';
import { formatEnergy, formatPower, formatMass, formatMassFlow } from '../../game/units.js';

/** Fuels the hive can actually burn right now. */
const fuels = computed(() =>
  NUTRIENT_IDS.filter((id) => NUTRIENTS[id].fuel).map((id) => ({
    id,
    def: NUTRIENTS[id],
    usable: isUsableFuel(state, id),
    held: state.nutrients[id] || 0,
    energy: (state.nutrients[id] || 0) * NUTRIENTS[id].kjPerGram * 1000,
    efficiency: derived.value.efficiency[id],
    burning: derived.value.burn[id] || 0,
  })),
);

const usableFuels = computed(() => fuels.value.filter((f) => f.usable));

const consumers = computed(() =>
  derived.value.demands.map((d) => {
    const choice = fuelChoiceFor(state, d.key);
    const detail = derived.value.perConsumer[d.key] ?? {};
    return {
      key: d.key,
      label: d.label,
      watts: d.watts,
      ...choice,
      ratio: detail.ratio ?? 1,
      from: detail.from ?? {},
    };
  }),
);

function setPreferred(key, value) {
  if (key === 'global') setGlobalFuel(value, state.energy.fallback);
  else {
    const current = fuelChoiceFor(state, key);
    setFuelOverride(key, value, current.fallback);
  }
}

function setFallback(key, value) {
  if (key === 'global') setGlobalFuel(state.energy.preferred, value);
  else {
    const current = fuelChoiceFor(state, key);
    setFuelOverride(key, current.preferred, value);
  }
}

const reserveSeconds = computed(() => {
  const burn = derived.value.energy.delivered;
  if (burn <= 0) return Infinity;
  return derived.value.energy.usable / burn;
});

function formatReserve(seconds) {
  if (!Number.isFinite(seconds)) return 'indefinite';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
</script>

<template>
  <div>
    <div class="stat-grid" style="margin-bottom: 0.9rem">
      <div class="stat-tile">
        <div class="label">Energy in store</div>
        <div class="value">{{ formatEnergy(derived.energy.stored) }}</div>
        <div class="muted" style="font-size: 0.72rem">sum of every nutrient held</div>
      </div>
      <div class="stat-tile">
        <div class="label">Burnable now</div>
        <div class="value" :class="derived.energy.usable < derived.energy.stored ? 'warn' : ''">
          {{ formatEnergy(derived.energy.usable) }}
        </div>
        <div class="muted" style="font-size: 0.72rem">excludes fuels not yet unlocked</div>
      </div>
      <div class="stat-tile">
        <div class="label">Demand</div>
        <div class="value" :class="derived.energy.ratio < 0.999 ? 'bad' : ''">
          {{ formatPower(derived.energy.demand) }}
        </div>
        <div class="muted" style="font-size: 0.72rem">
          delivering {{ formatPower(derived.energy.delivered) }}
          ({{ Math.floor(derived.energy.ratio * 100) }}%)
        </div>
      </div>
      <div class="stat-tile">
        <div class="label">Metabolic ceiling</div>
        <div class="value" :class="derived.energy.throughputRatio < 0.999 ? 'warn' : ''">
          {{ formatPower(derived.energy.throughput) }}
        </div>
        <div class="muted" style="font-size: 0.72rem">how fast mass can be oxidised</div>
      </div>
      <div class="stat-tile">
        <div class="label">Reserve</div>
        <div class="value">{{ formatReserve(reserveSeconds) }}</div>
        <div class="muted" style="font-size: 0.72rem">at the current burn rate</div>
      </div>
    </div>

    <div class="panel-box" style="margin-bottom: 0.9rem">
      <div class="panel-head"><span>Fuels</span></div>
      <div class="panel-body">
        <p class="muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
          Energy is not a separate store — it is what the hive's mass is worth. Burning a gram of
          fat costs 37 kJ of reserve; burning a gram of sodium costs nothing, because sodium holds
          nothing. That is why only these appear here.
        </p>
        <table class="table is-fullwidth is-narrow data-table">
          <thead>
            <tr>
              <th>Fuel</th>
              <th class="right">Density</th>
              <th class="right">Efficiency</th>
              <th class="right">Held</th>
              <th class="right">Energy</th>
              <th class="right">Burning</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in fuels" :key="f.id" :class="{ muted: !f.usable }">
              <td>
                {{ f.def.name }}
                <span v-if="!f.usable" class="warn" style="font-size: 0.72rem">
                  · locked ({{ f.def.fuelRequires }})
                </span>
              </td>
              <td class="right num">{{ f.def.kjPerGram }} kJ/g</td>
              <td class="right num" :class="f.efficiency > 1 ? 'good' : ''">
                ×{{ f.efficiency.toFixed(2) }}
              </td>
              <td class="right num">{{ formatMass(f.held) }}</td>
              <td class="right num">{{ formatEnergy(f.energy) }}</td>
              <td class="right num" :class="f.burning > 0 ? 'bad' : 'muted'">
                {{ f.burning > 0 ? formatMassFlow(-f.burning) : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel-box">
      <div class="panel-head">
        <span>Energy sources</span>
        <span class="muted">in the order they are paid</span>
      </div>
      <div class="panel-body" style="padding-bottom: 0">
        <p class="muted" style="font-size: 0.78rem; margin: 0">
          This list is the queue. The drones are kept alive first, then the buildings band by band
          down the Hive tab — Core, Cognition, Gathering, Production, Digestion, Storage — and
          left to right inside each band. When there is not enough to go round, whatever the
          supply runs out on starts to go dark, and everything below it with it.
        </p>
      </div>
      <div class="panel-body">
        <div class="fuel-row is-global">
          <span class="field-label">
            Hive default
            <span class="field-help">Used by anything without its own setting.</span>
          </span>
          <select class="fuel-select" :value="state.energy.preferred" @change="setPreferred('global', $event.target.value)">
            <option v-for="f in usableFuels" :key="f.id" :value="f.id">{{ f.def.name }}</option>
          </select>
          <select class="fuel-select" :value="state.energy.fallback" @change="setFallback('global', $event.target.value)">
            <option v-for="f in usableFuels" :key="f.id" :value="f.id">{{ f.def.name }}</option>
          </select>
          <span class="muted" style="width: 5.5rem; text-align: right">—</span>
        </div>

        <div v-for="c in consumers" :key="c.key" class="fuel-row">
          <span class="field-label">
            {{ c.label }}
            <span class="field-help">
              {{ formatPower(c.watts) }}
              <template v-if="c.ratio < 0.999"> · <span class="bad">{{ Math.floor(c.ratio * 100) }}% met</span></template>
              <template v-else-if="Object.keys(c.from).length">
                · drawing
                {{ Object.entries(c.from).map(([n, g]) => `${formatMassFlow(-g)} ${NUTRIENTS[n].name.toLowerCase()}`).join(', ') }}
              </template>
            </span>
          </span>
          <select class="fuel-select" :value="c.preferred" @change="setPreferred(c.key, $event.target.value)">
            <option v-for="f in usableFuels" :key="f.id" :value="f.id">{{ f.def.name }}</option>
          </select>
          <select class="fuel-select" :value="c.fallback" @change="setFallback(c.key, $event.target.value)">
            <option v-for="f in usableFuels" :key="f.id" :value="f.id">{{ f.def.name }}</option>
          </select>
          <button
            class="btn"
            style="width: 5.5rem"
            :disabled="!c.overridden"
            @click="clearFuelOverride(c.key)"
          >
            {{ c.overridden ? 'Reset' : 'default' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
