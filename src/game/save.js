// Persistence: localStorage, versioned, forward-tolerant.
//
// Saves are merged onto a fresh default state, so adding a new field to
// `createInitialState` never breaks an existing save.
//
// FAILING LOUDLY
// Browser storage can refuse a write for reasons the player never sees coming:
// private browsing, site data blocked, or the ~5 MB per-origin quota being full
// (often of someone else's data on a shared origin like file://). The worst
// outcome is a game that looks like it is saving and is not, so every failure
// path here sets `saveStatus`, which the interface shows directly. The rules:
//
//   - storage unusable at all  -> detected at boot, before any progress is made
//   - a write throws           -> flagged, with the quota case named explicitly
//   - a write silently does not round-trip -> caught by reading it back
//
// `saveStatus` deliberately lives outside the game state: it describes the
// browser, not the hive, and it must never end up inside the thing being saved.

import { reactive } from 'vue';
import { state, replaceState, createInitialState, SAVE_VERSION, pushLog } from './state.js';
import { logIntro } from './actions.js';

export const SAVE_KEY = 'hiveidle.save.v2';
export const AUTOSAVE_SECONDS = 30;

/** Saves above this are worth warning about long before the quota is hit. */
export const SAVE_WARN_BYTES = 1_000_000;

export const saveStatus = reactive({
  supported: null, // null = not probed yet
  ok: true,
  bytes: 0,
  at: null,
  error: null, // human-readable reason the last write failed
  reason: null, // 'unsupported' | 'quota' | 'mismatch' | 'error'
  warned: false,
});

function safeStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // private mode / site data blocked
  }
}

/**
 * Confirm storage actually works, rather than assuming it does. Some browsers
 * expose localStorage and throw only on write, so this writes and reads back.
 * Called once at boot so the player is told before they have anything to lose.
 */
export function probeStorage() {
  const store = safeStorage();
  if (!store) {
    saveStatus.supported = false;
    saveStatus.ok = false;
    saveStatus.reason = 'unsupported';
    saveStatus.error = 'This browser is not allowing site storage, so progress cannot be saved.';
    return false;
  }
  const probeKey = `${SAVE_KEY}.probe`;
  try {
    store.setItem(probeKey, 'x');
    const ok = store.getItem(probeKey) === 'x';
    store.removeItem(probeKey);
    saveStatus.supported = ok;
    if (!ok) {
      saveStatus.ok = false;
      saveStatus.reason = 'mismatch';
      saveStatus.error = 'Site storage accepted a write but did not return it. Progress will not persist.';
    }
    return ok;
  } catch (err) {
    saveStatus.supported = false;
    saveStatus.ok = false;
    saveStatus.reason = describeReason(err);
    saveStatus.error = describeError(err);
    return false;
  }
}

function describeReason(err) {
  const name = err?.name || '';
  const quota =
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err?.code === 22 ||
    err?.code === 1014;
  return quota ? 'quota' : 'error';
}

function describeError(err) {
  if (describeReason(err) === 'quota') {
    return 'Browser storage is full, so the save was rejected. Export your save, then clear site data for this page.';
  }
  return `Browser storage refused the write: ${err?.message || err}`;
}

/** Byte length as stored, not character count — quotas are counted in bytes. */
function byteLength(text) {
  try {
    return new Blob([text]).size;
  } catch {
    return text.length * 2; // UTF-16 worst case
  }
}

export function serialize() {
  const snapshot = JSON.parse(JSON.stringify(state));
  snapshot.savedAt = Date.now();
  snapshot.version = SAVE_VERSION;
  return snapshot;
}

/**
 * Write the save. Returns true only if the data is verifiably in storage.
 * @param {object} [opts]
 * @param {boolean} [opts.quiet] suppress the "Game saved" log line
 */
export function save({ quiet = true } = {}) {
  const store = safeStorage();
  if (!store) {
    saveStatus.supported = false;
    saveStatus.ok = false;
    saveStatus.reason = 'unsupported';
    saveStatus.error = 'This browser is not allowing site storage, so progress cannot be saved.';
    if (!saveStatus.warned) {
      saveStatus.warned = true;
      pushLog('Progress cannot be saved: this browser is blocking site storage.', 'error');
    }
    return false;
  }

  const snapshot = serialize();
  const payload = JSON.stringify(snapshot);
  const bytes = byteLength(payload);

  try {
    store.setItem(SAVE_KEY, payload);

    // Read it back. A write that throws is easy to notice; a write that quietly
    // does not stick is the one that costs someone their run.
    const readBack = store.getItem(SAVE_KEY);
    if (readBack !== payload) {
      saveStatus.ok = false;
      saveStatus.reason = 'mismatch';
      saveStatus.bytes = bytes;
      saveStatus.error = readBack
        ? `Saved ${bytes} bytes but read back ${byteLength(readBack)}. The save did not stick.`
        : 'The save vanished immediately after being written.';
      pushLog(saveStatus.error, 'error');
      return false;
    }

    state.savedAt = snapshot.savedAt;
    saveStatus.ok = true;
    saveStatus.supported = true;
    saveStatus.bytes = bytes;
    saveStatus.at = snapshot.savedAt;
    saveStatus.error = null;
    saveStatus.reason = null;
    saveStatus.warned = false;

    if (bytes > SAVE_WARN_BYTES) {
      pushLog(`Save is unusually large (${(bytes / 1024).toFixed(0)} kB). Worth looking into.`, 'error');
    }
    if (!quiet) pushLog('Game saved.', 'info');
    return true;
  } catch (err) {
    // The message log is the only part of a save that grows without bound, so
    // on a quota failure shed it and try once more. Losing scrollback beats
    // losing the run, and it turns the most likely failure into a recoverable one.
    if (describeReason(err) === 'quota' && state.log.length > 5) {
      state.log.length = 5;
      try {
        const trimmed = JSON.stringify(serialize());
        store.setItem(SAVE_KEY, trimmed);
        if (store.getItem(SAVE_KEY) === trimmed) {
          state.savedAt = snapshot.savedAt;
          saveStatus.ok = true;
          saveStatus.bytes = byteLength(trimmed);
          saveStatus.at = snapshot.savedAt;
          saveStatus.error = null;
          saveStatus.reason = null;
          pushLog('Storage was nearly full; the message log was trimmed to fit the save.', 'error');
          return true;
        }
      } catch {
        // fall through to reporting the original failure
      }
    }

    saveStatus.ok = false;
    saveStatus.bytes = bytes;
    saveStatus.reason = describeReason(err);
    saveStatus.error = describeError(err);
    pushLog(saveStatus.error, 'error');
    return false;
  }
}

/**
 * Measure how much this origin will actually hold, by writing growing blocks to
 * a scratch key until it refuses. Removes everything it wrote. Only run when
 * the player asks — it is slow and it churns storage.
 */
export function measureStorageHeadroom() {
  const store = safeStorage();
  if (!store) return { supported: false, usedBytes: 0, freeBytes: 0 };

  const probeKey = `${SAVE_KEY}.headroom`;
  const CHUNK = 64 * 1024;
  const block = 'x'.repeat(CHUNK);
  let written = 0;
  let buffer = '';
  try {
    // Cap the probe so a browser with a huge quota does not spin for ages.
    while (written < 32 * 1024 * 1024) {
      buffer += block;
      store.setItem(probeKey, buffer);
      written += CHUNK;
    }
  } catch {
    // expected: this is how we find the ceiling
  } finally {
    try {
      store.removeItem(probeKey);
    } catch {
      /* nothing useful to do */
    }
  }

  let usedBytes = 0;
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      usedBytes += byteLength(key) + byteLength(store.getItem(key) ?? '');
    }
  } catch {
    /* some keys may be unreadable; the figure is indicative */
  }

  return { supported: true, usedBytes, freeBytes: written };
}

/** Recursively fill in anything the save is missing from the defaults. */
function mergeDefaults(defaults, loaded) {
  if (Array.isArray(defaults)) return Array.isArray(loaded) ? loaded : defaults;
  if (defaults && typeof defaults === 'object') {
    // An empty default object is an open-ended map (energy source overrides,
    // say). It has no known keys to merge, so take the saved one wholesale —
    // iterating the defaults here would silently erase the player's settings.
    if (Object.keys(defaults).length === 0) {
      return loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? loaded : {};
    }
    const out = {};
    for (const key of Object.keys(defaults)) {
      const value = loaded && typeof loaded === 'object' ? loaded[key] : undefined;
      out[key] = value === undefined ? defaults[key] : mergeDefaults(defaults[key], value);
    }
    return out;
  }
  return loaded === undefined || loaded === null ? defaults : loaded;
}

/** Hook for future save-format changes. */
function migrate(raw) {
  // Saves from before landing sites existed describe a run already under way.
  // Showing them the chooser would re-seed a hive someone has been playing for
  // hours, so they are grandfathered onto the site matching how they began.
  //
  // Keyed on the save version, not on symptoms like "has playtime". A version
  // number is unambiguous; a symptom is a guess, and the first guess here was
  // wrong — a brand new save sitting on the chooser also had playtime.
  if ((raw.version ?? 0) < 3 && !raw.origin) {
    raw.origin = 'anthill';
  }

  // Saves from before item storage existed decomposed every harvest on arrival,
  // so there is no backlog to restore — an empty store is exactly right. The
  // digestion structures start at zero and the base gut rate covers what those
  // hives were already producing, so nothing stalls on load.
  if ((raw.version ?? 0) < 4) {
    raw.items ??= {};
    raw.spilledItems ??= {};
  }

  // Saves from before territory existed were played on an implicit temperate
  // forest — that is what the Anthill has always been — so they are granted the
  // same 36 m2 a new Anthill run starts with rather than being left on nothing,
  // which would stop every caste finding anything at all.
  if ((raw.version ?? 0) < 5) {
    raw.forage ??= {};
    if (!raw.territory || Object.keys(raw.territory).length === 0) {
      raw.territory = raw.origin ? { temperateForest: 36 } : {};
    }
  }

  // Before v6 the hive could see the whole forage table and metabolised straight
  // out of its stores. A save from then has learned nothing it can prove, so it
  // starts the discovery log empty; and its energy pool starts empty too,
  // because nothing had generated any.
  if ((raw.version ?? 0) < 6) {
    raw.found ??= {};
    raw.energyPool ??= 0;
  }

  // Before v7 nothing could brown out: a building either stood or it did not.
  // An empty power map means every standing building is at full charge, which is
  // exactly how those saves were behaving, so they load unchanged and only start
  // fading if their supply is already short.
  if ((raw.version ?? 0) < 7) {
    raw.power ??= {};
  }

  // Before v8 a building that stood was a building that ran. Switching one off
  // did not exist, so every structure in an old save is switched on — anything
  // else would silently idle a hive someone had already built.
  //
  // Storage also moved off the nutrients themselves and onto the Hivecore in
  // v8. An old save keeps its stores; what changes is the ceiling above them,
  // and a hive sitting over its new cap spills the difference in the normal
  // way rather than being clamped silently here.
  if ((raw.version ?? 0) < 8) {
    raw.active ??= {}; // empty = everything that stands is running
    raw.larvae ??= 0;
  }

  // Before v9 there was only ever one kind of room, so nothing was pooled.
  // Anything a loaded save is holding is on its shelf; if the shelf has since
  // shrunk under it, the first tick pools or spills the difference in the
  // normal way.
  if ((raw.version ?? 0) < 9) {
    raw.general ??= {};
  }

  raw.version = SAVE_VERSION;
  return raw;
}

/**
 * Load from storage.
 * Returns { status: 'loaded' | 'fresh', offlineSeconds } — the caller decides
 * what to do with the elapsed time.
 */
export function load() {
  probeStorage();

  const store = safeStorage();
  let raw = null;
  try {
    raw = store?.getItem(SAVE_KEY) ?? null;
  } catch (err) {
    pushLog(`Could not read the save: ${err.message}`, 'error');
  }

  if (!raw) {
    logIntro();
    if (saveStatus.supported === false) pushLog(saveStatus.error, 'error');
    return { status: 'fresh', offlineSeconds: 0 };
  }
  saveStatus.bytes = byteLength(raw);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Keep the unreadable data rather than overwriting it — it may still be
    // recoverable by hand, and a fresh game would stamp right over it.
    try {
      store.setItem(`${SAVE_KEY}.corrupt`, raw);
      pushLog('Save data was unreadable. A copy was kept under hiveidle.save.v2.corrupt.', 'error');
    } catch {
      pushLog('Save data was unreadable and could not be backed up.', 'error');
    }
    logIntro();
    return { status: 'fresh', offlineSeconds: 0 };
  }

  const merged = mergeDefaults(createInitialState(), migrate(parsed));
  replaceState(merged);

  // Offline time is NOT applied here. It is handed back to the caller, which
  // runs it through the catch-up modal so a long absence can show progress and
  // be skipped rather than freezing the tab on startup.
  const away = merged.savedAt ? (Date.now() - merged.savedAt) / 1000 : 0;
  const pending = state.settings.offlineProgress && away > 1 ? away : 0;
  if (!pending) pushLog('Welcome back.', 'info');
  if (saveStatus.supported === false) pushLog(saveStatus.error, 'error');
  return { status: 'loaded', offlineSeconds: pending };
}

export function wipe() {
  try {
    safeStorage()?.removeItem(SAVE_KEY);
  } catch {
    /* nothing useful to do */
  }
  replaceState(createInitialState());
  logIntro();
  pushLog('Save wiped. Fresh start.', 'info');
}

/** Export as a base64 string the player can paste somewhere safe. */
export function exportSave() {
  const json = JSON.stringify(serialize());
  return btoa(encodeURIComponent(json));
}

export function importSave(text) {
  try {
    const json = decodeURIComponent(atob(text.trim()));
    const parsed = migrate(JSON.parse(json));
    replaceState(mergeDefaults(createInitialState(), parsed));
    save();
    pushLog('Save imported.', 'info');
    return true;
  } catch (err) {
    pushLog(`Import failed: ${err.message}`, 'error');
    return false;
  }
}
