<script setup>
import { ref, computed } from 'vue';
import { state } from '../../game/useGame.js';
import {
  save,
  wipe,
  exportSave,
  importSave,
  saveStatus,
  measureStorageHeadroom,
} from '../../game/save.js';
import { pushLog } from '../../game/state.js';

import { tryUnlockDev } from '../../game/dev.js';

const headroom = ref(null);
const testing = ref(false);

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const lastWrite = computed(() => {
  if (!saveStatus.at) return 'not yet';
  const secs = Math.max(0, Math.round((Date.now() - saveStatus.at) / 1000));
  return secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
});

/** Yields a frame first so the button can show its busy state before blocking. */
function runHeadroomTest() {
  testing.value = true;
  setTimeout(() => {
    headroom.value = measureStorageHeadroom();
    testing.value = false;
    pushLog(
      `Storage test: ${formatBytes(headroom.value.freeBytes)} free, ` +
        `${formatBytes(headroom.value.usedBytes)} already in use.`,
      'info',
    );
  }, 50);
}

const saveText = ref('');
const confirmWipe = ref(false);
const codeInput = ref('');
const codeStatus = ref('');

function submitCode() {
  const ok = tryUnlockDev(codeInput.value);
  codeStatus.value = ok ? 'ok' : 'bad';
  if (ok) {
    codeInput.value = '';
    state.ui.tab = 'dev';
  }
}

function applyTheme(theme) {
  state.settings.theme = theme;
  document.documentElement.dataset.theme = theme;
}

function doExport() {
  saveText.value = exportSave();
  navigator.clipboard?.writeText(saveText.value).then(
    () => pushLog('Save string copied to clipboard.', 'info'),
    () => pushLog('Save string generated below.', 'info'),
  );
}

function doImport() {
  if (!saveText.value.trim()) return;
  importSave(saveText.value);
  saveText.value = '';
}

function doWipe() {
  if (!confirmWipe.value) {
    confirmWipe.value = true;
    return;
  }
  wipe();
  confirmWipe.value = false;
}
</script>

<template>
  <div>
    <div class="panel-box" style="margin-bottom: 0.9rem">
      <div class="panel-head"><span>Display</span></div>
      <div class="panel-body">
        <div class="field-row">
          <span class="field-label">
            Theme
            <span class="field-help">Dark is the default.</span>
          </span>
          <div class="stepper">
            <button
              v-for="option in ['dark', 'light']"
              :key="option"
              class="btn"
              style="width: auto; height: auto; text-transform: capitalize"
              :class="{ 'is-active': state.settings.theme === option }"
              @click="applyTheme(option)"
            >
              {{ option }}
            </button>
          </div>
        </div>

        <div class="field-row">
          <span class="field-label">
            Show zero flows
            <span class="field-help">Keep nutrients with no movement visible in the store list.</span>
          </span>
          <input type="checkbox" v-model="state.settings.showZeroFlows" />
        </div>
      </div>
    </div>

    <div class="panel-box">
      <div class="panel-head"><span>Save data</span></div>
      <div class="panel-body">
        <div class="field-row">
          <span class="field-label">
            Autosave
            <span class="field-help">Every 30 seconds, plus when the tab closes.</span>
          </span>
          <input type="checkbox" v-model="state.settings.autosave" />
        </div>

        <div class="field-row">
          <span class="field-label">
            Offline progress
            <span class="field-help">Simulate up to 8 hours of time away on load.</span>
          </span>
          <input type="checkbox" v-model="state.settings.offlineProgress" />
        </div>

        <div class="field-row">
          <span class="field-label">
            Storage
            <span class="field-help">
              Saves live in this browser's local storage for this site — not in a file and
              not in the cloud. Clearing site data erases them, and a different browser or
              a private window has its own.
              <template v-if="saveStatus.supported === false">
                <strong class="bad"> Storage is unavailable here.</strong>
              </template>
              <template v-else-if="!saveStatus.ok">
                <strong class="bad"> Last save failed: {{ saveStatus.error }}</strong>
              </template>
              <template v-else>
                Current save is <strong>{{ formatBytes(saveStatus.bytes) }}</strong>, written
                {{ lastWrite }}.
              </template>
            </span>
          </span>
          <button class="btn" @click="runHeadroomTest()" :disabled="testing">
            {{ testing ? 'Measuring…' : 'Test storage' }}
          </button>
        </div>

        <div v-if="headroom" class="field-row">
          <span class="field-label">
            Headroom
            <span class="field-help">
              This origin accepted <strong>{{ formatBytes(headroom.freeBytes) }}</strong> of new
              data on top of the {{ formatBytes(headroom.usedBytes) }} already stored. The save is
              {{ formatBytes(saveStatus.bytes) }}, so there is room for roughly
              {{ Math.floor(headroom.freeBytes / Math.max(saveStatus.bytes, 1)).toLocaleString() }}
              more of them. Browsers typically allow about 5 MB per site.
            </span>
          </span>
        </div>

        <div class="field-row">
          <span class="field-label">Manual</span>
          <button class="btn is-primary" @click="save({ quiet: false })">Save now</button>
          <button class="btn" @click="doExport()">Export</button>
          <button class="btn" :disabled="!saveText.trim()" @click="doImport()">Import</button>
          <button class="btn is-danger" @click="doWipe()">
            {{ confirmWipe ? 'Click again to confirm' : 'Wipe save' }}
          </button>
        </div>

        <textarea
          class="save-box"
          v-model="saveText"
          placeholder="Export writes your save string here; paste one in and press Import to restore it."
        />
      </div>
    </div>

    <div class="panel-box" style="margin-top: 0.9rem">
      <div class="panel-head"><span>Access code</span></div>
      <div class="panel-body">
        <div class="field-row">
          <span class="field-label">
            Enter code
            <span class="field-help">
              <template v-if="state.dev.enabled">
                Developer mode is unlocked — see the Dev tab.
              </template>
              <template v-else-if="codeStatus === 'bad'">
                That code does not do anything.
              </template>
              <template v-else>For codes, if you have one.</template>
            </span>
          </span>
          <input
            class="codex-search"
            style="max-width: 16rem; flex: 0 1 16rem"
            type="text"
            v-model="codeInput"
            placeholder="code"
            @keyup.enter="submitCode()"
          />
          <button class="btn" :disabled="!codeInput.trim()" @click="submitCode()">Unlock</button>
        </div>
      </div>
    </div>
  </div>
</template>
