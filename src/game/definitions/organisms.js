// Prey organisms.
//
// An organism is a live mass plus a butchery breakdown: what fraction of that
// mass comes off as which item. Fractions are of LIVE weight and need not sum
// to 1; the remainder is gut content, hide waste and loss.
//
// `biomes` is where it lives, weighted 1-10 the same way items are weighted in
// forage.js. Hunters roll an ORGANISM rather than an item, because one deer is
// a dozen different cuts arriving at once — which is the whole reason hunting
// feels different from foraging.
//
// `habitat` is flavour text for the codex. `biomes` is what the game reads.
//
// `difficulty` is a placeholder cost multiplier for the future hunt loop:
// roughly how much effort a kill costs relative to its mass.

const F = 'temperateForest';
const TR = 'temperateRainforest';
const JR = 'tropicalRainforest';
const TA = 'taiga';
const GR = 'grassland';
const SV = 'savanna';
const TU = 'tundra';
const DE = 'desert';
const AL = 'alpine';
const WE = 'wetland';
const RI = 'riverine';
const LK = 'lake';
const CO = 'coast';
const ES = 'estuary';
const KE = 'kelpForest';
const RE = 'coralReef';
const SH = 'continentalShelf';
const OO = 'openOcean';
const TW = 'twilightZone';
const AB = 'abyssalPlain';
const HV = 'hydrothermalVent';
const PO = 'polarSea';
const FA = 'farmland';
const LU = 'lightUrban';
const DU = 'denseUrban';
const IN = 'industrial';

export const ORGANISMS = {
  cattle: {
    id: 'cattle',
    name: 'Cattle',
    biomes: { [FA]: 9, [GR]: 4, [LU]: 1 },
    habitat: 'pasture',
    liveMass: 600_000, // grams
    difficulty: 3,
    note: 'Enormous, docile, and standing in open fields in their millions. The single most efficient biomass source on this continent.',
    parts: {
      beef_ground_80: 0.28,
      beef_sirloin: 0.08,
      tallow: 0.08,
      bone_dry: 0.12,
      beef_liver: 0.012,
      beef_heart: 0.004,
      beef_kidney: 0.002,
      blood_bovine: 0.035,
      beef_tripe: 0.02,
      leather: 0.07,
    },
  },
  deer: {
    id: 'deer',
    name: 'Deer',
    biomes: { [F]: 8, [TR]: 6, [TA]: 5, [GR]: 3, [AL]: 2, [LU]: 2 },
    habitat: 'forest',
    liveMass: 70_000,
    difficulty: 6,
    note: 'Lean, fast and alert. Poor fat yield, but it walks into the open at dusk.',
    parts: {
      venison: 0.38,
      bone_dry: 0.13,
      beef_liver: 0.015,
      blood_bovine: 0.03,
      leather: 0.06,
    },
  },
  pig: {
    id: 'pig',
    name: 'Pig',
    biomes: { [FA]: 7, [F]: 3, [TR]: 2, [JR]: 2 },
    habitat: 'farm',
    liveMass: 110_000,
    difficulty: 4,
    parts: {
      pork_loin: 0.24,
      lard: 0.16,
      bone_dry: 0.1,
      pork_liver: 0.014,
      blood_bovine: 0.035,
      leather: 0.05,
    },
  },
  sheep: {
    id: 'sheep',
    name: 'Sheep',
    biomes: { [FA]: 6, [AL]: 4, [GR]: 3 },
    habitat: 'pasture',
    liveMass: 60_000,
    difficulty: 3,
    parts: {
      lamb_leg: 0.32,
      tallow: 0.06,
      bone_dry: 0.11,
      beef_liver: 0.013,
      blood_bovine: 0.03,
      wool: 0.04,
    },
  },
  rabbit: {
    id: 'rabbit',
    name: 'Rabbit',
    biomes: { [GR]: 6, [F]: 5, [FA]: 4, [LU]: 3, [DE]: 2, [TU]: 2 },
    habitat: 'grassland',
    liveMass: 2_000,
    difficulty: 5,
    note: 'Almost no fat. Living on rabbit alone starves a predator of energy even on a full stomach.',
    parts: {
      rabbit: 0.52,
      bone_dry: 0.14,
      beef_liver: 0.02,
      leather: 0.05,
    },
  },
  chicken: {
    id: 'chicken',
    name: 'Chicken',
    biomes: { [FA]: 9, [LU]: 4, [DU]: 2 },
    habitat: 'farm',
    liveMass: 2_500,
    difficulty: 2,
    note: 'Twenty-five billion of them. The most numerous bird on the planet by an order of magnitude.',
    parts: {
      chicken_breast: 0.2,
      chicken_thigh: 0.22,
      bone_dry: 0.12,
      chicken_liver: 0.025,
    },
  },
  rat: {
    id: 'rat',
    name: 'Rat',
    biomes: { [DU]: 9, [LU]: 6, [IN]: 5, [FA]: 3 },
    habitat: 'urban',
    liveMass: 300,
    difficulty: 4,
    note: 'Lives wherever the locals do, in numbers nobody has ever counted.',
    parts: {
      rabbit: 0.45,
      bone_dry: 0.13,
      chicken_liver: 0.03,
    },
  },
  pigeon: {
    id: 'pigeon',
    name: 'Pigeon',
    biomes: { [DU]: 8, [LU]: 5, [CO]: 2, [AL]: 2 },
    habitat: 'urban',
    liveMass: 350,
    difficulty: 5,
    parts: {
      duck_meat: 0.42,
      bone_dry: 0.12,
      chicken_liver: 0.025,
    },
  },
  cod: {
    id: 'cod',
    name: 'Cod',
    biomes: { [SH]: 7, [PO]: 4, [CO]: 3, [KE]: 2 },
    habitat: 'ocean',
    liveMass: 5_000,
    difficulty: 7,
    parts: {
      cod: 0.44,
      bone_dry: 0.1,
      cod_liver_oil: 0.02,
    },
  },
  salmon: {
    id: 'salmon',
    name: 'Salmon',
    biomes: { [RI]: 7, [CO]: 4, [ES]: 4, [PO]: 3, [LK]: 2 },
    habitat: 'river',
    liveMass: 4_000,
    difficulty: 6,
    note: 'Swims upstream in dense runs once a year, which makes the timing of a harvest matter.',
    parts: {
      salmon: 0.52,
      bone_dry: 0.09,
    },
  },
  cricket_swarm: {
    id: 'cricket_swarm',
    name: 'Cricket swarm',
    biomes: { [GR]: 6, [SV]: 5, [F]: 3, [FA]: 3, [JR]: 3 },
    habitat: 'grassland',
    liveMass: 5_000,
    difficulty: 1,
    note: 'Not an individual but a harvestable mass. Trivial to take, poor in fat, rich in magnesium.',
    parts: {
      cricket: 0.92,
    },
  },
  locust_swarm: {
    id: 'locust_swarm',
    name: 'Locust swarm',
    biomes: { [SV]: 7, [DE]: 4, [GR]: 4, [FA]: 3 },
    habitat: 'grassland',
    liveMass: 40_000,
    difficulty: 2,
    note: 'A plague-scale swarm can mass tens of tonnes and strips a region bare on its own.',
    parts: {
      locust: 0.92,
    },
  },
  hominid: {
    id: 'hominid',
    name: 'Hominid',
    biomes: { [DU]: 7, [LU]: 4, [FA]: 1 },
    habitat: 'urban',
    liveMass: 70_000,
    difficulty: 9,
    note: 'Nutritionally ordinary. Behaviourally the single most dangerous organism on the planet — they coordinate, and they remember.',
    parts: {
      hominid_muscle: 0.4,
      hominid_adipose: 0.15,
      hominid_bone: 0.14,
      hominid_liver: 0.022,
      hominid_blood: 0.07,
      leather: 0.04,
    },
  },
  mackerel: {
    id: 'mackerel',
    name: 'Mackerel shoal',
    biomes: { [OO]: 5, [SH]: 5, [CO]: 3 },
    habitat: 'ocean',
    liveMass: 6_000,
    difficulty: 5,
    note: 'Taken as a shoal rather than a fish. Oily enough to be worth the water.',
    parts: { mackerel: 0.5, bone_dry: 0.09 },
  },
  herring: {
    id: 'herring',
    name: 'Herring shoal',
    biomes: { [SH]: 5, [OO]: 4, [PO]: 3, [CO]: 3 },
    habitat: 'ocean',
    liveMass: 5_000,
    difficulty: 4,
    parts: { herring: 0.5, bone_dry: 0.09 },
  },
  tuna: {
    id: 'tuna',
    name: 'Tuna',
    biomes: { [OO]: 4 },
    habitat: 'ocean',
    liveMass: 250_000,
    difficulty: 9,
    note: 'Warm-blooded, fast, and a quarter of a tonne. The largest single prize in open water.',
    parts: { tuna: 0.55, bone_dry: 0.08 },
  },
  trout: {
    id: 'trout',
    name: 'Trout',
    biomes: { [RI]: 6, [LK]: 5, [AL]: 3 },
    habitat: 'river',
    liveMass: 1_500,
    difficulty: 5,
    parts: { trout: 0.5, bone_dry: 0.09 },
  },
  squid: {
    id: 'squid',
    name: 'Squid',
    biomes: { [SH]: 4, [OO]: 3, [RE]: 2 },
    habitat: 'ocean',
    liveMass: 1_200,
    difficulty: 5,
    note: 'Almost no skeleton and almost no waste. One of the cleanest conversions in the sea.',
    parts: { squid: 0.78 },
  },
  octopus: {
    id: 'octopus',
    name: 'Octopus',
    biomes: { [RE]: 4, [KE]: 4, [SH]: 3, [CO]: 2 },
    habitat: 'ocean',
    liveMass: 4_000,
    difficulty: 7,
    note: 'Solves problems. Opens things. Worth watching rather than eating, but the hive is not sentimental.',
    parts: { octopus: 0.75 },
  },
  duck: {
    id: 'duck',
    name: 'Duck',
    biomes: { [WE]: 6, [RI]: 5, [LK]: 4, [ES]: 3, [CO]: 3, [FA]: 2 },
    habitat: 'wetland',
    liveMass: 1_400,
    difficulty: 6,
    parts: { duck_meat: 0.4, bone_dry: 0.11, chicken_liver: 0.025 },
  },
  turkey: {
    id: 'turkey',
    name: 'Turkey',
    biomes: { [FA]: 6, [F]: 3 },
    habitat: 'farm',
    liveMass: 9_000,
    difficulty: 3,
    parts: { turkey_breast: 0.3, chicken_thigh: 0.12, bone_dry: 0.12, chicken_liver: 0.02 },
  },
  goat: {
    id: 'goat',
    name: 'Goat',
    biomes: { [AL]: 5, [DE]: 4, [FA]: 4, [SV]: 3 },
    habitat: 'upland',
    liveMass: 45_000,
    difficulty: 5,
    note: 'Eats anything, climbs anything, survives anywhere. The locals took it everywhere for exactly that reason.',
    parts: { goat: 0.35, bone_dry: 0.12, beef_liver: 0.015, leather: 0.05 },
  },
  horse: {
    id: 'horse',
    name: 'Horse',
    biomes: { [GR]: 4, [FA]: 4 },
    habitat: 'pasture',
    liveMass: 450_000,
    difficulty: 6,
    parts: { horse: 0.4, bone_dry: 0.12, beef_liver: 0.012, leather: 0.06 },
  },
  bison: {
    id: 'bison',
    name: 'Bison',
    biomes: { [GR]: 6, [TA]: 2 },
    habitat: 'grassland',
    liveMass: 700_000,
    difficulty: 7,
    note: 'Three quarters of a tonne that can outrun a horse. There were sixty million; there are now rather fewer.',
    parts: {
      bison: 0.33, tallow: 0.06, bone_dry: 0.13, beef_liver: 0.012, blood_bovine: 0.03, leather: 0.07,
    },
  },
  termite_mound: {
    id: 'termite_mound',
    name: 'Termite mound',
    biomes: { [JR]: 7, [SV]: 6, [TR]: 3 },
    habitat: 'savanna',
    liveMass: 30_000,
    difficulty: 2,
    note: 'A single colony outweighs the grazers standing on top of it, and does not run away.',
    parts: { termite: 0.9 },
  },
};

export const ORGANISM_IDS = Object.keys(ORGANISMS);

/** Everything huntable in a given biome, with its weight. */
export function preyFor(biomeId) {
  const out = [];
  for (const id of ORGANISM_IDS) {
    const weight = ORGANISMS[id].biomes?.[biomeId];
    if (weight > 0) out.push({ organismId: id, weight });
  }
  return out;
}

/** Total item mass (grams) a single organism butchers down to. */
export function butcherYield(organismId) {
  const org = ORGANISMS[organismId];
  const out = {};
  for (const [itemId, fraction] of Object.entries(org.parts)) {
    if (fraction > 0) out[itemId] = org.liveMass * fraction;
  }
  return out;
}
