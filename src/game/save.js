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
import {
  state, replaceState, createInitialState, SAVE_VERSION, OPEN_MAPS, pushLog,
} from './state.js';
import { DISCOVERY_RESCALE } from './discovery.js';
import { logIntro } from './actions.js';
import { offline } from './offline.js';

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

  /*
   * THE CLOCK CARRIES WHAT HAS NOT BEEN SIMULATED YET.
   *
   * A catch-up for a long absence runs over many frames, and the tab can be
   * closed or hidden in the middle of it — both of which fire a save. Stamping
   * the real wall-clock time there threw away every second the catch-up had
   * not reached: shut the tab three seconds into an eight-hour catch-up and
   * seven and a half of those hours simply never happened.
   *
   * Back-dating the stamp by the unsimulated remainder makes the next load
   * compute exactly that remainder as its offline span, so the catch-up
   * resumes instead of restarting or vanishing. No cursor to store and nothing
   * to keep in step: the one field that already means "simulated up to here"
   * is made to say so honestly.
   *
   * A SKIPPED catch-up is not pending — `offline.active` goes false the moment
   * it is skipped, so the remainder is discarded, which is what the player
   * asked for and what the log already tells them.
   */
  const unsimulated = offline.active ? Math.max(0, offline.total - offline.done) : 0;
  snapshot.savedAt = Date.now() - unsimulated * 1000;
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

/**
 * Recursively fill in anything the save is missing from the defaults.
 *
 * CLOSED BY DEFAULT. For an ordinary object the SCHEMA decides what exists:
 * only keys `createInitialState` declares survive, which is what makes a field
 * removed from the game disappear from old saves instead of haunting them
 * forever. That is the right rule for almost everything.
 *
 * OPEN WHERE THE PLAYER INVENTS THE KEYS. A map keyed by something the schema
 * cannot know — which generator is burning what, which nutrients are barred
 * from the pool — has to be taken from the save as it stands, or every setting
 * the player made is erased on reload.
 *
 * Openness is declared TWO ways, and both are needed:
 *
 *   1. `state.js` OPEN_MAPS names the path. This is the one that counts.
 *   2. The default object is empty, so there is nothing to merge anyway.
 *
 * Rule 2 alone is what this used to do, and it is a trap: it infers a design
 * decision from a count. `energy.overrides` was open for exactly as long as it
 * had no default entries — the moment v21 gave the drone ration a default, the
 * map silently became closed and every generator and caste fuel choice the
 * player had made was destroyed on their next reload. Nothing failed, nothing
 * logged; the dropdowns simply went back to default. Rule 1 exists because a
 * map's openness is a fact about what it is FOR, not about how many entries it
 * happens to ship with.
 *
 * An open map MERGES rather than replacing: saved keys win, and default keys
 * the save has never heard of are added. So a new shipped default appears for
 * an existing player without a migration, and their own keys survive it.
 */
/*
 * AND TYPED, which it was not.
 *
 * Every leaf the schema declares has a type, and the merge now holds the save
 * to it: a number stays a finite number, a boolean stays a boolean, a string
 * stays a string, and anything else falls back to the default and is counted.
 * Numbers whose default is zero or above are also held at or above zero.
 *
 * Nothing checked any of this before, and nothing had to be malicious to break
 * it. `"broken"` as a carbohydrate quantity, `-5000` larvae and `"lots"` of
 * foragers all imported cleanly, straight into the live state, where the first
 * arithmetic on them turns into NaN and spreads through every rate in the game
 * before anything complains. The save is the one input the player can hand the
 * engine directly, and it was the one input nobody checked.
 *
 * Repaired rather than rejected, deliberately. A save with one bad field is
 * still somebody's run, and throwing the whole thing away over a field they
 * cannot see is a worse outcome than resetting that field and saying so. What
 * gets rejected is a save that is not a save at all — see `readSave`.
 */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Strip values an open map cannot legally hold. Open keys, closed values. */
function sanitiseOpen(value, repairs, path) {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    repairs.push(path);
    return 0;
  }
  if (Array.isArray(value)) return value.map((v, i) => sanitiseOpen(v, repairs, `${path}[${i}]`));
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitiseOpen(v, repairs, `${path}.${k}`);
    return out;
  }
  return value;
}

function mergeDefaults(defaults, loaded, path = '', repairs = []) {
  if (Array.isArray(defaults)) return Array.isArray(loaded) ? loaded : defaults;
  if (defaults && typeof defaults === 'object') {
    const saved = isPlainObject(loaded) ? loaded : null;
    if (OPEN_MAPS.has(path) || Object.keys(defaults).length === 0) {
      const merged = saved ? { ...defaults, ...saved } : { ...defaults };
      return sanitiseOpen(merged, repairs, path);
    }
    const out = {};
    for (const key of Object.keys(defaults)) {
      const value = saved ? saved[key] : undefined;
      const at = path ? `${path}.${key}` : key;
      out[key] = value === undefined
        ? defaults[key]
        : mergeDefaults(defaults[key], value, at, repairs);
    }
    return out;
  }

  if (loaded === undefined || loaded === null) return defaults;

  if (typeof defaults === 'number') {
    if (typeof loaded !== 'number' || !Number.isFinite(loaded)) {
      repairs.push(path);
      return defaults;
    }
    // A schema default of zero or more means the field counts something. None
    // of them can be negative, and a negative one is a store that pays out.
    if (defaults >= 0 && loaded < 0) {
      repairs.push(path);
      return defaults;
    }
    return loaded;
  }
  if (typeof defaults === 'boolean' && typeof loaded !== 'boolean') {
    repairs.push(path);
    return defaults;
  }
  if (typeof defaults === 'string' && typeof loaded !== 'string') {
    repairs.push(path);
    return defaults;
  }
  return loaded;
}

/**
 * Say what had to be reset, once, naming a few fields rather than all of them.
 *
 * Silence here would be the same mistake in a new place: a field quietly
 * reverting to its default is exactly as invisible as a field quietly holding
 * `NaN`, and the player is the only one who can tell whether it mattered.
 */
function reportRepairs(repairs) {
  if (!repairs.length) return;
  const shown = repairs.slice(0, 4).join(', ');
  const more = repairs.length > 4 ? `, and ${repairs.length - 4} more` : '';
  pushLog(
    `${repairs.length} field${repairs.length === 1 ? '' : 's'} in the save held something `
    + `impossible and ${repairs.length === 1 ? 'was' : 'were'} reset: ${shown}${more}.`,
    'error',
  );
}

/** Hook for future save-format changes. */
/**
 * IS THIS A SAVE AT ALL? Throws with something a player can read if not.
 *
 * Separate from the field-by-field repair above, because the two failures are
 * different in kind. A save with one bad number is somebody's run with a bad
 * number in it, and gets repaired. `null`, an array, or a string is not a save
 * and never was — `load()` used to walk straight into it and throw
 * "Cannot read properties of null (reading 'version')" out of a startup path
 * with no catch around it, which is a blank page.
 *
 * A SAVE FROM THE FUTURE IS REFUSED, which is the one case where repairing is
 * the wrong instinct. The migrations only ever run forward; a v999 save was
 * accepted untouched and then written back stamped v24, so a hive played on a
 * newer build and opened on an older one was silently downgraded, losing
 * whatever that build had added. Better to refuse and leave the file alone:
 * the player can update and open it again, and nothing has been destroyed in
 * the meantime.
 */
function assertLoadable(raw) {
  if (!isPlainObject(raw)) {
    throw new Error('that is not a save file');
  }
  const version = raw.version;
  if (version !== undefined && (typeof version !== 'number' || !Number.isFinite(version))) {
    throw new Error('the save does not say which version it is');
  }
  if ((version ?? 0) > SAVE_VERSION) {
    throw new Error(
      `the save is from a newer version of the game (v${version}, this build reads v${SAVE_VERSION})`,
    );
  }
  return raw;
}

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

  // Before v10 there was no brood, so nothing is part-way through a cycle.
  if ((raw.version ?? 0) < 10) {
    raw.brood ??= {};
    raw.larvae ??= 0;
  }

  // Before v11 a larva could go hungry indefinitely. A loaded save starts fed;
  // if it is not, the first few seconds of play will say so.
  if ((raw.version ?? 0) < 11) {
    raw.larvaeHunger = 0;
    raw.larvaeDying = 0;
  }

  // Before v12 nothing could be molded. An old save has made no drones and has
  // every type switched off, which is what a fresh one has too.
  if ((raw.version ?? 0) < 12) {
    raw.molding ??= {};
    raw.droneMolding ??= {};
    raw.droneTypes ??= {};
  }

  // Before v13 a generator picked its fuel fresh every tick and would blend two
  // stores inside one step. An empty lock means every generator starts on its
  // preferred fuel with no cooldown running, which is where a fresh hive starts
  // too. The costs also moved onto fibre at v13; nothing stored needs changing
  // for that, since a cost is read from the definition and never saved.
  if ((raw.version ?? 0) < 13) {
    raw.fuelLock ??= {};
  }

  // Before v14 the click was worth the same however fast it was pressed. A
  // loaded save starts cold, which is where anyone who has been away is.
  if ((raw.version ?? 0) < 14) {
    raw.clickHeat = 0;
  }

  // Before v15 a drone type worked ONE find, wherever its holdings were. Land
  // now decides how many patches are worked at once, so the old single slot is
  // dropped and the first tick rolls a full set against the same ground.
  if ((raw.version ?? 0) < 15) {
    raw.patches = {};
    for (const key of Object.keys(raw.forage || {})) {
      if (key.startsWith('drone:')) delete raw.forage[key];
    }
  }

  // v16 adds the Scavenger. An old save has none and has it switched off,
  // which is where a fresh one starts too — the merge below fills both in from
  // the defaults, so this only has to exist to mark the version.
  if ((raw.version ?? 0) < 16) {
    raw.droneTypes ??= {};
    raw.droneMolding ??= {};
  }

  // v17 adds expeditions and the unclaimed map. An old save has mapped nothing
  // and has nobody out there, which is where a fresh one starts too.
  if ((raw.version ?? 0) < 17) {
    raw.unclaimed ??= {};
    raw.expedition ??= {};
  }

  // v18 lets a nutrient be kept out of the shared pool. An old save forbids
  // nothing, which is how the pool has always behaved.
  if ((raw.version ?? 0) < 18) {
    raw.generalBans ??= {};
  }

  // v19 adds focus: stars telling a gathering route what to look for on a
  // given biome. An old save has focused nothing, so every route rolls its
  // ground exactly as it always did.
  if ((raw.version ?? 0) < 19) {
    raw.focus ??= {};
  }

  // v20 adds the build queue. An old save has nothing lined up, which is how
  // every hive behaved until now.
  if ((raw.version ?? 0) < 20) {
    raw.buildQueue ??= [];
  }

  // v21 feeds the drones. They used to draw watts out of the pool like a
  // building; now they eat, and the hive picks what off the Metabolism tab.
  // An old save gets the ration pointed at sugar, which is what it would have
  // been eating anyway — but its generators keep whatever the player chose,
  // because that was their decision and not a default to be overwritten.
  if ((raw.version ?? 0) < 21) {
    raw.energy ??= {};
    raw.energy.overrides ??= {};
    raw.energy.overrides.drones ??= { preferred: 'carb', fallback: 'fat' };
  }

  // v22 gives buildings a build time. An old save has nothing on the bench —
  // everything it ever built went up the instant it was paid for — so it comes
  // back with an empty slot and starts its first timed job off the queue.
  if ((raw.version ?? 0) < 22) {
    raw.building = null;
  }

  // v23 is the land rewrite: a patch is one drone's ground on one biome, room
  // is counted per biome, and the player assigns drones to ground.
  if ((raw.version ?? 0) < 23) {
    // The old `patches` were keyed by drone type and each carried the biome it
    // had rolled. There is no honest way to turn those into crews — the whole
    // point is that a drone now belongs to a biome rather than rolling one — so
    // they are dropped and the first tick rolls fresh. One forage cycle of
    // intake, at most.
    delete raw.patches;
    raw.crews = {};
    // No targets: every drone spreads by area share, which is what the hive was
    // doing before any of this existed. A returning save therefore behaves as
    // it did until the player opens the panel and says otherwise.
    raw.assign ??= {};

    // Discovery now records once per DRONE rather than once per patch, and the
    // old patch count was capped at twelve however big the hive got. So the
    // thresholds went up by an order of magnitude (see discovery.js), and the
    // counts already banked have to go up with them or a hive that had pinned
    // down forty finds would come back having forgotten all of them.
    for (const bucket of Object.values(raw.found || {})) {
      for (const key of Object.keys(bucket)) bucket[key] *= DISCOVERY_RESCALE;
    }
  }

  // v24 opens the genome. Nothing is written into anything, which is exactly
  // what a save from before genetics means — and because an empty genome leaves
  // every trait at 1, a returning hive forages and eats at precisely the rates
  // it left at.
  if ((raw.version ?? 0) < 24) {
    raw.genes ??= {};
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

  let merged;
  const repairs = [];
  try {
    merged = mergeDefaults(createInitialState(), migrate(assertLoadable(parsed)), '', repairs);
  } catch (err) {
    // The stored data is LEFT WHERE IT IS. A save this build cannot read may
    // be perfectly readable by the build it came from, and starting a fresh
    // game over the top of it is the one outcome that cannot be undone.
    pushLog(`This save could not be opened: ${err.message}. It has been left untouched.`, 'error');
    logIntro();
    return { status: 'fresh', offlineSeconds: 0 };
  }
  replaceState(merged);
  reportRepairs(repairs);

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

/**
 * TAKE A SAVE STRING, OR LEAVE THE HIVE EXACTLY AS IT WAS.
 *
 * This used to replace the live state, call `save()`, ignore what `save()`
 * said, and report success either way. So a quota-full browser — the single
 * likeliest reason anybody is importing a save in the first place — swallowed
 * the run that was open, kept the old one on disk, and printed "Save
 * imported." The player had neither save and no way to know.
 *
 * Three rules now, in order of how much they matter:
 *
 *   1. NOTHING IS REPLACED UNTIL THE NEW SAVE PARSES. A string that is not a
 *      save never touches the live hive.
 *   2. THE WRITE IS PART OF THE IMPORT. If it cannot be persisted the previous
 *      state is put back, and the failure is what gets reported.
 *   3. "LOADED" AND "SAVED" ARE DIFFERENT CLAIMS. The log says which happened.
 *
 * The rollback copy is a plain structural clone rather than an exported
 * string: it has to be restorable when storage is exactly what is not working.
 */
export function importSave(text) {
  let merged;
  const repairs = [];
  try {
    const json = decodeURIComponent(atob(String(text).trim()));
    merged = mergeDefaults(createInitialState(), migrate(assertLoadable(JSON.parse(json))), '', repairs);
  } catch (err) {
    pushLog(`Import failed: ${err.message}. Nothing was changed.`, 'error');
    return false;
  }

  const rollback = JSON.parse(JSON.stringify(state));
  replaceState(merged);
  reportRepairs(repairs);

  if (!save()) {
    replaceState(rollback);
    pushLog(
      'That save could be read but could not be stored, so it was not loaded — '
      + `the hive is as it was. ${saveStatus.error ?? ''}`.trim(),
      'error',
    );
    return false;
  }
  pushLog('Save imported.', 'info');
  return true;
}
