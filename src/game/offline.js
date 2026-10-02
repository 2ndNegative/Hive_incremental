// Offline catch-up.
//
// There is no cap on how long you can be away. Someone returning after a year
// gets a year simulated — but a year at one-second steps is 31.5 million ticks,
// which would hang the tab for minutes, so the step size scales with the gap:
// the work stays bounded at roughly TARGET_TICKS no matter how long the absence.
//
// Coarser steps are less exact than live play. Production and consumption are
// still integrated correctly; what drifts is anything that depends on crossing a
// threshold mid-step — a store filling and spilling, or growth that should have
// stalled partway through. It is the usual idle-game trade and it errs in the
// player's favour more often than not.
//
// The whole thing runs in chunks between animation frames so the modal can paint
// a progress bar, and so Skip can actually interrupt it.

import { reactive } from 'vue';
import { tick } from './engine.js';
import { NUTRIENT_IDS } from './definitions/nutrients.js';
import { pushLog } from './state.js';
import { logOfflineGain } from './actions.js';
import { formatDuration } from './format.js';

/** Enough resolution to feel honest, few enough ticks to stay responsive. */
const TARGET_TICKS = 20_000;
const MIN_STEP_SECONDS = 1;
const MAX_STEP_SECONDS = 3600;
const TICKS_PER_CHUNK = 400;

/** Absences shorter than this are just applied silently. */
export const MODAL_THRESHOLD_SECONDS = 60;

export const offline = reactive({
  active: false,
  total: 0, // seconds to simulate
  done: 0, // seconds simulated so far
  stepSeconds: 1,
  skipped: false,
});

export function stepSizeFor(totalSeconds) {
  const step = totalSeconds / TARGET_TICKS;
  return Math.min(MAX_STEP_SECONDS, Math.max(MIN_STEP_SECONDS, step));
}

export function skipOffline() {
  offline.skipped = true;
}

/**
 * Simulate `seconds` of absence, yielding to the browser between chunks.
 * Resolves once finished or skipped.
 */
export function runOfflineCatchup(state, seconds) {
  return new Promise((resolve) => {
    if (seconds <= 0) {
      resolve({ applied: 0, skipped: false });
      return;
    }

    const before = {};
    for (const n of NUTRIENT_IDS) before[n] = state.nutrients[n] || 0;

    offline.active = true;
    offline.total = seconds;
    offline.done = 0;
    offline.skipped = false;
    offline.stepSeconds = stepSizeFor(seconds);

    const finish = () => {
      const applied = offline.done;
      const skippedSeconds = offline.total - applied;
      offline.active = false;

      if (applied > 0) logOfflineGain(applied, before);
      if (offline.skipped && skippedSeconds > 1) {
        pushLog(
          `Skipped the remaining ${formatDuration(skippedSeconds)} of dormancy. That progress is gone.`,
          'offline',
        );
      }
      resolve({ applied, skipped: offline.skipped });
    };

    const chunk = () => {
      if (offline.skipped) {
        finish();
        return;
      }
      let ticks = 0;
      while (ticks < TICKS_PER_CHUNK && offline.done < offline.total) {
        const dt = Math.min(offline.stepSeconds, offline.total - offline.done);
        tick(state, dt);
        offline.done += dt;
        ticks += 1;
      }
      if (offline.done >= offline.total) {
        finish();
        return;
      }
      requestAnimationFrame(chunk);
    };

    requestAnimationFrame(chunk);
  });
}
