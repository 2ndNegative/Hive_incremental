<script setup>
// GENETICS. Three columns: what it goes into, what it does, and what there is.
//
// The screen is a sentence read left to right — "write THIS gene into THAT
// body and THIS is what changes" — so the three panels are the three nouns, in
// that order, and the middle one is the only one that moves.
//
// THE STAGING MODEL, which is the one decision in here worth arguing about.
//
// Clicking a gene on the right does not write it. It adds it to a PROPOSED
// genome, and the middle column shows what that genome would do against what
// the current one does. Clicking a gene that is already written in stages its
// removal, the same way. Nothing reaches the hive until the commit button is
// pressed.
//
// Which gets three things at once. The player can line up several changes and
// see them together, which is what "highlight the changes of the gene(s)
// selected" asks for and what a one-click-one-gene model cannot do. Adding and
// removing are the same gesture, so there is no second set of controls for
// taking something out. And the preview is not a parallel calculation that
// could drift from the real one: it is `traitsOf` with a different genome
// handed to it, so the figure on the screen is the figure the engine will use.
import { computed, ref, watch } from 'vue';
import { state } from '../../game/useGame.js';
import {
  GENES, GENE_ORDER, TRAITS, TRAIT_ORDER,
  SUBJECT_KINDS, SUBJECT_KIND_ORDER,
} from '../../game/definitions/genes.js';
import { geneSubjects, traitsOf, blockedBecause } from '../../game/genes.js';
import { DRONE_TYPES, DRONE_CASTES } from '../../game/definitions/drones.js';
import { DRONE_RATION_JOULES } from '../../game/definitions/castes.js';
import { FORAGE_CYCLE } from '../../game/forage.js';
import { expeditionSeconds } from '../../game/expedition.js';
import { writeGenome } from '../../game/actions.js';
import { formatPower } from '../../game/units.js';

/* ----------------------------------------------------------------- subjects */

const subjects = computed(() => geneSubjects(state));

/** Subjects grouped under their kind, so the empty kind can still have a band. */
const bands = computed(() => SUBJECT_KIND_ORDER.map((kind) => ({
  kind,
  def: SUBJECT_KINDS[kind],
  rows: subjects.value.filter((s) => s.kind === kind),
})));

const picked = ref(subjects.value[0]?.id ?? null);
const subject = computed(() => subjects.value.find((s) => s.id === picked.value) ?? null);

/* ------------------------------------------------------------- the proposal */

/**
 * The genome being proposed, as a plain array of ids.
 *
 * Reset whenever the subject changes, because a half-finished thought about
 * foragers is not a thought about scavengers. Deliberately NOT reset when the
 * hive ticks — the tab re-renders ten times a second and anything derived from
 * the live state would wipe a selection between clicks, which is the bug the
 * Territory tab's number fields had.
 */
const staged = ref([]);
watch(picked, () => { staged.value = subject.value ? [...subject.value.genes] : []; },
  { immediate: true });

/** Current genome, as written. The thing `staged` is being compared against. */
const written = computed(() => subject.value?.genes ?? []);

const added = computed(() => staged.value.filter((id) => !written.value.includes(id)));
const removed = computed(() => written.value.filter((id) => !staged.value.includes(id)));
const dirty = computed(() => added.value.length > 0 || removed.value.length > 0);

function toggle(geneId) {
  if (!subject.value) return;
  if (blockedBecause(GENES[geneId], subject.value)) return;
  staged.value = staged.value.includes(geneId)
    ? staged.value.filter((id) => id !== geneId)
    : [...staged.value, geneId];
}

function commit() {
  if (!subject.value || !dirty.value) return;
  writeGenome(subject.value.id, staged.value);
  staged.value = [...(subject.value?.genes ?? [])];
}

function discard() {
  staged.value = [...written.value];
}

/* -------------------------------------------------------------------- genes */

/**
 * Every gene, applicable or not, with the reason when not.
 *
 * ALL OF THEM, ALWAYS. A gene that does not fit the selected body is still a
 * fact about the game, and a list that quietly shortened itself as you clicked
 * around the left-hand column would make the system look smaller than it is and
 * give the player no way to find out what a scavenger is missing out on.
 */
const genes = computed(() => GENE_ORDER.map((id) => {
  const gene = GENES[id];
  const why = subject.value ? blockedBecause(gene, subject.value) : 'Nothing selected.';
  const isIn = written.value.includes(id);
  const isStaged = staged.value.includes(id);
  return {
    ...gene,
    why,
    blocked: Boolean(why),
    written: isIn,
    staged: isStaged,
    // Three states the row can be in beyond plain: already there, going in,
    // coming out. Named here so the template is not a nest of conditionals.
    mark: isIn && !isStaged ? 'out' : !isIn && isStaged ? 'in' : isIn ? 'held' : null,
  };
}));

/* ------------------------------------------------------------------- traits */

/**
 * What a trait MEANS, in the units the rest of the game quotes.
 *
 * A multiplier is not an effect. "×1.15 pace" is arithmetic; "a trip every
 * 10.4s, was 12.0s" is the thing that actually happens, and it is what makes
 * the difference between two genes legible when one of them moves a trait the
 * player has never thought about. So every trait renders a concrete figure as
 * well as its multiplier, and the figure is computed per subject because a
 * forager's cycle and an explorer's expedition are the same trait landing in
 * two different places.
 */
function concrete(traitId, value) {
  const s = subject.value;
  if (!s || s.kind !== 'drone') return null;
  const def = DRONE_TYPES[s.typeId];

  if (traitId === 'pace') {
    if (def.gather) return `a trip every ${(FORAGE_CYCLE / value).toFixed(1)}s`;
    if (def.expedition) {
      // Straight off the real function, which already folds pace in — so this
      // cannot disagree with the Territory tab about how long a trip takes.
      // Previewed by scaling the live figure, since the hypothetical genome is
      // not in the state for it to read.
      const now = expeditionSeconds(state, s.typeId);
      const live = traitsOf(state, s.id).pace || 1;
      return `an expedition every ${Math.round((now * live) / value)}s`;
    }
    return 'nothing on a cycle yet';
  }
  if (traitId === 'appetite') {
    return `${formatPower(DRONE_RATION_JOULES * value)} each`;
  }
  return null;
}

/** One row per trait: what it is now, what the proposal would make it. */
const rows = computed(() => {
  if (!subject.value) return [];
  const now = traitsOf(state, subject.value.id);
  const next = traitsOf(state, subject.value.id, staged.value);
  return TRAIT_ORDER.map((id) => {
    const def = TRAITS[id];
    const delta = next[id] - now[id];
    const moved = Math.abs(delta) > 1e-9;
    // Which way is better is declared, not guessed — see definitions/genes.js
    // on why this layer states it and the modifier layer refuses to.
    const better = def.better === 'down' ? delta < 0 : delta > 0;
    return {
      id,
      name: def.name,
      desc: def.desc,
      now: now[id],
      next: next[id],
      moved,
      tone: !moved ? '' : better ? 'good' : 'bad',
      nowText: concrete(id, now[id]),
      nextText: concrete(id, next[id]),
      // Plain means "no gene anywhere touches this", which is worth saying
      // differently from "a gene touches it and the proposal does not move it".
      plain: Math.abs(now[id] - 1) < 1e-9 && !moved,
    };
  });
});

/** Genes currently written in, for the line under the subject's name. */
const heldNames = computed(() => written.value.map((id) => GENES[id].name));

function pct(value) {
  const sign = value >= 0 ? '+' : '−';
  return `${sign}${Math.abs(value * 100).toFixed(0)}%`;
}

/** What a gene would do, as a list of trait movements, for its own row. */
function effectsOf(gene) {
  return Object.entries(gene.effects || {}).map(([id, value]) => ({
    id,
    name: TRAITS[id].name,
    text: pct(value),
    tone: (TRAITS[id].better === 'down' ? value < 0 : value > 0) ? 'good' : 'bad',
  }));
}

/** Molding status for the subject line — "none standing" is worth saying. */
function standing(s) {
  if (!s.unlocked) return { text: 'cannot be grown yet', tone: 'muted' };
  if (!s.count) return { text: 'none standing', tone: 'muted' };
  return { text: `${s.count} standing`, tone: '' };
}

const totalWritten = computed(
  () => subjects.value.reduce((a, s) => a + s.genes.length, 0),
);
</script>

<template>
  <div class="gene-cols">
    <!-- ------------------------------------------------------- what it goes into -->
    <div class="panel-box gene-col">
      <div class="panel-head">
        <span>Bodies</span>
        <span class="muted num">{{ totalWritten }} written</span>
      </div>

      <div v-for="band in bands" :key="band.kind" class="panel-body tight">
        <div class="gene-band">
          {{ band.def.name }}
          <!-- The blurb says what the kind IS; the empty line says that there
               is none of it. A band with no rows needs only the second, and
               printing both made the buildings band say the same thing twice. -->
          <span v-if="band.rows.length" class="muted">{{ band.def.blurb }}</span>
        </div>

        <button
          v-for="s in band.rows"
          :key="s.id"
          class="gene-subject"
          :class="{ 'is-on': s.id === picked, 'is-locked': !s.unlocked }"
          @click="picked = s.id"
        >
          <span class="gene-subject-name">
            {{ s.name }}
            <span class="muted">{{ DRONE_CASTES[DRONE_TYPES[s.typeId]?.caste]?.name }}</span>
          </span>
          <span class="gene-subject-right">
            <span v-if="s.genes.length" class="gene-count good">{{ s.genes.length }}</span>
            <span class="num muted">{{ s.unlocked ? s.count : '—' }}</span>
          </span>
        </button>

        <p v-if="!band.rows.length" class="gene-empty muted">{{ band.def.empty }}</p>
      </div>
    </div>

    <!-- ---------------------------------------------------------- what it does -->
    <div class="panel-box gene-col">
      <div class="panel-head">
        <span>What it does</span>
        <span v-if="dirty" class="warn num">unwritten</span>
      </div>

      <template v-if="subject">
        <div class="panel-body">
          <div class="gene-subject-head">
            <span class="gene-title">{{ subject.name }}</span>
            <span class="muted" :class="standing(subject).tone">
              {{ standing(subject).text }}
            </span>
          </div>
          <p class="muted gene-desc">{{ subject.desc }}</p>
          <p class="gene-held">
            <template v-if="heldNames.length">
              Written in: <span class="good">{{ heldNames.join(', ') }}</span>
            </template>
            <template v-else><span class="muted">A plain genome. Nothing written in.</span></template>
          </p>
        </div>

        <!-- One block per trait. The arrow only appears when something moves,
             so a screen with no proposal on it is a plain statement of what
             this body currently is. -->
        <div class="panel-body tight gene-traits">
          <div v-for="r in rows" :key="r.id" class="gene-trait" :class="{ 'is-moved': r.moved }">
            <div class="gene-trait-top">
              <span class="gene-trait-name" :class="r.plain ? 'muted' : ''">{{ r.name }}</span>
              <span class="gene-trait-nums num">
                <span :class="r.moved ? 'muted' : ''">×{{ r.now.toFixed(2) }}</span>
                <template v-if="r.moved">
                  <span class="gene-arrow">→</span>
                  <span :class="r.tone">×{{ r.next.toFixed(2) }}</span>
                </template>
              </span>
            </div>
            <div v-if="r.nowText" class="gene-trait-real">
              <span :class="r.moved ? 'muted strike' : 'muted'">{{ r.nowText }}</span>
              <template v-if="r.moved">
                <span class="gene-arrow muted">→</span>
                <span :class="r.tone">{{ r.nextText }}</span>
              </template>
            </div>
            <div class="gene-trait-desc muted">{{ r.desc }}</div>
          </div>
        </div>

        <div class="panel-body gene-commit">
          <span v-if="!dirty" class="muted">
            Pick a gene on the right to see what it would change.
          </span>
          <span v-else class="gene-commit-what">
            <span v-if="added.length" class="good">
              writing in {{ added.map((id) => GENES[id].name).join(', ') }}
            </span>
            <span v-if="added.length && removed.length" class="muted"> · </span>
            <span v-if="removed.length" class="warn">
              taking out {{ removed.map((id) => GENES[id].name).join(', ') }}
            </span>
          </span>
          <span class="gene-commit-buttons">
            <button class="focus-clear" :disabled="!dirty" @click="discard">discard</button>
            <button class="btn gene-write" :disabled="!dirty" @click="commit">Write it in</button>
          </span>
        </div>
      </template>

      <div v-else class="panel-body">
        <p class="muted">Pick a body on the left.</p>
      </div>
    </div>

    <!-- ------------------------------------------------------------ the genes -->
    <div class="panel-box gene-col">
      <div class="panel-head">
        <span>Genes</span>
        <span class="muted num">{{ genes.length }} known</span>
      </div>

      <div class="panel-body tight">
        <!-- Blocked genes are listed and dimmed rather than hidden, and they
             print the reason. A locked door with no sign on it is the worst
             thing an interface can do, and the reason is usually a fact about
             the body that is worth knowing on its own. -->
        <button
          v-for="g in genes"
          :key="g.id"
          class="gene-row"
          :class="[g.blocked ? 'is-blocked' : '', g.mark ? `is-${g.mark}` : '']"
          :disabled="g.blocked"
          @click="toggle(g.id)"
        >
          <span class="gene-row-top">
            <span class="gene-row-name">{{ g.name }}</span>
            <span class="gene-row-effects">
              <span v-for="e in effectsOf(g)" :key="e.id" class="gene-eff" :class="e.tone">
                {{ e.name }} {{ e.text }}
              </span>
            </span>
          </span>
          <span class="gene-row-desc muted">{{ g.desc }}</span>
          <span v-if="g.blocked" class="gene-row-why bad">{{ g.why }}</span>
          <span v-else-if="g.mark === 'in'" class="gene-row-state good">going in</span>
          <span v-else-if="g.mark === 'out'" class="gene-row-state warn">coming out</span>
          <span v-else-if="g.mark === 'held'" class="gene-row-state muted">written in</span>
          <span v-else class="gene-row-state muted">click to try it</span>
        </button>
      </div>

      <div class="panel-body gene-note muted">
        Genes cost nothing and take effect the moment they are written. Both of those are
        placeholders.
      </div>
    </div>
  </div>
</template>
