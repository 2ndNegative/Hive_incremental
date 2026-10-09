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
import { computed, ref } from 'vue';
import { state, derived, showInCodex } from '../../game/useGame.js';
import {
  BIOMES, CLIMATES, holdings, totalArea, biomeShares, needsLightText,
  isDangerous, colonisationBlock,
} from '../../game/definitions/biomes.js';
import { squarify } from '../../game/treemap.js';
import { FORAGERS_PER_SQUARE_METRE, AREA_PER_PATCH } from '../../game/definitions/biomes.js';
import { GATHER_TYPES, poolFor } from '../../game/definitions/forage.js';
import { ORGANISMS, preyFor } from '../../game/definitions/organisms.js';
import { ITEMS } from '../../game/definitions/items/index.js';
import { DRONE_TYPES } from '../../game/definitions/drones.js';
import { describeSlot } from '../../game/forage.js';
import { formatMass, formatMassFlow, formatArea } from '../../game/units.js';
import {
  claimCost, claimableArea, claimTerritory, abandonTerritory, DANGEROUS_CLAIM_MULTIPLIER,
} from '../../game/actions.js';
import { NUTRIENTS, substitutedEntries } from '../../game/definitions/nutrients.js';
import { isPinned, pinHandlers } from '../../game/tips.js';
import {
  isStarred, isStarrable, starsFor, toggleStar, clearStars, focusedOdds, focusStrength,
  FOCUS_SHARE,
} from '../../game/focus.js';
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
/**
 * Ground an Explorer has mapped but the hive has not paid for, largest first.
 * It sits on the SAME treemap as the holdings — a patch of unclaimed forest is
 * next to the forest it was found from, which is the whole point of it — but
 * hatched, dimmed and labelled, because it is not doing anything yet.
 */
const mapped = computed(() =>
  Object.entries(state.unclaimed || {})
    .filter(([, area]) => area > 0)
    .map(([id, area]) => ({
      id,
      def: BIOMES[id],
      area,
      dangerous: isDangerous(id),
      blocked: colonisationBlock(state, id),
    }))
    .sort((a, b) => b.area - a.area),
);

const tiles = computed(() =>
  squarify(
    [
      ...land.value.map((h) => ({ id: h.id, value: h.area })),
      ...mapped.value.map((m) => ({ id: `unclaimed:${m.id}`, value: m.area })),
    ],
    FRAME.w,
    FRAME.h,
  ).map((t) => {
    const unclaimed = t.id.startsWith('unclaimed:');
    const biomeId = unclaimed ? t.id.slice('unclaimed:'.length) : t.id;
    const def = BIOMES[biomeId];
    const share = unclaimed ? 0 : shares.value[biomeId] || 0;
    // A tile too small for its own name hands the job to the legend below.
    const roomForName = t.w > 120 && t.h > 40;
    const roomForFigure = t.w > 74 && t.h > 22;
    return {
      id: t.id,
      biomeId,
      unclaimed,
      dangerous: unclaimed && isDangerous(biomeId),
      blocked: unclaimed ? colonisationBlock(state, biomeId) : null,
      def,
      share,
      area: t.value,
      // Worked out HERE rather than called from the template, for two reasons.
      // It was `topFinds(t.id)` down there, and for a mapped tile `t.id` is
      // "unclaimed:forest" rather than a biome — so every hatched tile reported
      // that the ground offers nothing at all, which is the one tooltip a
      // player reads before deciding whether to pay for it. And the template
      // called it twice per tile, each call walking the whole forage table, on
      // every one of the ten renders a second.
      finds: topFinds(biomeId),
      roomForName,
      roomForFigure,
      // A tooltip on a tile at the right-hand edge of the map opens off the
      // side of the window — and the tiles at that edge are the smallest ones,
      // which are exactly the ones a player needs the tooltip to read. So the
      // right-hand half of the map hangs its tooltips the other way.
      tipRight: t.x + t.w > FRAME.w * 0.5,
      ink: needsLightText(def.colour) ? '#eef1f5' : '#0f1113',
      inkDim: needsLightText(def.colour) ? 'rgba(238,241,245,0.78)' : 'rgba(15,17,19,0.74)',
      style: {
        left: `${(t.x / FRAME.w) * 100}%`,
        top: `${(t.y / FRAME.h) * 100}%`,
        width: `${(t.w / FRAME.w) * 100}%`,
        height: `${(t.h / FRAME.h) * 100}%`,
        // `backgroundColor`, never the `background` shorthand: the shorthand
        // resets `background-image`, and an inline style beats the stylesheet,
        // so it would silently wipe the hatching off every unclaimed tile.
        backgroundColor: def.colour,
      },
    };
  }),
);

/* ------------------------------------------------------------- claiming it */

/** Which patch the claim dialog is open on, or null. */
const claiming = ref(null);
/** What the player has dialled in, in square metres. */
const claimWant = ref(0);

function openClaim(tile) {
  if (!tile.unclaimed) return;
  claiming.value = tile.biomeId;
  claimWant.value = Math.min(
    state.unclaimed?.[tile.biomeId] || 0,
    Math.max(0, claimableArea(tile.biomeId)),
  );
}
function closeClaim() {
  claiming.value = null;
}

const claimPatch = computed(() => {
  const id = claiming.value;
  if (!id) return null;
  const area = state.unclaimed?.[id] || 0;
  if (area <= 0) return null;
  const want = Math.max(0, Math.min(Number(claimWant.value) || 0, area));
  const unit = claimCost(id, 1);
  const bill = claimCost(id, want);
  return {
    id,
    def: BIOMES[id],
    area,
    want,
    unit,
    bill,
    // Which lines of the bill are bulk standing in for an element the hive
    // cannot see yet. Coloured, not explained — see substitutedEntries.
    standingIn: substitutedEntries(unit),
    affordable: want > 0 && Object.entries(bill).every(([n, g]) => (state.nutrients[n] || 0) >= g),
    most: claimableArea(id),
    dangerous: isDangerous(id),
    multiplier: DANGEROUS_CLAIM_MULTIPLIER,
    blocked: colonisationBlock(state, id),
  };
});

function doClaim() {
  const patch = claimPatch.value;
  if (!patch) return;
  if (claimTerritory(patch.id, patch.want) > 0) closeClaim();
}
function doAbandon() {
  if (claiming.value) abandonTerritory(claiming.value);
  closeClaim();
}

/** What the explorers are doing, for the panel above the map. */
const expeditions = computed(() => derived.value.expeditions ?? []);

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
    // What a trip to this ground ACTUALLY comes back with once the stars are
    // on. With nothing starred this is just the natural distribution again.
    const odds = focusedOdds(state, gather.value, h.id, raw.map((e) => ({ ...e })));
    const stars = starsFor(state, gather.value, h.id);
    // A star on something this ground no longer offers. Kept rather than
    // silently dropped — the player put it there — but it claims nothing, so
    // the panel has to say so or it reads as a focus that stopped working.
    const live = new Set(raw.map((e) => e.key));
    const dead = stars.filter((k) => !live.has(k));
    return {
      ...h,
      share: shares.value[h.id] || 0,
      starCount: stars.length - dead.length,
      dead: dead.length,
      // What each star is worth here, for the panel's one-line summary.
      strength: focusStrength(stars.length - dead.length),
      entries: raw
        .map((e) => {
          const chance = total > 0 ? e.weight / total : 0;
          const named = isNamed(state, e.key);
          const seen = timesFound(state, h.id, e.key);
          const level = rateConfidence(state, h.id, e.key);
          return {
            ...e,
            chance,
            // What it is worth per trip with the stars applied. Shown beside
            // the natural rate rather than instead of it, so a player can see
            // what their own orders are doing rather than just the result.
            focused: odds[e.key] ?? chance,
            named,
            seen,
            level,
            starrable: isStarrable(state, h.id, e.key),
            starred: isStarred(state, gather.value, h.id, e.key),
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

/** Star or unstar one find for the selected route on one biome. */
function star(biomeId, entry) {
  if (!entry.starrable && !entry.starred) return;
  toggleStar(state, gather.value, biomeId, entry.key);
}

/** Drop every star on one biome for the selected route. */
function unfocus(biomeId) {
  clearStars(state, gather.value, biomeId);
}

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
 * What is out on the land right now.
 *
 * ONE ROW PER PATCH, not per drone type. The hive works several places at once
 * — how many is decided by how much ground it holds — and each of them is its
 * own find with its own share of the drones on it. A hive on four patches is
 * bringing in four different things, which is the whole reason to expand.
 *
 * NOTHING HERE READS THE CASTES. There used to be a second loop over
 * CASTE_ORDER giving each gathering caste a row of its own, from before drone
 * types took the job over. CASTE_ORDER is now `['dormant']` and dormant has no
 * `gather` route — being dormant is where a drone is when it has no job — so
 * the loop could not produce a row under any state the game can reach, and
 * `derived.droneForage` above is the whole answer.
 */
const working = computed(() => {
  const rows = [];
  for (const f of Object.values(derived.value.droneForage ?? {})) {
    for (const patch of f.patches) {
      rows.push({
        id: `${f.droneId}-${patch.index}`,
        name: DRONE_TYPES[f.droneId]?.name ?? f.droneId,
        assigned: patch.drones,
        found: describeSlot(patch),
        rate: patch.rate,
        grams: patch.grams,
        worked: patch.worked,
        empty: patch.empty,
      });
    }
  }
  return rows;
});

/** What the ground will carry, and how many places it is worked in. */
const ground = computed(
  () => derived.value.land ?? { capacity: 0, patches: 0, working: 0, landless: 0 },
);
const totalRate = computed(() => working.value.reduce((a, r) => a + r.rate, 0));

</script>

<template>
  <div class="main-col">
    <!-- ------------------------------------------------------- the holdings -->
    <div class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Holdings</span>
        <span class="muted num">{{ formatArea(area) }} m²</span>
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
            :class="{
              'tip-right': t.tipRight,
              'is-pinned': isPinned(`terr:${t.id}`),
              'is-unclaimed': t.unclaimed,
              'is-blocked': Boolean(t.blocked),
              'is-dangerous': t.dangerous,
            }"
            :style="t.style"
            :role="t.unclaimed ? 'button' : null"
            :tabindex="t.unclaimed ? 0 : null"
            v-on="pinHandlers(`terr:${t.id}`)"
            @click="openClaim(t)"
            @keydown.enter="openClaim(t)"
          >
            <span v-if="t.roomForName" class="terr-tile-name" :style="{ color: t.ink }">
              {{ t.def.name }}
            </span>
            <span v-if="t.roomForFigure" class="terr-tile-figure" :style="{ color: t.inkDim }">
              <template v-if="t.unclaimed">{{ formatArea(t.area) }} m² · ?</template>
              <template v-else>
                {{ formatArea(t.area) }} m² · {{ (t.share * 100).toFixed(0) }}%
              </template>
            </span>
            <span v-if="t.unclaimed && !t.roomForFigure" class="terr-tile-flag">?</span>

            <span class="tip-body">
              <!-- Type and size first, because on a sliver too small to label
                   the tooltip is the only place either of them appears. -->
              <span class="tip-title">
                {{ t.def.name }} · {{ formatArea(t.area) }} m²<span
                  v-if="t.unclaimed"
                  class="warn"
                > · unclaimed</span>
              </span>
              <span class="muted" style="display: block; margin-bottom: 0.3rem">
                {{ CLIMATES[t.def.climate] }} · {{ t.def.desc }}
              </span>
              <span v-if="t.unclaimed" class="tip-row">
                <span :class="t.blocked ? 'bad' : 'warn'">
                  {{ t.blocked || (t.dangerous ? 'People are on it.' : 'Mapped, not taken.') }}
                </span>
                <span>{{ t.blocked ? '—' : 'click to claim' }}</span>
              </span>
              <span class="tip-row">
                <span>{{ t.unclaimed ? 'Mapped' : 'Held' }}</span>
                <span>{{ formatArea(t.area) }} m²</span>
              </span>
              <span class="tip-row">
                <span>Share of every roll</span>
                <span>{{ (t.share * 100).toFixed(1) }}%</span>
              </span>
              <hr style="border-color: var(--border); margin: 0.3rem 0" />
              <span class="tip-title" style="font-size: 0.72rem">
                Likeliest {{ GATHER_TYPES[gather].name.toLowerCase() }} here
              </span>
              <span v-for="fnd in t.finds" :key="fnd.name" class="tip-row">
                <span>{{ fnd.name }}</span>
                <span>{{ (fnd.chance * 100).toFixed(0) }}%</span>
              </span>
              <span v-if="!t.finds.length" class="tip-row warn">
                <span>Nothing for this caste</span><span>—</span>
              </span>
            </span>
          </div>
        </div>

        <p v-if="mapped.length" class="muted" style="font-size: 0.76rem; margin: 0.5rem 0 0">
          The hatched tiles are ground the hive has MAPPED and not taken. Click one to claim it.
        </p>

        <!-- The legend carries the slivers the map has no room to label. -->
        <div class="terr-legend">
          <div v-for="h in land" :key="h.id" class="terr-key">
            <span class="terr-key-dot" :style="{ background: h.def.colour }"></span>
            <span class="terr-key-name">{{ h.def.name }}</span>
            <span class="terr-key-num num">{{ formatArea(h.area) }} m²</span>
            <span class="terr-key-pct num">{{ ((shares[h.id] || 0) * 100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ----------------------------------------------------------- expeditions -->
    <div v-if="expeditions.length" class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Out past the edge</span>
        <span class="muted num">{{ expeditions.reduce((a, e) => a + e.count, 0) }}</span>
      </div>
      <div class="panel-body">
        <div v-for="e in expeditions" :key="e.droneId" class="field-row">
          <span class="field-label">
            {{ e.name }} <span class="muted">×{{ e.count }}</span>
            <span class="field-help">
              A trip takes {{ Math.round(e.seconds) }}s across {{ formatArea(area) }} m² of
              holdings — the more ground the hive stands on, the longer it takes to reach
              anywhere new.
            </span>
          </span>
          <span class="num muted">{{ (e.progress * 100).toFixed(0) }}%</span>
        </div>
        <div class="gut-meter" style="margin-top: 0.4rem">
          <span :style="{ width: `${(expeditions[0].progress || 0) * 100}%` }" />
        </div>
      </div>
    </div>

    <!-- ----------------------------------------------------- claiming the map -->
    <div v-if="claimPatch" class="modal-backdrop" @click.self="closeClaim">
      <div class="panel-box claim-box">
        <div class="panel-head">
          <span>{{ claimPatch.def.name }}</span>
          <span class="muted num">{{ formatArea(claimPatch.area) }} m² mapped</span>
        </div>

        <div class="panel-body">
          <p class="muted" style="font-size: 0.78rem; margin: 0 0 0.5rem">
            {{ claimPatch.def.desc }}
          </p>

          <p v-if="claimPatch.blocked" class="notice is-warn" style="margin: 0 0 0.5rem">
            <strong class="bad">{{ claimPatch.blocked }}</strong>
            An Explorer can map it, and that is all. Something the hive has not grown yet would
            have to change before any of this could be taken.
          </p>
          <p v-else-if="claimPatch.dangerous" class="notice is-warn" style="margin: 0 0 0.5rem">
            <strong class="warn">People are on this ground.</strong>
            It can be taken, at {{ claimPatch.multiplier }}× the usual price — the hive is not
            moving into an empty field, it is moving in around something that will notice.
          </p>

          <template v-if="!claimPatch.blocked">
            <div class="field-row">
              <span class="field-label">
                How much
                <span class="field-help">
                  Up to {{ formatArea(claimPatch.area) }} m² mapped; the hive can pay for
                  {{ formatArea(claimPatch.most) }} m² right now.
                </span>
              </span>
              <input
                v-model.number="claimWant"
                class="claim-input"
                type="number"
                min="0"
                :max="claimPatch.area"
                step="0.1"
                aria-label="Square metres to claim"
              />
            </div>

            <div class="stepper" style="margin-bottom: 0.5rem">
              <button class="btn" style="width: auto; height: auto" @click="claimWant = claimPatch.most">
                All it can pay for
              </button>
              <button class="btn" style="width: auto; height: auto" @click="claimWant = claimPatch.area">
                All of it
              </button>
            </div>

            <div class="data-table">
              <div v-for="(grams, n) in claimPatch.bill" :key="n" class="field-row">
                <span>{{ NUTRIENTS[n]?.name ?? n }}</span>
                <span
                  class="num"
                  :class="claimPatch.standingIn.has(n) ? 'cost-unassayed'
                    : (state.nutrients[n] || 0) >= grams ? '' : 'bad'"
                  :title="claimPatch.standingIn.has(n)
                    ? 'Bulk, standing in for an element the hive cannot pick out yet. Assaying it cuts the price fifty-fold.'
                    : null"
                >
                  {{ formatMass(grams) }}
                </span>
              </div>
            </div>
          </template>
        </div>

        <div class="panel-body" style="display: flex; gap: 0.4rem">
          <button
            v-if="!claimPatch.blocked"
            class="btn"
            style="width: auto; height: auto"
            :disabled="!claimPatch.affordable"
            @click="doClaim"
          >
            Claim {{ formatArea(claimPatch.want) }} m²
          </button>
          <button class="btn" style="width: auto; height: auto" @click="doAbandon">
            Forget it
          </button>
          <button class="btn" style="width: auto; height: auto" @click="closeClaim">Close</button>
        </div>
      </div>
    </div>

    <!-- ------------------------------------------------------- who is on what -->
    <div v-if="ground.patches || working.length" class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Out now</span>
        <span class="muted num">{{ formatMassFlow(totalRate) }}</span>
      </div>

      <div class="panel-body">
        <p class="muted" style="font-size: 0.78rem; margin: 0 0 0.5rem">
          Ground carries <strong>{{ ground.capacity.toFixed(0) }}</strong> foraging
          drone{{ ground.capacity === 1 ? '' : 's' }} at
          {{ (1 / FORAGERS_PER_SQUARE_METRE).toFixed(1) }} m² each, and is worked in
          <strong>{{ ground.patches }}</strong> patch{{ ground.patches === 1 ? '' : 'es' }} —
          one per {{ AREA_PER_PATCH }} m², never fewer than the number of biomes held. Each
          patch is its own find, rolled separately.
        </p>
        <p v-if="ground.landless > 0" class="warn" style="font-size: 0.78rem; margin: 0 0 0.5rem">
          <strong class="bad">{{ ground.landless.toFixed(0) }} with nowhere to work.</strong>
          The hive holds more foragers than its ground will carry. More land, or fewer drones.
        </p>
      </div>

      <div class="panel-body tight">
        <div v-for="w in working" :key="w.id" class="field-row">
          <span class="field-label">
            {{ w.name }}
            <span class="muted">×{{ w.assigned < 1 ? w.assigned.toFixed(2) : w.assigned.toFixed(1) }}</span>
            <span class="field-help">
              <template v-if="!w.worked">No drone on this patch.</template>
              <template v-else-if="w.empty">{{ w.found.label }} — nothing of this kind there.</template>
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
          <span class="num" :class="w.rate > 0 ? 'good' : 'bad'">{{ formatMassFlow(w.rate) }}</span>
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
        <p class="muted" style="font-size: 0.76rem; margin: 0.35rem 0 0">
          Star anything the hive has pinned down and this route will spend
          {{ (FOCUS_SHARE * 100).toFixed(0) }}% of its trips on that ground going after it. Stars
          are set per biome and per route, so the forest can work one thing while the river works
          another. A second star on the same ground splits the focus and weakens it — see the
          figure beside each one.
        </p>
      </div>

      <div v-for="o in offerings" :key="o.id" class="panel-body tight">
        <div class="offer-head">
          <span>{{ o.def.name }}</span>
          <span class="offer-head-right">
            <span v-if="o.starCount" class="focus-note">
              <span class="star-on">★</span>
              {{ o.starCount }} focused · {{ (o.strength * 100).toFixed(0) }}% of trips
              <button class="focus-clear" @click="unfocus(o.id)">clear</button>
            </span>
            <span v-if="o.dead" class="focus-note bad">
              {{ o.dead }} star{{ o.dead === 1 ? '' : 's' }} on nothing this ground offers
            </span>
            <span class="muted num">{{ (o.share * 100).toFixed(0) }}% of the hive's land</span>
          </span>
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
            <!-- What the orders did to it, beside what chance gives. Only on
                 ground where the stars are actually doing something, so an
                 unfocused biome reads exactly as it did before. -->
            <span v-if="o.starCount && e.starred" class="offer-focused">
              → {{ (e.focused * 100).toFixed(0) }}%
            </span>
            <button
              v-if="e.starrable || e.starred"
              class="star-btn"
              :class="{ 'star-on': e.starred }"
              :title="e.starred ? 'Stop focusing on this' : 'Focus this route here'"
              @click.stop="star(o.id, e)"
            >{{ e.starred ? '★' : '☆' }}</button>

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
              <template v-if="e.starred">
                <hr style="border-color: var(--border); margin: 0.3rem 0" />
                <span class="tip-row">
                  <span class="star-on">★ Focused — chance per trip</span>
                  <span class="star-on">{{ (e.focused * 100).toFixed(0) }}%</span>
                </span>
              </template>
              <span v-else-if="e.starrable" class="tip-row muted" style="margin-top: 0.25rem">
                <span>Pinned down — this can be focused</span><span>☆</span>
              </span>
              <span v-else-if="e.level !== 'exact'" class="tip-row muted" style="margin-top: 0.25rem">
                <span>Focus needs the exact rate</span><span>{{ e.toNext }} more finds</span>
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
