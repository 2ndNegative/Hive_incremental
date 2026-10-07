<script setup>
import { computed } from 'vue';
import { state, derived } from '../../game/useGame.js';
import { ITEMS, ITEM_IDS, CATEGORIES, itemJoulesPerGram } from '../../game/definitions/items/index.js';
import { ORGANISMS, ORGANISM_IDS, butcherYield } from '../../game/definitions/organisms.js';
import {
  NUTRIENTS, NUTRIENT_IDS, MACROS, MICROS, isRevealed,
} from '../../game/definitions/nutrients.js';
import { isNamed } from '../../game/discovery.js';
import { formatMass, formatEnergy } from '../../game/units.js';
import { FORAGE, GATHER_TYPES } from '../../game/definitions/forage.js';
import { BIOMES } from '../../game/definitions/biomes.js';

const SORTS = {
  name: (a, b) => ITEMS[a].name.localeCompare(ITEMS[b].name),
  energy: (a, b) => itemJoulesPerGram(ITEMS[b]) - itemJoulesPerGram(ITEMS[a]),
  protein: (a, b) => (ITEMS[b].per100g.protein || 0) - (ITEMS[a].per100g.protein || 0),
  fat: (a, b) => (ITEMS[b].per100g.fat || 0) - (ITEMS[a].per100g.fat || 0),
};

/**
 * WHAT THE HIVE HAS ACTUALLY MET.
 *
 * The codex is a record of what this colony has found, not a catalogue of
 * everything that exists. An item appears the first time it turns up anywhere —
 * the same moment it stops reading as ??? on the Territory tab — and until then
 * the hive has no word for it and nothing to file. That is the whole reason
 * discovery exists; a codex that listed all two hundred from the first tick
 * would hand the player the answer to a question the game is asking.
 */
const known = computed(() => ITEM_IDS.filter((id) => isNamed(state, id)));

const categories = computed(() => {
  const present = new Set(known.value.map((id) => ITEMS[id].category));
  return ['all', ...Object.keys(CATEGORIES).filter((c) => present.has(c))];
});

/**
 * Nutrients the search can match on: every macro, and every micro whose assay
 * is done. Searching "iron" before the Trace Metal Assay finds nothing, which
 * is correct — the hive cannot pick iron out of the mineral mass yet, so it has
 * no way to know which of its finds carry it.
 */
const searchableNutrients = computed(() =>
  NUTRIENT_IDS.filter((n) => isRevealed(state, n)).map((n) => ({
    id: n,
    name: NUTRIENTS[n].name.toLowerCase(),
  })),
);

const results = computed(() => {
  const q = state.ui.codexSearch.trim().toLowerCase();
  // Which nutrients the query names. "fat" matches the macro; "ethanol" matches
  // the one nutrient; "vitamin" matches the lot of them.
  const wanted = q ? searchableNutrients.value.filter((n) => n.name.includes(q)) : [];
  return known.value.filter((id) => {
    const item = ITEMS[id];
    if (state.ui.codexCategory !== 'all' && item.category !== state.ui.codexCategory) return false;
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q)
      || item.category.includes(q)
      || item.tags.some((t) => t.includes(q))
      // By what is IN it: searching a nutrient lists everything that carries
      // any of it, which is the question a player actually has — "where do I
      // get ethanol" rather than "what is ethanol".
      || wanted.some((n) => (item.per100g[n.id] || 0) > 0)
    );
  }).sort(SORTS[state.ui.codexSort] ?? SORTS.name);
});

/** Which nutrients the current query matched, so the list can say so. */
const matchedNutrients = computed(() => {
  const q = state.ui.codexSearch.trim().toLowerCase();
  if (!q) return [];
  return searchableNutrients.value
    .filter((n) => n.name.includes(q))
    .map((n) => NUTRIENTS[n.id].name);
});

// A save can carry a selection the hive no longer has a name for — a wipe, or a
// run that reset discovery — so the detail pane checks rather than trusting it.
const selected = computed(() => {
  const id = state.ui.selectedItem;
  if (!id || !ITEMS[id] || !isNamed(state, id)) return null;
  return ITEMS[id];
});

/** Macro rows always show. Micro rows appear only once their assay is done. */
const composition = computed(() => {
  const item = selected.value;
  if (!item) return { macros: [], micros: [], unresolved: 0 };
  const macros = MACROS.filter((n) => (item.per100g[n] || 0) > 0).map((n) => ({
    n,
    def: NUTRIENTS[n],
    grams: item.per100g[n],
    energy: item.per100g[n] * NUTRIENTS[n].kjPerGram * 1000,
  }));
  const micros = MICROS.filter((n) => isRevealed(state, n) && (item.per100g[n] || 0) > 0).map((n) => ({
    n,
    def: NUTRIENTS[n],
    grams: item.per100g[n],
  }));
  const unresolved = MICROS.filter((n) => !isRevealed(state, n) && (item.per100g[n] || 0) > 0).length;
  return { macros, micros, unresolved };
});

const preyFor = computed(() =>
  ORGANISM_IDS.filter((oid) => state.ui.selectedItem && ORGANISMS[oid].parts[state.ui.selectedItem]),
);

const perKg = computed(() => (selected.value ? itemJoulesPerGram(selected.value) * 1000 : 0));

/**
 * Where this turns up and who can collect it. The whole forage table is in the
 * game but invisible until the player happens to roll something, so the codex
 * is where it gets stated outright.
 */
const whereFound = computed(() => {
  const entry = FORAGE[state.ui.selectedItem];
  if (!entry) return null;
  return {
    gather: entry.gather.map((g) => GATHER_TYPES[g].name),
    huntedOnly: entry.gather.includes('hunter') && !Object.keys(entry.biomes).length,
    biomes: Object.entries(entry.biomes)
      .sort((a, b) => b[1] - a[1])
      .map(([id, weight]) => ({ id, name: BIOMES[id].name, weight })),
  };
});

const COVERAGE_LABEL = {
  full: 'full panel sourced',
  partial: 'notable micronutrients only — blanks mean unknown, not zero',
  macroOnly: 'macronutrients only — treat every micronutrient as unknown',
};
const CONFIDENCE_LABEL = {
  high: 'standard reference table',
  medium: 'published but variable between samples',
  low: 'order-of-magnitude estimate',
  model: 'game abstraction, not a measurement',
};
</script>

<template>
  <div>
    <div class="codex-controls">
      <input
        class="codex-search"
        type="search"
        placeholder="Search by name, category, tag or what is in it…"
        v-model="state.ui.codexSearch"
      />
      <select class="fuel-select" v-model="state.ui.codexCategory">
        <option v-for="c in categories" :key="c" :value="c">
          {{ c === 'all' ? 'All categories' : CATEGORIES[c].name }}
        </option>
      </select>
      <select class="fuel-select" v-model="state.ui.codexSort">
        <option value="name">By name</option>
        <option value="energy">By energy density</option>
        <option value="protein">By protein</option>
        <option value="fat">By fat</option>
      </select>
    </div>

    <div class="codex-split">
      <div class="panel-box codex-list">
        <div class="panel-head">
          <span>Catalogue</span>
          <span class="muted">
            <template v-if="results.length === known.length">{{ known.length }} known</template>
            <template v-else>{{ results.length }} of {{ known.length }}</template>
          </span>
        </div>
        <!-- When the query named a nutrient, say so: otherwise a search for
             "ethanol" returning nine things with no ethanol in their NAME looks
             like the filter is broken. -->
        <p v-if="matchedNutrients.length" class="muted codex-hint">
          …and anything containing {{ matchedNutrients.join(', ').toLowerCase() }}.
        </p>
        <div class="panel-body tight">
          <button
            v-for="id in results"
            :key="id"
            class="codex-row"
            :class="{ 'is-selected': state.ui.selectedItem === id }"
            @click="state.ui.selectedItem = id"
          >
            <span class="codex-row-name">{{ ITEMS[id].name }}</span>
            <span class="muted num">{{ formatEnergy(itemJoulesPerGram(ITEMS[id]) * 1000) }}/kg</span>
          </button>
          <!-- Two different emptinesses, and conflating them is how a new
               player concludes the tab is broken. -->
          <p v-if="!known.length" class="muted" style="padding: 0.6rem">
            The hive has not met anything yet. Send drones out, or press Consume biomass — a
            thing is named here the first time it turns up anywhere.
          </p>
          <p v-else-if="!results.length" class="muted" style="padding: 0.6rem">
            Nothing the hive knows matches that. It has met {{ known.length }} things so far.
          </p>
        </div>
      </div>

      <div class="panel-box codex-detail">
        <template v-if="selected">
          <div class="panel-head">
            <span>{{ selected.name }}</span>
            <span class="muted">{{ CATEGORIES[selected.category].name }}</span>
          </div>
          <div class="panel-body">
            <div class="stat-grid" style="margin-bottom: 0.7rem">
              <div class="stat-tile">
                <div class="label">Energy per kg</div>
                <div class="value">{{ formatEnergy(perKg) }}</div>
              </div>
              <div class="stat-tile">
                <div class="label">Water</div>
                <div class="value">{{ (selected.per100g.water || 0).toFixed(1) }}%</div>
              </div>
            </div>

            <p v-if="selected.note" class="notice">{{ selected.note }}</p>

            <table class="table is-fullwidth is-narrow data-table">
              <thead>
                <tr>
                  <th>Macronutrient</th>
                  <th class="right">per 100 g</th>
                  <th class="right">per kg</th>
                  <th class="right">energy/kg</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in composition.macros" :key="m.n">
                  <td>{{ m.def.name }}</td>
                  <td class="right num">{{ m.grams.toFixed(2) }} g</td>
                  <td class="right num">{{ formatMass(m.grams * 10) }}</td>
                  <td class="right num" :class="m.energy > 0 ? 'good' : 'muted'">
                    {{ m.energy > 0 ? formatEnergy(m.energy * 10) : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>

            <template v-if="composition.micros.length">
              <table class="table is-fullwidth is-narrow data-table" style="margin-top: 0.6rem">
                <thead>
                  <tr>
                    <th>Micronutrient</th>
                    <th class="right">per 100 g</th>
                    <th class="right">per kg</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in composition.micros" :key="m.n">
                    <td>{{ m.def.name }}</td>
                    <td class="right num">{{ formatMass(m.grams) }}</td>
                    <td class="right num">{{ formatMass(m.grams * 10) }}</td>
                  </tr>
                </tbody>
              </table>
            </template>

            <p v-if="composition.unresolved" class="notice is-warn" style="margin-top: 0.6rem">
              {{ composition.unresolved }} further compound{{ composition.unresolved === 1 ? '' : 's' }}
              detected in this material but not yet resolved. The hive absorbs them regardless.
            </p>

            <div v-if="whereFound" class="field-row">
              <span class="field-label">
                Collected by
                <span class="field-help">
                  {{ whereFound.gather.join(', ') }}.
                  <template v-if="whereFound.huntedOnly">
                    Reachable only through prey — nothing is lying about to pick up.
                  </template>
                </span>
              </span>
            </div>

            <div v-if="whereFound && whereFound.biomes.length" class="field-row">
              <span class="field-label">
                Found in
                <span class="field-help">
                  {{ whereFound.biomes.map((b) => `${b.name} (${b.weight})`).join(', ') }} —
                  higher numbers are commoner within that biome, not across them.
                </span>
              </span>
            </div>

            <div v-if="preyFor.length" class="field-row">
              <span class="field-label">
                Butchered from
                <span class="field-help">
                  {{ preyFor.map((o) => `${ORGANISMS[o].name} (${(ORGANISMS[o].parts[state.ui.selectedItem] * 100).toFixed(1)}% of live mass)`).join(', ') }}
                </span>
              </span>
            </div>

            <div class="field-row">
              <span class="field-label">
                Provenance
                <span class="field-help">
                  {{ selected.source }} · {{ CONFIDENCE_LABEL[selected.confidence] }} ·
                  {{ COVERAGE_LABEL[selected.coverage] }}
                </span>
              </span>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="panel-head"><span>Select an item</span></div>
          <div class="panel-body">
            <p class="muted">
              Everything the hive can ingest, with the composition it yields. Macronutrients are
              listed for every item from the start; micronutrients appear here only once the
              matching assay has been researched — which does not stop the hive absorbing them in
              the meantime.
            </p>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
