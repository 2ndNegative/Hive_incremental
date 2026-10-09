<script setup>
import { computed } from 'vue';
import { state, derived } from '../../game/useGame.js';
import {
  STRUCTURES,
  BUILDING_CATEGORIES,
  BUILDING_CATEGORY_ORDER,
  maxLevelOf,
} from '../../game/definitions/structures.js';
import { NUTRIENTS } from '../../game/definitions/nutrients.js';
import { CASTES } from '../../game/definitions/castes.js';
import {
  structureCost, canAfford, etaFor,
  buildQueueCap, queuedCount, queueRoom, inFlightCount,
  buildSecondsFor, buildProgress,
} from '../../game/engine.js';
import {
  setActive, adjustActive, abandonBuild,
  queueBuild, unqueueBuild, moveQueued, clearBuildQueue,
} from '../../game/actions.js';
import { formatMass, formatMassFlow, formatPower, formatCogits } from '../../game/units.js';
import { formatEta } from '../../game/format.js';
import CostList from '../CostList.vue';

const BUY_OPTIONS = [1, 5, 25, 'max'];

/**
 * WHAT A BUILDING DOES, WORKED OUT ONCE PER BUILDING AND NEVER AGAIN.
 *
 * `effectLines` reads nothing but `STRUCTURES[id]`, which is frozen at module
 * load — so its answer for a given id is the same answer for the whole life of
 * the page. It was being recomputed for all sixteen cards on every render,
 * which the 100 ms tick makes ten times a second: a dozen Object.entries walks
 * and ten or so formatted strings per card, to arrive at exactly the text that
 * was already on screen.
 *
 * Filled lazily rather than eagerly at load, because the cards a hive can see
 * are a small and growing subset of the table — a hive that has never unlocked
 * a Hivecore should not pay to describe one.
 *
 * `cycleOf` on the same line looks like it belongs here and does NOT: it reads
 * `derived.brood` and `derived.molding` and its countdown has to move with the
 * tick. Caching it would freeze every chamber bar on the page.
 */
const EFFECTS = new Map();

function effectsFor(id) {
  let lines = EFFECTS.get(id);
  if (lines === undefined) {
    lines = effectLines(STRUCTURES[id]);
    EFFECTS.set(id, lines);
  }
  return lines;
}

function effectLines(def) {
  const lines = [];
  if (def.caps?.drones) lines.push(`+${def.caps.drones} drone capacity`);
  for (const [group, value] of Object.entries(def.capMult || {})) {
    const label = { bulk: 'macronutrient', mineral: 'mineral', vitamin: 'vitamin' }[group] ?? group;
    lines.push(`+${Math.round(value * 100)}% ${label} storage`);
  }
  if (def.throughput) lines.push(`+${formatPower(def.throughput)} metabolic ceiling`);
  if (def.insightCap) lines.push(`+${def.insightCap} insight storage`);
  if (def.insight) lines.push(`+${def.insight}/s insight`);
  if (def.cogitCapacity) lines.push(`+${formatCogits(def.cogitCapacity)} cognition`);
  if (def.cogitDraw) lines.push(`${formatCogits(def.cogitDraw)} cognition occupied`);
  if (def.metabolism) lines.push(`metabolises ${formatMassFlow(def.metabolism)} into energy`);
  if (def.digestion) lines.push(`breaks down ${formatMassFlow(def.digestion)} of raw matter`);
  if (def.brood) {
    const cost = Object.entries(def.brood.cost)
      .map(([n, g]) => `${formatMass(g)} ${NUTRIENTS[n]?.name.toLowerCase() ?? n}`)
      .join(' + ');
    lines.push(
      `${def.brood.yield ?? 1} larva every ${def.brood.seconds}s, for ${cost} an attempt`,
    );
  }
  // Only a building in the Storage band says what it holds. Everywhere else
  // room is a quiet side effect of having grown something — the Hivecore
  // bringing a body with it is not what the player is choosing to build it for.
  if (def.category === 'storage') {
    if (def.generalStorage) {
      lines.push(`+${formatMass(def.generalStorage)} general storage`);
    }
    if (def.itemStorage) {
      lines.push(`+${formatMass(def.itemStorage)} raw matter storage`);
    }
    for (const [n, grams] of Object.entries(def.storage || {})) {
      lines.push(`+${formatMass(grams)} ${NUTRIENTS[n]?.name.toLowerCase() ?? n} storage`);
    }
  }
  for (const [caste, value] of Object.entries(def.slots || {})) {
    lines.push(`+${value} ${CASTES[caste]?.name ?? caste} slot`);
  }
  for (const [channel, value] of Object.entries(def.mult || {})) {
    lines.push(`+${Math.round(value * 100)}% ${CASTES[channel]?.name ?? channel} output`);
  }
  if (def.molding) {
    lines.push(`1 larva into 1 drone every ${def.molding.seconds}s`);
  }
  if (def.upkeepWatts) {
    lines.push(
      def.activeWatts
        ? `${formatPower(def.upkeepWatts)} idle, ${formatPower(def.activeWatts)} working`
        : `${formatPower(def.upkeepWatts)} upkeep`,
    );
  }
  return lines;
}

const cards = computed(() =>
  derived.value.unlocked.structures.map((id) => {
    const def = STRUCTURES[id];
    const want = state.ui.buyAmount;
    const owned = state.structures[id] || 0;
    // What is already promised — lined up, or on the bench being grown. A level
    // that is paid for and growing is a level the hive is going to have, so it
    // counts against the ceiling exactly as a finished one does.
    const promised = inFlightCount(state, id);
    const headroom = maxLevelOf(id) - owned - promised;
    const room = queueRoom(state);
    // 'max' means FILL THE QUEUE, not "spend everything". Nothing is instant any
    // more, so the limit that matters is how many jobs the hive can hold in mind
    // rather than how many the larder could pay for in one go.
    const count = Math.max(0, Math.min(headroom, room, want === 'max' ? room : want));
    // THE COST OF ONE, whatever the build amount says. Each job in the queue is
    // paid for on its own when it starts, so the hive never needs five lots at
    // once and quoting the sum of five would be asking for mass that is not
    // actually required.
    const cost = structureCost(state, id, 1);
    const maxed = maxLevelOf(id) - owned - promised <= 0;
    const affordable = !maxed && canAfford(state, cost);
    const power = derived.value.power?.[id] ?? { charge: 1, direction: 'steady', secondsLeft: 0 };
    const running = power.running ?? owned;
    return {
      id,
      def,
      owned,
      running,
      idle: owned - running,
      power,
      // Only worth saying anything when it is not simply running.
      ailing: owned > 0 && (power.direction !== 'steady'),
      leveled: Boolean(def.leveled),
      maxed,
      // A levelled structure reads as what it would become, not how many of it
      // you would end up with.
      action: def.leveled
        ? (maxed ? 'At maximum level' : `Upgrade to level ${owned + promised + Math.max(1, count)}`)
        : null,
      count,
      cost,
      affordable,
      // How many of this are already promised, so the card can say so without
      // the player having to read the strip at the top and match names.
      queued: promised,
      eta: affordable ? null : formatEta(etaFor(state, derived.value, cost)),
      // How long the next one takes, at the pace the hive is managing now. This
      // MOVES — a brood hatching shortens every figure on the page — which is
      // the whole point of pace-seconds. See definitions/times.js rule 4.
      grow: formatEta(buildSecondsFor(state, id, derived.value.buildPace)),
      effects: effectsFor(id),
      cycle: cycleOf(id),
    };
  }),
);

/**
 * Where a chamber is in its cycle, for the bar on its card.
 *
 * Progress is held per STRUCTURE, not per unit — three Brood Chambers push one
 * shared cycle three times as fast rather than running three staggered ones —
 * so one bar per card is the honest picture. The time left divides by the units
 * actually working, which is why the number drops when a second chamber comes
 * up and stretches when one browns out.
 */
function cycleOf(id) {
  const brood = (derived.value.brood ?? []).find((b) => b.id === id);
  const mold = (derived.value.molding ?? []).find((m) => m.id === id);
  const job = brood ?? mold;
  if (!job || !job.count) return null;

  // A full brood works faster, so the countdown has to know about it — see
  // engine.js larvaPace. The bar itself is unaffected; only how fast it fills.
  const working = (job.units || 0) * (job.pace || 1);
  const progress = Math.max(0, Math.min(1, job.progress || 0));

  // Nothing is turning, so there is no countdown to give. Saying "Larva in 0s"
  // under a dark chamber is the worst of both: it reads as imminent and it is
  // the one thing that is definitely not about to happen.
  if (working <= 0) {
    return { progress, label: 'Dark — nothing is turning', stalled: true };
  }

  const left = ((1 - progress) * job.seconds) / working;
  const stalled = brood ? !brood.affordable : !mold.active;
  const pace = job.pace || 1;

  let label;
  if (brood) {
    label = brood.affordable
      ? `${brood.yield > 1 ? `${brood.yield} larvae` : 'Larva'} in ${Math.ceil(left)}s`
      : 'Short of protein — this attempt will be lost';
  } else if (mold.active) {
    label = `${mold.makesName ?? 'Drone'} in ${Math.ceil(left)}s`;
  } else if (mold.broke) {
    label = `Cannot pay for a ${(mold.makesName ?? 'drone').toLowerCase()}`;
  } else if (mold.starved) {
    label = 'Waiting on a larva';
  } else {
    label = 'Nothing switched on';
  }

  return { progress, label, stalled, pace };
}

/**
 * The Hive tab is banded by what a building is FOR, and each band folds. Bands
 * show even when empty: an empty Cognition band answers "where does thinking
 * come from" better than no band at all, and during the rebuild that is most
 * of what this screen has to say.
 */
const bands = computed(() =>
  BUILDING_CATEGORY_ORDER.map((id, index) => {
    const def = BUILDING_CATEGORIES[id];
    const mine = cards.value.filter((c) => c.def.category === id);
    return {
      id,
      def,
      cards: mine,
      // Bands are the power queue, so each one knows its own place in it — and
      // says so when something inside it is in trouble, even folded shut.
      rank: index + 1,
      short: mine.filter((c) => c.owned > 0 && !c.power.satisfied).length,
      ailing: mine.filter((c) => c.ailing).length,
      open: !state.ui.buildBands?.[id],
    };
  }),
);

/**
 * How a building's power state reads on its card.
 *
 * A building no longer simply dies when it is short — it settles at the share
 * of its upkeep it is actually getting — so the line has to say both where it
 * is now and where it is heading.
 */
function powerLine(card) {
  const pct = Math.round(card.power.charge * 100);
  const target = Math.round(card.power.target * 100);
  const secs = Math.max(1, Math.ceil(card.power.secondsLeft));

  if (card.power.direction === 'holding') {
    // Settled. Saying "holding at 51% output on 51% of its upkeep" is true and
    // useless — of course the two agree, that IS the rule. What the player
    // cannot see anywhere else is the watts, so that is what this says.
    return target > 0
      ? `Browned out — ${formatPower(card.power.delivered)} of the ` +
          `${formatPower(card.power.watts)} it wants, so it runs at ${pct}%`
      : 'Dark. Nothing is reaching it at all.';
  }
  if (card.power.direction === 'failing') {
    return target > 0
      ? `Losing power — ${pct}% output, settling at ${target}% in ${secs}s`
      : `Losing power — ${pct}% output, dark in ${secs}s`;
  }
  return target >= 100
    ? `Coming back — ${pct}% output, full in ${secs}s`
    : `Coming back — ${pct}% output, levelling at ${target}% in ${secs}s`;
}

function toggleBand(id) {
  state.ui.buildBands ??= {};
  state.ui.buildBands[id] = !state.ui.buildBands[id];
}

/* --------------------------------------------------------------- the queue */

const queue = computed(() =>
  (state.buildQueue || []).map((entry, index) => {
    const def = STRUCTURES[entry.id];
    const cost = structureCost(state, entry.id, 1);
    return {
      index,
      id: entry.id,
      n: entry.n,
      name: def?.name ?? entry.id,
      leveled: Boolean(def?.leveled),
      cost,
      // Only the head is ever being paid for, so only the head has a waiting
      // time. Saying "in 4m" against everything behind it would be a lie: the
      // third thing in the queue is not 4 minutes away, it is however long the
      // two in front of it take plus its own.
      affordable: canAfford(state, cost),
      // formatEta gives null when nothing is coming in at all, and "affordable
      // in" followed by a blank is the worst possible answer — it reads as a
      // broken figure rather than as "nothing is arriving to pay for this".
      eta: formatEta(etaFor(state, derived.value, cost)),
    };
  }),
);

/**
 * What the hive is growing right now, if anything.
 *
 * Separate from the queue above because it IS separate: the job has left the
 * queue, it is paid for, and the only things left to say about it are how far
 * through it is and whether to give up on it.
 */
const job = computed(() => buildProgress(state, derived.value.buildPace));

const queueCap = computed(() => buildQueueCap(state));
const queueUsed = computed(() => queuedCount(state));
const queueFree = computed(() => queueRoom(state));

/** How much faster than a hive with no brood at all. Worth saying when it is. */
const paceNote = computed(() => {
  const pace = derived.value.buildPace || 0;
  return pace > 1.005 ? `×${pace.toFixed(1)} on this hive's pace` : null;
});

/** Buildings whose category is missing or unknown — a rebuild tripwire. */
const unfiled = computed(() => cards.value.filter((c) => !BUILDING_CATEGORIES[c.def.category]));

const starving = computed(() => derived.value.energy.ratio < 0.999);
const throttled = computed(() => derived.value.energy.throughputRatio < 0.999);

/** The buildings not getting their full upkeep, best-placed first. */
const failing = computed(() =>
  cards.value
    .filter((c) => c.owned > 0 && !c.power.satisfied)
    .sort((a, b) => a.power.priority - b.power.priority),
);

const overCapacity = computed(() =>
  cards.value.filter((card) =>
    Object.entries(card.cost).some(([n, amount]) => amount > (derived.value.caps[n] ?? Infinity)),
  ),
);
</script>

<template>
  <div>
    <div v-if="starving" class="notice is-warn">
      <strong class="bad">Energy deficit.</strong>
      The hive is running at {{ Math.floor(derived.energy.ratio * 100) }}% of demand
      <template v-if="throttled">
        — the generators are making {{ formatPower(derived.energy.generated) }} against
        {{ formatPower(derived.energy.demand) }} of demand. Grow more Metabolic Generators, or
        the pool will run dry.
      </template>
      <template v-else>
        — the pool is empty. Nothing converts stored matter into usable energy except a Metabolic
        Generator.
      </template>
      <div style="margin-top: 0.35rem">
        What there is goes to the drones first, then band by band down this page. Of what is left,
        <template v-if="failing.length">
          <strong class="bad">{{ failing.map((c) => c.def.name).join(', ') }}</strong>
          {{ failing.length === 1 ? 'is' : 'are' }} short, and will settle at
          {{ failing.map((c) => `${Math.round(c.power.target * 100)}%`).join(' / ') }} of
          {{ failing.length === 1 ? 'its' : 'their' }} output. A building runs at whatever share
          of its upkeep it is paid — it only goes dark when nothing reaches it.
        </template>
        <template v-else>every building is still being paid for.</template>
      </div>
    </div>

    <div v-else-if="overCapacity.length" class="notice is-warn">
      <strong>Storage too small.</strong>
      {{ overCapacity.map((c) => c.def.name).join(', ') }} costs more than the hive can hold.
      Nothing in the Storage band is big enough for it yet.
    </div>

    <div class="field-row">
      <span class="field-label" title="How many a press lines up in the queue">
        Line up
      </span>
      <div class="stepper">
        <button
          v-for="option in BUY_OPTIONS"
          :key="option"
          class="btn"
          style="width: auto; height: auto"
          :class="{ 'is-active': state.ui.buyAmount === option }"
          @click="state.ui.buyAmount = option"
        >
          {{ option === 'max' ? 'Max' : `×${option}` }}
        </button>
      </div>
    </div>

    <!-- What the hive is growing, and what it has been told to grow next.
         Strictly in order: the head waits until it can be paid for rather than
         letting cheaper things behind it jump the line, so this reads top to
         bottom as a plan. One job at a time, which is what makes the order
         mean anything. -->
    <div class="queue-strip">
      <div class="queue-head">
        <span class="queue-title">Construction</span>
        <span class="num queue-cap" :class="{ warn: queueFree === 0 }">
          {{ queueUsed }} / {{ queueCap }}
        </span>
        <span v-if="paceNote" class="queue-pace muted">{{ paceNote }}</span>
        <button v-if="queue.length" class="queue-clear" @click="clearBuildQueue()">clear</button>
      </div>

      <!-- The one on the bench. Paid for already, so the only figures that
           matter are how far through it is and how long is left. -->
      <div v-if="job" class="queue-job" :class="{ 'is-stalled': job.stalled }">
        <span class="job-name">
          Growing {{ job.name }}<span v-if="job.leveled" class="muted"> · upgrade</span>
        </span>
        <span class="cycle-bar job-bar">
          <span :style="{ width: `${job.progress * 100}%` }" />
        </span>
        <span class="job-left num" :class="job.stalled ? 'bad' : 'ok'">
          <template v-if="job.stalled">stalled — the hive has stopped</template>
          <template v-else-if="formatEta(job.seconds)">{{ formatEta(job.seconds) }} left</template>
          <template v-else>finishing</template>
        </span>
        <button class="btn switch-btn" title="Give up on it. The mass goes back."
                @click="abandonBuild()">✕</button>
      </div>

      <div v-if="!queue.length && !job" class="queue-empty muted">
        Nothing being grown. Press a building below and the hive will start it the moment it can
        pay for it — the queue spends nothing until a job actually begins, and takes them in the
        order you set. Nothing is instant: a bag goes up in a couple of minutes, a mind takes
        half an hour.
      </div>

      <ol v-else-if="queue.length" class="queue-list">
        <li v-for="(q, i) in queue" :key="`${q.id}-${i}`" class="queue-item"
            :class="{ 'is-head': i === 0 && !job }">
          <span class="queue-pos num">{{ i + 1 }}</span>
          <span class="queue-name">
            {{ q.name }}<span v-if="q.n > 1" class="muted"> ×{{ q.n }}</span>
          </span>
          <span class="queue-state" :class="q.affordable ? 'ok' : 'muted'">
            <template v-if="i > 0">waiting its turn</template>
            <template v-else-if="job && q.affordable">next, once this one is done</template>
            <template v-else-if="job">next — affordable in {{ q.eta || '—' }}</template>
            <template v-else-if="q.affordable">starting now</template>
            <template v-else-if="q.eta">affordable in {{ q.eta }}</template>
            <template v-else>nothing coming in to pay for it</template>
          </span>
          <button class="btn switch-btn" :disabled="i === 0"
                  title="Move it up the queue" @click="moveQueued(i, -1)">↑</button>
          <button class="btn switch-btn" :disabled="i === queue.length - 1"
                  title="Move it down the queue" @click="moveQueued(i, 1)">↓</button>
          <button class="btn switch-btn" title="Take one off"
                  @click="unqueueBuild(i, q.n === 1)">−</button>
        </li>
      </ol>
    </div>

    <div class="band-stack">
      <section v-for="band in bands" :key="band.id" class="band">
        <h2 class="band-head">
          <button
            class="band-toggle"
            :aria-expanded="band.open ? 'true' : 'false'"
            :aria-controls="`band-${band.id}`"
            @click="toggleBand(band.id)"
          >
            <span class="band-arrow" aria-hidden="true">{{ band.open ? '▾' : '▸' }}</span>
            <span class="band-name">{{ band.def.name }}</span>
            <span class="band-desc">
              <span v-if="band.short" class="bad">
                {{ band.short }} short of power
              </span>
              <span v-else-if="band.ailing" class="warn">
                {{ band.ailing }} coming back up
              </span>
              <template v-else>{{ band.def.desc }}</template>
            </span>
            <span class="band-count num">{{ band.cards.length || '—' }}</span>
          </button>
        </h2>

        <div v-show="band.open" :id="`band-${band.id}`" class="band-body">
          <div v-if="!band.cards.length" class="band-empty">Nothing here yet.</div>

          <div v-else class="action-grid">
            <div v-for="card in band.cards" :key="card.id" class="action-slot">
            <!-- Pressing a card LINES IT UP. There is no instant build any
                 more, so an unaffordable card is still a legal thing to ask
                 for — the queue is what waits for the mass. What stops a press
                 is a full queue or a structure that has nowhere left to go. -->
            <button
              class="action-card"
              :class="{ 'is-affordable': card.affordable, 'has-switch': card.owned > 0 }"
              :disabled="card.count <= 0"
              :title="card.maxed
                ? 'Nothing left to build here'
                : queueFree <= 0
                  ? `The queue is full at ${queueCap}`
                  : `Line up ${card.count} to grow when the hive can pay`"
              @click="queueBuild(card.id, state.ui.buyAmount)"
            >
              <span class="action-head">
                <span class="action-name">
                  {{ card.def.name }}
                  <span v-if="!card.leveled && card.count > 1" class="muted">×{{ card.count }}</span>
                </span>
                <span class="action-count">
                  <template v-if="card.leveled">Lv {{ card.owned }}</template>
                  <template v-else>{{ card.owned }}</template>
                </span>
              </span>
              <span class="action-desc">{{ card.def.desc }}</span>
              <span
                v-if="card.ailing"
                class="action-power"
                :class="{
                  bad: card.power.direction === 'failing',
                  warn: card.power.direction === 'holding',
                  good: card.power.direction === 'recovering',
                }"
              >
                <span class="power-bar" :class="card.power.direction">
                  <span :style="{ width: `${card.power.charge * 100}%` }" />
                </span>
                {{ powerLine(card) }}
              </span>
              <!-- Where its cycle is. A chamber is the only thing on this
                   screen that is doing something over time rather than simply
                   being on, so it is the only thing with a bar. -->
              <span v-if="card.cycle" class="action-cycle" :class="{ 'is-stalled': card.cycle.stalled }">
                <span class="cycle-bar">
                  <span :style="{ width: `${card.cycle.progress * 100}%` }" />
                </span>
                <span class="cycle-label">
                  {{ card.cycle.label }}<span v-if="card.cycle.pace > 1.005" class="muted">
                  · ×{{ card.cycle.pace.toFixed(1) }} on a full brood</span>
                </span>
              </span>
              <span v-if="card.action" class="action-upgrade" :class="{ muted: card.maxed }">
                {{ card.action }}
              </span>
              <CostList :cost="card.cost" />
              <span class="effect-list">{{ card.effects.join(' · ') }}</span>
              <!-- Cost and time, in that order and in that visual weight:
                   cost is what gates the build, time is only texture. -->
              <span v-if="card.grow" class="action-grow muted">
                {{ card.grow }} to grow<template v-if="card.eta"> · affordable in {{ card.eta }}</template>
              </span>
              <span v-else-if="card.eta" class="action-desc" style="margin-bottom: 0">
                affordable in {{ card.eta }}
              </span>
            </button>

            <div v-if="card.queued" class="queue-row">
              <span class="queue-mine num">{{ card.queued }} promised</span>
            </div>

            <!-- Switching buildings off is the way back out of overbuilding
                 something that eats. Outside the card, because the card is
                 itself a button. -->
            <div v-if="card.owned > 0" class="switch-row" :class="{ 'is-idle': card.idle > 0 }">
              <template v-if="card.leveled">
                <!-- "Running" alone under a browned-out building reads as a
                     contradiction, so a levelled one says what it is running
                     AT whenever that is not everything. -->
                <span class="switch-label">
                  <template v-if="card.running <= 0">Shut down</template>
                  <template v-else-if="card.power.charge < 0.995">
                    Running at <strong class="num warn">{{ Math.round(card.power.charge * 100) }}%</strong>
                  </template>
                  <template v-else>Running</template>
                </span>
                <button
                  class="btn switch-btn is-wide"
                  @click="setActive(card.id, card.running > 0 ? 'none' : 'all')"
                >
                  {{ card.running > 0 ? 'Shut down' : 'Start up' }}
                </button>
              </template>

              <template v-else>
                <span class="switch-label">
                  <strong class="num">{{ card.running }}</strong> of {{ card.owned }} active
                  <span v-if="card.idle > 0" class="muted">· {{ card.idle }} idle</span>
                </span>
                <button class="btn switch-btn" :disabled="card.running <= 0"
                        @click="setActive(card.id, 'none')" title="Idle all of them">0</button>
                <button class="btn switch-btn" :disabled="card.running <= 0"
                        @click="adjustActive(card.id, -1)" title="Idle one of them">−</button>
                <button class="btn switch-btn" :disabled="card.running >= card.owned"
                        @click="adjustActive(card.id, 1)" title="Run one more">+</button>
                <button class="btn switch-btn" :disabled="card.running >= card.owned"
                        @click="setActive(card.id, 'all')" title="Run all of them">All</button>
              </template>
            </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-if="unfiled.length" class="notice is-warn">
      <strong>Unfiled buildings.</strong>
      {{ unfiled.map((c) => c.def.name).join(', ') }} name no band, so nothing lists them. Give
      each a <code>category</code> from BUILDING_CATEGORIES.
    </div>
  </div>
</template>
