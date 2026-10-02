<script setup>
import { computed } from 'vue';
import { state, derived } from '../../game/useGame.js';
import { JOBS } from '../../game/definitions/jobs.js';
import { RESOURCES } from '../../game/definitions/resources.js';
import { assignJob, clearJobs } from '../../game/actions.js';
import { formatNumber, formatRate } from '../../game/format.js';

/** Per-worker throughput at current multipliers, for the "each" column. */
function perWorker(def) {
  const bonus = 1 + (def.mult ? derived.value.mult[def.mult] || 0 : 0);
  const parts = [];
  for (const [res, value] of Object.entries(def.outputs || {})) {
    parts.push(`+${formatNumber(value * bonus, { decimals: 2 })} ${RESOURCES[res].name}`);
  }
  for (const [res, value] of Object.entries(def.inputs || {})) {
    parts.push(`-${formatNumber(value, { decimals: 2 })} ${RESOURCES[res].name}`);
  }
  return parts.join(' · ');
}

const rows = computed(() =>
  derived.value.unlocked.jobs
    .filter((id) => JOBS[id].assignable)
    .map((id) => {
      const def = JOBS[id];
      const assigned = state.jobs[id] || 0;
      const slots = derived.value.jobSlots[id];
      const fuel = derived.value.satisfaction[`job:${id}`];
      const throttled =
        (fuel !== undefined && fuel < 0.999) ||
        (def.needsPower && derived.value.power.ratio < 0.999);
      return {
        id,
        def,
        assigned,
        slots,
        limited: Number.isFinite(slots),
        canAdd: state.jobs.unemployed > 0 && assigned < slots,
        canRemove: assigned > 0,
        each: perWorker(def),
        throttled,
      };
    }),
);

const idle = computed(() => state.jobs.unemployed || 0);
</script>

<template>
  <div>
    <div class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Workforce</span>
        <span class="muted num">
          {{ formatNumber(state.amounts.workers) }} / {{ formatNumber(derived.caps.workers) }} housed
        </span>
      </div>
      <div class="panel-body">
        <div class="field-row">
          <span class="field-label">
            Idle workers <strong class="num" :class="idle ? 'warn' : 'muted'">{{ idle }}</strong>
            <span class="field-help">
              Idle workers do nothing. Build shelters to raise the population ceiling.
            </span>
          </span>
          <button class="btn is-danger" :disabled="!rows.some((r) => r.assigned)" @click="clearJobs()">
            Unassign all
          </button>
        </div>
      </div>
    </div>

    <div class="panel-box">
      <div class="panel-head"><span>Assignments</span></div>
      <div class="panel-body tight">
        <div v-for="row in rows" :key="row.id" class="job-row">
          <span>
            <span class="job-name">{{ row.def.name }}</span>
            <span v-if="row.throttled" class="bad" style="font-size: 0.72rem">
              &nbsp;· throttled
            </span>
            <br />
            <span class="job-desc">{{ row.def.desc }} <em>Each:</em> {{ row.each }}</span>
          </span>

          <span class="job-count">
            {{ row.assigned }}<span class="muted" v-if="row.limited"> / {{ row.slots }}</span>
          </span>

          <span class="stepper">
            <button :disabled="!row.canRemove" @click="assignJob(row.id, -1)">&minus;</button>
            <button :disabled="!row.canAdd" @click="assignJob(row.id, 1)">+</button>
            <button :disabled="!row.canAdd" @click="assignJob(row.id, 10)">++</button>
          </span>
        </div>

        <div v-if="!rows.length" class="panel-body muted">No jobs available yet.</div>
      </div>
    </div>
  </div>
</template>
