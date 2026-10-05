<script setup>
/**
 * Territory — what the hive holds, and what holding it means.
 *
 * Area does one job: it sets the odds. Every forage roll picks a biome weighted
 * by its share of the hive's land and then picks something from that biome, so
 * this tab is really a view of a probability distribution that happens to be
 * measured in square metres.
 *
 * The second panel is the part worth reading: for each gather type, what each
 * biome actually offers, so the consequences of a holding are visible before
 * the hive spends an hour discovering them.
 */
import { computed } from 'vue';
import { state, derived, showInCodex } from '../../game/useGame.js';
import { BIOMES, CLIMATES, holdings, totalArea, biomeShares, needsLightText } from '../../game/definitions/biomes.js';
import { squarify } from '../../game/treemap.js';
import { GATHER_TYPES, poolFor } from '../../game/definitions/forage.js';
import { ORGANISMS, preyFor } from '../../game/definitions/organisms.js';
import { ITEMS } from '../../game/definitions/items/index.js';
import { CASTES, CASTE_ORDER } from '../../game/definitions/castes.js';
import { DRONE_TYPES, foragingTypes, droneForageKey } from '../../game/definitions/drones.js';
import { describeFind } from '../../game/forage.js';
import { formatMass, formatMassFlow } from '../../game/units.js';
import { isPinned, pinHandlers } from '../../game/tips.js';
import {
  isNamed, rateLabel, rateConfidence, timesFound, preyKey, RANGE_AT, EXACT_AT,
} from '../../game/discovery.js';

const area = computed(() => totalArea(state));
const land = computed(() => holdings(state)); // already sorted largest first
const shares = computed(() => biomeShares(state));

/**
 * The holdings as a treemap. Laid out against a fixed virtual frame and then
 * expressed in percentages, so it stretches with the panel without having to
 * measure anything — the aspect ratio only has to be roughly right for the
 * tiles to come out roughly square.
 */
const FRAME = { w: 1000, h: 300 };
const tiles = computed(() =>
  squarify(land.value.map((h) => ({ id: h.id, value: h.area })), FRAME.w, FRAME.h).map((t) => {
    const def = BIOMES[t.id];
    const share = shares.value[t.id] || 0;
    // A tile too small for its own name hands the job to the legend below.
    const roomForName = t.w > 120 && t.h > 40;
    const roomForFigure = t.w > 74 && t.h > 22;
    return {
      id: t.id,
      def,
      share,
      area: t.value,
      roomForName,
      roomForFigure,
      ink: needsLightText(def.colour) ? '#eef1f5' : '#0f1113',
      inkDim: needsLightText(def.colour) ? 'rgba(238,241,245,0.78)' : 'rgba(15,17,19,0.74)',
      style: {
        left: `${(t.x / FRAME.w) * 100}%`,
        top: `${(t.y / FRAME.h) * 100}%`,
        width: `${(t.w / FRAME.w) * 100}%`,
        height: `${(t.h / FRAME.h) * 100}%`,
        background: def.colour,
      },
    };
  }),
);

/** What the selected gather type would find on one biome, for its tooltip. */
function topFinds(biomeId, limit = 4) {
  const raw =
    gather.value === 'hunter'
      ? [...preyFor(biomeId).map((p) => ({ name: ORGANISMS[p.organismId].name, weight: p.weight })),
         ...poolFor('hunter', biomeId).map((p) => ({ name: ITEMS[p.itemId].name, weight: p.weight }))]
      : poolFor(gather.value, biomeId).map((p) => ({ name: ITEMS[p.itemId].name, weight: p.weight }));
  const total = raw.reduce((a, e) => a + e.weight, 0);
  return raw
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((e) => ({ ...e, chance: total > 0 ? e.weight / total : 0 }));
}

const GATHERS = ['forager', 'scavenger', 'hunter', 'excavator', 'siphon'];
const gather = computed({
  get: () => state.ui.territoryGather || 'forager',
  set: (v) => { state.ui.territoryGather = v; },
});

/** What each held biome offers for the selected gather type, likeliest first. */
/**
 * What the ground offers — as far as the hive knows.
 *
 * The real table is complete from the first tick and the hive does not get to
 * see it. An entry it has never found shows as ??? at ?%: the player can see
 * that SOMETHING is there, and how many somethings, but not what or how often.
 * Finding it once names it everywhere; finding it ten times in this biome
 * brackets the rate; twenty-five resolves it.
 *
 * Deliberately still sorted by the TRUE rate, so the list order is itself a
 * weak hint — the hive can tell that the top of the list is commoner than the
 * bottom long before it can say by how much.
 */
const offerings = computed(() =>
  land.value.map((h) => {
    const raw =
      gather.value === 'hunter'
        ? preyFor(h.id).map((p) => ({
          id: p.organismId, key: preyKey(p.organismId),
          name: ORGANISMS[p.organismId].name, weight: p.weight, prey: true,
        }))
        : poolFor(gather.value, h.id).map((p) => ({
          id: p.itemId, key: p.itemId, name: ITEMS[p.itemId].name, weight: p.weight,
        }));
    const total = raw.reduce((a, e) => a + e.weight, 0);
    return {
      ...h,
      share: shares.value[h.id] || 0,
      entries: raw
        .map((e) => {
          const chance = total > 0 ? e.weight / total : 0;
          const named = isNamed(state, e.key);
          const seen = timesFound(state, h.id, e.key);
          const level = rateConfidence(state, h.id, e.key);
          return {
            ...e,
            chance,
            named,
            seen,
            level,
            label: named ? e.name : '???',
            rate: rateLabel(state, h.id, e.key, chance),
            // How much more work would sharpen the figure.
            toNext: level === 'unknown' ? RANGE_AT - seen : level === 'range' ? EXACT_AT - seen : 0,
          };
        })
        .sort((a, b) => b.chance - a.chance),
    };
  }),
);

/** How much of the selected ground the hive has actually worked out. */
const learned = computed(() => {
  let known = 0;
  let exact = 0;
  let total = 0;
  for (const o of offerings.value) {
    for (const e of o.entries) {
      total += 1;
      if (e.named) known += 1;
      if (e.level === 'exact') exact += 1;
    }
  }
  return { known, exact, total };
});

/**
 * What is out on the land right now — the drone types that gather, and any
 * gathering caste still left standing. Both read the same `state.forage` slots;
 * the only difference is which registry the name and the count come from.
 */
const working = computed(() => {
  const rows = [];
  for (const id of foragingTypes()) {
    const count = state.droneTypes?.[id] || 0;
    if (!count) continue;
    const key = droneForageKey(id);
    const found = describeFind(state, key);
    const flow = derived.value.forage?.[key];
    rows.push({
      id: key,
      def: DRONE_TYPES[id],
      assigned: count,
      found,
      rate: flow?.rate || 0,
      grams: flow?.grams || 0,
      empty: found.empty,
    });
  }
  for (const id of CASTE_ORDER) {
    if (!CASTES[id].gather || (state.castes[id] || 0) <= 0) continue;
    const found = describeFind(state, id);
    const flow = derived.value.forage?.[id];
    rows.push({
      id,
      def: CASTES[id],
      assigned: state.castes[id],
      found,
      rate: flow?.rate || 0,
      grams: 0,
      empty: found.empty,
    });
  }
  return rows;
});
</script>

<template>
  <div class="main-col">
    <!-- ------------------------------------------------------- the holdings -->
    <div class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Holdings</span>
        <span class="muted num">{{ area.toFixed(0) }} m²</span>
      </div>

      <div class="panel-body">
        <p class="muted" style="font-size: 0.78rem; margin: 0 0 0.5rem">
          Every time a drone goes out it picks a patch of this land at random — weighted by nothing
          but area — and brings back whatever that patch had. Half city and half forest is a coin
          flip, every time.
        </p>
      </div>

      <div v-if="!land.length" class="panel-body">
        <span class="warn" style="font-size: 0.78rem">
          The hive holds no ground. Nothing can be found anywhere.
        </span>
      </div>

      <div v-else class="panel-body">
        <!-- Every tile's AREA is its share of the next roll. No axis to read
             and no bars to compare: the biggest thing on screen is the thing
             the hive is most likely to find. -->
        <div class="terr-map">
          <div
            v-for="t in tiles"
            :key="t.id"
            class="terr-tile tip"
            :class="{ 'is-pinned': isPinned(`terr:${t.id}`) }"
            :style="t.style"
            v-on="pinHandlers(`terr:${t.id}`)"
          >
            <span v-if="t.roomForName" class="terr-tile-name" :style="{ color: t.ink }">
              {{ t.def.name }}
            </span>
            <span v-if="t.roomForFigure" class="terr-tile-figure" :style="{ color: t.inkDim }">
              {{ t.area.toFixed(0) }} m² · {{ (t.share * 100).toFixed(0) }}%
            </span>

            <span class="tip-body">
              <span class="tip-title">{{ t.def.name }}</span>
              <span class="muted" style="display: block; margin-bottom: 0.3rem">
                {{ CLIMATES[t.def.climate] }} · {{ t.def.desc }}
              </span>
              <span class="tip-row">
                <span>Held</span>
                <span>{{ t.area.toFixed(0) }} m²</span>
              </span>
              <span class="tip-row">
                <span>Share of every roll</span>
                <span>{{ (t.share * 100).toFixed(1) }}%</span>
              </span>
              <hr style="border-color: var(--border); margin: 0.3rem 0" />
              <span class="tip-title" style="font-size: 0.72rem">
                Likeliest {{ GATHER_TYPES[gather].name.toLowerCase() }} here
              </span>
              <span v-for="fnd in topFinds(t.id)" :key="fnd.name" class="tip-row">
                <span>{{ fnd.name }}</span>
                <span>{{ (fnd.chance * 100).toFixed(0) }}%</span>
              </span>
              <span v-if="!topFinds(t.id).length" class="tip-row warn">
                <span>Nothing for this caste</span><span>—</span>
              </span>
            </span>
          </div>
        </div>

        <!-- The legend carries the slivers the map has no room to label. -->
        <div class="terr-legend">
          <div v-for="h in land" :key="h.id" class="terr-key">
            <span class="terr-key-dot" :style="{ background: h.def.colour }"></span>
            <span class="terr-key-name">{{ h.def.name }}</span>
            <span class="terr-key-num num">{{ h.area.toFixed(0) }} m²</span>
            <span class="terr-key-pct num">{{ ((shares[h.id] || 0) * 100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ------------------------------------------------------- who is on what -->
    <div v-if="working.length" class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Out now</span>
        <span class="muted num">{{ working.length }}</span>
      </div>
      <div class="panel-body tight">
        <div v-for="w in working" :key="w.id" class="field-row">
          <span class="field-label">
            {{ w.def.name }} <span class="muted">×{{ w.assigned }}</span>
            <span class="field-help">
              <template v-if="w.empty">{{ w.found.label }} — nothing of this kind there.</template>
              <template v-else>
                On
                <button
                  v-if="w.found.itemId"
                  class="codex-link"
                  @click="showInCodex(w.found.itemId)"
                >{{ w.found.label.toLowerCase() }}</button>
                <strong v-else>{{ w.found.label.toLowerCase() }}</strong>
                in {{ w.found.biome.name.toLowerCase() }}.
                <template v-if="w.grams">
                  {{ formatMass(w.grams) }} each this trip; rolls again shortly.
                </template>
                <template v-else>Rolls again shortly.</template>
              </template>
            </span>
          </span>
          <span class="num" :class="w.empty ? 'bad' : 'good'">{{ formatMassFlow(w.rate) }}</span>
        </div>
      </div>
    </div>

    <!-- ----------------------------------------------------- what is out there -->
    <div class="panel-box">
      <div class="panel-head">
        <span>What the ground offers</span>
      </div>

      <div class="panel-body">
        <div class="filter-row">
          <select v-model="gather">
            <option v-for="g in GATHERS" :key="g" :value="g">{{ GATHER_TYPES[g].name }}</option>
          </select>
          <span class="muted" style="font-size: 0.76rem">{{ GATHER_TYPES[gather].desc }}</span>
        </div>
        <p class="muted" style="font-size: 0.76rem; margin: 0.4rem 0 0">
          The hive knows {{ learned.known }} of {{ learned.total }} of these by name and has the
          exact rate for {{ learned.exact }}. Everything else it has to find out by going and
          looking — a thing is named the first time it turns up anywhere, bracketed after
          {{ RANGE_AT }} finds on the same ground, and pinned down after {{ EXACT_AT }}.
        </p>
      </div>

      <div v-for="o in offerings" :key="o.id" class="panel-body tight">
        <div class="offer-head">
          <span>{{ o.def.name }}</span>
          <span class="muted num">{{ (o.share * 100).toFixed(0) }}% of the hive's land</span>
        </div>

        <div v-if="!o.entries.length" class="offer-empty warn">
          Nothing here for this caste. A drone sent out rolls this ground and comes back with
          nothing at all.
        </div>

        <div v-else class="offer-list">
          <span
            v-for="e in o.entries"
            :key="e.id"
            class="offer-chip tip"
            :class="{ 'is-pinned': isPinned(`offer:${o.id}:${e.id}`) }"
            v-on="pinHandlers(`offer:${o.id}:${e.id}`)"
          >
            <button
              v-if="!e.prey && e.named"
              class="codex-link"
              @click="showInCodex(e.id)"
            >{{ e.label }}</button>
            <span v-else :class="{ 'offer-unknown': !e.named }">{{ e.label }}</span>
            <span class="offer-pct" :class="e.level === 'exact' ? 'muted' : 'offer-vague'">
              {{ e.rate }}
            </span>

            <span class="tip-body">
              <span class="tip-title">{{ e.label }}</span>
              <span class="tip-row">
                <span>Found here</span>
                <span>{{ e.seen }}×</span>
              </span>
              <span class="tip-row">
                <span>Chance per roll here</span><span>{{ e.rate }}</span>
              </span>
              <span v-if="e.level === 'exact'" class="tip-row">
                <span>Across the whole hive</span>
                <span>{{ (e.chance * o.share * 100).toFixed(1) }}%</span>
              </span>
              <span v-if="e.toNext > 0" class="tip-row muted" style="margin-top: 0.25rem">
                <span>{{ e.level === 'unknown' ? 'Bracket the rate in' : 'Pin it down in' }}</span>
                <span>{{ e.toNext }} more</span>
              </span>
              <template v-if="e.prey">
                <hr style="border-color: var(--border); margin: 0.3rem 0" />
                <span class="muted">{{ ORGANISMS[e.id].liveMass >= 1000
                  ? `${(ORGANISMS[e.id].liveMass / 1000).toFixed(0)} kg live`
                  : `${ORGANISMS[e.id].liveMass} g live` }}, butchers into
                  {{ Object.keys(ORGANISMS[e.id].parts).length }} separate cuts.</span>
              </template>
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
