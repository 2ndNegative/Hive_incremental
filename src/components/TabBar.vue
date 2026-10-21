<script setup>
import { computed } from 'vue';
import { state, derived } from '../game/useGame.js';
import { canAfford } from '../game/engine.js';
import { RESEARCH } from '../game/definitions/research.js';

const affordableResearch = computed(
  () => derived.value.unlocked.research.filter((id) => canAfford(state, RESEARCH[id].cost)).length,
);

const tabs = computed(() => [
  { id: 'hive', label: 'Hive' },
  { id: 'drones', label: 'Drones', badge: state.castes.dormant || 0 },
  { id: 'genetics', label: 'Genetics' },
  // The alert is the one thing the player needs to notice without looking:
  // matter is spoiling because the gut cannot keep up with the harvest.
  { id: 'territory', label: 'Territory' },
  { id: 'storage', label: 'Storage', alert: Object.values(derived.value.itemSpill).some((r) => r > 0) },
  { id: 'metabolism', label: 'Metabolism', alert: derived.value.energy.ratio < 0.999 },
  { id: 'research', label: 'Research', badge: affordableResearch.value },
  { id: 'codex', label: 'Codex' },
  { id: 'stats', label: 'Stats' },
  { id: 'settings', label: 'Settings' },
  ...(state.dev?.enabled ? [{ id: 'dev', label: 'Dev' }] : []),
]);

/*
 * ROVING TABINDEX, which is the half of the tablist pattern that is about the
 * keyboard rather than the announcement.
 *
 * Declaring `role="tablist"` without this would have been worse than leaving
 * the buttons alone: a screen reader then tells the player to use the arrow
 * keys, because that is what a tablist means, and the arrow keys would have
 * done nothing. The two go together or neither does.
 *
 * It is also the better keyboard regardless of any of that. Eleven tab stops
 * sat between the topbar and the first control on the screen, so reaching
 * anything on the Hive tab by keyboard meant eleven presses of Tab through
 * things the player was not trying to reach. One stop for the whole bar, and
 * the arrows move inside it.
 *
 * SELECTION FOLLOWS FOCUS, because switching tab here is free and reversible:
 * nothing is submitted, no request is made, the previous screen is one arrow
 * key back. That is exactly the condition the ARIA practices give for it, and
 * the alternative — arrow to move, Enter to open — makes the common case two
 * keys instead of one.
 */
/**
 * The one tab in the bar that is a tab stop.
 *
 * Normally the selected one. The fallback matters: `state.ui.tab` can name a
 * screen the bar is not rendering — `dev` survives in a loaded save after the
 * dev flag is off, and App.vue quietly shows the Hive tab instead — and with
 * nothing matched every button would have carried `tabindex="-1"`, which is a
 * navigation bar the keyboard cannot reach at all.
 */
const focusIndex = computed(() => {
  const at = tabs.value.findIndex((t) => t.id === state.ui.tab);
  return at === -1 ? 0 : at;
});

/*
 * Found from the event rather than held in a template ref. `ref` inside
 * `v-for` has changed shape between Vue minors, and the buttons are all
 * siblings of the one that was pressed, so there is nothing to hold.
 */
function go(event, index) {
  const list = [...event.currentTarget.parentElement.querySelectorAll('[role="tab"]')];
  const next = (index + list.length) % list.length;
  state.ui.tab = tabs.value[next].id;
  list[next]?.focus();
}

function onKey(event, index) {
  const delta = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (delta !== undefined) {
    event.preventDefault();
    go(event, index + delta);
    return;
  }
  if (event.key === 'Home') {
    event.preventDefault();
    go(event, 0);
  } else if (event.key === 'End') {
    event.preventDefault();
    go(event, tabs.value.length - 1);
  }
}
</script>

<template>
  <!-- A TABLIST, NOT ELEVEN LOOSE BUTTONS.
       Which tab you are on was carried entirely by `.is-active`, which is a
       colour: a screen reader read eleven buttons with no indication that they
       were alternatives, let alone which one was showing. `role="tab"` plus
       `aria-selected` says both, and it is the one piece of this that cannot
       be inferred from the markup.
       `aria-controls` points at the panel in App.vue, which carries the
       matching `role="tabpanel"`.
       The badges get labels of their own because a bare "3" beside "Drones"
       is read as part of the tab's name — "Drones 3" — which sounds like the
       third of several Drones tabs rather than three dormant drones waiting. -->
  <nav class="tab-bar" role="tablist" aria-label="Hive screens">
    <button
      v-for="(tab, i) in tabs"
      :key="tab.id"
      :id="`tab-${tab.id}`"
      role="tab"
      aria-controls="tab-panel"
      :aria-selected="state.ui.tab === tab.id"
      :tabindex="focusIndex === i ? 0 : -1"
      :class="{ 'is-active': state.ui.tab === tab.id }"
      @click="state.ui.tab = tab.id"
      @keydown="onKey($event, i)"
    >
      {{ tab.label }}
      <span v-if="tab.badge" class="badge" :aria-label="`${tab.badge} waiting`">{{ tab.badge }}</span>
      <span v-else-if="tab.alert" class="badge is-alert" aria-label="needs attention">!</span>
    </button>
  </nav>
</template>
