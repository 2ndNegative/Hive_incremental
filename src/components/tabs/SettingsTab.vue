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
import { restartRun, lifetimeTotals } from '../../game/run.js';
import { formatDuration } from '../../game/format.js';
import { formatMass, formatEnergy } from '../../game/units.js';
import { RESEARCH_ORDER } from '../../game/definitions/research.js';
import ConfirmDialog from '../ConfirmDialog.vue';

const showWipe = ref(false);
const showRestart = ref(false);
const lifetime = computed(() => lifetimeTotals());

/**
 * Counted, not typed. The lifetime line read "/ 12" and was right, and would
 * have been silently wrong the first time a tech joined the ladder — a stat
 * that is quietly short by one is worse than no stat at all.
 */
const researchTotal = RESEARCH_ORDER.length;

function doRestart() {
  restartRun();
  showRestart.value = false;
  save();
}

function confirmWipeNow() {
  wipe();
  showWipe.value = false;
  save();
}

/** Offered inside the wipe dialog, because losing this by accident is forever. */
function exportBeforeWipe() {
  saveText.value = exportSave();
  navigator.clipboard?.writeText(saveText.value).catch(() => {});
  pushLog('Save string copied to the clipboard and written into Settings.', 'info');
}

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
          <!-- aria-label rather than a <label for>: the text beside it is a
               <span class="field-label">, so without this a screen reader
               reaches an unnamed checkbox and has nothing at all to announce.
               A real <label> would want ids on every control on the page. -->
          <input
            type="checkbox"
            v-model="state.settings.showZeroFlows"
            aria-label="Show zero flows"
          />
        </div>
      </div>
    </div>

    <div class="panel-box" style="margin-bottom: 0.9rem">
      <div class="panel-head">
        <span>Run</span>
        <span class="muted num">run {{ state.lifetime.runs }}</span>
      </div>
      <div class="panel-body">
        <div class="field-row">
          <span class="field-label">
            Restart run
            <span class="field-help">
              Ends this run and starts a fresh hive. Lifetime totals and records are kept —
              only this run's progress is cleared. Currently {{ formatDuration(state.playtime) }}
              in, {{ state.stats.peakDrones }} peak drones, {{ state.stats.researched }} research.
            </span>
          </span>
          <button class="btn" @click="showRestart = true">Restart run</button>
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
          <input type="checkbox" v-model="state.settings.autosave" aria-label="Autosave" />
        </div>

        <div class="field-row">
          <span class="field-label">
            Offline progress
            <!-- This used to say "up to 8 hours", which was the opposite of
                 what offline.js does: there is no cap, and the step size grows
                 with the gap instead so that a year stays bounded work. The
                 help text was telling the player their absence would be
                 truncated, which would make coming back look like a bug. -->
            <span class="field-help">
              Simulate time away on load. There is no cap — come back after a year and a year is
              simulated, in coarser steps the longer you were gone.
            </span>
          </span>
          <input
            type="checkbox"
            v-model="state.settings.offlineProgress"
            aria-label="Offline progress"
          />
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
          <button class="btn is-danger" @click="showWipe = true">Wipe save</button>
        </div>

        <textarea
          class="save-box"
          v-model="saveText"
          placeholder="Export writes your save string here; paste one in and press Import to restore it."
        />
      </div>
    </div>

    <ConfirmDialog
      :show="showRestart"
      title="Start a new run?"
      confirm-label="Restart run"
      @cancel="showRestart = false"
      @confirm="doRestart()"
    >
      <p style="margin-bottom: 0.7rem">
        This run ends here and a new hive is seeded. Nothing permanent is lost.
      </p>
      <div class="columns">
        <div class="column">
          <div class="section-head" style="margin-bottom: 0.4rem"><span>Cleared</span></div>
          <ul class="plain-list bad">
            <li>All nutrient stores</li>
            <li>Every structure and drone</li>
            <li>All research and insight</li>
            <li>This run's statistics and log</li>
          </ul>
        </div>
        <div class="column">
          <div class="section-head" style="margin-bottom: 0.4rem"><span>Kept</span></div>
          <ul class="plain-list good">
            <li>Lifetime totals and records</li>
            <li>Settings</li>
          </ul>
        </div>
      </div>
      <p class="muted" style="font-size: 0.8rem; margin-top: 0.6rem">
        This run so far: {{ formatDuration(state.playtime) }},
        {{ state.stats.peakDrones }} peak drones,
        {{ state.stats.researched }} research,
        {{ formatMass(state.stats.ingested) }} consumed. It will be folded into your
        lifetime record as run {{ state.lifetime.runs }}.
      </p>
    </ConfirmDialog>

    <ConfirmDialog
      :show="showWipe"
      title="Permanently delete everything?"
      confirm-label="Delete everything"
      danger
      require-phrase="DELETE"
      @cancel="showWipe = false"
      @confirm="confirmWipeNow()"
    >
      <p class="notice is-warn" style="margin-bottom: 0.7rem">
        <strong>This cannot be undone.</strong> It is not a restart. It erases the save
        itself, including the lifetime record that normally survives every restart and
        every future prestige.
      </p>

      <div class="section-head" style="margin-bottom: 0.4rem"><span>You are destroying</span></div>
      <table class="table is-fullwidth is-narrow data-table">
        <tbody>
          <tr><td>Runs played</td><td class="right num">{{ lifetime.runs }}</td></tr>
          <tr><td>Total time</td><td class="right num">{{ formatDuration(lifetime.playtime) }}</td></tr>
          <tr><td>Mass consumed, all runs</td><td class="right num">{{ formatMass(lifetime.ingested) }}</td></tr>
          <tr><td>Energy metabolised, all runs</td><td class="right num">{{ formatEnergy(lifetime.metabolised) }}</td></tr>
          <tr><td>Best run</td><td class="right num">{{ formatDuration(lifetime.bestPlaytime) }}</td></tr>
          <tr><td>Most drones ever</td><td class="right num">{{ lifetime.bestDrones }}</td></tr>
          <tr><td>Most research ever</td><td class="right num">{{ lifetime.bestResearched }} / {{ researchTotal }}</td></tr>
        </tbody>
      </table>

      <p class="muted" style="font-size: 0.8rem; margin-top: 0.6rem">
        If you only want a fresh hive, close this and use <strong>Restart run</strong> instead —
        it keeps everything above.
      </p>

      <div class="field-row">
        <span class="field-label">
          Export first?
          <span class="field-help">Copies a save string to your clipboard so this is recoverable.</span>
        </span>
        <button class="btn" @click="exportBeforeWipe()">Export save</button>
      </div>
    </ConfirmDialog>

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
