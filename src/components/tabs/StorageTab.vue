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
import {
  NUTRIENTS, ASSAY_GROUPS, isRevealed, itemYield,
} from '../../game/definitions/nutrients.js';
import { formatMass, formatMassFlow, formatEnergy } from '../../game/units.js';
import { isPinned, pinHandlers } from '../../game/tips.js';

const SORTS = {
  mass: (a, b) => b.held - a.held || b.harvest - a.harvest,
  name: (a, b) => a.name.localeCompare(b.name),
  rate: (a, b) => b.harvest - a.harvest,
  energy: (a, b) => b.perGram - a.perGram,
};

const d = computed(() => derived.value);

/**
 * WHAT A BREAKDOWN DEPENDS ON — AND WHY IT IS CACHED RATHER THAN RECOMPUTED.
 *
 * What 100 g of an item turns into is decided by exactly two things: the item's
 * composition, which is frozen at module load and can never change, and which
 * assays the hive has run, which changes five times in an entire game. It does
 * not depend on how much is held, what is flowing, or anything else the 100 ms
 * tick moves — so recomputing it per render is pure waste, and the waste was
 * large: `itemYield` is a 35-key scan plus a 28-micro loop with a nested parent
 * walk, and the tooltip asked for it three times per row for text nobody is
 * looking at. Forty rows at ten renders a second was tens of thousands of
 * iterations a second.
 *
 * The cache is keyed on the item AND the five assay flags rather than being
 * cleared when research lands. A stale breakdown is the one failure mode here
 * that would be invisible rather than loud: it would either name compounds the
 * player has not assayed yet — handing over the micronutrient panel for free,
 * which is the whole point of assay research — or keep hiding ones they have
 * just paid for. Folding the flags into the key makes that unrepresentable
 * instead of relying on somebody remembering to invalidate.
 */
const BREAKDOWNS = new Map();

/** The five assay flags as a string, cheap enough to rebuild per recompute. */
function assaySignature() {
  let sig = '';
  for (const assay of ASSAY_GROUPS) sig += state.tech[assay.id] ? '1' : '0';
  return sig;
}

/**
 * What one sample of an item becomes, showing only what the hive can identify —
 * naming an unassayed compound here would hand over the micronutrient panel
 * for free and undo the point of assay research.
 */
function breakdownOf(id, assays) {
  const key = `${id}\u0000${assays}`;
  const hit = BREAKDOWNS.get(key);
  if (hit) return hit;

  const yielded = itemYield(state, ITEMS[id].per100g, 100);
  const known = [];
  let unresolved = 0;
  for (const [n, grams] of Object.entries(yielded)) {
    if (grams <= 1e-9) continue;
    if (isRevealed(state, n)) known.push({ n, name: NUTRIENTS[n].name, grams });
    else unresolved += 1;
  }
  known.sort((a, b) => b.grams - a.grams);
  const out = { known: known.slice(0, 8), more: Math.max(0, known.length - 8), unresolved };
  BREAKDOWNS.set(key, out);
  return out;
}

/** Everything currently held OR flowing, which is what the player cares about. */
const rows = computed(() => {
  const ids = new Set([
    ...Object.keys(state.items || {}),
    ...Object.keys(d.value.itemFlow),
    ...Object.keys(d.value.digestFlow),
  ]);

  const q = (state.ui.storageSearch || '').trim().toLowerCase();
  // The larder is one sac, so a row's bar is its SHARE of what is in there,
  // not a fill against a cap of its own. Every row reading "180 g / 500 g" when
  // the five of them together are what fills the 500 g was the old lie.
  const total = Object.values(state.items || {}).reduce((a, b) => a + (b || 0), 0);

  const assays = assaySignature();
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
      share: total > 0 ? Math.min(100, (held / total) * 100) : 0,
      harvest: d.value.itemFlow[id] || 0,
      digest: d.value.digestFlow[id] || 0,
      net: d.value.itemNet[id] || 0,
      spill: d.value.itemSpill[id] || 0,
      spilled: state.spilledItems?.[id] || 0,
      sources: d.value.itemSources[id] || [],
      perGram: itemJoulesPerGram(item),
      breakdown: breakdownOf(id, assays),
    });
  }
  return out.sort(SORTS[state.ui.storageSort] ?? SORTS.mass);
});

const totals = computed(() => ({
  held: rows.value.reduce((a, r) => a + r.held, 0),
  spoiled: Object.values(state.spilledItems || {}).reduce((a, b) => a + b, 0),
  spoiling: rows.value.reduce((a, r) => a + r.spill, 0),
}));

/** How full the shared larder is. */
const larder = computed(() => {
  const cap = d.value.itemCap;
  const held = d.value.itemHeld ?? totals.value.held;
  return {
    cap,
    held,
    fill: cap > 0 ? Math.min(100, (held / cap) * 100) : 0,
    full: d.value.itemFull,
    none: cap <= 0,
  };
});

const gutFill = computed(() => {
  const gut = d.value.digestion;
  return gut > 0 ? Math.min(100, (d.value.harvestRate / gut) * 100) : 0;
});

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
          Drones deliver whole matter into the larder. Gut tissue draws it back out and splits it
          into the nutrients it was made of — an even share of every pile, so nothing waits at the
          back of the queue. The hive is born with no gut at all: without one, everything gathered
          sits here until the larder is full and then spoils where it lies.
        </p>

        <div v-if="!d.digestion" class="notice is-warn" style="margin: 0 0 0.5rem">
          <strong class="bad">No gut.</strong>
          Nothing the hive has built can break raw matter down, so none of this is reaching the
          stores. Grow a Digestive Caecum — it costs no energy to run.
        </div>

        <div class="data-table">
          <div class="field-row">
            <span>Gathered</span>
            <span class="num" :class="d.harvestRate > 0 ? 'good' : 'muted'">
              {{ formatMassFlow(d.harvestRate) }}
            </span>
          </div>
          <div class="field-row">
            <span>Gut capacity</span>
            <span class="num" :class="d.digestion > 0 ? '' : 'bad'">
              {{ formatMassFlow(d.digestion) }}
            </span>
          </div>
          <div class="field-row">
            <span>Keeping up with</span>
            <span class="num" :class="d.digestRatio > 0.999 ? 'good' : 'warn'">
              {{ (d.digestRatio * 100).toFixed(0) }}% of what is stored
            </span>
          </div>
          <div class="field-row">
            <span>Larder</span>
            <span class="num" :class="larder.full ? 'bad' : larder.none ? 'bad' : ''">
              {{ formatMass(larder.held) }} / {{ formatMass(larder.cap) }}
            </span>
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

        <!-- How full the sac itself is, which is the thing that decides whether
             the next gram gathered is kept or thrown away. -->
        <div class="store-bar" :class="{ 'is-full': larder.full }" style="margin-top: 0.4rem">
          <span :style="{ width: `${larder.fill}%` }" />
        </div>

        <p v-if="larder.none" class="warn" style="font-size: 0.76rem; margin: 0.4rem 0 0">
          Nowhere to put anything. The hive holds no raw matter at all until something is built that
          can hold it.
        </p>
        <p
          v-else-if="d.digestRatio < 0.999"
          class="warn"
          style="font-size: 0.76rem; margin: 0.4rem 0 0"
        >
          The hive is gathering faster than it can digest. Grow more Digestive Caecums, or a Crop
          Chamber to hold the backlog until it can.
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
          Nothing in the larder and nothing being gathered. Mold a Forager and whatever it brings
          back will appear here.
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
            <span :class="{ warn: larder.full }">{{ formatMass(r.held) }}</span>
            <span class="cap"> · {{ r.share.toFixed(0) }}%</span>
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

          <span class="store-bar" :class="{ 'is-full': larder.full }">
            <span :style="{ width: `${r.share}%` }" />
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
            <span v-for="b in r.breakdown.known" :key="b.n" class="tip-row">
              <span>{{ b.name }}</span>
              <span>{{ formatMass(b.grams) }}</span>
            </span>
            <span v-if="r.breakdown.unresolved" class="tip-row muted">
              <span>+{{ r.breakdown.unresolved }} unresolved in this sample</span>
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
