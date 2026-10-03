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
    climate: 'forest',
    desc: 'Broadleaf woodland with a deep litter layer. Mast years, browsing deer, and more fungus than anything else here.',
  },
  temperateRainforest: {
    id: 'temperateRainforest',
    name: 'Temperate rainforest',
    climate: 'forest',
    desc: 'Wet, cool and permanently dripping. Enormous standing biomass, slow to rot, and salmon coming up the rivers.',
  },
  tropicalRainforest: {
    id: 'tropicalRainforest',
    name: 'Tropical rainforest',
    climate: 'forest',
    desc: 'The densest standing biomass on the planet, and the fastest turnover. Fruit year-round, insects without end.',
  },
  taiga: {
    id: 'taiga',
    name: 'Taiga',
    climate: 'cold',
    desc: 'Boreal conifer. Poor, acidic, frozen half the year — but vast, and almost nothing competes for it.',
  },

  /* ------------------------------------------------------------ open land -- */

  grassland: {
    id: 'grassland',
    name: 'Temperate grassland',
    climate: 'open',
    desc: 'Prairie and steppe. Grass to the horizon, deep black soil beneath it, and herds that follow the rain.',
  },
  savanna: {
    id: 'savanna',
    name: 'Tropical savanna',
    climate: 'open',
    desc: 'Grass and scattered trees under a hard sun. Seasonal, locust-prone, and crossed by very large animals.',
  },
  tundra: {
    id: 'tundra',
    name: 'Tundra',
    climate: 'cold',
    desc: 'Permafrost under lichen and dwarf shrub. Almost no energy in it, and what there is arrives for eight weeks a year.',
  },
  desert: {
    id: 'desert',
    name: 'Desert',
    climate: 'arid',
    desc: 'Mineral-rich and biologically empty. Nothing to eat, everything to dig — evaporites sit on the surface here.',
  },
  alpine: {
    id: 'alpine',
    name: 'Alpine',
    climate: 'cold',
    desc: 'Above the treeline. Thin air, bare rock, exposed ore bodies and a short violent growing season.',
  },

  /* ----------------------------------------------------------------- wet -- */

  wetland: {
    id: 'wetland',
    name: 'Wetland',
    climate: 'water',
    desc: 'Marsh, bog and fen. Waterlogged, anaerobic, and the most productive ground per square metre on Earth.',
  },
  riverine: {
    id: 'riverine',
    name: 'River and lake',
    climate: 'water',
    desc: 'Fresh water in quantity, with everything that comes to drink from it and everything that lives in it.',
  },
  coast: {
    id: 'coast',
    name: 'Coast',
    climate: 'water',
    desc: 'Intertidal rock and sand. Shellfish, weed and brine — the richest source of trace elements the planet offers.',
  },

  /* --------------------------------------------------------------- human -- */

  farmland: {
    id: 'farmland',
    name: 'Farmland',
    climate: 'built',
    desc: 'Monoculture at scale. A biosphere reduced to six species and fed deliberately, which makes it absurdly easy to raid.',
  },
  lightUrban: {
    id: 'lightUrban',
    name: 'Light urban',
    climate: 'built',
    desc: 'Suburb and village. Gardens, bins, pets, and a density of discarded food no wild habitat can match.',
  },
  denseUrban: {
    id: 'denseUrban',
    name: 'Dense urban',
    climate: 'built',
    desc: 'City proper. Refuse by the tonne, rats and pigeons living on it, and the locals themselves at the highest density they ever reach.',
  },
  industrial: {
    id: 'industrial',
    name: 'Industrial',
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
  water: 'Wet',
  built: 'Human',
};

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
 * Each biome's share of the hive's land, as a fraction of 1. This is the only
 * thing area is used for: a hive that is half city and half forest rolls a
 * coin before it rolls anything else.
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
