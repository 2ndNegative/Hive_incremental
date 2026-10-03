#!/usr/bin/env node
/**
 * Headless balance simulator.
 *
 * Runs the real engine with a greedy bot so you can see how the economy behaves
 * after changing a cost, a yield or an energy density — no browser, no clicking.
 *
 *   node tools/balance-sim.mjs            # 6 hours of simulated time
 *   node tools/balance-sim.mjs 24         # 24 hours
 *   node tools/balance-sim.mjs 6 --quiet  # final report only
 *
 * The bot keeps the hive fed first, then researches, then builds. If it can get
 * through the assay ladder without starving, the numbers are playable.
 */

import { state } from '../src/game/state.js';
import { computeDerived, tick } from '../src/game/engine.js';
import { buildStructure, assignCaste, research, consumeBiomass } from '../src/game/actions.js';
import { chooseOrigin, originsFor } from '../src/game/run.js';
import { RESEARCH, RESEARCH_ORDER } from '../src/game/definitions/research.js';
import { STRUCTURE_ORDER, STRUCTURES } from '../src/game/definitions/structures.js';
import { CASTE_ORDER, CASTES } from '../src/game/definitions/castes.js';
import { NUTRIENTS, MACROS, MICROS, isRevealed } from '../src/game/definitions/nutrients.js';
import { formatDuration } from '../src/game/format.js';
import { formatMass, formatEnergy, formatPower, formatMassFlow } from '../src/game/units.js';

const hours = Number(process.argv[2]) || 6;
const quiet = process.argv.includes('--quiet');
const STEP = 1;
const TOTAL = hours * 3600;

const BUILD_PRIORITY = [
  'caecum',
  'crop',
  'thermalVent',
  'gutSac',
  'nodeCluster',
  'assayChamber',
  'mineralVault',
  'boreShaft',
  'ambushBurrow',
  'vitaminLattice',
];

function botAssign() {
  const derived = computeDerived(state);
  // Keep one siphon for water, then favour whichever intake caste is unlocked
  // and pays best, with a steady minority on analysis.
  while (state.castes.dormant > 0) {
    if (state.castes.siphon < 1) {
      if (assignCaste('siphon', 1)) continue;
    }
    if (derived.unlocked.castes.includes('hunter') && state.castes.hunter < derived.slots.hunter) {
      if (assignCaste('hunter', 1)) continue;
    }
    if (derived.unlocked.castes.includes('excavator') && state.castes.excavator < derived.slots.excavator) {
      if (assignCaste('excavator', 1)) continue;
    }
    // Roughly one analyst for every two intake drones.
    const intake = state.castes.forager + state.castes.scavenger + state.castes.hunter;
    const target = state.castes.analyst * 2 <= intake ? 'analyst' : null;
    if (target && assignCaste(target, 1)) continue;
    if (derived.unlocked.castes.includes('scavenger') && assignCaste('scavenger', 1)) continue;
    if (assignCaste('forager', 1)) continue;
    break;
  }
}

function botAct() {
  const derived = computeDerived(state);

  for (const id of derived.unlocked.research) research(id);

  // Keep the metabolic ceiling ahead of demand, or everything throttles.
  if (derived.energy.throughputRatio < 1 && buildStructure('thermalVent', 1)) return;

  // Gut and storage are demand-driven, the way a player reading the Storage tab
  // would do it. Building either before there is pressure burns seed protein the
  // hive needs for its first drones — which is itself worth knowing.
  const backlogPressure = Object.values(state.items || {}).some((g) => g > derived.itemCap * 0.6);
  const spoiling = Object.values(derived.itemSpill).some((r) => r > 0);

  for (const id of BUILD_PRIORITY) {
    if (!derived.unlocked.structures.includes(id)) continue;
    // Do not add drone capacity the hive cannot feed.
    if (id === 'nodeCluster' && derived.energy.ratio < 0.95) continue;
    if (id === 'caecum' && derived.digestRatio > 0.98) continue;
    if (id === 'crop' && !backlogPressure && !spoiling) continue;
    if (buildStructure(id, 1)) return;
  }
}

// A run with no landing site has no drones and no starting mass, and the engine
// correctly refuses to tick it. Land on the first site available to a fresh
// save, the same way a new player would.
if (!state.origin) {
  const site = originsFor().unlocked[0];
  if (!site) {
    console.log('no landing site is available to a fresh save — nothing to simulate');
    process.exit(1);
  }
  chooseOrigin(site.id);
  if (!quiet) console.log(`landed at ${site.name}\n`);
}

const milestones = [];
let elapsed = 0;
let starvedTicks = 0;

while (elapsed < TOTAL) {
  if (elapsed < 120) consumeBiomass();

  const derived = tick(state, STEP);
  if (derived.energy.ratio < 0.999) starvedTicks += 1;
  botAssign();
  botAct();
  elapsed += STEP;

  for (const id of RESEARCH_ORDER) {
    if (state.tech[id] && !milestones.some((m) => m.id === id)) {
      milestones.push({ id, at: state.playtime });
      if (!quiet) {
        console.log(
          `[${formatDuration(state.playtime)}] ${RESEARCH[id].name.padEnd(22)}` +
            ` drones ${String(state.drones).padStart(3)}` +
            `  energy ${formatEnergy(computeDerived(state).energy.usable).padStart(10)}`,
        );
      }
    }
  }
}

const derived = computeDerived(state);
const done = RESEARCH_ORDER.filter((id) => state.tech[id]).length;

console.log('\n=== balance report ===');
console.log(`simulated       ${formatDuration(state.playtime)} (${hours}h)`);
console.log(`research        ${done}/${RESEARCH_ORDER.length}`);
console.log(`drones          ${state.drones} / ${derived.droneCap}`);
console.log(
  `castes          ${CASTE_ORDER.filter((c) => state.castes[c]).map((c) => `${CASTES[c].name} ${state.castes[c]}`).join(', ')}`,
);
console.log(
  `structures      ${STRUCTURE_ORDER.filter((s) => state.structures[s]).map((s) => `${STRUCTURES[s].name} ${state.structures[s]}`).join(', ') || 'none'}`,
);
console.log(`energy stored   ${formatEnergy(derived.energy.stored)} (${formatEnergy(derived.energy.usable)} burnable)`);
console.log(
  `energy draw     ${formatPower(derived.energy.delivered)} / ${formatPower(derived.energy.demand)} demand, ceiling ${formatPower(derived.energy.throughput)}`,
);
console.log(`intake          ${formatMassFlow(derived.ingestRate)}  (lifetime ${formatMass(state.stats.ingested)})`);
console.log(`insight         ${Math.floor(state.insight)} / ${derived.insightCap}  (+${derived.insightRate.toFixed(2)}/s)`);
console.log(`starving        ${((starvedTicks / TOTAL) * 100).toFixed(1)}% of ticks, ${state.stats.dronesLost} drones lost`);

{
  const d = computeDerived(state);
  const backlog = Object.values(state.items || {}).reduce((a, b) => a + b, 0);
  const spoiled = Object.values(state.spilledItems || {}).reduce((a, b) => a + b, 0);
  console.log(
    `digestion       ${formatMassFlow(d.digestRate)} of ${formatMassFlow(d.digestion)} gut, ` +
      `harvest ${formatMassFlow(d.harvestRate)} (${(d.digestRatio * 100).toFixed(0)}% kept up with)`,
  );
  console.log(`storage         ${formatMass(backlog)} held, cap ${formatMass(d.itemCap)} each, ${formatMass(spoiled)} spoiled`);
  const queued = Object.entries(state.items || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!quiet && queued.length) {
    for (const [id, grams] of queued) {
      const pct = (grams / d.itemCap) * 100;
      console.log(`  ${id.padEnd(20)} ${formatMass(grams).padStart(9)}  ${pct.toFixed(0)}% full`);
    }
  }
}

console.log('\nmacronutrients');
for (const n of MACROS) {
  console.log(
    `  ${NUTRIENTS[n].name.padEnd(16)} ${formatMass(state.nutrients[n]).padStart(10)} / ${formatMass(derived.caps[n]).padEnd(10)}` +
      ` net ${formatMassFlow(derived.net[n]).padStart(12)}  spilled ${formatMass(state.spilled[n])}`,
  );
}

const hidden = MICROS.filter((n) => !isRevealed(state, n));
const shown = MICROS.filter((n) => isRevealed(state, n));
console.log(`\nmicronutrients  ${shown.length} resolved, ${hidden.length} still invisible`);
const topHidden = hidden
  .map((n) => ({ n, g: state.nutrients[n] || 0, spill: state.spilled[n] || 0 }))
  .sort((a, b) => b.g + b.spill - (a.g + a.spill))
  .slice(0, 5);
for (const h of topHidden) {
  console.log(
    `  (unseen) ${NUTRIENTS[h.n].name.padEnd(16)} holding ${formatMass(h.g).padStart(10)}, quietly discarded ${formatMass(h.spill)}`,
  );
}

if (done < RESEARCH_ORDER.length) {
  const next = RESEARCH_ORDER.find((id) => !state.tech[id] && RESEARCH[id].requires.every((r) => state.tech[r]));
  if (next) console.log(`\nstalled before ${RESEARCH[next].name} — check its cost against current rates.`);
}
console.log('=== simulation finished ===');
