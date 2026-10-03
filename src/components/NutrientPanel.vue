<script setup>
import { computed, ref } from 'vue';
import { state, derived, showInCodex } from '../game/useGame.js';
import { NUTRIENTS, MACROS, MICROS, ASSAY_GROUPS, isRevealed } from '../game/definitions/nutrients.js';
import { formatMass, formatMassFlow, formatEnergy } from '../game/units.js';
import { consumeBiomass, MANUAL_INTAKE, manualOdds } from '../game/actions.js';
import { ITEMS } from '../game/definitions/items/index.js';
import { isPinned, pinHandlers } from '../game/tips.js';
import { BIOMES, holdings, totalArea } from '../game/definitions/biomes.js';

const collapsed = ref({});
function toggle(key) {
  collapsed.value[key] = !collapsed.value[key];
}

function row(id) {
  const def = NUTRIENTS[id];
  const amount = state.nutrients[id] ?? 0;
  const cap = derived.value.caps[id];
  const rate = derived.value.net[id] ?? 0;
  return {
    id,
    def,
    amount,
    cap,
    rate,
    full: cap > 0 && amount >= cap - 1e-9,
    fill: cap > 0 ? Math.min(100, (amount / cap) * 100) : 0,
    energy: amount * def.kjPerGram * 1000,
    sources: (derived.value.flowSources[id] ?? []).map((s) => ({
      ...s,
      // Who is bringing this item in. This is the second link of the chain:
      // protein came from beef, and the beef came from eleven hunters working
      // deer. Without it the player can see the what but never the who.
      from: s.itemId ? derived.value.itemSources[s.itemId] ?? [] : [],
    })),
    spilled: state.spilled[id] ?? 0,
  };
}

// Groups appear only once their assay is done. Before that the nutrients are
// accumulating all the same — there is simply nothing in the interface to say so.
const groups = computed(() => {
  const out = [{ key: 'bulk', name: 'Macronutrients', rows: MACROS.map(row) }];
  for (const assay of ASSAY_GROUPS) {
    if (!state.tech[assay.id]) continue;
    const ids = MICROS.filter((id) => NUTRIENTS[id].group === assay.id);
    out.push({ key: assay.id, name: assay.name, rows: ids.map(row) });
  }
  return out;
});

const hiddenCount = computed(() => MICROS.filter((id) => !isRevealed(state, id)).length);

/**
 * A click no longer means a known mouthful. The drone picks up whatever is
 * within reach on the hive's own land, so the tooltip shows the distribution
 * rather than a result — and the last find is shown under the button, because
 * a log line per click would bury everything else in the log.
 */
const odds = computed(() => manualOdds(6));
const land = computed(() => holdings(state));
const area = computed(() => totalArea(state));

const lastGather = computed(() => {
  const last = state.lastGather;
  if (!last) return null;
  return {
    name: last.itemId ? ITEMS[last.itemId].name : null,
    itemId: last.itemId,
    biome: last.biomeId ? BIOMES[last.biomeId] : null,
    grams: last.grams,
  };
});
</script>

<template>
  <div class="panel-box">
    <div class="panel-head">
      <span>Stores</span>
      <span class="muted num">{{ state.drones }} drones</span>
    </div>

    <div class="panel-body">
      <span class="tip tip-side" style="display: block">
        <button class="gather-btn" @click="consumeBiomass()">Consume biomass</button>
        <span class="tip-body">
          <span class="tip-title">{{ formatMass(MANUAL_INTAKE.grams) }} of whatever is to hand</span>
          <span class="muted" style="display: block; margin-bottom: 0.3rem">
            A drone picks up what it can reach on the hive's
            {{ area.toFixed(0) }} m² and eats it where it stands. What it finds depends on the
            ground.
          </span>
          <span v-for="o in odds" :key="o.itemId" class="tip-row">
            <span>{{ o.name }}</span>
            <span>{{ (o.chance * 100).toFixed(0) }}%</span>
          </span>
          <span v-if="!odds.length" class="tip-row warn">
            <span>No land, nothing within reach</span><span>—</span>
          </span>
        </span>
      </span>

      <div v-if="lastGather" class="last-gather">
        <template v-if="lastGather.name">
          Last: {{ formatMass(lastGather.grams) }}
          <button class="codex-link" @click="showInCodex(lastGather.itemId)">
            {{ lastGather.name.toLowerCase() }}
          </button>
          <span class="muted">· {{ lastGather.biome.name.toLowerCase() }}</span>
        </template>
        <span v-else class="warn">Found nothing.</span>
      </div>
    </div>

    <div v-for="group in groups" :key="group.key">
      <button class="group-head" @click="toggle(group.key)">
        <span>{{ collapsed[group.key] ? '▸' : '▾' }} {{ group.name }}</span>
        <span class="muted">{{ group.rows.length }}</span>
      </button>

      <div v-show="!collapsed[group.key]" class="panel-body tight">
        <div
          v-for="r in group.rows"
          :key="r.id"
          class="res-row tip tip-side"
          :class="{ 'is-pinned': isPinned(`nutrient:${r.id}`) }"
          v-on="pinHandlers(`nutrient:${r.id}`)"
        >
          <span class="res-name">{{ r.def.name }}</span>

          <span class="res-amount num">
            <span :class="{ warn: r.full }">{{ formatMass(r.amount) }}</span>
            <span class="cap"> / {{ formatMass(r.cap) }}</span>
          </span>

          <span
            v-if="r.rate !== 0 || state.settings.showZeroFlows"
            class="res-rate num"
            :class="r.rate > 0 ? 'good' : r.rate < 0 ? 'bad' : 'muted'"
          >
            {{ formatMassFlow(r.rate) }}
          </span>

          <span class="res-bar" :class="{ 'is-full': r.full }">
            <span :style="{ width: `${r.fill}%` }" />
          </span>

          <span class="tip-body">
            <span class="tip-title">{{ r.def.name }}</span>
            <span class="muted" style="display: block; margin-bottom: 0.3rem">{{ r.def.desc }}</span>
            <span class="tip-row">
              <span>Energy density</span>
              <span>{{ r.def.kjPerGram ? `${r.def.kjPerGram} kJ/g` : 'none' }}</span>
            </span>
            <span class="tip-row">
              <span>Energy held</span>
              <span :class="r.energy > 0 ? 'good' : 'muted'">{{ formatEnergy(r.energy) }}</span>
            </span>
            <span v-if="r.def.fuelRequires && !state.tech[r.def.fuelRequires]" class="tip-row warn">
              <span>Locked</span><span>needs {{ r.def.fuelRequires }}</span>
            </span>
            <hr style="border-color: var(--border); margin: 0.3rem 0" />
            <span v-for="(s, i) in r.sources" :key="i" class="tip-row">
              <!-- An item source nests a tooltip of its own, naming the castes
                   behind it. Reachable only once this tooltip is pinned, which
                   is what makes it hoverable. -->
              <span v-if="s.itemId" class="tip">
                <span class="tip-link">{{ s.label }}</span>
                <span class="tip-body">
                  <span class="tip-title">{{ s.label }}</span>
                  <span class="muted" style="display: block; margin-bottom: 0.3rem">
                    {{ formatMassFlow(s.amount) }} of {{ NUTRIENTS[r.id].name.toLowerCase() }} comes
                    out of this.
                  </span>
                  <span v-for="(f, j) in s.from" :key="j" class="tip-row">
                    <span>{{ f.label }}</span>
                    <span class="good">{{ formatMassFlow(f.amount) }}</span>
                  </span>
                  <span v-if="!s.from.length" class="tip-row muted">
                    <span>Drawn from storage, not being gathered</span><span>—</span>
                  </span>
                  <span class="tip-row" style="margin-top: 0.25rem">
                    <span>
                      <button class="codex-link" @click="showInCodex(s.itemId)">Open in Codex</button>
                    </span>
                    <span />
                  </span>
                </span>
              </span>
              <span v-else>{{ s.label }}</span>
              <span :class="s.amount > 0 ? 'good' : 'bad'">{{ formatMassFlow(s.amount) }}</span>
            </span>
            <span v-if="!r.sources.length" class="tip-row muted"><span>No flow</span><span>—</span></span>
            <span v-if="r.spilled > 0.001" class="tip-row warn">
              <span>Lost to overflow</span><span>{{ formatMass(r.spilled) }}</span>
            </span>
            <span v-if="r.sources.some((s) => s.itemId)" class="tip-hint">
              {{
                isPinned(`nutrient:${r.id}`)
                  ? 'Pinned — hover a source for its own sources, Escape to release'
                  : 'Middle-click to pin, then hover a source to see where it comes from'
              }}
            </span>
          </span>
        </div>
      </div>
    </div>

    <div v-if="hiddenCount" class="panel-body">
      <span class="muted" style="font-size: 0.76rem">
        {{ hiddenCount }} compound{{ hiddenCount === 1 ? '' : 's' }} in the intake stream remain
        unresolved. Assay research will tell you what they are.
      </span>
    </div>
  </div>
</template>
