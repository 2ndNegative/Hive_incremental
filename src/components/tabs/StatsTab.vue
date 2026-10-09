<script setup>
import { computed } from 'vue';
import { state, derived } from '../../game/useGame.js';
import { NUTRIENTS, MACROS, MICROS, isRevealed } from '../../game/definitions/nutrients.js';
import { STRUCTURE_ORDER, STRUCTURES } from '../../game/definitions/structures.js';
import { RESEARCH_ORDER } from '../../game/definitions/research.js';
import { ITEMS } from '../../game/definitions/items/index.js';
import { formatNumber, formatDuration } from '../../game/format.js';
import { lifetimeTotals } from '../../game/run.js';
import { formatMass, formatMassFlow, formatEnergy } from '../../game/units.js';

const lifetime = computed(() => lifetimeTotals());

/**
 * How many techs there are to finish, counted rather than typed.
 *
 * It read `/ 12` in three places on this screen and a fourth on Settings. All
 * four were correct, and all four would have gone quietly wrong the first time
 * a tech was added to the ladder — a progress figure that is wrong by one is
 * the kind of thing a player notices long before a developer does, and nothing
 * in the code would have objected.
 */
const researchTotal = RESEARCH_ORDER.length;

const tiles = computed(() => [
  { label: 'This run', value: formatDuration(state.playtime) },
  { label: 'Mass ingested', value: formatMass(state.stats.ingested) },
  { label: 'Energy metabolised', value: formatEnergy(state.stats.metabolised) },
  { label: 'Manual intakes', value: formatNumber(state.stats.clicks, { notation: 'plain' }) },
  { label: 'Structures grown', value: formatNumber(state.stats.built, { notation: 'plain' }) },
  { label: 'Research complete', value: `${state.stats.researched} / ${researchTotal}` },
  { label: 'Peak drones', value: formatNumber(state.stats.peakDrones, { notation: 'plain' }) },
  { label: 'Drones starved', value: formatNumber(state.stats.dronesLost, { notation: 'plain' }) },
]);

// Only nutrients the hive can see. The others are accumulating, but the hive
// has no way to report on something it cannot detect.
const rows = computed(() =>
  [...MACROS, ...MICROS.filter((n) => isRevealed(state, n))].map((n) => ({
    n,
    name: NUTRIENTS[n].name,
    held: state.nutrients[n] || 0,
    cap: derived.value.caps[n],
    inflow: derived.value.inflow[n] || 0,
    burn: derived.value.burn[n] || 0,
    net: derived.value.net[n] || 0,
    spilled: state.spilled[n] || 0,
    energy: (state.nutrients[n] || 0) * NUTRIENTS[n].kjPerGram * 1000,
  })),
);

const intake = computed(() =>
  Object.entries(derived.value.itemFlow)
    .filter(([, g]) => g > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, grams]) => ({ name: ITEMS[id].name, grams })),
);

const built = computed(() =>
  STRUCTURE_ORDER.filter((id) => (state.structures[id] || 0) > 0).map((id) => ({
    name: STRUCTURES[id].name,
    count: state.structures[id],
  })),
);
</script>

<template>
  <div>
    <div class="stat-grid" style="margin-bottom: 0.9rem">
      <div v-for="tile in tiles" :key="tile.label" class="stat-tile">
        <div class="label">{{ tile.label }}</div>
        <div class="value">{{ tile.value }}</div>
      </div>
    </div>

    <div class="panel-box" style="margin-bottom: 0.9rem">
      <div class="panel-head">
        <span>Lifetime</span>
        <span class="muted num">
          run {{ lifetime.runs }}<template v-if="lifetime.devUsed"> · dev-touched</template>
        </span>
      </div>
      <div class="panel-body" style="overflow-x: auto">
        <p class="muted" style="font-size: 0.78rem; margin-bottom: 0.5rem">
          Totals across every run, including this one. Restarting a run keeps all of this;
          only wiping the save clears it.
        </p>
        <table class="table is-fullwidth is-narrow data-table">
          <thead>
            <tr><th>Measure</th><th class="right">This run</th><th class="right">All runs</th><th class="right">Best run</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Time</td>
              <td class="right num">{{ formatDuration(state.playtime) }}</td>
              <td class="right num">{{ formatDuration(lifetime.playtime) }}</td>
              <td class="right num">{{ formatDuration(lifetime.bestPlaytime) }}</td>
            </tr>
            <tr>
              <td>Mass consumed</td>
              <td class="right num">{{ formatMass(state.stats.ingested) }}</td>
              <td class="right num">{{ formatMass(lifetime.ingested) }}</td>
              <td class="right num muted">—</td>
            </tr>
            <tr>
              <td>Energy metabolised</td>
              <td class="right num">{{ formatEnergy(state.stats.metabolised) }}</td>
              <td class="right num">{{ formatEnergy(lifetime.metabolised) }}</td>
              <td class="right num muted">—</td>
            </tr>
            <tr>
              <td>Peak drones</td>
              <td class="right num">{{ state.stats.peakDrones }}</td>
              <td class="right num muted">—</td>
              <td class="right num">{{ lifetime.bestDrones }}</td>
            </tr>
            <tr>
              <td>Research complete</td>
              <td class="right num">{{ state.stats.researched }} / {{ researchTotal }}</td>
              <td class="right num">{{ lifetime.researched }}</td>
              <td class="right num">{{ lifetime.bestResearched }} / {{ researchTotal }}</td>
            </tr>
            <tr>
              <td>Structures grown</td>
              <td class="right num">{{ state.stats.built }}</td>
              <td class="right num">{{ lifetime.built }}</td>
              <td class="right num muted">—</td>
            </tr>
            <tr>
              <td>Drones starved</td>
              <td class="right num">{{ state.stats.dronesLost }}</td>
              <td class="right num">{{ lifetime.dronesLost }}</td>
              <td class="right num muted">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel-box" style="margin-bottom: 0.9rem">
      <div class="panel-head">
        <span>Nutrient ledger</span>
        <span class="muted">{{ rows.length }} of {{ MACROS.length + MICROS.length }} resolved</span>
      </div>
      <div class="panel-body" style="overflow-x: auto">
        <table class="table is-fullwidth is-narrow data-table">
          <thead>
            <tr>
              <th>Nutrient</th>
              <th class="right">Held</th>
              <th class="right">Capacity</th>
              <th class="right">Intake</th>
              <th class="right">Burned</th>
              <th class="right">Net</th>
              <th class="right">Energy</th>
              <th class="right">Spilled</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.n">
              <td>{{ r.name }}</td>
              <td class="right num">{{ formatMass(r.held) }}</td>
              <td class="right num muted">{{ formatMass(r.cap) }}</td>
              <td class="right num good">{{ r.inflow ? formatMassFlow(r.inflow) : '—' }}</td>
              <td class="right num bad">{{ r.burn ? formatMassFlow(-r.burn) : '—' }}</td>
              <td class="right num" :class="r.net >= 0 ? 'good' : 'bad'">{{ formatMassFlow(r.net) }}</td>
              <td class="right num">{{ r.energy ? formatEnergy(r.energy) : '—' }}</td>
              <td class="right num warn">{{ r.spilled > 0.001 ? formatMass(r.spilled) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="columns">
      <div class="column">
        <div class="panel-box">
          <div class="panel-head">
            <span>Intake stream</span>
            <span class="muted num">{{ formatMassFlow(derived.ingestRate) }}</span>
          </div>
          <div class="panel-body">
            <div v-for="row in intake" :key="row.name" class="field-row">
              <span class="field-label">{{ row.name }}</span>
              <span class="num good">{{ formatMassFlow(row.grams) }}</span>
            </div>
            <p v-if="!intake.length" class="muted">Nothing is coming in. Assign drones to intake castes.</p>
          </div>
        </div>
      </div>
      <div class="column">
        <div class="panel-box">
          <div class="panel-head"><span>Structures</span></div>
          <div class="panel-body">
            <div v-for="row in built" :key="row.name" class="field-row">
              <span class="field-label">{{ row.name }}</span>
              <span class="num">{{ row.count }}</span>
            </div>
            <p v-if="!built.length" class="muted">Nothing grown yet.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
