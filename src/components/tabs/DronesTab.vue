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
import { GATHER_TYPES } from '../../game/definitions/forage.js';
import { STRUCTURES } from '../../game/definitions/structures.js';
import { NUTRIENTS, payableCost, costWasSubstituted } from '../../game/definitions/nutrients.js';
import { toggleMolding, setMoldTarget } from '../../game/actions.js';
import { formatCogits, formatMass, formatMassFlow } from '../../game/units.js';

/** What each status reads as on the row, and what colour it is. */
const STATUS = {
  molding: { text: 'molding', tone: 'good' },
  queued: { text: 'waiting its turn', tone: 'muted' },
  'at target': { text: 'at target', tone: 'muted' },
  'no larvae': { text: 'no larvae', tone: 'bad' },
  'no bandwidth': { text: 'no bandwidth', tone: 'bad' },
  off: { text: 'off', tone: 'muted' },
};

/** A mold cost as the hive can actually pay it, locked nutrients swapped out. */
function costLine(def) {
  const cost = payableCost(state, def.cost);
  const parts = Object.entries(cost).map(
    ([n, g]) => `${formatMass(g)} ${NUTRIENTS[n]?.name.toLowerCase() ?? n}`,
  );
  if (!parts.length) return null;
  return {
    text: parts.join(' + '),
    // Charged to a parent macro because the real thing is still unassayed.
    substituted: costWasSubstituted(cost),
    real: Object.keys(def.cost || {})
      .map((n) => NUTRIENTS[n]?.name.toLowerCase() ?? n)
      .join(' + '),
  };
}

const bands = computed(() =>
  DRONE_CASTE_ORDER.map((id) => {
    const def = DRONE_CASTES[id];
    const types = typesInCaste(id)
      .filter((tid) => DRONE_TYPES[tid].unlock(state))
      .map((tid) => {
        const want = state.droneMolding?.[tid] ?? { on: false, target: null };
        const status = moldStatus(state, tid, derived.value.cognition.free);
        const def = DRONE_TYPES[tid];
        const count = state.droneTypes?.[tid] || 0;
        const flow = derived.value.droneForage?.[tid];

        // What one of them costs and what one of them is for, in the type's own
        // terms rather than the hive's totals. Declared-but-unread fields stay
        // off this line: it should only ever say things that are true.
        const terms = [];
        if (def.cogitDraw) terms.push(`${formatCogits(def.cogitDraw)} cognition each`);
        if (def.load) {
          terms.push(`carries ${def.load.min}–${formatMass(def.load.max)} home a trip`);
        }
        if (def.gather && GATHER_TYPES[def.gather]) {
          terms.push(`works ${GATHER_TYPES[def.gather].desc.split(':')[0].toLowerCase()}`);
        }

        return {
          id: tid,
          def,
          count,
          on: want.on,
          target: want.target,
          status,
          label: STATUS[status] ?? { text: status, tone: 'muted' },
          terms,
          cost: costLine(def),
          cogits: (def.cogitDraw || 0) * count,
          rate: flow?.rate || 0,
          // Drones the hive is holding that its land will not carry. They cost
          // bandwidth and bring nothing back, which is worth saying out loud.
          landless: flow?.landless || 0,
          patches: flow?.open || 0,
        };
      });
    return {
      id,
      def,
      types,
      held: types.reduce((sum, t) => sum + t.count, 0),
      cogits: types.reduce((sum, t) => sum + t.cogits, 0),
      landless: types.reduce((sum, t) => sum + t.landless, 0),
      rate: types.reduce((sum, t) => sum + t.rate, 0),
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
const cogits = computed(() => bands.value.reduce((sum, b) => sum + b.cogits, 0));
const landless = computed(() => bands.value.reduce((sum, b) => sum + b.landless, 0));
const land = computed(() => derived.value.land ?? { capacity: 0, patches: 0 });
const hauling = computed(() => bands.value.reduce((sum, b) => sum + b.rate, 0));
const cognition = computed(() => derived.value.cognition);

/** The molding chambers, so the tab can say why nothing is happening. */
const chambers = computed(() => derived.value.molding ?? []);
/** What pressing costs over idling, and how much the brood is speeding it up. */
const moldDraw = computed(() => {
  const def = STRUCTURES.moldingChamber;
  return def?.upkeepWatts ? Math.round((def.activeWatts || 0) / def.upkeepWatts) : 1;
});
const pace = computed(() => chambers.value[0]?.pace ?? 1);
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
        and drawing {{ moldDraw }}× its idle power to do it.<template v-if="pace > 1.005">
        A brood this full is running it at ×{{ pace.toFixed(1) }}.</template>
      </template>
      <template v-else>
        Nothing is switched on, so they are idling at their lower draw. The hive is holding
        {{ total }} drones.
      </template>
    </div>

    <!-- What the standing drones cost the hive and what they are returning for
         it. Cognition is the binding constraint on a drone population, so it
         belongs on this screen and not only under the chip in the top bar. -->
    <div v-if="total" class="notice">
      <strong>{{ total }} drone{{ total === 1 ? '' : 's' }} standing.</strong>
      Holding {{ formatCogits(cogits) }} of the hive's {{ formatCogits(cognition.capacity) }}
      cognition<span v-if="cognition.over" class="bad"> — which is already over budget</span>.
      <template v-if="hauling > 0">
        Bringing in {{ formatMassFlow(hauling) }} across {{ land.patches }}
        patch{{ land.patches === 1 ? '' : 'es' }} of ground.
      </template>
    </div>

    <div v-if="landless > 0" class="notice is-warn">
      <strong class="bad">{{ landless.toFixed(0) }} with nowhere to work.</strong>
      The hive's land carries {{ land.capacity.toFixed(0) }} foraging
      drone{{ land.capacity === 1 ? '' : 's' }}, and it is holding more than that. They still
      cost bandwidth and still eat; they just have nowhere to go. Take more ground.
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
                <span v-if="t.terms.length" class="job-desc muted" style="display: block">
                  {{ t.terms.join(' · ') }}
                </span>
                <span v-if="t.cost" class="job-desc muted" style="display: block">
                  costs {{ t.cost.text }} a press<template v-if="t.cost.substituted">
                  — it is really built out of {{ t.cost.real }}, and the hive is shovelling the
                  parent at it until the assay is run</template>
                </span>
                <span v-if="t.count && t.rate > 0" class="job-desc good" style="display: block">
                  {{ formatMassFlow(t.rate) }} coming in across {{ t.patches }}
                  patch{{ t.patches === 1 ? '' : 'es' }}<span v-if="t.landless > 0" class="bad">
                  · {{ t.landless.toFixed(0) }} with nowhere to work</span>
                </span>
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
