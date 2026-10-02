<script setup>
import { state } from '../game/useGame.js';
import { formatDuration } from '../game/format.js';
</script>

<template>
  <div class="panel-box">
    <div class="panel-head">
      <span>Log</span>
      <span class="muted">{{ state.log.length }}</span>
    </div>
    <ul class="log-list">
      <li v-for="(entry, i) in state.log" :key="i" :class="`type-${entry.type}`">
        <span class="ts">{{ formatDuration(entry.playtime) }}</span>{{ entry.text }}
      </li>
      <li v-if="!state.log.length" class="muted">Nothing has happened yet.</li>
    </ul>
  </div>
</template>
