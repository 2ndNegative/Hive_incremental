<script setup>
// A blocking confirmation. `requirePhrase` turns it into a typed confirmation,
// which is the right weight for something genuinely irreversible — a button
// alone is too easy to hit by reflex.

import { ref, computed, watch } from 'vue';

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, required: true },
  confirmLabel: { type: String, default: 'Confirm' },
  danger: { type: Boolean, default: false },
  requirePhrase: { type: String, default: '' },
});

const emit = defineEmits(['confirm', 'cancel']);

const typed = ref('');
watch(
  () => props.show,
  (open) => {
    if (open) typed.value = '';
  },
);

const satisfied = computed(
  () => !props.requirePhrase || typed.value.trim().toUpperCase() === props.requirePhrase.toUpperCase(),
);
</script>

<template>
  <div v-if="show" class="modal-backdrop" @click.self="emit('cancel')">
    <div class="modal-card" :class="{ 'is-danger': danger }">
      <div class="modal-head" :class="{ 'is-danger': danger }">{{ title }}</div>

      <div class="modal-body">
        <slot />

        <div v-if="requirePhrase" class="confirm-phrase">
          <label>
            Type <strong>{{ requirePhrase }}</strong> to confirm
          </label>
          <input
            class="codex-search"
            type="text"
            v-model="typed"
            :placeholder="requirePhrase"
            autocomplete="off"
            spellcheck="false"
            @keyup.enter="satisfied && emit('confirm')"
          />
        </div>
      </div>

      <div class="modal-foot">
        <button class="btn" @click="emit('cancel')">Cancel</button>
        <button
          class="btn"
          :class="danger ? 'is-danger-solid' : 'is-primary'"
          :disabled="!satisfied"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
