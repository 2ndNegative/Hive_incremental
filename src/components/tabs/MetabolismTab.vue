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

/**
 * The generators, which are the only things in the hive that choose a fuel.
 *
 * Everything else draws watts out of the pool and has no opinion about what was
 * burned to fill it, so nothing else gets a dropdown. Before the metabolism
 * rewrite every consumer had one and every one of them was a lie.
 */
const generators = computed(() => derived.value.generators.filter((g) => g.count > 0));

/** The queue: who is being paid, in the order they are paid. Read-only. */
const consumers = computed(() =>
  derived.value.demands.map((d) => {
    const detail = derived.value.perConsumer[d.key] ?? {};
    const power = d.key.startsWith('structure:')
      ? derived.value.power[d.key.slice('structure:'.length)]
      : null;
    return {
      key: d.key,
      label: d.label,
      watts: d.watts,
      ratio: detail.ratio ?? 1,
      delivered: detail.delivered ?? 0,
      charge: power?.charge ?? null,
      direction: power?.direction ?? null,
    };
  }),
);

function drawLine(drew) {
  const parts = Object.entries(drew).map(
    ([n, g]) => `${formatMassFlow(-g)} ${NUTRIENTS[n].name.toLowerCase()}`,
  );
  return parts.length ? parts.join(', ') : null;
}

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

// How long the generators can keep going on what they are pointed at — the
// figure that matters, rather than how long the banked pool would last.
const reserveSeconds = computed(() => {
  const making = derived.value.energy.generated;
  if (making <= 0) return Infinity;
  return derived.value.energy.reachableYield / making;
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
        <div class="muted" style="font-size: 0.72rem">
          only the stores a generator is pointed at
        </div>
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
        <div class="muted" style="font-size: 0.72rem">until the generators run dry</div>
      </div>
    </div>

    <div class="panel-box" style="margin-bottom: 0.9rem">
      <div class="panel-head"><span>Fuels</span></div>
      <div class="panel-body">
        <p class="muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
          What a generator can get out of a gram. Fat gives up 37 kJ; sodium gives up nothing at
          all, which is why only these appear here. Until a generator opens one of these stores,
          every joule in them is locked in the matter and the hive cannot spend a watt of it.
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

    <div class="panel-box" style="margin-bottom: 0.9rem">
      <div class="panel-head">
        <span>Generators</span>
        <span class="muted">what gets burned</span>
      </div>
      <div class="panel-body" style="padding-bottom: 0">
        <p class="muted" style="font-size: 0.78rem; margin: 0">
          Only a generator opens a store. Everything else in the hive draws watts out of the pool
          and never knows what was burned to fill it, so this is the whole of the hive's say in
          the matter: which mass each generator reaches for first, and what it falls back to when
          that runs out.
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

        <div v-for="g in generators" :key="g.key" class="fuel-row">
          <span class="field-label">
            {{ g.name }} <template v-if="g.count > 1">×{{ g.count }}</template>
            <span class="field-help">
              {{ formatMass(g.owned) }}/s capacity
              <template v-if="g.idle > 0">
                · <span class="warn">{{ g.idle }} idle</span>
              </template>
              <template v-if="g.running > 0 && g.charge < 0.999">
                · <span class="warn">{{ Math.round(g.charge * 100) }}% powered</span>
              </template>
              <template v-if="g.dry">
                · <span class="bad">nothing it can open is in store</span>
              </template>
              <template v-else-if="drawLine(g.drew)">
                · drawing {{ drawLine(g.drew) }} for {{ formatPower(g.watts) }}
              </template>
              <!-- A generator burns ONE fuel at a time and waits out a
                   cooldown before changing back, so the screen says which and
                   for how long rather than flickering between the two. -->
              <template v-if="g.onFallback">
                · <span class="warn">on its fallback</span>
                <template v-if="g.hold > 0">
                  for another {{ Math.ceil(g.hold) }}s
                </template>
                <template v-else>until something better is in store</template>
              </template>
            </span>
          </span>
          <select class="fuel-select" :value="g.preferred" @change="setPreferred(g.key, $event.target.value)">
            <option v-for="f in usableFuels" :key="f.id" :value="f.id">{{ f.def.name }}</option>
          </select>
          <select class="fuel-select" :value="g.fallback" @change="setFallback(g.key, $event.target.value)">
            <option v-for="f in usableFuels" :key="f.id" :value="f.id">{{ f.def.name }}</option>
          </select>
          <button
            class="btn"
            style="width: 5.5rem"
            :disabled="!g.overridden"
            @click="clearFuelOverride(g.key)"
          >
            {{ g.overridden ? 'Reset' : 'default' }}
          </button>
        </div>

        <p v-if="!generators.length" class="muted" style="font-size: 0.78rem; margin: 0.4rem 0 0">
          No generators standing. Nothing is converting mass into energy, so the pool can only
          empty — grow a Metabolic Generator in the Digestion band.
        </p>
      </div>
    </div>

    <!-- ------------------------------------------------------------ the queue -->
    <div class="panel-box">
      <div class="panel-head">
        <span>Where it goes</span>
        <span class="muted">in the order they are paid</span>
      </div>
      <div class="panel-body" style="padding-bottom: 0">
        <p class="muted" style="font-size: 0.78rem; margin: 0">
          The drones are kept alive first, then the buildings band by band down the Hive tab —
          Core, Cognition, Gathering, Production, Digestion, Storage — and left to right inside
          each band. When there is not enough to go round, a building settles at the share it is
          actually being paid, and everything below it gets nothing.
        </p>
      </div>
      <div class="panel-body">
        <table class="table is-fullwidth is-narrow data-table">
          <thead>
            <tr>
              <th>Consumer</th>
              <th class="right">Wants</th>
              <th class="right">Gets</th>
              <th class="right">Running at</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in consumers" :key="c.key">
              <td>{{ c.label }}</td>
              <td class="right num">{{ formatPower(c.watts) }}</td>
              <td class="right num" :class="c.ratio < 0.999 ? 'bad' : 'muted'">
                {{ formatPower(c.delivered) }}
              </td>
              <td class="right num">
                <template v-if="c.charge === null">—</template>
                <template v-else>
                  <span :class="c.charge < 0.999 ? (c.direction === 'failing' ? 'bad' : 'warn') : 'good'">
                    {{ Math.round(c.charge * 100) }}%
                  </span>
                </template>
              </td>
            </tr>
            <tr v-if="!consumers.length">
              <td colspan="4" class="muted">Nothing is asking for energy.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
