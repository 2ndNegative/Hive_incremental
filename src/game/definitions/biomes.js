// Territory types.
//
// The hive holds land, measured in square metres, and what it holds decides
// what it can find. Every forage roll picks a biome first — weighted purely by
// how much of that biome the hive holds — and then picks something that grows,
// walks, rots or was discarded there.
//
// Area does nothing else. It is not a population cap, it does not scale yields
// and it does not deplete. A hive on 36 m² of forest finds exactly what a hive
// on 36 hectares of forest finds, just as often. That is deliberate: the mix is
// the mechanic, and everything else can be layered on later without changing
// how any of this is written.
//
//   id        stable key, used in saves
//   name      what the player sees
//   colour    the tile in the territory treemap. Chosen to differ in LIGHTNESS
//             as well as hue, so the map is still readable without colour
//             vision — the depth gradient from shelf to abyss is the clearest
//             example, and it doubles as the thing that makes the sea look
//             like the sea.
//   climate   grouping for the interface only
//   desc      one line of flavour that also tells the player what it is for
//
// There is no way to gain territory yet. `grantTerritory` in run.js is the one
// door in, so when expansion arrives — a claim action, a structure, a prestige
// award — it goes through that and nothing here has to change.

export const BIOMES = {
  /* ------------------------------------------------------------- forested -- */

  temperateForest: {
    id: 'temperateForest',
    name: 'Temperate forest',
    colour: '#4a7c4e',
    climate: 'forest',
    desc: 'Broadleaf woodland with a deep litter layer. Mast years, browsing deer, and more fungus than anything else here.',
  },
  temperateRainforest: {
    id: 'temperateRainforest',
    name: 'Temperate rainforest',
    colour: '#35705f',
    climate: 'forest',
    desc: 'Wet, cool and permanently dripping. Enormous standing biomass, slow to rot, and salmon coming up the rivers.',
  },
  tropicalRainforest: {
    id: 'tropicalRainforest',
    name: 'Tropical rainforest',
    colour: '#5b9e3f',
    climate: 'forest',
    desc: 'The densest standing biomass on the planet, and the fastest turnover. Fruit year-round, insects without end.',
  },
  taiga: {
    id: 'taiga',
    name: 'Taiga',
    colour: '#3a5f52',
    climate: 'cold',
    desc: 'Boreal conifer. Poor, acidic, frozen half the year — but vast, and almost nothing competes for it.',
  },

  /* ------------------------------------------------------------ open land -- */

  grassland: {
    id: 'grassland',
    name: 'Temperate grassland',
    colour: '#b5a04a',
    climate: 'open',
    desc: 'Prairie and steppe. Grass to the horizon, deep black soil beneath it, and herds that follow the rain.',
  },
  savanna: {
    id: 'savanna',
    name: 'Tropical savanna',
    colour: '#c08a3e',
    climate: 'open',
    desc: 'Grass and scattered trees under a hard sun. Seasonal, locust-prone, and crossed by very large animals.',
  },
  tundra: {
    id: 'tundra',
    name: 'Tundra',
    colour: '#8fa3a8',
    climate: 'cold',
    desc: 'Permafrost under lichen and dwarf shrub. Almost no energy in it, and what there is arrives for eight weeks a year.',
  },
  desert: {
    id: 'desert',
    name: 'Desert',
    colour: '#d4a259',
    climate: 'arid',
    desc: 'Mineral-rich and biologically empty. Nothing to eat, everything to dig — evaporites sit on the surface here.',
  },
  alpine: {
    id: 'alpine',
    name: 'Alpine',
    colour: '#7d8794',
    climate: 'cold',
    desc: 'Above the treeline. Thin air, bare rock, exposed ore bodies and a short violent growing season.',
  },

  /* ----------------------------------------------------------------- wet -- */

  wetland: {
    id: 'wetland',
    name: 'Wetland',
    colour: '#5f9080',
    climate: 'water',
    desc: 'Marsh, bog and fen. Waterlogged, anaerobic, and the most productive ground per square metre on Earth.',
  },
  riverine: {
    id: 'riverine',
    name: 'River',
    colour: '#3d7fa6',
    climate: 'water',
    desc: 'Running fresh water. Everything that lives in it has to hold station, and everything on land comes to drink.',
  },
  lake: {
    id: 'lake',
    name: 'Freshwater lake',
    colour: '#4b8fb8',
    climate: 'water',
    desc: 'Standing fresh water, stratified and slow. Poorer per litre than a river but vastly larger, and it holds what it grows.',
  },

  /* ---------------------------------------------------------------- marine -- */
  //
  // The sea is layered, and the layers are not interchangeable. Sunlight stops
  // at about 200 m and everything below it is living on what falls from above,
  // which is why the deep entries are sparse, strange and mostly water.

  coast: {
    id: 'coast',
    name: 'Coast',
    colour: '#4aa3b5',
    climate: 'marine',
    desc: 'Intertidal rock and sand. Shellfish, weed and brine — the richest source of trace elements the planet offers.',
  },
  estuary: {
    id: 'estuary',
    name: 'Estuary',
    colour: '#5a9aa0',
    climate: 'marine',
    desc: 'Where the river meets the tide. Brackish, turbid, and a nursery for half the species on the shelf.',
  },
  kelpForest: {
    id: 'kelpForest',
    name: 'Kelp forest',
    colour: '#2f7d6a',
    climate: 'marine',
    desc: 'Standing algal forest in cold shallow water. It grows half a metre a day and shelters everything that eats it.',
  },
  coralReef: {
    id: 'coralReef',
    name: 'Coral reef',
    colour: '#d96f8a',
    climate: 'marine',
    desc: 'A limestone city built by animals. Extraordinary diversity packed onto almost no nutrient at all.',
  },
  continentalShelf: {
    id: 'continentalShelf',
    name: 'Continental shelf',
    colour: '#3f6f94',
    climate: 'marine',
    desc: 'Shallow seabed out to the drop-off. Flatfish on the bottom, shoals above it, and most of the planet\'s fishing.',
  },
  openOcean: {
    id: 'openOcean',
    name: 'Open ocean',
    colour: '#2f5f8f',
    climate: 'marine',
    desc: 'The sunlit surface layer, out of sight of land. Thin, enormous, and crossed by the fastest animals in the sea.',
  },
  twilightZone: {
    id: 'twilightZone',
    name: 'Twilight zone',
    colour: '#3b4f78',
    climate: 'marine',
    desc: 'Two hundred metres down to a thousand. The largest animal biomass on the planet lives here and rises every night to feed.',
  },
  abyssalPlain: {
    id: 'abyssalPlain',
    name: 'Abyssal plain',
    colour: '#2a3550',
    climate: 'marine',
    desc: 'Cold, dark, four kilometres down and flat to the horizon. Everything alive here is waiting for something to fall.',
  },
  hydrothermalVent: {
    id: 'hydrothermalVent',
    name: 'Hydrothermal vent',
    colour: '#b5563f',
    climate: 'marine',
    desc: 'Superheated mineral water on the ocean floor, and an ecosystem running on sulfide instead of sunlight. The hive should find this very interesting.',
  },
  polarSea: {
    id: 'polarSea',
    name: 'Polar sea',
    colour: '#9fc0cf',
    climate: 'marine',
    desc: 'Sea ice and the water beneath it. Algae grow on the underside of the ice, krill eat the algae, and everything else eats the krill.',
  },

  /* --------------------------------------------------------------- human -- */

  farmland: {
    id: 'farmland',
    name: 'Farmland',
    colour: '#9aad3e',
    climate: 'built',
    desc: 'Monoculture at scale. A biosphere reduced to six species and fed deliberately, which makes it absurdly easy to raid.',
  },
  lightUrban: {
    id: 'lightUrban',
    name: 'Light urban',
    colour: '#8a7f9c',
    climate: 'built',
    desc: 'Suburb and village. Gardens, bins, pets, and a density of discarded food no wild habitat can match.',
  },
  denseUrban: {
    id: 'denseUrban',
    name: 'Dense urban',
    colour: '#6f6a7d',
    climate: 'built',
    desc: 'City proper. Refuse by the tonne, rats and pigeons living on it, and the locals themselves at the highest density they ever reach.',
  },
  industrial: {
    id: 'industrial',
    name: 'Industrial',
    colour: '#a78377',
    climate: 'built',
    desc: 'Works, yards and tips. No food worth the name, but refined metal and pure hydrocarbon lying in the open.',
  },
};

export const BIOME_IDS = Object.keys(BIOMES);

export const CLIMATES = {
  forest: 'Forested',
  open: 'Open land',
  cold: 'Cold',
  arid: 'Arid',
  water: 'Fresh water',
  marine: 'Marine',
  built: 'Human',
};

/**
 * Is this tile dark enough to need light text on it?
 *
 * Relative luminance by the WCAG formula, against the point where black and
 * white contrast equally (0.179). Above it black wins, below it white does —
 * which is why the desert gets dark labels and the abyssal plain gets light
 * ones, and why neither has to be eyeballed.
 */
export function needsLightText(hex) {
  const v = (i) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * v(0) + 0.7152 * v(1) + 0.0722 * v(2) < 0.179;
}

/** The hive's holdings, largest first. Zero and negative areas are dropped. */
export function holdings(state) {
  return BIOME_IDS.filter((id) => (state.territory?.[id] || 0) > 0)
    .map((id) => ({ id, def: BIOMES[id], area: state.territory[id] }))
    .sort((a, b) => b.area - a.area);
}

/** Total area held, in square metres. */
export function totalArea(state) {
  let total = 0;
  for (const id of BIOME_IDS) total += state.territory?.[id] || 0;
  return total;
}

/**
 * Each biome's share of the hive's land, as a fraction of 1. A hive that is
 * half city and half forest rolls a coin before it rolls anything else.
 */
export function biomeShares(state) {
  const total = totalArea(state);
  if (total <= 0) return {};
  const shares = {};
  for (const id of BIOME_IDS) {
    const area = state.territory?.[id] || 0;
    if (area > 0) shares[id] = area / total;
  }
  return shares;
}

/* ------------------------------------------------------- what land is worth */

/**
 * WHAT HOLDING GROUND ACTUALLY DOES.
 *
 * Two things, and they are deliberately different things:
 *
 *   1. CAPACITY. A square metre only supports so much foraging. Land is the
 *      ceiling on how many drones can be out at once — not a multiplier on what
 *      they bring back. A hive with forty foragers and nine square metres is a
 *      hive with nine foragers and thirty-one standing around.
 *
 *   2. PATCHES. A big holding is several places at once. Every patch is its own
 *      find, rolled separately against the whole territory, worked by its own
 *      share of the drones. More land does not make a trip richer; it makes the
 *      hive work acorns and carrion and standing water at the same time instead
 *      of whatever the last roll happened to say.
 *
 * So expanding raises the ceiling AND broadens what comes in, and neither of
 * those is a number quietly multiplying another number.
 */

/** Foragers one square metre of ground will support. */
export const FORAGERS_PER_SQUARE_METRE = 0.4;

/** Ground that supports one separately-worked patch. */
export const AREA_PER_PATCH = 36;

/** However much land the hive holds, the interface stays readable. */
export const MAX_PATCHES = 12;

/**
 * How many drones the hive's land can keep working at once.
 *
 * Whole drones. Two thirds of a forager is not a thing that can be out on the
 * ground, and a capacity of 14.4 reads as a rounding error rather than a rule —
 * but any land at all supports at least one, because a hive standing on a
 * square metre can still reach down and pick something up.
 */
export function landCapacity(state) {
  const area = totalArea(state);
  if (area <= 0) return 0;
  return Math.max(1, Math.floor(area * FORAGERS_PER_SQUARE_METRE));
}

/**
 * How many patches the hive can work at once.
 *
 * Area decides it — but never fewer than the number of biomes held, so a hive
 * that has gone to the trouble of holding three kinds of ground can always have
 * drones on all three at once rather than rolling for the privilege.
 */
export function patchCount(state) {
  // Counted rather than built: this runs inside computeDerived and inside every
  // tick, and `holdings` allocates an array of objects and sorts it. Offline
  // catch-up is millions of ticks, and it showed.
  let kinds = 0;
  let area = 0;
  for (const id of BIOME_IDS) {
    const held = state.territory?.[id] || 0;
    if (held > 0) {
      kinds += 1;
      area += held;
    }
  }
  if (!kinds) return 0;
  const byArea = Math.floor(area / AREA_PER_PATCH);
  return Math.max(1, Math.min(MAX_PATCHES, Math.max(kinds, byArea)));
}
