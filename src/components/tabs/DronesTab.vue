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
import { describeFind, expectedYield } from '../../game/forage.js';
import { GATHER_TYPES } from '../../game/definitions/forage.js';
import { isPinned, pinHandlers } from '../../game/tips.js';

/**
 * What a caste is currently on. There is no fixed yield any more — a forager
 * finds whatever the ground it rolled had — so the row shows the find rather
 * than a promise, and the energy figure beside it is an average over everything
 * it could have rolled instead.
 */
function findFor(id) {
  return describeFind(state, id);
}

/** Expected energy return per drone, averaged across the hive's territory. */
function netLine(id) {
  const def = CASTES[id];
  const gained = expectedYield(state, id, NUTRIENTS, state.tech, derived.value.efficiency);
  return gained - (def.workWatts + BASAL_WATTS);
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
        gathers: Boolean(def.gather),
        found: def.gather ? findFor(id) : null,
        net: netLine(id),
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
              · net {{ formatPower(r.net) }}<span class="muted"> avg</span>
            </span>
            <span v-else-if="r.gathers" class="bad" style="font-size: 0.74rem">
              · net {{ formatPower(r.net) }}<span class="muted"> avg</span>
            </span>
            <br />
            <span class="job-desc">
              {{ r.def.desc }}
              <template v-if="r.gathers">
                <em>{{ GATHER_TYPES[r.def.gather].name }}</em>,
                {{ formatMassFlow(r.def.harvestRate) }} per drone.
                <template v-if="r.found.empty">
                  <span class="warn">{{ r.found.label }}.</span>
                </template>
                <template v-else>
                  Currently on
                  <button
                    v-if="r.found.itemId"
                    class="codex-link"
                    @click="showInCodex(r.found.itemId)"
                  >{{ r.found.label.toLowerCase() }}</button>
                  <strong v-else>{{ r.found.label.toLowerCase() }}</strong>
                  in {{ r.found.biome.name.toLowerCase() }}.
                </template>
              </template>
              <template v-else-if="r.def.insight">Yields +{{ r.def.insight }}/s insight.</template>
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
