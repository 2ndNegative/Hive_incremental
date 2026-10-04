<script setup>
// The Drones tab, banded by caste.
//
// The old version of this file drove the flat caste-assignment panel — a row
// per job with +/- buttons. Every one of those castes is parked (see
// definitions/castes.js) and the model they belonged to is being replaced, so
// the panel went with them rather than sitting here rendering nothing. The
// caste DEFINITIONS survive untouched; only the screen was rewritten.
//
// What is here now takes the band from the Hive tab and the ROW from the old
// drone panel: a band per caste that folds the same way, and inside it a list
// rather than a grid of cards. A drone type is a line with a count and a
// control on the end of it — the same thing the old caste rows were — and the
// third column is left empty for the +/- that will go there.
import { computed } from 'vue';
import { state, derived } from '../../game/useGame.js';
import {
  DRONE_CASTES,
  DRONE_CASTE_ORDER,
  DRONE_TYPES,
  moldStatus,
  typesInCaste,
  unfiledTypes,
} from '../../game/definitions/drones.js';
import { toggleMolding, setMoldTarget } from '../../game/actions.js';

/** What each status reads as on the row, and what colour it is. */
const STATUS = {
  molding: { text: 'molding', tone: 'good' },
  queued: { text: 'waiting its turn', tone: 'muted' },
  'at target': { text: 'at target', tone: 'muted' },
  'no larvae': { text: 'no larvae', tone: 'bad' },
  off: { text: 'off', tone: 'muted' },
};

const bands = computed(() =>
  DRONE_CASTE_ORDER.map((id) => {
    const def = DRONE_CASTES[id];
    const types = typesInCaste(id)
      .filter((tid) => DRONE_TYPES[tid].unlock(state))
      .map((tid) => {
        const want = state.droneMolding?.[tid] ?? { on: false, target: null };
        const status = moldStatus(state, tid);
        return {
          id: tid,
          def: DRONE_TYPES[tid],
          count: state.droneTypes?.[tid] || 0,
          on: want.on,
          target: want.target,
          status,
          label: STATUS[status] ?? { text: status, tone: 'muted' },
        };
      });
    return {
      id,
      def,
      types,
      held: types.reduce((sum, t) => sum + t.count, 0),
      open: !state.ui.droneBands?.[id],
    };
  }),
);

function toggleBand(id) {
  state.ui.droneBands ??= {};
  state.ui.droneBands[id] = !state.ui.droneBands[id];
}

const unfiled = computed(() => unfiledTypes());
const total = computed(() => bands.value.reduce((sum, b) => sum + b.held, 0));

/** The molding chambers, so the tab can say why nothing is happening. */
const chambers = computed(() => derived.value.molding ?? []);
const standing = computed(() => chambers.value.reduce((n, m) => n + m.count, 0));
const rate = computed(() => derived.value.moldRate ?? 0);
const starved = computed(() => chambers.value.some((m) => m.starved));

function onTarget(id, event) {
  setMoldTarget(id, event.target.value);
}
</script>

<template>
  <div>
    <div v-if="!standing" class="notice">
      <strong>Nothing can make a drone.</strong>
      A Molding Chamber turns a larva into one of these. Without one, the switches below do
      nothing. The hive is holding {{ total }} drones.
    </div>

    <div v-else-if="starved" class="notice is-warn">
      <strong class="bad">No larvae.</strong>
      {{ standing }} Molding Chamber{{ standing === 1 ? '' : 's' }} with something to make and
      nothing to make it from, idling at the lower draw until the brood catches up. A Brood
      Chamber lays larvae out of protein.
    </div>

    <div v-else class="notice">
      <strong>{{ standing }} Molding Chamber{{ standing === 1 ? '' : 's' }}.</strong>
      <template v-if="rate > 0">
        Pressing {{ (rate * 60).toFixed(1) }} drones a minute out of the brood, one larva each,
        and drawing five times its idle power to do it.
      </template>
      <template v-else>
        Nothing is switched on, so they are idling at their lower draw. The hive is holding
        {{ total }} drones.
      </template>
    </div>

    <div class="band-stack">
      <section v-for="band in bands" :key="band.id" class="band">
        <h2 class="band-head">
          <button
            class="band-toggle"
            :aria-expanded="band.open ? 'true' : 'false'"
            :aria-controls="`caste-${band.id}`"
            @click="toggleBand(band.id)"
          >
            <span class="band-arrow" aria-hidden="true">{{ band.open ? '▾' : '▸' }}</span>
            <span class="band-name">{{ band.def.name }}</span>
            <span class="band-desc">{{ band.def.desc }}</span>
            <span class="band-count num">{{ band.held || '—' }}</span>
          </button>
        </h2>

        <div v-show="band.open" :id="`caste-${band.id}`" class="band-body is-list">
          <div v-if="!band.types.length" class="band-empty">Nothing here yet.</div>

          <template v-else>
            <div v-for="t in band.types" :key="t.id" class="job-row">
              <span>
                <span class="job-name">{{ t.def.name }}</span>
                <span class="job-desc" style="display: block">{{ t.def.desc }}</span>
              </span>
              <span class="job-count" :class="t.count > 0 ? '' : 'muted'">{{ t.count }}</span>

              <span class="mold-controls">
                <button
                  class="btn mold-toggle"
                  :class="{ 'is-active': t.on }"
                  :aria-pressed="t.on ? 'true' : 'false'"
                  @click="toggleMolding(t.id)"
                >
                  {{ t.on ? 'On' : 'Off' }}
                </button>
                <label class="mold-target">
                  <span class="muted">stop at</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="∞"
                    :value="t.target ?? ''"
                    :aria-label="`Stop making ${t.def.name} at`"
                    @change="onTarget(t.id, $event)"
                  />
                </label>
                <span class="mold-status" :class="t.label.tone">{{ t.label.text }}</span>
              </span>
            </div>
          </template>
        </div>
      </section>
    </div>

    <div v-if="unfiled.length" class="notice is-warn">
      <strong>Unfiled drone types.</strong>
      {{ unfiled.map((id) => DRONE_TYPES[id].name).join(', ') }} name no caste, so nothing lists
      them. Give each a <code>caste</code> from DRONE_CASTES.
    </div>
  </div>
</template>
