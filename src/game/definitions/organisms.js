// Prey organisms.
//
// Hunting mechanics are not built yet — this is the data they will sit on. An
// organism is a live mass plus a butchery breakdown: what fraction of that mass
// comes off as which item. Fractions are of LIVE weight and need not sum to 1;
// the remainder is gut content, hide waste and loss.
//
// `difficulty` is a placeholder cost multiplier for the future hunt loop:
// roughly how much effort a kill costs relative to its mass.

export const ORGANISMS = {
  cattle: {
    id: 'cattle',
    name: 'Cattle',
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
};

export const ORGANISM_IDS = Object.keys(ORGANISMS);

export const HABITATS = [...new Set(ORGANISM_IDS.map((id) => ORGANISMS[id].habitat))];

/** Total item mass (grams) a single organism butchers down to. */
export function butcherYield(organismId) {
  const org = ORGANISMS[organismId];
  const out = {};
  for (const [itemId, fraction] of Object.entries(org.parts)) {
    if (fraction > 0) out[itemId] = org.liveMass * fraction;
  }
  return out;
}
