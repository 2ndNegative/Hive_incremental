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
} from './definitions/genes.js';

export { subjectKey, splitSubjectKey };

/* ------------------------------------------------------------------ subjects */

/**
 * Everything genetics can be written into right now.
 *
 * LOCKED TYPES ARE LISTED. A drone the hive cannot grow yet is still a thing
 * genetics applies to, and hiding it makes the tab lie about how big the system
 * is — the player would find out that scavengers take genes by researching
 * scavenging, which is a strange way to learn it. It is listed, marked, and its
 * genome can be written in advance; nothing is wearing it until one exists.
 */
export function geneSubjects(state) {
  const out = [];
  for (const typeId of DRONE_TYPE_ORDER) {
    const def = DRONE_TYPES[typeId];
    out.push({
      id: subjectKey('drone', typeId),
      kind: 'drone',
      typeId,
      name: def.name,
      desc: def.desc,
      count: state?.droneTypes?.[typeId] || 0,
      unlocked: def.unlock ? Boolean(def.unlock(state)) : true,
      genes: genomeOf(state, subjectKey('drone', typeId)),
    });
  }
  return out;
}

/** One subject by key, or null. */
export function subjectOf(state, key) {
  return geneSubjects(state).find((s) => s.id === key) ?? null;
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
    READ.add(id);
    out[id] = Math.max(TRAITS[id].floor ?? 0, 1 + total[id]);
  }
  return out;
}

/**
 * One trait of one subject. The engine's door into this file.
 *
 * Takes a key rather than a subject so a hot path does not rebuild the whole
 * subject list to ask about one drone type — see the memo below.
 */
export function trait(state, key, id) {
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
