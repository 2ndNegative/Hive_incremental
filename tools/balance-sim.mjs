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
import {
  computeDerived, tick, queueRoom, canAfford, structureCost, inFlightCount, droneCount,
} from '../src/game/engine.js';
import {
  buildStructure, setMolding, setActive, research, consumeBiomass,
} from '../src/game/actions.js';
import { chooseOrigin, originsFor } from '../src/game/run.js';
import { RESEARCH, RESEARCH_ORDER } from '../src/game/definitions/research.js';
import { STRUCTURE_ORDER, STRUCTURES } from '../src/game/definitions/structures.js';
import { payableCost } from '../src/game/definitions/nutrients.js';
import { DRONE_TYPES, DRONE_TYPE_ORDER } from '../src/game/definitions/drones.js';
import { NUTRIENTS, MACROS, MICROS, isRevealed } from '../src/game/definitions/nutrients.js';
import { holdings, totalArea } from '../src/game/definitions/biomes.js';
import { formatDuration } from '../src/game/format.js';
import { formatMass, formatEnergy, formatPower, formatMassFlow } from '../src/game/units.js';

const hours = Number(process.argv[2]) || 6;
const quiet = process.argv.includes('--quiet');
const STEP = 1;
const TOTAL = hours * 3600;

/* ------------------------------------------------------------ determinism
 *
 * THE SAME COMMAND HAS TO GIVE THE SAME ANSWER. It did not: two runs of
 * `balance-sim.mjs 3 --quiet`, same code, same everything, came back with
 * `0/12 research, 0 micronutrients resolved, stalled before Glycolysis` and
 * `7/12 research, 11 resolved, stalled before Cellulolysis`.
 *
 * That is not noise around a figure, it is two different games. The forage
 * rolls decide which items the hive finds in its first minutes, and a bad
 * opening compounds — no protein means no drones means no gathering means no
 * protein. Which is a genuinely interesting thing to know about the economy,
 * and completely useless as a regression check: a tool whose answer moves on
 * its own cannot tell you that a change moved it.
 *
 * So the whole run goes through one seeded generator. `--seed N` picks a
 * different game; the default is fixed, so a figure in the docs means
 * something and a change that moves it was a change.
 *
 * mulberry32: four lines, good enough for this, and no dependency. The point
 * is reproducibility, not statistical quality.
 *
 * ONE RUN IS ONE SAMPLE. Before reading a number here as a balance result,
 * sweep a few seeds — the spread above is the hive's real variance and it is
 * wide. `for s in 1 2 3 4 5; do node tools/balance-sim.mjs 6 --quiet --seed $s; done`
 */
const seedArg = process.argv.indexOf('--seed');
const SEED = seedArg > -1 ? Number(process.argv[seedArg + 1]) || 1 : 1;
Math.random = (() => {
  let a = SEED >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();

/** Drones at which the bot stops consuming biomass by hand. See the loop. */
const CLICK_UNTIL = 12;

/**
 * WHAT THE BOT BUILDS, AND IN WHAT ORDER.
 *
 * Every id here must be in STRUCTURE_ORDER — a bot driving parked buildings is
 * a bot driving nothing, and that is exactly how this file came to report a
 * dead hive for weeks while exiting 0. The assertion below enforces it.
 *
 * The order is roughly what a player reading the screen would do: the organs
 * that turn matter into energy and larvae into drones first, then room to put
 * things, then thinking.
 */
const BUILD_PRIORITY = [
  // Brood and molding first, and in that order: they are what turns mass into a
  // workforce, and until the hive has one every other building is something it
  // paid for and cannot use. The generator comes straight after, because
  // everything built so far draws watts and nothing yet makes any.
  'broodChamber',
  'moldingChamber',
  'metabolicGenerator',
  // The gut before the drone cap: harvested matter that is not broken down
  // simply rots where it lies, so a hive without one has no nutrient income at
  // all however many drones it is allowed. Measured without it: 273 kg spoiled
  // in six hours and not one research passed.
  'caecum',
  // THE ONLY SOURCE OF INSIGHT IN THE LIVE GAME is the Interlocutor
  // (structures.js — 0.2/s). The Analyst caste that used to supply it is
  // parked, so a hive without one never passes a single research, whatever else
  // it builds. The Nerve Node in front of it is for the cognition it draws.
  'nodeCluster',
  'interlocutor',
  'hivecore',
  'cistern',
  'celluloseBale',
  'proteinGranule',
  'crop',
  'nodeCluster',
  'glycogenGranule',
  'lipidDroplet',
  'gizzard',
  'vacuole',
  'memoryBank',
];

for (const id of BUILD_PRIORITY) {
  if (!STRUCTURE_ORDER.includes(id)) {
    throw new Error(
      `balance-sim BUILD_PRIORITY names "${id}", which is not in STRUCTURE_ORDER. `
      + 'A bot that builds parked structures measures nothing.',
    );
  }
}

/**
 * Switch the molding chambers on for everything the hive is allowed to make.
 *
 * This is what raises a workforce now — the caste assignment this function used
 * to do is gone with the castes. A chamber with nothing switched on sits idle
 * however many larvae the brood produces, so without this the hive never gets
 * a single drone and every number below it is a measurement of nothing.
 */
function botMold(derived) {
  // ONLY WHILE THERE IS ROOM FOR WHAT IT PRESSES. Molding a drone costs protein,
  // and a chamber left switched on at the drone cap goes on spending it for
  // drones the hive cannot hold — measured at ten drones against a cap of
  // three, with protein pinned at 15 g and an Interlocutor the hive could never
  // save the 250 g for. Which is to say it never passed a single research.
  const room = droneCount(state) < derived.droneCap;
  for (const id of DRONE_TYPE_ORDER) {
    if (!DRONE_TYPES[id].unlock(state)) continue;
    const on = Boolean(state.droneMolding?.[id]?.on);
    if (on !== room) setMolding(id, room);
  }
}

function botAct() {
  const derived = computeDerived(state);

  for (const id of derived.unlocked.research) research(id);

  // Builds take time and go through the queue, so there is no point lining up
  // more than it will hold — and filling it with one thing would starve
  // everything behind it.
  if (queueRoom(state) <= 0) return;

  // Gut and storage are demand-driven, the way a player reading the Storage tab
  // would do it. Building either before there is pressure burns seed protein the
  // hive needs for its first drones — which is itself worth knowing.
  const backlogPressure = Object.values(state.items || {}).some((g) => g > derived.itemCap * 0.6);
  const spoiling = Object.values(derived.itemSpill).some((r) => r > 0);

  // ONE OF EACH BEFORE A SECOND OF ANYTHING.
  //
  // Two passes, and the order matters more than it looks. A single pass that
  // let `readyForMore` promote a repeat ahead of a building the hive does not
  // own at all means the first thing with standing demand hogs the list: the
  // measured result was a bot waiting indefinitely on a fourth Metabolic
  // Generator it could not afford the iron for, while 274 kg of harvest rotted
  // for want of a Digestive Caecum it had never built once.
  for (const pass of ['first', 'more']) {
  for (const id of BUILD_PRIORITY) {
    if (!derived.unlocked.structures.includes(id)) continue;
    if (pass === 'first' && owned(id) >= 1) continue;
    if (pass === 'more' && (owned(id) < 1 || !readyForMore(id, derived))) continue;
    if (id === 'caecum' && derived.digestRatio > 0.98) continue;
    if (id === 'crop' && !backlogPressure && !spoiling) continue;
    if (id === 'metabolicGenerator' && derived.energy.ratio > 0.98
        && derived.energy.throughputRatio > 0.98) continue;
    // THE FIRST THING THAT WANTS BUILDING IS THE TARGET, and if the hive cannot
    // pay for it yet the bot SAVES UP rather than buying something cheaper.
    //
    // This is the one line that decides whether the bot plays the game or
    // merely spends. Falling through to the next item on a failed affordability
    // check looks reasonable and is not: the priority list is sorted roughly by
    // cost, so a hive short of fibre for a Molding Chamber would buy a Cistern
    // instead, every time, and never accumulate enough for the chamber. The
    // measured result was a two-hour run that built three Cisterns, sat on
    // sixty-one larvae and never pressed a single drone.
    //
    // It also keeps the queue honest: it is strictly head-first, so a job the
    // hive cannot afford blocks everything behind it anyway.
    const cost = structureCost(state, id, 1);
    if (!canAfford(state, cost)) {
      starveTheBrood(cost);
      return;
    }
    broodRunning(true);
    if (buildStructure(id, 1)) return;
  }
  }
}

/**
 * STOP LAYING WHILE SAVING UP FOR SOMETHING THE BROOD IS EATING.
 *
 * A brood chamber spends 60 g of protein every twenty seconds and does not care
 * what else the hive wants that protein for. Two of them hold the stores at
 * roughly 30 g in perpetuity — so a Molding Chamber at 50 g protein is never
 * affordable, the hive never presses a drone, and it sits on fifty larvae it
 * cannot use. That is a real trap and a player hits it too; the way out is the
 * switch on the card, which is what this does.
 *
 * Only for protein, and only while the target actually needs more than the hive
 * holds: idling the nursery is a cost, and a bot that did it on principle would
 * measure a hive that never grows.
 */
function starveTheBrood(cost) {
  const wants = cost.protein || 0;
  broodRunning(!(wants > 0 && (state.nutrients.protein || 0) < wants));
}

function broodRunning(on) {
  if (!(state.structures.broodChamber > 0)) return;
  const running = state.active?.broodChamber ?? state.structures.broodChamber;
  if (on && running === 0) setActive('broodChamber', 'all');
  else if (!on && running > 0) setActive('broodChamber', 'none');
}

/**
 * HOW MANY OF SOMETHING THE HIVE IS GOING TO HAVE — standing, queued, and the
 * one on the bench.
 *
 * `state.structures` counts only what is FINISHED, and since build time landed
 * a job can sit in the queue for twenty minutes before it shows up there. A bot
 * reading the finished count alone queues the same building on every tick until
 * the first one lands: the measured result was a queue permanently full of
 * Brood Chambers, no room left for the Molding Chamber behind them, and a hive
 * that never pressed a drone in six hours.
 */
function owned(id) {
  return (state.structures[id] || 0) + inFlightCount(state, id);
}

/** Is there pressure to add a SECOND of something the hive already has? */
function readyForMore(id, derived) {
  if (id === 'metabolicGenerator') {
    return derived.energy.ratio < 0.95 || derived.energy.throughputRatio < 0.95;
  }
  // Only when raw matter is actually backing up. digestRatio reads 0 when
  // nothing is being harvested at all, so testing it alone had the bot building
  // a seventh Digestive Caecum for a hive with no drones and nothing to digest.
  if (id === 'caecum') return derived.itemHeld > 0 && derived.digestRatio < 0.9;
  // Brood and molding are a pair, and the LARVA COUNT is what says which end is
  // short. Testing brood against the drone cap instead had the bot stacking
  // brood chambers while 63 larvae sat in them with nothing to press them into.
  // A second brood chamber before the first molding chamber is a trap the bot
  // fell into and a player would too: larvae EAT, so a hive laying faster than
  // it can press is spending its whole carbohydrate income feeding a queue of
  // things that never become drones. One brood chamber until something can
  // turn its output into a workforce.
  if (id === 'broodChamber') {
    return owned('moldingChamber') >= 1
      && (state.larvae || 0) < 3
      && droneCount(state) < derived.droneCap;
  }
  // Larvae piling up is only a reason for another press if there is somewhere
  // to put what it presses. Without the cap check the bot built five Molding
  // Chambers for a hive that could hold three drones, because the larvae it
  // could not press kept reading as demand.
  if (id === 'moldingChamber') {
    return (state.larvae || 0) > 10 && droneCount(state) < derived.droneCap;
  }
  // Room for drones is the Hivecore's job, so a hive pressed up against its cap
  // takes a level rather than growing more of anything else.
  if (id === 'hivecore') return droneCount(state) >= derived.droneCap;
  // Storage: only when something is actually spilling or nearly full.
  const caps = derived.caps || {};
  for (const [n, grams] of Object.entries(state.nutrients)) {
    if (caps[n] > 0 && grams > caps[n] * 0.9) return true;
  }
  return false;
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
  // A PLAYER KEEPS CLICKING UNTIL THE HIVE FEEDS ITSELF. The old bot clicked
  // for two minutes and then stopped on principle — "the hive has to stand on
  // its own" — which was fine when drones were assigned from a pool that
  // already existed. Now a workforce has to be GROWN: brood, then molding, then
  // drones, and none of it happens without seed mass.
  //
  // CLICK_UNTIL is where that stops. Measured: cutting it off at two drones
  // collapsed intake from 336 kg to 50 kg and the hive spent 38% of its ticks
  // starving, because five foragers on 36 m² do not replace a player's hand.
  // The figure is a statement about the EARLY GAME, not a bot convenience — if
  // it has to keep rising to keep the sim alive, that is the finding.
  if (droneCount(state) < CLICK_UNTIL) consumeBiomass();

  const derived = tick(state, STEP);
  if (derived.energy.ratio < 0.999) starvedTicks += 1;
  botMold(derived);
  botAct();
  elapsed += STEP;

  for (const id of RESEARCH_ORDER) {
    if (state.tech[id] && !milestones.some((m) => m.id === id)) {
      milestones.push({ id, at: state.playtime });
      if (!quiet) {
        console.log(
          `[${formatDuration(state.playtime)}] ${RESEARCH[id].name.padEnd(22)}` +
            ` drones ${String(droneCount(state)).padStart(3)}` +
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
console.log(`drones          ${droneCount(state)} / ${derived.droneCap}`);
console.log(
  `drone types     ${DRONE_TYPE_ORDER.filter((t) => state.droneTypes?.[t])
    .map((t) => `${DRONE_TYPES[t].name} ${state.droneTypes[t]}`).join(', ') || 'none'}`,
);
console.log(`larvae          ${Math.floor(state.larvae || 0)}`);
console.log(
  `structures      ${STRUCTURE_ORDER.filter((s) => state.structures[s]).map((s) => `${STRUCTURES[s].name} ${state.structures[s]}`).join(', ') || 'none'}`,
);
console.log(`energy stored   ${formatEnergy(derived.energy.stored)} (${formatEnergy(derived.energy.usable)} burnable)`);
console.log(
  `energy draw     ${formatPower(derived.energy.delivered)} / ${formatPower(derived.energy.demand)} demand, ceiling ${formatPower(derived.energy.throughput)}`,
);
console.log(`intake          ${formatMassFlow(derived.ingestRate)}  (lifetime ${formatMass(state.stats.ingested)})`);
console.log(`insight         ${Math.floor(state.insight)} / ${Math.round(derived.insightCap)}  (+${derived.insightRate.toFixed(2)}/s)`);
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
  console.log(`territory       ${totalArea(state).toFixed(0)} m² — ${holdings(state).map((h) => `${h.def.name} ${h.area.toFixed(0)}`).join(', ') || 'none'}`);
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

/**
 * A DEAD HIVE IS A FAILURE, not a report.
 *
 * This file spent weeks printing "0 drones, 0/12 research" and exiting 0,
 * because the bot was driving castes and a generator that had all been parked.
 * `npm run balance` looked like it worked. Nothing that measures the economy
 * should be able to measure nothing and call it success — so the floor here is
 * not a balance target, it is a liveness check on the SIMULATOR: a hive that
 * raised no drones or passed no research in six hours means the bot is broken,
 * whatever the economy is doing.
 *
 * Raise these only if the game genuinely changes shape. They are deliberately
 * far below anything a playable balance would hit.
 */
/* ------------------------------------------------- can the hive still grow?
 *
 * THE STORAGE WALL. A building you cannot save up for is a building you can
 * never build, and if that building is the one that would have given you the
 * room, the run is over without anything saying so. The hive just stops.
 *
 * It bit fibre first and for a structural reason: fibre is what everything is
 * made of AND what its own store is priced in, so the Cellulose Bale was
 * bidding against itself. At `steady` the tenth bale cost 7.2 kg against the
 * 7.0 kg the hive could hold — a dead end with no message.
 *
 * The shape of it is general, though, and that is why this checks every
 * resource rather than the one that happened to break: a cost that grows
 * geometrically against a capacity that grows arithmetically always crosses.
 * The question is only whether it crosses somewhere a player will reach.
 *
 * NOT a failure. A wall at forty of something is a curiosity; a wall at ten is
 * a soft-lock. Only a human can say which, so this reports and does not judge.
 */
const walls = [];
for (const id of STRUCTURE_ORDER) {
  const def = STRUCTURES[id];
  for (let n = 0; n < 40; n += 1) {
    // THROUGH payableCost, or this lies about every mineral the hive cannot
    // see yet. A Gizzard's 10 g of iron is really 500 g of mineral mass before
    // the assay, measured against the ash shelf rather than the iron one — and
    // reading it as iron reported four buildings as walled at zero when none
    // of them is.
    const cost = payableCost(state, def.cost(n));
    // What the hive could hold, with n of this already standing. `capsMax` is
    // the honest ceiling: dedicated room plus whatever the shared pool adds.
    const ceiling = derived.capsMax;
    const over = Object.entries(cost).find(([res, grams]) => grams > (ceiling[res] ?? Infinity));
    if (!over) continue;
    walls.push({ id, n, resource: over[0], cost: Math.round(over[1]), ceiling: Math.round(ceiling[over[0]] ?? 0) });
    break;
  }
}
if (walls.length) {
  console.log('\nstorage walls  (cost of the next one exceeds what the hive can hold)');
  for (const w of walls.sort((a, b) => a.n - b.n)) {
    console.log(`  ${STRUCTURES[w.id].name.padEnd(20)} stops at ${String(w.n).padStart(3)}`
      + `  — needs ${formatMass(w.cost)} of ${w.resource}, can hold ${formatMass(w.ceiling)}`);
  }
  console.log('  Measured against THIS run\'s storage, so it moves as the hive grows.');
}

const dead = [];
if (droneCount(state) < 1) dead.push('no drones were ever raised');
if (state.stats.ingested <= 0) dead.push('nothing was ever ingested');
if ((state.structures.moldingChamber || 0) < 1) dead.push('no molding chamber was ever built');
if (dead.length) {
  console.log(`\nSIMULATOR FAILURE: ${dead.join('; ')}.`);
  console.log('The bot is not driving the game — check it against the live systems.');
  process.exit(1);
}

// A hive that is demonstrably ALIVE and still gets nowhere is a balance result,
// not a broken tool, so it is loud but it is not a failure. Keeping the two
// apart is the whole point: the previous version of this file could not tell
// "my bot drives parked systems" from "the economy is too tight", and reported
// the first as the second for weeks.
if (done < 1) {
  console.log('\nWARNING: the hive raised a workforce but passed no research at all.');
  console.log('That is a balance result, not a broken simulator — read the figures above.');
}
