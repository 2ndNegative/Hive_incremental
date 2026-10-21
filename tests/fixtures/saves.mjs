/*
 * SAVES FROM THE PAST, as the game would have written them.
 *
 * WHAT THESE ARE AND ARE NOT. They are reconstructed, not captured: the builds
 * that wrote v4 and v12 saves are gone, so there is nothing to export from.
 * Each fixture is the state object a hive of that era HELD — only the keys that
 * existed then, with plausible play behind them — read off the migration ladder
 * in src/game/save.js, which is itself a precise record of what each version
 * added.
 *
 * That makes them weaker than a captured save in one way and exactly as strong
 * in every way that matters here. A reconstructed fixture cannot catch a key
 * the ladder has forgotten existed. It catches, every time:
 *   - a migration that throws, or that `assertLoadable` now rejects;
 *   - a migration that stops being applied because somebody renamed a field;
 *   - a migration that DROPS something the player had — the quiet one, where a
 *     hive loads fine and comes back poorer;
 *   - a new validation rule in `mergeDefaults` that turns an old shape into a
 *     repair, which looks like a bug report rather than a load.
 *
 * None of those were testable before. `save-test.mjs` round-trips a CURRENT
 * save, which proves v24 reads v24 — the one case that cannot break.
 *
 * ADDING ONE: when SAVE_VERSION goes up, add a fixture at the version BELOW it
 * holding something the new migration has to move, and an expectation naming
 * what it should become. A migration with no fixture is a migration that has
 * only ever run on an empty object.
 *
 * Every fixture is deliberately a hive mid-run: nutrients in store, structures
 * standing, tech bought, playtime on the clock. A migration that works on a
 * fresh save and loses a returning player's hive is the failure mode, and an
 * empty fixture cannot see it.
 */

/**
 * `version`: what the save declares.
 * `state`: the raw object, exactly as that build's `serialize()` would have
 *     produced it — no later keys, because a save that already has them proves
 *     nothing about the migration that adds them.
 * `holds`: things the player had that must survive, asserted field by field.
 * `becomes`: what the migrations are documented to produce. Checked against the
 *     LOADED state, so a value the merge then overwrote shows up as a failure
 *     rather than as a migration that "ran".
 */
export const HISTORICAL_SAVES = [
  {
    name: 'v2, before landing sites',
    version: 2,
    state: {
      version: 2,
      playtime: 4210,
      savedAt: 1_700_000_000_000,
      nutrients: { carb: 820, fat: 140, protein: 310, ash: 60 },
      structures: { hivecore: 1, metabolicGenerator: 2, glycogenGranule: 3 },
      tech: { glycolysis: true },
      castes: { dormant: 2 },
      drones: 2,
      log: [{ playtime: 10, text: 'The hive stirs.', type: 'info' }],
    },
    holds: {
      'the hours played': (s) => s.playtime === 4210,
      'the stores': (s) => s.nutrients.carb === 820 && s.nutrients.protein === 310,
      'the buildings': (s) => s.structures.metabolicGenerator === 2,
      'the tech it bought': (s) => s.tech.glycolysis === true,
      'the message log': (s) => s.log.some((e) => /hive stirs/.test(e.text)),
    },
    becomes: {
      // v3: a run already under way must not be shown the chooser.
      'grandfathered onto the Anthill': (s) => s.origin === 'anthill',
      // v5: played on an implicit temperate forest, granted the same ground.
      'granted the 36 m² an Anthill starts on': (s) => s.territory.temperateForest === 36,
      // v21: the drones used to draw watts; now they eat.
      'its drones pointed at sugar': (s) => s.energy.overrides.drones?.preferred === 'carb',
      // v24.
      'an empty genome': (s) => Object.keys(s.genes).length === 0,
    },
  },

  {
    name: 'v12, molding but no fuel lock',
    version: 12,
    state: {
      version: 12,
      playtime: 19_800,
      savedAt: 1_700_000_000_000,
      origin: 'cityDrain',
      nutrients: { carb: 4100, fat: 2050, protein: 1900, fiber: 300, ash: 12_000 },
      items: { bread: 240, beef_liver: 60 },
      spilledItems: {},
      general: { carb: 90 },
      territory: { denseUrban: 36, lightUrban: 12 },
      forage: {},
      found: { 'forager:denseUrban': { bread: 4, plastic: 2 } },
      energyPool: 180_000,
      power: { metabolicGenerator: 1 },
      active: { caecum: 2 },
      larvae: 6,
      larvaeHunger: 0,
      larvaeDying: 0,
      brood: { broodChamber: 0.4 },
      molding: { moldingChamber: 0.2 },
      droneMolding: { forager: { on: true, target: 8 } },
      droneTypes: { forager: 5 },
      structures: {
        hivecore: 2, broodChamber: 1, moldingChamber: 1, metabolicGenerator: 3,
        caecum: 2, glycogenGranule: 6, proteinGranule: 4, vacuole: 20,
      },
      tech: { glycolysis: true, lipolysis: true, bulkMineralAssay: true },
      castes: { dormant: 1 },
      drones: 6,
      log: [],
    },
    holds: {
      'its landing site': (s) => s.origin === 'cityDrain',
      'the ground it claimed': (s) => s.territory.denseUrban === 36 && s.territory.lightUrban === 12,
      'the matter on its shelves': (s) => s.items.bread === 240 && s.items.beef_liver === 60,
      'what was in the shared pool': (s) => s.general.carb === 90,
      'the brood': (s) => s.larvae === 6,
      'the drones it had pressed': (s) => s.droneTypes.forager === 5,
      'the order it was pressing to': (s) => s.droneMolding.forager.target === 8,
      'its banked energy': (s) => s.energyPool === 180_000,
      'the three assays it had bought': (s) => s.tech.bulkMineralAssay === true,
    },
    becomes: {
      // v13.
      'a generator fuel lock, empty': (s) => s.fuelLock && Object.keys(s.fuelLock).length === 0,
      // v15 then v23: the old per-type patches are dropped both times.
      'no patches at all': (s) => s.patches === undefined,
      // v23: crews replace them, and area share replaces targets.
      'crews instead, and no assignment overrides': (s) =>
        s.crews && Object.keys(s.assign).length === 0,
      // v23: the discovery thresholds went up by an order of magnitude, so what
      // was already banked has to go up with them — a hive that had pinned down
      // forty finds must not come back having forgotten them.
      'its discoveries rescaled, not lost': (s) =>
        s.found['forager:denseUrban'].bread === 40
        && s.found['forager:denseUrban'].plastic === 20,
      // v20, v22, v24.
      'an empty build queue': (s) => Array.isArray(s.buildQueue) && s.buildQueue.length === 0,
      'nothing on the bench': (s) => s.building === null,
      'an empty genome': (s) => Object.keys(s.genes).length === 0,
    },
  },

  {
    name: 'v22, land before the rewrite',
    version: 22,
    state: {
      version: 22,
      playtime: 86_400,
      savedAt: 1_700_000_000_000,
      origin: 'anthill',
      nutrients: { carb: 9000, fat: 7000, protein: 8000, fiber: 1200, ash: 40_000 },
      items: { acorn: 900, mushroom: 120 },
      spilledItems: { leaf_litter: 40 },
      general: {},
      generalBans: { ash: true },
      territory: { temperateForest: 72, grassland: 36 },
      unclaimed: { taiga: 36 },
      expedition: {},
      focus: { 'forager:temperateForest': { acorn: true } },
      forage: {},
      found: { 'forager:temperateForest': { acorn: 12, mushroom: 3 } },
      // The shape the land rewrite threw away: keyed by drone type, each
      // carrying whichever biome it had happened to roll.
      patches: { forager: { biomeId: 'temperateForest', itemId: 'acorn', grams: 14 } },
      energyPool: 2_400_000,
      power: {},
      active: {},
      larvae: 24,
      larvaeHunger: 0,
      larvaeDying: 0,
      brood: {},
      molding: {},
      droneMolding: { forager: { on: false, target: 20 }, scavenger: { on: false, target: null } },
      droneTypes: { forager: 18, scavenger: 4 },
      buildQueue: [],
      building: null,
      clickHeat: 0,
      fuelLock: { metabolicGenerator: { fuel: 'fat', until: 0 } },
      energy: { preferred: 'fat', fallback: 'carb', overrides: {} },
      structures: {
        hivecore: 4, broodChamber: 3, nodeCluster: 4, moldingChamber: 2,
        metabolicGenerator: 6, caecum: 5, proteinGranule: 10, lipidDroplet: 8,
        glycogenGranule: 10, celluloseBale: 4, vacuole: 60, cistern: 2,
      },
      tech: {
        glycolysis: true, lipolysis: true, bulkMineralAssay: true, stigmergy: true,
        tightPacking: true, scavenging: true, cellulolysis: true,
      },
      castes: { dormant: 0 },
      drones: 22,
      log: [],
    },
    holds: {
      'a day of playtime': (s) => s.playtime === 86_400,
      'two biomes held and one mapped': (s) =>
        s.territory.temperateForest === 72 && s.unclaimed.taiga === 36,
      'what it had spilled': (s) => s.spilledItems.leaf_litter === 40,
      'the nutrient it had barred from the pool': (s) => s.generalBans.ash === true,
      'the stars it had set': (s) => s.focus['forager:temperateForest'].acorn === true,
      'both kinds of drone': (s) => s.droneTypes.forager === 18 && s.droneTypes.scavenger === 4,
      'the fuel its generators were locked onto': (s) => s.fuelLock.metabolicGenerator.fuel === 'fat',
      'the fuel the player had CHOSEN, not a default': (s) =>
        s.energy.preferred === 'fat' && s.energy.fallback === 'carb',
      'seven techs': (s) => Object.values(s.tech).filter(Boolean).length >= 7,
    },
    becomes: {
      'its old patches dropped rather than mistranslated': (s) => s.patches === undefined,
      'crews, and area share rather than targets': (s) =>
        s.crews && Object.keys(s.assign).length === 0,
      'its discoveries rescaled': (s) =>
        s.found['forager:temperateForest'].acorn === 120
        && s.found['forager:temperateForest'].mushroom === 30,
      // v21 ran before this save was written, so the drone ration is whatever
      // the save holds — nothing. The merge fills it from the defaults, which
      // is the point: an old save must come back with a ration, not without one.
      'a ration for its drones': (s) => Boolean(s.energy.overrides.drones?.preferred),
      'an empty genome': (s) => Object.keys(s.genes).length === 0,
    },
  },
];

/** The encoding `exportSave` produces, so a fixture goes in the same door. */
export function encodeSave(obj) {
  return Buffer.from(encodeURIComponent(JSON.stringify(obj)), 'utf8').toString('base64');
}
