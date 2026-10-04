<script setup>
import { computed, onMounted, onUnmounted } from 'vue';
import { state, derived } from '../game/useGame.js';
import { topbarLayout, TOPBAR_ORDER, TOPBAR, TOPBAR_SLOTS, DEFAULT_PINNED } from '../game/definitions/topbar.js';
import { togglePinned, resetPinned } from '../game/actions.js';

const emit = defineEmits(['close']);

/**
 * Every top-bar resource, whether or not the bar has room for it, with what it
 * holds and what it is doing. The list is in declared order rather than in bar
 * order: this is the index, not the bar, and an index that reshuffles while you
 * read it is useless.
 */
const rows = computed(() => {
  const layout = topbarLayout(state, derived.value);
  const onBar = new Set(layout.shown.map((r) => r.id));
  const byId = new Map([...layout.shown, ...layout.hidden].map((r) => [r.id, r]));
  return TOPBAR_ORDER.filter((id) => TOPBAR[id]).map((id) => ({
    ...byId.get(id),
    id,
    onBar: onBar.has(id),
  }));
});

const pinnedCount = computed(() => rows.value.filter((r) => r.pinned).length);
const isDefault = computed(
  () =>
    pinnedCount.value === DEFAULT_PINNED.length &&
    DEFAULT_PINNED.every((id) => rows.value.find((r) => r.id === id)?.pinned),
);

function onKey(e) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="picker-backdrop" @click.self="emit('close')">
    <div class="picker" role="dialog" aria-label="Top bar resources">
      <div class="picker-head">
        <span>Top bar resources</span>
        <button class="btn" @click="emit('close')">Close</button>
      </div>

      <p class="picker-note muted">
        Pinned resources are always on the bar, in this order. Whatever room is left over goes to
        whatever is moving — something losing before something gaining, and either before something
        standing still. The bar carries {{ TOPBAR_SLOTS }} before it starts leaving things out.
      </p>

      <table class="table is-fullwidth is-narrow data-table picker-table">
        <thead>
          <tr>
            <th>Resource</th>
            <th class="right">Held</th>
            <th class="right">Rate</th>
            <th class="right">On the bar</th>
            <th class="right">Pin</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" :class="{ 'is-pinned-row': r.pinned }">
            <td>
              <strong>{{ r.name }}</strong>
              <span class="picker-desc muted">{{ r.def.desc }}</span>
            </td>
            <td class="right num">{{ r.store }}</td>
            <td class="right num" :class="r.rate < 0 ? 'bad' : r.rate > 0 ? 'good' : 'muted'">
              {{ r.rateText ?? 'steady' }}
              <span v-if="r.note" class="picker-note-inline warn">{{ r.note }}</span>
            </td>
            <td class="right muted">{{ r.onBar ? 'yes' : 'no' }}</td>
            <td class="right">
              <button
                class="btn pin-btn"
                :class="{ 'is-active': r.pinned }"
                :aria-pressed="r.pinned ? 'true' : 'false'"
                @click="togglePinned(r.id)"
              >
                {{ r.pinned ? 'Pinned' : 'Pin' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="picker-foot">
        <span class="muted">{{ pinnedCount }} pinned</span>
        <button class="btn" :disabled="isDefault" @click="resetPinned()">Reset to default</button>
      </div>
    </div>
  </div>
</template>
