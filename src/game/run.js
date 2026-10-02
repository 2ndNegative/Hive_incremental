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
import { formatDuration } from './format.js';
import { formatMass } from './units.js';

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
