<script setup>
import { computed } from 'vue';
import { state, derived, showInCodex } from '../../game/useGame.js';
import { CASTES, BASAL_WATTS } from '../../game/definitions/castes.js';
import { NUTRIENTS } from '../../game/definitions/nutrients.js';
import { ITEMS } from '../../game/definitions/items/index.js';
import { ORGANISMS } from '../../game/definitions/organisms.js';
import { assignCaste, clearCastes } from '../../game/actions.js';
import { DRONE_PROTEIN_COST } from '../../game/engine.js';
import { formatMass, formatMassFlow, formatPower, formatEnergy } from '../../game/units.js';
import { isPinned, pinHandlers } from '../../game/tips.js';

/**
 * What one drone in this caste brings in per second, as parts rather than a
 * string, so every name it mentions can link to its codex entry. A caste's
 * yields are the one place the player meets these items by name, and following
 * them to the full composition should not mean searching the Codex by hand.
 */
function harvestParts(def) {
  const parts = [];
  for (const [itemId, grams] of Object.entries(def.harvest || {})) {
    parts.push({ kind: 'item', itemId, name: ITEMS[itemId].name, rate: formatMassFlow(grams) });
  }
  if (def.organism && def.harvestRate) {
    const org = ORGANISMS[def.organism];
    parts.push({
      kind: 'organism',
      organism: def.organism,
      name: org.name,
      rate: formatMassFlow(def.harvestRate),
      // Prey is not a codex entry of its own; the cuts it butchers into are.
      cuts: Object.entries(org.parts)
        .sort((a, b) => b[1] - a[1])
        .map(([itemId, fraction]) => ({
          itemId,
          name: ITEMS[itemId].name,
          grams: def.harvestRate * fraction,
        })),
    });
  }
  if (def.insight) parts.push({ kind: 'insight', name: `+${def.insight}/s insight` });
  return parts;
}

/** Energy value of what one drone brings in, minus what it costs to run. */
function netLine(def) {
  let joulesPerSecond = 0;
  const addItem = (itemId, grams) => {
    const item = ITEMS[itemId];
    for (const n of Object.keys(item.per100g)) {
      if (!NUTRIENTS[n].fuel) continue;
      if (NUTRIENTS[n].fuelRequires && !state.tech[NUTRIENTS[n].fuelRequires]) continue;
      joulesPerSecond +=
        ((item.per100g[n] * grams) / 100) * NUTRIENTS[n].kjPerGram * 1000 * derived.value.efficiency[n];
    }
  };
  for (const [itemId, grams] of Object.entries(def.harvest || {})) addItem(itemId, grams);
  if (def.organism && def.harvestRate) {
    const org = ORGANISMS[def.organism];
    for (const [itemId, fraction] of Object.entries(org.parts)) {
      addItem(itemId, def.harvestRate * fraction);
    }
  }
  return joulesPerSecond - (def.workWatts + BASAL_WATTS);
}

const rows = computed(() =>
  derived.value.unlocked.castes
    .filter((id) => CASTES[id].assignable)
    .map((id) => {
      const def = CASTES[id];
      const assigned = state.castes[id] || 0;
      const slots = derived.value.slots[id];
      return {
        id,
        def,
        assigned,
        slots,
        limited: Number.isFinite(slots),
        canAdd: state.castes.dormant > 0 && assigned < slots,
        canRemove: assigned > 0,
        harvest: harvestParts(def),
        net: netLine(def),
        watts: def.workWatts + BASAL_WATTS,
      };
    }),
);

const dormant = computed(() => state.castes.dormant || 0);
const growthPercent = computed(() => Math.floor((state.growth || 0) * 100));
</script>

<template>
  <div>
    <div class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Population</span>
        <span class="muted num">{{ state.drones }} / {{ derived.droneCap }}</span>
      </div>
      <div class="panel-body">
        <div class="field-row">
          <span class="field-label">
            Dormant <strong class="num" :class="dormant ? 'warn' : 'muted'">{{ dormant }}</strong>
            <span class="field-help">
              Every drone draws {{ formatPower(BASAL_WATTS) }} whether it works or not. Idle drones
              are a pure loss.
            </span>
          </span>
          <button class="btn is-danger" :disabled="!rows.some((r) => r.assigned)" @click="clearCastes()">
            Recall all
          </button>
        </div>
        <div class="field-row">
          <span class="field-label">
            Next drone
            <span class="field-help">
              Grown from {{ formatMass(DRONE_PROTEIN_COST) }} of protein.
              <template v-if="derived.growthRate > 0">{{ growthPercent }}% complete.</template>
              <template v-else-if="state.drones >= derived.droneCap">Capacity reached — grow a Nerve Node.</template>
              <template v-else-if="(state.nutrients.protein || 0) < DRONE_PROTEIN_COST">Not enough protein.</template>
              <template v-else>Stalled: energy demand is not being met.</template>
            </span>
          </span>
          <span class="res-bar" style="width: 120px">
            <span :style="{ width: `${growthPercent}%` }" />
          </span>
        </div>
      </div>
    </div>

    <div class="panel-box">
      <div class="panel-head"><span>Castes</span></div>
      <div class="panel-body tight">
        <div v-for="r in rows" :key="r.id" class="job-row">
          <span>
            <span class="job-name">{{ r.def.name }}</span>
            <span class="muted" style="font-size: 0.74rem"> · {{ formatPower(r.watts) }}/drone</span>
            <span v-if="r.net > 0" class="good" style="font-size: 0.74rem">
              · net {{ formatPower(r.net) }}
            </span>
            <span v-else-if="r.def.harvest || r.def.organism" class="bad" style="font-size: 0.74rem">
              · net {{ formatPower(r.net) }}
            </span>
            <br />
            <span class="job-desc">
              {{ r.def.desc }}
              <em>Yields:</em>&nbsp;
              <template v-if="!r.harvest.length">nothing</template>
              <template v-for="(part, i) in r.harvest" :key="i">
                <span v-if="i" class="muted"> · </span>
                <template v-if="part.kind === 'item'">
                  {{ part.rate }}
                  <button class="codex-link" @click="showInCodex(part.itemId)">{{ part.name }}</button>
                </template>
                <template v-else-if="part.kind === 'organism'">
                  {{ part.rate }} live
                  <span
                    class="tip"
                    :class="{ 'is-pinned': isPinned(`prey:${r.id}`) }"
                    v-on="pinHandlers(`prey:${r.id}`)"
                  >
                    <span class="tip-link">{{ part.name }}</span>
                    <span class="tip-body">
                      <span class="tip-title">{{ part.name }}, butchered</span>
                      <span class="muted" style="display: block; margin-bottom: 0.3rem">
                        What one drone recovers per second. Any of these opens in the Codex.
                      </span>
                      <span v-for="cut in part.cuts" :key="cut.itemId" class="tip-row">
                        <span>
                          <button class="codex-link" @click="showInCodex(cut.itemId)">{{ cut.name }}</button>
                        </span>
                        <span>{{ formatMassFlow(cut.grams) }}</span>
                      </span>
                      <span class="tip-hint">
                        {{ isPinned(`prey:${r.id}`) ? 'Pinned — Escape to release' : 'Middle-click to pin' }}
                      </span>
                    </span>
                  </span>
                </template>
                <template v-else>{{ part.name }}</template>
              </template>
            </span>
          </span>

          <span class="job-count">
            {{ r.assigned }}<span class="muted" v-if="r.limited"> / {{ r.slots }}</span>
          </span>

          <span class="stepper">
            <button :disabled="!r.canRemove" @click="assignCaste(r.id, -1)">&minus;</button>
            <button :disabled="!r.canAdd" @click="assignCaste(r.id, 1)">+</button>
            <button :disabled="!r.canAdd" @click="assignCaste(r.id, 10)">++</button>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
