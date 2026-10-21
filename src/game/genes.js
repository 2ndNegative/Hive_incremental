// THE GENE LAYER: what is written into what, and what that does to it.
//
// The shape of this file is land.js's: the definitions say what a gene IS, and
// this works out what the hive's genes currently mean for a given subject. The
// engine asks it one question — `trait(state, subjectKey, 'pace')` — and the
// Genetics tab asks it the same question twice, once as things stand and once
// with a hypothetical genome, which is the whole of the preview.
//
// THAT SECOND CALL IS WHY `traitsOf` TAKES AN OVERRIDE. A preview that
// recomputed the numbers by a parallel route would be a second implementation
// of the thing it is previewing, and the two would agree right up until one of
// them was edited. Here the preview is the real function with a different
// genome handed to it, so a screen that says "+15%" is reporting what the
// engine will actually do.

import { DRONE_TYPES, DRONE_TYPE_ORDER } from './definitions/drones.js';
import {
  GENES, GENE_ORDER, TRAITS, TRAIT_ORDER, subjectKey, splitSubjectKey,
  SUBJECT_KIND_ORDER,
} from './definitions/genes.js';

export { subjectKey, splitSubjectKey };

/* ------------------------------------------------------------------ subjects */

/*
 * ONE BUILDER PER KIND, and a roster that says which kinds exist.
 *
 * Both halves of the subject layer used to be the drone loop written out: the
 * list built every subject, and `subjectOf` built the whole list and then threw
 * all but one away. That is why `trait()` cost 1.2 µs a call with 0.6 of it in
 * `subjectOf` — the engine asks for a trait per drone type per tick, and every
 * one of those calls ran `unlock(state)` and rebuilt the genome for EVERY type
 * to answer about one.
 *
 * It also meant the second kind of subject — buildings, declared and empty in
 * definitions/genes.js — would have had to be added to the list and to the
 * lookup, separately, and the lookup is the one you forget: it fails as "genes
 * silently do nothing to buildings", not as an error.
 *
 * So: a builder per kind, keyed by the kind name the subject key carries.
 * `geneSubjects` walks the roster; `subjectOf` indexes it. Adding buildings is
 * one entry here and one in SUBJECT_KINDS, and neither can be done without the
 * other showing up.
 */
const BUILDERS = {
  /**
   * LOCKED TYPES ARE LISTED. A drone the hive cannot grow yet is still a thing
   * genetics applies to, and hiding it makes the tab lie about how big the
   * system is — the player would find out that scavengers take genes by
   * researching scavenging, which is a strange way to learn it. It is listed,
   * marked, and its genome can be written in advance; nothing is wearing it
   * until one exists.
   */
  drone: {
    ids: () => DRONE_TYPE_ORDER,
    build: (state, typeId) => {
      const def = DRONE_TYPES[typeId];
      if (!def) return null;
      return {
        id: subjectKey('drone', typeId),
        kind: 'drone',
        typeId,
        name: def.name,
        desc: def.desc,
        count: state?.droneTypes?.[typeId] || 0,
        unlocked: def.unlock ? Boolean(def.unlock(state)) : true,
        genes: genomeOf(state, subjectKey('drone', typeId)),
      };
    },
  },
  // `structure` is deliberately absent rather than declared empty here: the
  // KIND is declared in definitions/genes.js, which is what the tab reads to
  // say "buildings, not yet", and a builder with no ids would be a second
  // place claiming the same thing. The load-time check below keeps the two
  // honest in the one direction that matters — a builder for a kind nobody
  // declared.
};

/** Everything genetics can be written into right now. */
export function geneSubjects(state) {
  const out = [];
  for (const kind of SUBJECT_KIND_ORDER) {
    const builder = BUILDERS[kind];
    if (!builder) continue;
    for (const id of builder.ids()) {
      const subject = builder.build(state, id);
      if (subject) out.push(subject);
    }
  }
  return out;
}

/**
 * One subject by key, or null.
 *
 * Builds the one asked for rather than filtering the list, which is the hot
 * path: `trait()` comes through here on every tick for every drone type.
 */
export function subjectOf(state, key) {
  const { kind, id } = splitSubjectKey(key);
  return BUILDERS[kind]?.build(state, id) ?? null;
}

{
  // A builder for a kind the definitions do not declare would build subjects
  // the tab has no column for — present to the engine, invisible to the
  // player, which is the hardest version of this to notice.
  for (const kind of Object.keys(BUILDERS)) {
    if (!SUBJECT_KIND_ORDER.includes(kind)) {
      throw new Error(
        `genes.js builds subjects of kind "${kind}", which definitions/genes.js `
        + `does not declare. Add it to SUBJECT_KINDS or drop the builder.`,
      );
    }
  }
}

/* ------------------------------------------------------------------- genomes */

/**
 * The genes written into a subject, in declared order rather than the order
 * they were added — a genome is a set, and showing it in the order the player
 * happened to click would make the same genome look like two different ones.
 *
 * Unknown ids are dropped rather than carried. A save from a build that had a
 * gene this one does not would otherwise keep summing an effect nothing can
 * explain, and the player would have no way to find or remove it.
 */
export function genomeOf(state, key) {
  const held = state?.genes?.[key];
  if (!Array.isArray(held)) return [];
  return GENE_ORDER.filter((id) => held.includes(id));
}

/** Can this gene go into this subject? The reason it cannot, or null. */
export function blockedBecause(gene, subject) {
  if (!gene || !subject) return 'Nothing selected.';
  return gene.blocks(subject) ?? null;
}

/* -------------------------------------------------------------------- traits */

/** A fresh set of trait totals, every trait present and at zero. */
function emptyTraits() {
  const out = {};
  for (const id of TRAIT_ORDER) out[id] = 0;
  return out;
}

/**
 * What a subject's traits come to, as multipliers.
 *
 * `override` is a genome to use INSTEAD of the one in the state — an array of
 * gene ids. That is the preview, and it is the same arithmetic the engine gets.
 *
 * Genes that do not fit the subject are skipped even if they are somehow
 * written into it. A save edited by hand, or a gene whose `blocks` got stricter
 * between builds, must not be able to give a scavenger a forager's gut.
 */
export function traitsOf(state, key, override = null) {
  const subject = subjectOf(state, key);
  const genome = override ?? genomeOf(state, key);
  const total = emptyTraits();

  for (const id of genome) {
    const gene = GENES[id];
    if (!gene) continue;
    if (subject && gene.blocks(subject) !== null) continue;
    for (const [trait, value] of Object.entries(gene.effects || {})) {
      if (!(trait in total)) continue;
      total[trait] += value;
    }
  }

  const out = {};
  for (const id of TRAIT_ORDER) {
    out[id] = Math.max(TRAITS[id].floor ?? 0, 1 + total[id]);
  }
  return out;
}

/**
 * One trait of one subject. The engine's door into this file.
 *
 * Takes a key rather than a subject so a hot path does not rebuild the whole
 * subject list to ask about one drone type — see BUILDERS above.
 */
export function trait(state, key, id) {
  // RECORDED HERE, where ONE trait is asked for by name.
  //
  // It used to be recorded inside `traitsOf`, which builds the whole map — so
  // a single request for `pace` marked every declared trait as read, and the
  // guard could never fail. Worse, `traitsOf` is also the interface's preview
  // path, so merely opening the Genetics tab satisfied it. A guard that cannot
  // go red is decoration; this one exists because the layer it watches is
  // invisible when it stops working.
  READ.add(id);
  return traitsOf(state, key)[id] ?? 1;
}

/** The same, for a drone type, which is every caller so far. */
export function droneTrait(state, typeId, id) {
  return trait(state, subjectKey('drone', typeId), id);
}

/* ------------------------------------------------------- is anybody reading?
 *
 * The same guard modifiers.js keeps, for the same reason and after the same
 * accident: a layer that computes correctly and is read by nothing looks
 * perfectly healthy from the inside. `traitsOf` writes down which traits it has
 * produced; tests/genes-test.mjs drives the real engine and checks that every
 * trait has reached its declared reader.
 *
 * Note what this does and does not prove. It proves the ENGINE asked for the
 * trait; it cannot prove the engine then used the answer for anything. The test
 * covers that separately by moving a gene in and watching a rate change.
 */
const READ = new Set();

export function traitsRead() {
  return new Set(READ);
}

/**
 * Forget what has been read, so a test can ask the question cleanly.
 *
 * The guard is only worth anything if the reads it counts came from the
 * ENGINE. A suite that pokes `droneTrait` directly and then asks what has been
 * read is marking its own homework, so it resets first, drives one real tick,
 * and asks again.
 */
export function resetTraitsRead() {
  READ.clear();
}

/* ------------------------------------------------------------------ writing */

/**
 * Write a genome. Returns what was actually written, which may be shorter than
 * what was asked for: a gene that does not fit is dropped here rather than
 * stored and ignored, so the save never holds a claim that is not true.
 */
export function setGenome(state, key, geneIds) {
  const subject = subjectOf(state, key);
  if (!subject) return [];
  state.genes ??= {};
  const kept = GENE_ORDER.filter(
    (id) => geneIds.includes(id) && GENES[id].blocks(subject) === null,
  );
  // Sparse on purpose: an empty genome is the absence of an entry, not an
  // entry holding an empty array. Every subject that has never been touched
  // reads the same way as one that has been cleared.
  if (kept.length) state.genes[key] = kept;
  else delete state.genes[key];
  return kept;
}
