<script setup>
import { computed, ref } from 'vue';
import { state, derived, showInCodex } from '../game/useGame.js';
import { NUTRIENTS, MACROS, MICROS, ASSAY_GROUPS, isRevealed } from '../game/definitions/nutrients.js';
import { formatMass, formatMassFlow, formatEnergy } from '../game/units.js';
import {
  consumeBiomass, MANUAL_INTAKE, manualOdds, manualOddsSummary, manualCombo,
  setGeneralBan, generalContents,
} from '../game/actions.js';
import { RANGE_AT } from '../game/discovery.js';
import { ITEMS } from '../game/definitions/items/index.js';
import { isPinned, pinHandlers } from '../game/tips.js';
import { BIOMES } from '../game/definitions/biomes.js';

/** Where the click combo has got to, for the button to wear. */
const combo = computed(() => manualCombo());

/**
 * Every drone the hive is holding. Two counters, for now: `state.drones` is the
 * old population, which nothing grows any more, and `droneTypes` is what the
 * Molding Chambers press. Summing both means this line cannot disagree with the
 * Drones tab while the rebuild has one foot in each.
 */
const droneCount = computed(
  () =>
    (state.drones || 0) +
    Object.values(state.droneTypes || {}).reduce((sum, n) => sum + (n || 0), 0),
);

/**
 * FOLD STATE IS DELIBERATELY SESSION-ONLY.
 *
 * `state.ui.buildBands` and `state.ui.droneBands` persist, and this does not,
 * which looks like an oversight. It is not. Those two fold away bands of things
 * the player has decided they are done with for the rest of the run; a folded
 * micronutrient group is almost always "I am reading the macros right now", and
 * a panel that came back from a reload with thirty-five freshly assayed
 * compounds hidden would read as the assay having failed to land.
 *
 * Persisting it would also mean a key in `createInitialState` that every save
 * written before it existed does not have, for a preference worth less than the
 * migration. If that judgement ever flips, it is a declared `state.ui`
 * key — not a ref that happens to get saved.
 */
const collapsed = ref({});
function toggle(key) {
  collapsed.value[key] = !collapsed.value[key];
}

function row(id) {
  const def = NUTRIENTS[id];
  const amount = state.nutrients[id] ?? 0;
  const cap = derived.value.caps[id];
  const rate = derived.value.net[id] ?? 0;
  // What is on this nutrient's own shelf, and what has spilled over into the
  // shared pool. The pool is invisible until something is using it, which is
  // why the ceiling appears to grow: it is not room until it is occupied.
  const pooled = state.general?.[id] ?? 0;
  const shelf = Math.max(0, amount - pooled);
  return {
    id,
    def,
    amount,
    cap,
    pooled,
    shelf,
    shelfCap: derived.value.storage.dedicated[id] ?? 0,
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
//
// A COLLAPSED GROUP BUILDS NO ROWS AT ALL. `row()` is not cheap — it reads four
// derived maps and spreads every flow source into a nested `from` array — and
// this whole computed invalidates on the 100 ms tick, so a fully assayed hive
// was rebuilding thirty-five of them, ten times a second, to feed a template
// that was hiding twenty-eight of them behind `v-show`. Folding a group away is
// the player asking not to be shown it; before this it bought them nothing
// whatsoever, which is the opposite of what a fold is for.
//
// `ids` and `count` are what survive the skip, because the two things that read
// a folded group still need them: the header shows the count, and the general-
// storage rules dialog lists every revealed nutrient whether its group is open
// or not. Dropping to `rows` alone would have quietly emptied that dialog.
const groups = computed(() => {
  const out = [groupOf('bulk', 'Macronutrients', MACROS)];
  for (const assay of ASSAY_GROUPS) {
    if (!state.tech[assay.id]) continue;
    out.push(groupOf(assay.id, assay.name, MICROS.filter((id) => NUTRIENTS[id].group === assay.id)));
  }
  return out;
});

function groupOf(key, name, ids) {
  return {
    key,
    name,
    ids,
    count: ids.length,
    rows: collapsed.value[key] ? [] : ids.map(row),
  };
}

const hiddenCount = computed(() => MICROS.filter((id) => !isRevealed(state, id)).length);

// The shared pool, for the panel footer and the per-nutrient tooltips. It stays
// out of sight until the hive has built some and started using it.
const generalCapacity = computed(() => derived.value.storage.general);
const generalUsed = computed(() => derived.value.storage.generalUsed);

/**
 * THE SHARED POOL, AND WHY IT NEEDS RULES.
 *
 * It is a buffer, not a cupboard: small, last-in-first-out, and whatever
 * overflows into it first owns it. A hive working forest floor fills it with
 * water and fibre in seconds and then has nowhere to catch the protein that
 * actually mattered. So the row says what is IN there, and clicking it opens
 * the list of what is allowed in.
 */
const generalRows = computed(() => generalContents());
const generalFree = computed(() => Math.max(0, generalCapacity.value - generalUsed.value));
const bannedCount = computed(() => Object.keys(state.generalBans || {}).length);

/** The rules dialog, and everything it lists. */
const rulesOpen = ref(false);
const ruleSearch = ref('');

const ruleRows = computed(() => {
  const q = ruleSearch.value.trim().toLowerCase();
  const out = [];
  for (const group of groups.value) {
    // `ids`, not `rows` — a folded group has no rows, and the rules it is under
    // are about the shared pool rather than about what the panel is showing.
    const rows = group.ids
      .filter((id) => isRevealed(state, id))
      .filter((id) => !q || NUTRIENTS[id].name.toLowerCase().includes(q))
      .map((id) => ({
        id,
        def: NUTRIENTS[id],
        pooled: state.general?.[id] ?? 0,
        banned: Boolean(state.generalBans?.[id]),
      }));
    if (rows.length) out.push({ key: group.key, name: group.name, rows });
  }
  return out;
});

function banAll(on) {
  for (const group of ruleRows.value) {
    for (const r of group.rows) setGeneralBan(r.id, on);
  }
}

/**
 * A click no longer means a known mouthful. The drone picks up whatever is
 * within reach on the hive's own land, so the tooltip shows the distribution
 * rather than a result — and the last find is shown under the button, because
 * a log line per click would bury everything else in the log.
 *
 * The distribution is shown AS FAR AS THE HIVE KNOWS IT, off the same discovery
 * log the Territory tab reads: a thing never picked up is ??? at ?%, and both
 * screens sharpen in the same frame because both are reading `state.found`.
 */
const odds = computed(() => manualOdds(6));
const oddsKnown = computed(() => manualOddsSummary());

const lastGather = computed(() => {
  const last = state.lastGather;
  if (!last) return null;
  return {
    name: last.itemId ? ITEMS[last.itemId].name : null,
    itemId: last.itemId,
    biome: last.biomeId ? BIOMES[last.biomeId] : null,
    grams: last.grams,
    multiplier: last.multiplier ?? 1,
  };
});
</script>

<template>
  <div class="panel-box">
    <div class="panel-head">
      <span>Stores</span>
      <span class="muted num">{{ droneCount }} drones</span>
    </div>

    <div class="panel-body">
      <span class="tip tip-side" style="display: block">
        <button class="gather-btn" :class="{ 'is-hot': combo.hot }" @click="consumeBiomass()">
          Consume biomass
          <span v-if="combo.hot" class="combo-mult">×{{ combo.multiplier.toFixed(1) }}</span>
          <span class="combo-bar"><span :style="{ width: `${combo.heat * 100}%` }" /></span>
        </button>
        <span class="tip-body">
          <span class="tip-title">Take biomass from the hive's own territory</span>
          <span class="muted" style="display: block; margin-bottom: 0.3rem">
            The hive extends itself into the ground it holds and consumes whatever it closes on.
            What that turns out to be depends on the territory; how much of it comes away is
            whatever came away — {{ formatMass(MANUAL_INTAKE.min) }} to
            {{ formatMass(MANUAL_INTAKE.max) }} a time.
          </span>
          <span class="muted" style="display: block; margin-bottom: 0.3rem">
            Reaching again before it has settled takes more:
            <strong>×{{ MANUAL_INTAKE.comboMax }}</strong> at a steady hammering, bleeding back to
            nothing over {{ MANUAL_INTAKE.comboCool }}s of leaving it alone.
            <template v-if="combo.hot">
              Currently <strong class="good">×{{ combo.multiplier.toFixed(2) }}</strong>.
            </template>
          </span>
          <span v-for="o in odds" :key="o.itemId" class="tip-row">
            <span :class="{ 'offer-unknown': !o.named }">{{ o.label }}</span>
            <span :class="o.level === 'exact' ? '' : 'offer-vague'">{{ o.rate }}</span>
          </span>
          <span v-if="!odds.length" class="tip-row warn">
            <span>No land, nothing within reach</span><span>—</span>
          </span>
          <span v-else class="tip-hint">
            {{ oddsKnown.named }} of {{ oddsKnown.total }} named,
            {{ oddsKnown.exact }} pinned down. A rate stays vague while it could have come off
            ground the hive has walked fewer than {{ RANGE_AT }} times.
          </span>
        </span>
      </span>

      <div v-if="lastGather" class="last-gather">
        <template v-if="lastGather.name">
          Last: {{ formatMass(lastGather.grams) }}<span
            v-if="lastGather.multiplier > 1.01"
            class="good"
          >&nbsp;×{{ lastGather.multiplier.toFixed(1) }}</span>&nbsp;
          <button class="codex-link" @click="showInCodex(lastGather.itemId)">
            {{ lastGather.name.toLowerCase() }}
          </button>
          <span class="muted">· {{ lastGather.biome.name.toLowerCase() }}</span>
        </template>
        <span v-else class="warn">Found nothing.</span>
      </div>
    </div>

    <!-- THE SHARED POOL SITS AT THE TOP. It is the one line that is about
         every resource rather than one of them, and it is the line that
         explains why a store that read 2 kg / 2 kg a moment ago now reads
         2.2 kg / 2.2 kg — so it belongs where the eye lands first, not
         buried under thirty-five rows of micronutrient. -->
    <div v-if="generalCapacity > 0" class="panel-body tight">
      <div
        class="res-row general-row tip tip-side"
        :class="{ 'is-pinned': isPinned('general') }"
        role="button"
        tabindex="0"
        v-on="pinHandlers('general')"
        @click="rulesOpen = true"
        @keydown.enter="rulesOpen = true"
      >
        <span class="res-name">
          General storage
          <span v-if="bannedCount" class="muted">· {{ bannedCount }} barred</span>
        </span>
        <span class="res-amount num">
          <span :class="{ warn: generalUsed >= generalCapacity - 1e-9 }">
            {{ formatMass(generalUsed) }}
          </span>
          <span class="cap"> / {{ formatMass(generalCapacity) }}</span>
        </span>
        <span class="res-bar" :class="{ 'is-full': generalUsed >= generalCapacity - 1e-9 }">
          <span :style="{ width: `${generalCapacity > 0 ? (generalUsed / generalCapacity) * 100 : 0}%` }" />
        </span>

        <span class="tip-body">
          <span class="tip-title">General storage</span>
          <span class="muted" style="display: block; margin-bottom: 0.3rem">
            Shared room, last in and first out. Nothing lives here — this is only what has
            overflowed off its own shelf and not yet been spent.
          </span>

          <span v-for="g in generalRows" :key="g.id" class="tip-row">
            <span>{{ g.def.name }}</span>
            <span>{{ formatMass(g.grams) }}</span>
          </span>
          <span v-if="!generalRows.length" class="tip-row muted">
            <span>Empty — nothing has overflowed</span><span>—</span>
          </span>

          <hr style="border-color: var(--border); margin: 0.3rem 0" />
          <span class="tip-row">
            <span>Free</span>
            <span :class="generalFree > 0 ? 'good' : 'bad'">{{ formatMass(generalFree) }}</span>
          </span>
          <span v-if="bannedCount" class="tip-row warn">
            <span>Barred from it</span><span>{{ bannedCount }}</span>
          </span>
          <span class="tip-hint">Click to choose what is allowed in.</span>
        </span>
      </div>
    </div>

    <div v-for="group in groups" :key="group.key">
      <button class="group-head" @click="toggle(group.key)">
        <span>{{ collapsed[group.key] ? '▸' : '▾' }} {{ group.name }}</span>
        <span class="muted">{{ group.count }}</span>
      </button>

      <!-- v-if, not v-show. Every row carries a `.tip-body` full of flow rows,
           and under v-show all of it stayed mounted and re-rendering on the
           tick while being invisible. -->
      <div v-if="!collapsed[group.key]" class="panel-body tight">
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
            <span class="tip-row">
              <span>On its own shelf</span>
              <span :class="r.shelf >= r.shelfCap - 1e-9 && r.shelfCap > 0 ? 'warn' : ''">
                {{ formatMass(r.shelf) }} / {{ formatMass(r.shelfCap) }}
              </span>
            </span>
            <span v-if="r.pooled > 0" class="tip-row">
              <span>Overflowed into general storage</span>
              <span class="warn">{{ formatMass(r.pooled) }}</span>
            </span>
            <span v-else-if="generalCapacity > 0" class="tip-row muted">
              <span>In general storage</span><span>none</span>
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

    <!-- --------------------------------------------------- what may pool -->
    <div v-if="rulesOpen" class="modal-backdrop" @click.self="rulesOpen = false">
      <div class="panel-box rules-box">
        <div class="panel-head">
          <span>General storage</span>
          <span class="muted num">{{ formatMass(generalUsed) }} / {{ formatMass(generalCapacity) }}</span>
        </div>

        <div class="panel-body">
          <p class="muted" style="font-size: 0.78rem; margin: 0 0 0.5rem">
            Shared room is a buffer, not a cupboard: small, and whatever overflows into it first
            owns it. A hive working the forest floor fills it with water and fibre in seconds and
            then has nowhere to catch the protein that mattered. Bar whatever is not worth
            catching.
          </p>
          <p class="warn" style="font-size: 0.76rem; margin: 0 0 0.5rem">
            Barring something that is already in here spills it — what is in the pool is overflow,
            so there is no shelf for it to go back to.
          </p>

          <div class="filter-row">
            <input
              v-model="ruleSearch"
              class="codex-search"
              type="text"
              placeholder="Filter resources…"
            />
            <button class="btn" style="width: auto; height: auto" @click="banAll(true)">
              Bar all
            </button>
            <button class="btn" style="width: auto; height: auto" @click="banAll(false)">
              Allow all
            </button>
          </div>
        </div>

        <div class="panel-body tight rules-list">
          <template v-for="group in ruleRows" :key="group.key">
            <div class="group-head" style="cursor: default">
              <span>{{ group.name }}</span>
              <span class="muted">{{ group.rows.length }}</span>
            </div>
            <div v-for="r in group.rows" :key="r.id" class="field-row">
              <span class="field-label">
                {{ r.def.name }}
                <span v-if="r.pooled > 0" class="field-help">
                  {{ formatMass(r.pooled) }} in the pool now
                </span>
              </span>
              <button
                class="btn rule-toggle"
                :class="{ 'is-barred': r.banned }"
                :aria-pressed="r.banned ? 'true' : 'false'"
                @click="setGeneralBan(r.id, !r.banned)"
              >
                {{ r.banned ? 'Barred' : 'Allowed' }}
              </button>
            </div>
          </template>
          <div v-if="!ruleRows.length" class="band-empty">Nothing matches that.</div>
        </div>

        <div class="panel-body">
          <button class="btn" style="width: auto; height: auto" @click="rulesOpen = false">
            Close
          </button>
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
