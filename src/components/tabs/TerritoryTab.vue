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
import { describeSlot, FORAGE_CYCLE } from '../../game/forage.js';
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
import { claimPreview, hitChance, meanLoad } from '../../game/landvalue.js';

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
const outNow = computed(() => {
  const groups = new Map();
  for (const f of Object.values(derived.value.droneForage ?? {})) {
    for (const patch of f.patches) {
      // A crew keeps a patch slot for every patch the LAND offers, and works as
      // many of them as it has drones — so a scavenger ×4 on twelve-patch
      // ground holds eight slots it cannot staff. Those contributed fourteen
      // rows of "no drone on it, 0 g/s" to a twenty-four row panel and buried
      // the ten rows that said anything. The crew line above already says how
      // many of its patches are open; the rows are for what is being worked.
      if (!patch.worked) continue;
      // A worked patch with no biome is one whose roll has not landed yet.
      const key = patch.biomeId ?? 'nowhere';
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          biome: patch.biomeId ? BIOMES[patch.biomeId] : null,
          rows: [],
          rate: 0,
        };
        groups.set(key, group);
      }
      const found = describeSlot(patch);
      group.rows.push({
        id: `${f.droneId}-${patch.index}`,
        patch: patch.index + 1,
        crew: DRONE_TYPES[f.droneId]?.name ?? f.droneId,
        found,
        itemId: found.itemId ?? null,
        drones: patch.drones,
        rate: patch.rate,
        grams: patch.grams,
        worked: patch.worked,
        empty: patch.empty,
      });
      group.rate += patch.rate;
    }
  }
  for (const group of groups.values()) group.rows.sort((a, b) => b.rate - a.rate);
  return [...groups.values()].sort((a, b) => b.rate - a.rate);
});

/**
 * The crews, one line each — and the home of the figure that used to be stamped
 * on every patch row.
 *
 * `drones per patch` is `working / open` for the whole TYPE. It is identical on
 * every row of that type by construction, so "×2.1" printed twenty-five times
 * was telling the player that it varies. It belongs here, where it is stated
 * once and is true.
 */
const crews = computed(() =>
  Object.values(derived.value.droneForage ?? {}).map((f) => ({
    droneId: f.droneId,
    name: f.name,
    gather: f.gather,
    count: f.count,
    working: f.working,
    landless: f.landless,
    open: f.open,
    perPatch: f.open > 0 ? f.working / f.open : 0,
    // How often a trip finds anything at all on this mix of ground. A route
    // with nothing to look for comes back empty, and the rate alone cannot
    // tell a player whether that is bad luck or bad land.
    hit: hitChance(shares.value, f.gather),
    trip: meanLoad(f.droneId),
    rate: f.rate,
  })),
);

/** What the ground will carry, and how many places it is worked in. */
const ground = computed(
  () => derived.value.land
    ?? { capacity: 0, patches: 0, working: 0, landless: 0, patchHeadroom: 0 },
);
const totalRate = computed(() => outNow.value.reduce((a, g) => a + g.rate, 0));
/**
 * Patches actually being worked, across every crew.
 *
 * NOT `derived.land.patches`, which is how many the GROUND offers — a figure
 * each crew gets its own copy of. Two crews on twelve-patch ground are on up to
 * twenty-four separate finds, and a headline reading "12" beside a list of
 * twenty-four rows is the kind of arithmetic that makes a player distrust the
 * whole panel.
 */
const patchesWorked = computed(() => outNow.value.reduce((a, g) => a + g.rows.length, 0));
const anyPatches = computed(() => patchesWorked.value > 0);

/* ----------------------------------------------- what a claim would be worth */

/**
 * The claim dialog's second half: not what this ground costs, but what it does.
 *
 * Recomputed as the player drags the slider, from the same arithmetic the engine
 * runs — see landvalue.js. The one thing it must not do is flatter the purchase:
 * a hive whose foragers are all already on ground gains NO intake from more of
 * the same, and the honest version of this panel says so in bold.
 */
const claimValue = computed(() => {
  const patch = claimPatch.value;
  if (!patch || patch.want <= 0 || patch.blocked) return null;
  const d = derived.value;
  const preview = claimPreview(state, patch.id, patch.want, {
    vigour: d.vigour ?? 1,
    harvest: d.land?.harvest ?? 1,
  });
  return {
    ...preview,
    // Only the movers worth a line, and only ones the hive could name. An
    // unnamed find would be "??? +1.2 g/s", which spoils that there is
    // something there without saying anything useful about it.
    movers: preview.shifts.filter((s) => s.label && Math.abs(s.delta) > 1e-4).slice(0, 4),
    unknowns: preview.shifts.filter((s) => !s.label && s.delta > 1e-4).length,
  };
});

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

            <!-- ---------------------------------- and what it would be worth -->
            <template v-if="claimValue">
              <hr style="border-color: var(--border); margin: 0.6rem 0 0.5rem" />
              <div class="offer-head" style="margin-bottom: 0.3rem">
                <span>What this would do</span>
                <span
                  class="num"
                  :class="claimValue.rateGain > 0 ? 'good' : 'muted'"
                >{{ formatMassFlow(claimValue.rateGain) }}</span>
              </div>

              <!-- THE HEADLINE IS THE HONEST ONE. Land is a ceiling on drones,
                   not a multiplier on them, so a hive with every forager
                   already on ground gains nothing today by buying more. That
                   was invisible, and it is the whole decision. -->
              <p
                v-if="claimValue.headroomOnly"
                class="notice is-warn"
                style="margin: 0 0 0.45rem"
              >
                <strong class="warn">No extra intake today.</strong>
                Every forager the hive owns is already on ground, so this buys room for
                <strong>{{ claimValue.capacityGain }}</strong> more of them
                <template v-if="claimValue.fresh">and a share of new ground</template>
                — not a faster trip for the ones already out. Hatch into it and it pays.
              </p>
              <p v-else class="notice" style="margin: 0 0 0.45rem">
                <strong class="good">Puts {{ claimValue.employs }}
                  idle forager{{ claimValue.employs === 1 ? '' : 's' }} to work.</strong>
                That is where the {{ formatMassFlow(claimValue.rateGain) }} comes from.
              </p>

              <div class="data-table">
                <div class="field-row">
                  <span>Foragers the land will carry</span>
                  <span class="num">
                    {{ claimValue.before.capacity }} →
                    <strong>{{ claimValue.after.capacity }}</strong>
                  </span>
                </div>
                <div class="field-row stacked-help">
                  <span class="field-label">
                    Patches worked
                    <span v-if="!claimValue.patchGain" class="field-help">
                      No new places — the hive is already working as many as it can read. Variety
                      comes from the MIX of ground now, not from more of it.
                    </span>
                    <span v-else class="field-help">
                      Each one its own find, rolled separately against the whole territory.
                    </span>
                  </span>
                  <span class="num">
                    {{ claimValue.before.patches }} →
                    <strong>{{ claimValue.after.patches }}</strong>
                  </span>
                </div>
                <div class="field-row">
                  <span>Share of every roll</span>
                  <span class="num">
                    {{ ((shares[claimValue.biomeId] || 0) * 100).toFixed(0) }}% →
                    <strong>{{ (((state.territory?.[claimValue.biomeId] || 0) + claimPatch.want)
                      / (area + claimPatch.want) * 100).toFixed(0) }}%</strong>
                  </span>
                </div>
              </div>

              <!-- What changes about WHAT comes in. The signed deltas matter:
                   more of one biome dilutes every other one, and a player about
                   to drown their acorns in roadkill should see it first. -->
              <template v-if="claimValue.movers.length">
                <div class="offer-head" style="margin: 0.5rem 0 0.2rem">
                  <span class="muted" style="font-size: 0.74rem">What comes in instead</span>
                </div>
                <div class="data-table">
                  <div v-for="m in claimValue.movers" :key="m.key" class="field-row">
                    <span>{{ m.label }}</span>
                    <span class="num" :class="m.delta > 0 ? 'good' : 'bad'">
                      {{ formatMassFlow(m.delta) }}
                    </span>
                  </div>
                </div>
              </template>
              <p
                v-if="claimValue.unknowns"
                class="muted"
                style="font-size: 0.74rem; margin: 0.35rem 0 0"
              >
                And {{ claimValue.unknowns }} thing{{ claimValue.unknowns === 1 ? '' : 's' }}
                on this ground the hive has never found, so it cannot say what they are worth.
              </p>
            </template>
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
    <div v-if="ground.patches || anyPatches" class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Out now</span>
        <span class="muted num">{{ formatMassFlow(totalRate) }}</span>
      </div>

      <!-- The three figures that decide what to do next, as figures rather than
           as a paragraph: how much the ground will carry, how much of that is
           taken, and how many places it is worked in. -->
      <div class="panel-body">
        <div class="land-stats">
          <span class="land-stat">
            <span class="land-stat-num num">{{ ground.working.toFixed(0) }}<span
              class="muted"
            >/{{ ground.capacity.toFixed(0) }}</span></span>
            <span class="land-stat-label">drones out</span>
          </span>
          <span class="land-stat">
            <span class="land-stat-num num">{{ patchesWorked }}</span>
            <span class="land-stat-label">patches worked</span>
          </span>
          <span class="land-stat">
            <span class="land-stat-num num">{{ formatArea(area) }}</span>
            <span class="land-stat-label">m² held</span>
          </span>
        </div>

        <p class="muted" style="font-size: 0.78rem; margin: 0.5rem 0 0">
          Ground carries one forager per
          {{ (1 / FORAGERS_PER_SQUARE_METRE).toFixed(1) }} m², and opens
          <strong>{{ ground.patches }}</strong> patch{{ ground.patches === 1 ? '' : 'es' }}
          <em>for each crew</em> — one per {{ AREA_PER_PATCH }} m², never fewer than the number
          of biomes held, never more than {{ ground.patches + ground.patchHeadroom }}, and never
          more than the crew has drones to staff. Each patch is its own find, rolled separately,
          so <strong>patches decide what comes in and capacity decides how much</strong>.
        </p>
        <p
          v-if="ground.patchHeadroom === 0"
          class="muted"
          style="font-size: 0.78rem; margin: 0.35rem 0 0"
        >
          The hive is working as many separate patches as it can read. More ground still carries
          more foragers — it just will not add places.
        </p>
        <p v-if="ground.landless > 0" class="warn" style="font-size: 0.78rem; margin: 0.35rem 0 0">
          <strong class="bad">{{ ground.landless.toFixed(0) }} with nowhere to work.</strong>
          The hive holds more foragers than its ground will carry. More land, or fewer drones.
        </p>
      </div>

      <!-- One line per CREW, which is where the per-patch drone count lives.
           It is `working / open` for the whole type, so it was identical on
           every patch row it used to be printed on. -->
      <div class="panel-body tight">
        <div v-for="c in crews" :key="c.droneId" class="field-row stacked-help">
          <span class="field-label">
            {{ c.name }} <span class="muted">×{{ c.count }}</span>
            <span class="field-help">
              {{ c.working }} on the ground across {{ c.open }}
              patch{{ c.open === 1 ? '' : 'es' }} —
              <strong>{{ c.perPatch < 1 ? c.perPatch.toFixed(2) : c.perPatch.toFixed(1) }}
                drone{{ c.perPatch === 1 ? '' : 's' }} per patch</strong>, each carrying about
              {{ formatMass(c.trip) }} back every {{ FORAGE_CYCLE }}s.
              <template v-if="c.hit < 0.999">
                {{ ((1 - c.hit) * 100).toFixed(0) }}% of trips find nothing, because that share of
                the hive's land offers this route nothing at all.
              </template>
              <template v-if="c.landless > 0">
                <span class="bad">{{ c.landless }} cannot be fitted on.</span>
              </template>
            </span>
          </span>
          <span class="num" :class="c.rate > 0 ? 'good' : 'bad'">{{ formatMassFlow(c.rate) }}</span>
        </div>
      </div>

      <!-- And the patches themselves, under the ground they are on. The panel's
           job is to answer "which ground is worth more", and a flat list of
           twenty-five rows in drone order never answered it. -->
      <div v-for="g in outNow" :key="g.key" class="panel-body tight">
        <div class="offer-head">
          <span>
            <span
              v-if="g.biome"
              class="terr-key-dot"
              :style="{ background: g.biome.colour }"
            ></span>
            {{ g.biome ? g.biome.name : 'Nowhere' }}
            <span class="muted">· {{ g.rows.length }}
              patch{{ g.rows.length === 1 ? '' : 'es' }}</span>
          </span>
          <span class="num" :class="g.rate > 0 ? 'good' : 'muted'">
            {{ formatMassFlow(g.rate) }}
          </span>
        </div>

        <div v-for="r in g.rows" :key="r.id" class="field-row stacked-help">
          <span class="field-label">
            <span class="muted">Patch {{ r.patch }}</span>
            <span class="sep">·</span>
            <template v-if="r.worked && !r.empty">
              <button
                v-if="r.itemId"
                class="codex-link"
                @click="showInCodex(r.itemId)"
              >{{ r.found.label.toLowerCase() }}</button>
              <strong v-else>{{ r.found.label.toLowerCase() }}</strong>
            </template>
            <span v-else-if="!r.worked" class="muted">no drone on it</span>
            <span v-else class="warn">nothing of this kind here</span>
            <span class="field-help">
              {{ r.crew }}<span class="sep">·</span>{{
                r.drones < 1 ? r.drones.toFixed(2) : r.drones.toFixed(1)
              }} drone{{ r.drones === 1 ? '' : 's' }}<template v-if="r.grams">,
                {{ formatMass(r.grams) }} each per trip, rolling again within
                {{ FORAGE_CYCLE }}s</template>.
            </span>
          </span>
          <span class="num" :class="r.rate > 0 ? 'good' : 'bad'">{{ formatMassFlow(r.rate) }}</span>
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
