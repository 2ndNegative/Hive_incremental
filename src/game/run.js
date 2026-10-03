// Runs.
//
// A "run" is one attempt: the hive from seed mass to wherever it got to.
// Restarting ends the current run and begins a fresh one, keeping everything
// that is meant to outlive a single attempt.
//
//   RESET on restart   nutrient stores, structures, castes, drones, research,
//                      insight, run playtime, run statistics, the message log
//   KEPT on restart    lifetime totals and records, settings, the dev unlock
//   KEPT only until a full wipe   lifetime totals
//
// The prestige layer will hang off this: a reset that also grants something
// permanent is this function plus an award step, so the bookkeeping below is
// deliberately the only place that decides what survives a reset.

import { state, replaceState, createInitialState, pushLog } from './state.js';
import { ORIGINS, originAvailability } from './definitions/origins.js';
import { BIOMES } from './definitions/biomes.js';
import { releaseAllCogits } from './actions.js';
import { formatDuration } from './format.js';
import { formatMass } from './units.js';

/**
 * Add land to the hive.
 *
 * This is the only way territory is ever gained, and nothing calls it yet
 * except the landing site. It exists now so that whatever eventually does the
 * gaining — a claim action, a structure that annexes ground over time, a
 * prestige award, a tech that opens a biome — has one door to come through,
 * and the forage system never has to learn about any of them.
 *
 * Returns the new area of that biome, or 0 if the biome or area was invalid.
 */
export function grantTerritory(biomeId, squareMetres) {
  if (!BIOMES[biomeId] || !(squareMetres > 0)) return 0;
  state.territory ??= {};
  state.territory[biomeId] = (state.territory[biomeId] || 0) + squareMetres;
  return state.territory[biomeId];
}

/** Give land back. Also unused for now; the counterpart of the above. */
export function revokeTerritory(biomeId, squareMetres) {
  if (!BIOMES[biomeId] || !(squareMetres > 0)) return 0;
  const held = state.territory?.[biomeId] || 0;
  const next = Math.max(0, held - squareMetres);
  if (next <= 0) delete state.territory[biomeId];
  else state.territory[biomeId] = next;
  return next;
}

/** What carries over from one run to the next. */
const PRESERVED_KEYS = ['lifetime', 'settings', 'dev'];

/**
 * Fold the finished run into the lifetime record.
 * Totals accumulate; records take the better of the two.
 */
function retireCurrentRun(lifetime) {
  const s = state.stats;
  lifetime.playtime += state.playtime;
  lifetime.clicks += s.clicks;
  lifetime.ingested += s.ingested;
  lifetime.metabolised += s.metabolised;
  lifetime.built += s.built;
  lifetime.researched += s.researched;
  lifetime.dronesLost += s.dronesLost;

  lifetime.bestDrones = Math.max(lifetime.bestDrones, s.peakDrones);
  lifetime.bestPlaytime = Math.max(lifetime.bestPlaytime, state.playtime);
  lifetime.bestResearched = Math.max(lifetime.bestResearched, s.researched);

  // Once a save has been touched by dev tools, it stays marked.
  lifetime.devUsed = lifetime.devUsed || s.devUsed;
  lifetime.runs += 1;
  return lifetime;
}

/**
 * End this run and start a new one. Returns a summary of what was retired.
 */
export function restartRun() {
  const summary = {
    run: state.lifetime.runs,
    playtime: state.playtime,
    drones: state.stats.peakDrones,
    researched: state.stats.researched,
    ingested: state.stats.ingested,
  };

  const lifetime = retireCurrentRun(JSON.parse(JSON.stringify(state.lifetime)));
  const carried = {};
  for (const key of PRESERVED_KEYS) {
    carried[key] = JSON.parse(JSON.stringify(state[key]));
  }
  carried.lifetime = lifetime;

  const tab = state.ui.tab;
  const fresh = createInitialState();
  Object.assign(fresh, carried);
  fresh.ui.tab = tab;
  replaceState(fresh);

  pushLog(
    `Run ${summary.run} ended after ${formatDuration(summary.playtime)} — ` +
      `${summary.drones} drones, ${summary.researched} research, ${formatMass(summary.ingested)} consumed.`,
    'unlock',
  );
  pushLog(`Run ${lifetime.runs} begins. Lifetime records are intact.`, 'info');
  return summary;
}

/** Lifetime totals including the run currently in progress. */
export function lifetimeTotals() {
  const l = state.lifetime;
  const s = state.stats;
  return {
    runs: l.runs,
    playtime: l.playtime + state.playtime,
    clicks: l.clicks + s.clicks,
    ingested: l.ingested + s.ingested,
    metabolised: l.metabolised + s.metabolised,
    built: l.built + s.built,
    researched: l.researched + s.researched,
    dronesLost: l.dronesLost + s.dronesLost,
    bestDrones: Math.max(l.bestDrones, s.peakDrones),
    bestPlaytime: Math.max(l.bestPlaytime, state.playtime),
    bestResearched: Math.max(l.bestResearched, s.researched),
    devUsed: l.devUsed || s.devUsed,
    firstStartedAt: l.firstStartedAt,
  };
}

/* ------------------------------------------------------------- starting site */

/** Has this run been given a starting site yet? */
export function needsOrigin() {
  return !state.origin;
}

export function originsFor() {
  return originAvailability(state.lifetime, state);
}

/**
 * Begin the run at a site. Seeds the opening conditions and nothing else —
 * everything the hive does from here is the player's doing.
 */
export function chooseOrigin(id) {
  const def = ORIGINS[id];
  if (!def) return false;
  if (!def.unlock(state.lifetime, state)) return false;
  if (state.origin) return false; // a run's site is fixed once picked

  const start = def.start || {};
  for (const [nutrient, grams] of Object.entries(start.nutrients || {})) {
    state.nutrients[nutrient] = (state.nutrients[nutrient] || 0) + grams;
  }
  for (const [structure, count] of Object.entries(start.structures || {})) {
    state.structures[structure] = (state.structures[structure] || 0) + count;
  }
  for (const [biome, area] of Object.entries(start.territory || {})) {
    grantTerritory(biome, area);
  }
  const drones = start.drones || 0;
  state.drones += drones;
  state.castes.dormant += drones;
  state.stats.peakDrones = Math.max(state.stats.peakDrones, state.drones);

  // Nothing carries a reservation across the start of a run.
  releaseAllCogits();

  state.origin = id;
  pushLog(`Landed: ${def.name}. ${def.flavour}`, 'unlock');
  pushLog('Consume anything. Work out what it was made of afterwards.', 'info');
  return true;
}

/** The site this run started at, for display. */
export function currentOrigin() {
  return state.origin ? ORIGINS[state.origin] : null;
}
