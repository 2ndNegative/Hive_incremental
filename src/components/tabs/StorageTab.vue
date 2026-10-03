<script setup>
/**
 * Storage — whole matter the hive has gathered but not yet broken down.
 *
 * Deliberately not part of the nutrient panel. Nutrients are what the hive is
 * made of; this is a larder of carcasses, grass and soil waiting its turn, and
 * mixing the two lists makes both harder to read.
 *
 * It doubles as the attribution view: every row says who is bringing the matter
 * in and what it turns into, so "where is all this protein coming from" has an
 * answer that does not require reading the caste table.
 */
import { computed } from 'vue';
import { state, derived, showInCodex } from '../../game/useGame.js';
import { ITEMS, CATEGORIES, itemJoulesPerGram } from '../../game/definitions/items/index.js';
import { NUTRIENTS, MACROS, MICROS, isRevealed, itemYield } from '../../game/definitions/nutrients.js';
import { formatMass, formatMassFlow, formatEnergy } from '../../game/units.js';
import { isPinned, pinHandlers } from '../../game/tips.js';

const SORTS = {
  mass: (a, b) => b.held - a.held || b.harvest - a.harvest,
  name: (a, b) => a.name.localeCompare(b.name),
  rate: (a, b) => b.harvest - a.harvest,
  energy: (a, b) => b.perGram - a.perGram,
};

const d = computed(() => derived.value);

/** Everything currently held OR flowing, which is what the player cares about. */
const rows = computed(() => {
  const ids = new Set([
    ...Object.keys(state.items || {}),
    ...Object.keys(d.value.itemFlow),
    ...Object.keys(d.value.digestFlow),
  ]);

  const q = (state.ui.storageSearch || '').trim().toLowerCase();
  const cap = d.value.itemCap;

  const out = [];
  for (const id of ids) {
    const item = ITEMS[id];
    if (!item) continue;
    if (q && !item.name.toLowerCase().includes(q) && !item.category.includes(q)) continue;

    const held = state.items?.[id] || 0;
    out.push({
      id,
      item,
      name: item.name,
      category: CATEGORIES[item.category]?.name ?? item.category,
      held,
      cap,
      fill: cap > 0 ? Math.min(100, (held / cap) * 100) : 0,
      full: cap > 0 && held >= cap - 1e-9,
      harvest: d.value.itemFlow[id] || 0,
      digest: d.value.digestFlow[id] || 0,
      net: d.value.itemNet[id] || 0,
      spill: d.value.itemSpill[id] || 0,
      spilled: state.spilledItems?.[id] || 0,
      sources: d.value.itemSources[id] || [],
      perGram: itemJoulesPerGram(item),
    });
  }
  return out.sort(SORTS[state.ui.storageSort] ?? SORTS.mass);
});

const totals = computed(() => ({
  held: rows.value.reduce((a, r) => a + r.held, 0),
  spoiled: Object.values(state.spilledItems || {}).reduce((a, b) => a + b, 0),
  spoiling: rows.value.reduce((a, r) => a + r.spill, 0),
}));

const gutFill = computed(() => {
  const gut = d.value.digestion;
  return gut > 0 ? Math.min(100, (d.value.harvestRate / gut) * 100) : 0;
});

/**
 * What one gram of an item becomes, showing only what the hive can identify —
 * naming an unassayed compound here would hand over the micronutrient panel
 * for free and undo the point of assay research.
 */
function breakdown(id) {
  const yielded = itemYield(state, ITEMS[id].per100g, 100);
  const known = [];
  let unresolved = 0;
  for (const [n, grams] of Object.entries(yielded)) {
    if (grams <= 1e-9) continue;
    if (isRevealed(state, n)) known.push({ n, name: NUTRIENTS[n].name, grams });
    else unresolved += 1;
  }
  known.sort((a, b) => b.grams - a.grams);
  return { known: known.slice(0, 8), more: Math.max(0, known.length - 8), unresolved };
}
</script>

<template>
  <div class="main-col">
    <!-- ------------------------------------------------------------- the gut -->
    <div class="panel-box">
      <div class="panel-head">
        <span>Digestion</span>
        <span class="muted num">{{ formatMassFlow(d.digestRate) }} broken down</span>
      </div>
      <div class="panel-body">
        <p class="muted" style="font-size: 0.78rem; margin: 0 0 0.4rem">
          Castes deliver whole matter into storage. Gut tissue draws it back out and splits it into
          the nutrients it was made of — an even share of every pile, so nothing waits at the back of
          the queue. Harvest beyond what the gut can process stays in storage, and storage spoils
          once it is full.
        </p>

        <div class="data-table">
          <div class="field-row">
            <span>Gathered</span>
            <span class="num" :class="d.harvestRate > 0 ? 'good' : 'muted'">
              {{ formatMassFlow(d.harvestRate) }}
            </span>
          </div>
          <div class="field-row">
            <span>Gut capacity</span>
            <span class="num">{{ formatMassFlow(d.digestion) }}</span>
          </div>
          <div class="field-row">
            <span>Keeping up with</span>
            <span class="num" :class="d.digestRatio > 0.999 ? 'good' : 'warn'">
              {{ (d.digestRatio * 100).toFixed(0) }}% of what is stored
            </span>
          </div>
          <div class="field-row">
            <span>Held in storage</span>
            <span class="num">{{ formatMass(totals.held) }}</span>
          </div>
          <div v-if="totals.spoiling > 0" class="field-row">
            <span class="warn">Spoiling now</span>
            <span class="num bad">{{ formatMassFlow(-totals.spoiling) }}</span>
          </div>
          <div v-if="totals.spoiled > 0.001" class="field-row">
            <span class="muted">Spoiled this run</span>
            <span class="num muted">{{ formatMass(totals.spoiled) }}</span>
          </div>
        </div>

        <div class="gut-meter" :class="{ 'is-behind': d.digestRatio < 0.999 }">
          <span :style="{ width: `${gutFill}%` }" />
        </div>
        <p v-if="d.digestRatio < 0.999" class="warn" style="font-size: 0.76rem; margin: 0.4rem 0 0">
          The hive is gathering faster than it can digest. Grow more Digestive Caecums, or more Crop
          Chambers to hold the backlog until it can.
        </p>
      </div>
    </div>

    <!-- ----------------------------------------------------------- the larder -->
    <div class="panel-box">
      <div class="panel-head">
        <span>Stored matter</span>
        <span class="muted num">{{ rows.length }}</span>
      </div>

      <div class="panel-body">
        <div class="filter-row">
          <input
            v-model="state.ui.storageSearch"
            class="codex-search"
            type="text"
            placeholder="Filter stored matter…"
          />
          <select v-model="state.ui.storageSort">
            <option value="mass">Most held</option>
            <option value="rate">Fastest gathered</option>
            <option value="energy">Densest</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      <div v-if="!rows.length" class="panel-body">
        <span class="muted" style="font-size: 0.78rem">
          Nothing in storage and nothing being gathered. Assign drones to a harvesting caste and
          whatever they bring back will appear here.
        </span>
      </div>

      <div v-else class="panel-body tight">
        <div
          v-for="r in rows"
          :key="r.id"
          class="store-row tip"
          :class="{ 'is-pinned': isPinned(`store:${r.id}`) }"
          v-on="pinHandlers(`store:${r.id}`)"
        >
          <span class="store-name">
            <button class="codex-link" @click="showInCodex(r.id)">{{ r.name }}</button>
          </span>

          <span class="store-amount num">
            <span :class="{ warn: r.full }">{{ formatMass(r.held) }}</span>
            <span class="cap"> / {{ formatMass(r.cap) }}</span>
          </span>

          <!-- Throughput, not the standing balance. When the gut is keeping up
               every pile sits at zero and changes by zero, so a column showing
               only the net change reads as "nothing is happening" on a hive
               moving hundreds of grams a second. -->
          <span class="store-rate num" :class="r.harvest > 0 ? 'good' : 'muted'">
            {{ formatMassFlow(r.harvest) }}
          </span>

          <span class="store-net num" :class="r.net > 0 ? 'warn' : r.net < 0 ? 'good' : 'muted'">
            <template v-if="Math.abs(r.net) > 1e-6">
              {{ r.net > 0 ? 'piling up' : 'draining' }} {{ formatMassFlow(Math.abs(r.net)) }}
            </template>
            <template v-else-if="r.harvest > 0">keeping up</template>
          </span>

          <span class="store-bar" :class="{ 'is-full': r.full }">
            <span :style="{ width: `${r.fill}%` }" />
          </span>

          <span class="tip-body">
            <span class="tip-title">{{ r.name }}</span>
            <span class="muted" style="display: block; margin-bottom: 0.3rem">{{ r.category }}</span>

            <span class="tip-row">
              <span>Gathered</span>
              <span :class="r.harvest > 0 ? 'good' : 'muted'">{{ formatMassFlow(r.harvest) }}</span>
            </span>
            <span class="tip-row">
              <span>Digested</span>
              <span :class="r.digest > 0 ? 'good' : 'muted'">{{ formatMassFlow(-r.digest) }}</span>
            </span>
            <span v-if="r.spill > 0" class="tip-row warn">
              <span>Spoiling</span><span>{{ formatMassFlow(-r.spill) }}</span>
            </span>
            <span class="tip-row">
              <span>Energy density</span>
              <span>{{ formatEnergy(r.perGram * 1000) }}/kg</span>
            </span>

            <hr style="border-color: var(--border); margin: 0.3rem 0" />
            <span class="tip-title" style="font-size: 0.72rem">Brought in by</span>
            <span v-for="(s, i) in r.sources" :key="i" class="tip-row">
              <span>{{ s.label }}</span>
              <span class="good">{{ formatMassFlow(s.amount) }}</span>
            </span>
            <span v-if="!r.sources.length" class="tip-row muted">
              <span>Nobody — this is a standing store</span><span>—</span>
            </span>

            <hr style="border-color: var(--border); margin: 0.3rem 0" />
            <span class="tip-title" style="font-size: 0.72rem">Breaks down into, per 100 g</span>
            <span v-for="b in breakdown(r.id).known" :key="b.n" class="tip-row">
              <span>{{ b.name }}</span>
              <span>{{ formatMass(b.grams) }}</span>
            </span>
            <span v-if="breakdown(r.id).unresolved" class="tip-row muted">
              <span>+{{ breakdown(r.id).unresolved }} unresolved in this sample</span>
              <span>?</span>
            </span>

            <span v-if="r.spilled > 0.001" class="tip-row warn" style="margin-top: 0.25rem">
              <span>Spoiled this run</span><span>{{ formatMass(r.spilled) }}</span>
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
