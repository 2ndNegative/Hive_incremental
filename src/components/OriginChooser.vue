<script setup>
// Shown at the start of every run — a fresh save, a restart, and later a
// prestige reset. Blocking by design: the hive holds nothing and does nothing
// until a site is picked, so there is nothing to lose by leaving it open.

import { computed } from 'vue';
import { state } from '../game/useGame.js';
import { needsOrigin, originsFor, chooseOrigin } from '../game/run.js';
import { NUTRIENTS } from '../game/definitions/nutrients.js';
import { STRUCTURES } from '../game/definitions/structures.js';
import { formatMass } from '../game/units.js';

const show = computed(() => needsOrigin());
const sites = computed(() => originsFor());

/** Opening conditions, rendered from the site's own data. */
function openingLines(def) {
  const lines = [];
  for (const [n, grams] of Object.entries(def.start?.nutrients || {})) {
    lines.push(`${formatMass(grams)} ${NUTRIENTS[n].name.toLowerCase()}`);
  }
  for (const [sid, count] of Object.entries(def.start?.structures || {})) {
    lines.push(`${count}× ${STRUCTURES[sid].name}`);
  }
  if (def.start?.drones) lines.push(`${def.start.drones} drones`);
  return lines;
}

function pick(id) {
  chooseOrigin(id);
}
</script>

<template>
  <div v-if="show" class="modal-backdrop origin-backdrop">
    <div class="origin-panel">
      <h2 class="origin-title">Choose a landing site</h2>
      <p class="origin-sub">
        <template v-if="state.lifetime.runs > 1">
          Run {{ state.lifetime.runs }}. Where the seed mass comes down decides how this one opens.
        </template>
        <template v-else>
          Where the seed mass comes down decides how the hive opens.
        </template>
      </p>

      <div class="origin-grid">
        <button
          v-for="def in sites.unlocked"
          :key="def.id"
          class="origin-card"
          @click="pick(def.id)"
        >
          <span class="origin-name">{{ def.name }}</span>
          <span class="origin-tagline">{{ def.tagline }}</span>
          <span class="origin-desc">{{ def.desc }}</span>

          <span class="origin-section">Opening</span>
          <ul class="plain-list">
            <li v-for="line in openingLines(def)" :key="line">{{ line }}</li>
          </ul>

          <span class="origin-section">Notes</span>
          <ul class="plain-list muted">
            <li v-for="line in def.effects" :key="line">{{ line }}</li>
          </ul>

          <span class="origin-pick">Land here</span>
        </button>

        <button
          v-for="def in sites.locked"
          :key="def.id"
          class="origin-card is-locked"
          disabled
        >
          <span class="origin-name">{{ def.name }}</span>
          <span class="origin-tagline">Locked</span>
          <span class="origin-desc">{{ def.unlockHint }}</span>
        </button>

        <!-- A placeholder, not a real site: it says the system exists without
             pretending to know what the later sites are. -->
        <div class="origin-card is-placeholder">
          <span class="origin-name">?</span>
          <span class="origin-tagline">Not yet found</span>
          <span class="origin-desc">
            Other places on this world will take a hive. What unlocks them is a matter
            of what you manage here first.
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
