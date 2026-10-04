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
import { state } from '../../game/useGame.js';
import {
  DRONE_CASTES,
  DRONE_CASTE_ORDER,
  DRONE_TYPES,
  typesInCaste,
  unfiledTypes,
} from '../../game/definitions/drones.js';

const bands = computed(() =>
  DRONE_CASTE_ORDER.map((id) => {
    const def = DRONE_CASTES[id];
    const types = typesInCaste(id)
      .filter((tid) => DRONE_TYPES[tid].unlock(state))
      .map((tid) => ({
        id: tid,
        def: DRONE_TYPES[tid],
        count: state.droneTypes?.[tid] || 0,
      }));
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
</script>

<template>
  <div>
    <div class="notice">
      <strong>The drone system is being rebuilt.</strong>
      Castes and the types inside them are listed below, but nothing grows one yet and nothing
      they do is wired up. The hive is holding {{ total }} of them.
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
              <!-- Where the grow / assign controls will go. -->
              <span class="job-note muted">No way to grow these yet.</span>
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
