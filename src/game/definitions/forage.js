// Where everything is found, and who can get it.
//
// Every item in the database has an entry here. An entry says two things:
//
//   gather   which castes can obtain it directly — 'forager', 'scavenger',
//            'excavator', 'siphon'. 'hunter' is informational: it marks flesh
//            that arrives by butchering, and hunters roll ORGANISMS rather than
//            items, because one deer is a dozen different cuts at once.
//   biomes   relative abundance per territory type, roughly 1-10. Absent means
//            absent: you will not find a brazil nut in the tundra.
//
// The weights are relative WITHIN a biome, not across biomes. A 9 in farmland
// and a 9 on the coast do not mean the two are equally likely overall — that
// depends entirely on how much of each the hive holds, which is the point.
//
// An item with a 'hunter' tag and no biomes is reachable only through prey.
// An item with no route at all is a bug, and validate-items.mjs fails on it.
//
// A note on the human biomes: they are deliberately the richest ground in the
// game. A city is a habitat that concentrates food, discards most of it, and
// defends none of it, and the hive is very well placed to notice.

/* Short keys, so a line stays a line. */
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
const CO = 'coast';
const FA = 'farmland';
const LU = 'lightUrban';
const DU = 'denseUrban';
const IN = 'industrial';

const f = (gather, biomes = {}) => ({ gather, biomes });

export const GATHER_TYPES = {
  forager: { id: 'forager', name: 'Foraged', desc: 'Standing matter: plants, fungus, weed, anything that does not run.' },
  scavenger: { id: 'scavenger', name: 'Scavenged', desc: 'Already dead or already discarded. Refuse, carrion, detritus, scrap.' },
  hunter: { id: 'hunter', name: 'Hunted', desc: 'Taken live and butchered. Arrives as a whole carcass worth of cuts.' },
  excavator: { id: 'excavator', name: 'Excavated', desc: 'Dug out of the substrate. Soil, rock, ore, hydrocarbon.' },
  siphon: { id: 'siphon', name: 'Siphoned', desc: 'Drawn as bulk fluid.' },
};

export const FORAGE = {
  /* ------------------------------------------------------------------ meat */
  // Butchered cuts. Nearly all of this arrives through prey; the urban weights
  // are what a scavenger finds behind a butcher's shop or flattened on a road.
  beef_ground_80: f(['hunter', 'scavenger'], { [DU]: 4, [LU]: 3, [FA]: 2 }),
  beef_sirloin: f(['hunter', 'scavenger'], { [DU]: 2, [LU]: 1 }),
  pork_loin: f(['hunter', 'scavenger'], { [DU]: 3, [LU]: 2, [FA]: 2 }),
  chicken_breast: f(['hunter', 'scavenger'], { [DU]: 5, [LU]: 4, [FA]: 3 }),
  chicken_thigh: f(['hunter', 'scavenger'], { [DU]: 5, [LU]: 4, [FA]: 3 }),
  lamb_leg: f(['hunter', 'scavenger'], { [DU]: 2, [LU]: 1 }),
  venison: f(['hunter', 'scavenger'], { [F]: 1, [LU]: 1 }),
  rabbit: f(['hunter', 'scavenger'], { [F]: 1, [GR]: 1, [LU]: 1 }),
  horse: f(['hunter', 'scavenger'], { [DU]: 1 }),
  duck_meat: f(['hunter', 'scavenger'], { [WE]: 1, [RI]: 1 }),
  turkey_breast: f(['hunter', 'scavenger'], { [DU]: 2, [LU]: 2, [FA]: 2 }),
  goat: f(['hunter', 'scavenger'], { [AL]: 1, [DE]: 1, [FA]: 1 }),
  bison: f(['hunter', 'scavenger'], { [GR]: 1 }),

  /* ----------------------------------------------------------------- organ */
  // Offal is the part of an animal people throw away, which is why the city
  // weights here are better than the wild ones.
  beef_liver: f(['hunter', 'scavenger'], { [DU]: 2, [FA]: 2 }),
  chicken_liver: f(['hunter', 'scavenger'], { [DU]: 2, [FA]: 2 }),
  pork_liver: f(['hunter', 'scavenger'], { [DU]: 2, [FA]: 2 }),
  beef_kidney: f(['hunter', 'scavenger'], { [DU]: 2, [FA]: 1 }),
  beef_heart: f(['hunter', 'scavenger'], { [DU]: 2, [FA]: 1 }),
  beef_brain: f(['scavenger'], { [DU]: 2, [FA]: 1 }),
  beef_tongue: f(['scavenger'], { [DU]: 2, [FA]: 1 }),
  beef_spleen: f(['scavenger'], { [DU]: 2, [FA]: 1 }),
  beef_tripe: f(['hunter', 'scavenger'], { [DU]: 2, [FA]: 1 }),
  bone_marrow: f(['scavenger'], { [F]: 1, [GR]: 2, [SV]: 2, [DU]: 2 }),
  blood_bovine: f(['hunter', 'scavenger'], { [FA]: 2, [DU]: 1 }),

  /* --------------------------------------------------------------- aquatic */
  // Shellfish are foraged — they are attached to a rock and cannot leave.
  // Anything with fins is hunted.
  salmon: f(['hunter'], {}),
  cod: f(['hunter'], {}),
  tuna: f(['hunter'], {}),
  sardine: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  mackerel: f(['hunter'], {}),
  herring: f(['hunter'], {}),
  trout: f(['hunter'], {}),
  shrimp: f(['forager'], { [CO]: 5, [WE]: 3 }),
  crab: f(['forager'], { [CO]: 6, [WE]: 2 }),
  lobster: f(['forager'], { [CO]: 3 }),
  mussel: f(['forager'], { [CO]: 9 }),
  oyster: f(['forager'], { [CO]: 8, [WE]: 2 }),
  clam: f(['forager'], { [CO]: 8, [WE]: 3 }),
  squid: f(['hunter'], {}),
  octopus: f(['hunter'], {}),

  /* ---------------------------------------------------------------- insect */
  cricket: f(['hunter'], {}),
  locust: f(['hunter'], {}),
  termite: f(['hunter'], {}),
  mealworm: f(['scavenger'], { [F]: 3, [LU]: 3, [DU]: 3, [FA]: 3 }),
  silkworm_pupa: f(['scavenger'], { [FA]: 3, [LU]: 1 }),
  soldier_fly_larva: f(['scavenger'], { [DU]: 5, [LU]: 4, [FA]: 4, [JR]: 2 }),
  weaver_ant: f(['forager'], { [JR]: 5, [SV]: 3 }),

  /* ------------------------------------------------------------------- egg */
  egg_whole: f(['forager', 'scavenger'], { [FA]: 5, [LU]: 4, [DU]: 3, [CO]: 3, [WE]: 2, [F]: 2 }),
  egg_yolk: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  egg_white: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  duck_egg: f(['forager'], { [WE]: 4, [RI]: 3, [FA]: 2 }),
  milk_whole: f(['scavenger'], { [DU]: 4, [LU]: 3, [FA]: 3 }),
  milk_skim: f(['scavenger'], { [DU]: 4, [LU]: 3, [FA]: 2 }),
  cheddar: f(['scavenger'], { [DU]: 5, [LU]: 3 }),
  mozzarella: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  yogurt_plain: f(['scavenger'], { [DU]: 5, [LU]: 3 }),

  /* ------------------------------------------------------------------- fat */
  butter: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  cream_heavy: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  olive_oil: f(['scavenger'], { [DU]: 4, [LU]: 2 }),
  sunflower_oil: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  lard: f(['hunter', 'scavenger'], { [DU]: 2, [FA]: 2 }),
  tallow: f(['hunter', 'scavenger'], { [FA]: 2 }),
  coconut_oil: f(['forager', 'scavenger'], { [JR]: 2, [DU]: 2 }),
  cod_liver_oil: f(['hunter', 'scavenger'], { [DU]: 1 }),

  /* --------------------------------------------------------------- refined */
  whey_powder: f(['scavenger'], { [DU]: 3, [IN]: 2 }),
  sucrose: f(['scavenger'], { [DU]: 6, [LU]: 4, [IN]: 2 }),
  glucose: f(['scavenger'], { [DU]: 3, [IN]: 2 }),
  // Wild colonies, not hives kept by anyone. The locals are not the only
  // species on this planet that farms insects.
  honey: f(['forager'], { [F]: 4, [JR]: 3, [GR]: 3, [SV]: 3, [FA]: 3, [LU]: 3 }),
  maple_syrup: f(['forager', 'scavenger'], { [F]: 3, [TA]: 2, [DU]: 2 }),
  dark_chocolate: f(['scavenger'], { [DU]: 5, [LU]: 3 }),

  /* --------------------------------------------------------------- hominid */
  // Reachable only by hunting them. There is no scavenging route, because the
  // locals are extremely attentive about collecting their own dead.
  hominid_muscle: f(['hunter'], {}),
  hominid_adipose: f(['hunter'], {}),
  hominid_liver: f(['hunter'], {}),
  hominid_blood: f(['hunter'], {}),
  hominid_bone: f(['hunter'], {}),

  /* ----------------------------------------------------------------- grain */
  wheat: f(['forager', 'scavenger'], { [FA]: 9, [GR]: 2, [DU]: 2 }),
  rice_white: f(['forager', 'scavenger'], { [FA]: 2, [DU]: 4, [LU]: 3 }),
  rice_brown: f(['forager'], { [FA]: 5, [WE]: 3 }),
  oats: f(['forager'], { [FA]: 6, [GR]: 2, [TA]: 1 }),
  maize: f(['forager'], { [FA]: 9, [SV]: 2 }),
  barley: f(['forager'], { [FA]: 6, [GR]: 2 }),
  rye: f(['forager'], { [FA]: 4, [GR]: 2, [TA]: 2 }),
  quinoa: f(['forager'], { [FA]: 3, [AL]: 3 }),
  millet: f(['forager'], { [FA]: 4, [SV]: 4, [DE]: 2 }),
  bread_white: f(['scavenger'], { [DU]: 9, [LU]: 7 }),
  pasta_dry: f(['scavenger'], { [DU]: 6, [LU]: 5 }),

  /* ---------------------------------------------------------------- legume */
  soybean: f(['forager'], { [FA]: 8 }),
  lentil: f(['forager'], { [FA]: 5, [DE]: 2 }),
  chickpea: f(['forager'], { [FA]: 5, [DE]: 2 }),
  kidney_bean: f(['forager'], { [FA]: 5 }),
  black_bean: f(['forager'], { [FA]: 5 }),
  split_pea: f(['forager'], { [FA]: 4 }),
  peanut: f(['forager'], { [FA]: 6, [SV]: 3 }),
  tofu_firm: f(['scavenger'], { [DU]: 4, [LU]: 2 }),

  /* ------------------------------------------------------------------- nut */
  almond: f(['forager'], { [FA]: 5, [F]: 1 }),
  walnut: f(['forager'], { [F]: 5, [FA]: 4 }),
  brazil_nut: f(['forager'], { [JR]: 7 }),
  cashew: f(['forager'], { [JR]: 4, [FA]: 3 }),
  hazelnut: f(['forager'], { [F]: 6, [TR]: 3 }),
  pistachio: f(['forager'], { [DE]: 3, [FA]: 3 }),
  pecan: f(['forager'], { [F]: 4, [FA]: 3, [RI]: 2 }),
  macadamia: f(['forager'], { [JR]: 3, [FA]: 2 }),
  sunflower_seed: f(['forager'], { [FA]: 6, [GR]: 3 }),
  pumpkin_seed: f(['forager'], { [FA]: 5, [LU]: 2 }),
  sesame_seed: f(['forager'], { [FA]: 4, [SV]: 2 }),
  flaxseed: f(['forager'], { [FA]: 4, [GR]: 2 }),
  chia_seed: f(['forager'], { [FA]: 3, [DE]: 2 }),

  /* ------------------------------------------------------------- vegetable */
  // Farmland first, gardens second. A suburb is a very inefficient farm that
  // nobody is watching.
  potato: f(['forager'], { [FA]: 8, [LU]: 3, [AL]: 2 }),
  sweet_potato: f(['forager'], { [FA]: 6, [JR]: 3 }),
  carrot: f(['forager'], { [FA]: 7, [LU]: 3 }),
  broccoli: f(['forager'], { [FA]: 5, [LU]: 2 }),
  spinach: f(['forager'], { [FA]: 5, [LU]: 3 }),
  kale: f(['forager'], { [FA]: 4, [LU]: 3 }),
  cabbage: f(['forager'], { [FA]: 6, [LU]: 3 }),
  tomato: f(['forager'], { [FA]: 6, [LU]: 4 }),
  onion: f(['forager'], { [FA]: 7, [LU]: 3 }),
  garlic: f(['forager'], { [FA]: 4, [LU]: 2 }),
  bell_pepper_red: f(['forager'], { [FA]: 4, [LU]: 2 }),
  cucumber: f(['forager'], { [FA]: 4, [LU]: 3 }),
  beetroot: f(['forager'], { [FA]: 4, [LU]: 2 }),
  celery: f(['forager'], { [FA]: 3, [WE]: 2, [LU]: 2 }),
  asparagus: f(['forager'], { [FA]: 3, [GR]: 2, [RI]: 2 }),

  /* ----------------------------------------------------------------- fruit */
  apple: f(['forager'], { [FA]: 7, [LU]: 5, [F]: 2 }),
  banana: f(['forager'], { [JR]: 6, [FA]: 5 }),
  orange: f(['forager'], { [FA]: 6, [LU]: 2 }),
  grape: f(['forager'], { [FA]: 6, [LU]: 2 }),
  strawberry: f(['forager'], { [FA]: 4, [LU]: 4, [F]: 3 }),
  blueberry: f(['forager'], { [F]: 5, [TA]: 5, [WE]: 3, [TU]: 2 }),
  mango: f(['forager'], { [JR]: 7, [FA]: 3 }),
  watermelon: f(['forager'], { [FA]: 5, [SV]: 2 }),
  avocado: f(['forager'], { [JR]: 4, [FA]: 4 }),
  date: f(['forager'], { [DE]: 6, [FA]: 2 }),
  lemon: f(['forager'], { [FA]: 5, [LU]: 2 }),
  kiwifruit: f(['forager'], { [FA]: 4, [TR]: 2 }),
  coconut_meat: f(['forager'], { [JR]: 5, [CO]: 4 }),

  /* ---------------------------------------------------------------- fungus */
  button_mushroom: f(['forager'], { [F]: 6, [TR]: 5, [FA]: 3, [LU]: 2 }),
  shiitake: f(['forager'], { [TR]: 6, [F]: 4, [JR]: 3 }),
  yeast_dried: f(['scavenger'], { [DU]: 4, [LU]: 2, [IN]: 2 }),

  /* ----------------------------------------------------------------- algae */
  kombu: f(['forager'], { [CO]: 8 }),
  wakame: f(['forager'], { [CO]: 7 }),
  nori: f(['forager'], { [CO]: 7 }),
  dulse: f(['forager'], { [CO]: 6 }),
  spirulina: f(['forager'], { [WE]: 5, [RI]: 4 }),
  chlorella: f(['forager'], { [RI]: 4, [WE]: 4 }),

  /* ------------------------------------------------------- bulk and forage */
  // The three things that are everywhere. Grass is the floor of the economy:
  // thin, endless, and available on almost any ground the hive can hold.
  pasture_grass: f(['forager'], {
    [GR]: 10, [FA]: 7, [SV]: 6, [LU]: 5, [WE]: 4, [RI]: 4, [F]: 3, [AL]: 3, [TU]: 2, [DU]: 2,
  }),
  leaf_litter: f(['forager', 'scavenger'], { [F]: 10, [TR]: 9, [JR]: 8, [TA]: 7, [LU]: 3, [WE]: 3 }),
  carrion: f(['scavenger'], {
    [SV]: 6, [GR]: 5, [DU]: 5, [FA]: 5, [F]: 4, [JR]: 4, [LU]: 4, [TR]: 3,
    [TA]: 3, [WE]: 3, [RI]: 3, [CO]: 3, [TU]: 2, [DE]: 2, [AL]: 2,
  }),
  compost: f(['scavenger'], { [FA]: 5, [LU]: 5, [DU]: 3, [F]: 2 }),

  /* ----------------------------------------------------------------- fluid */
  beer: f(['scavenger'], { [DU]: 5, [LU]: 3 }),
  wine_red: f(['scavenger'], { [DU]: 4, [LU]: 2 }),
  spirits_40: f(['scavenger'], { [DU]: 3, [LU]: 1 }),
  fresh_water: f(['siphon'], {
    [RI]: 10, [WE]: 9, [TR]: 7, [JR]: 6, [F]: 5, [TA]: 5, [AL]: 5,
    [LU]: 4, [DU]: 4, [FA]: 4, [GR]: 3, [TU]: 3, [SV]: 2, [IN]: 2,
  }),
  seawater: f(['siphon'], { [CO]: 10 }),
  urine: f(['scavenger'], { [DU]: 4, [LU]: 2 }),

  /* --------------------------------------------------------------- mineral */
  table_salt: f(['excavator', 'scavenger'], { [DE]: 6, [CO]: 4, [DU]: 3 }),
  limestone: f(['excavator'], { [AL]: 7, [DE]: 5, [GR]: 4, [CO]: 4, [F]: 3, [IN]: 3, [SV]: 2 }),
  gypsum: f(['excavator'], { [DE]: 7, [AL]: 3, [IN]: 2 }),
  apatite: f(['excavator'], { [DE]: 4, [AL]: 3, [IN]: 2 }),
  quartz_sand: f(['excavator'], { [DE]: 8, [CO]: 7, [RI]: 4 }),
  sulfur_native: f(['excavator'], { [AL]: 4, [IN]: 3, [DE]: 3 }),
  magnetite: f(['excavator'], { [AL]: 6, [IN]: 4, [DE]: 2 }),
  clay: f(['excavator'], { [RI]: 6, [WE]: 6, [FA]: 4, [F]: 3, [SV]: 2, [TU]: 2 }),
  topsoil: f(['excavator'], { [FA]: 9, [GR]: 9, [F]: 7, [TR]: 6, [JR]: 5, [WE]: 5, [SV]: 5, [LU]: 4, [TA]: 4, [TU]: 3 }),

  /* ----------------------------------------------------------------- metal */
  // Refined metal does not occur. It is made, used and thrown away, so the
  // only place to find it is wherever the locals keep their scrap.
  iron_metal: f(['scavenger'], { [IN]: 9, [DU]: 5, [LU]: 2 }),
  copper_metal: f(['scavenger'], { [IN]: 6, [DU]: 4 }),
  zinc_metal: f(['scavenger'], { [IN]: 4, [DU]: 2 }),
  manganese_metal: f(['scavenger'], { [IN]: 3 }),
  selenium_metal: f(['scavenger'], { [IN]: 1 }),
  iodine_crystal: f(['scavenger'], { [IN]: 1 }),

  /* -------------------------------------------------------------- material */
  wood: f(['forager'], { [F]: 9, [TR]: 9, [TA]: 8, [JR]: 7, [LU]: 3, [IN]: 2 }),
  paper: f(['scavenger'], { [DU]: 8, [LU]: 5, [IN]: 3 }),
  cotton: f(['forager', 'scavenger'], { [FA]: 5, [DU]: 3 }),
  wool: f(['hunter', 'scavenger'], { [FA]: 4, [AL]: 2, [LU]: 2 }),
  leather: f(['hunter', 'scavenger'], { [DU]: 3, [LU]: 2 }),
  bone_dry: f(['hunter', 'scavenger'], { [GR]: 3, [DE]: 3, [SV]: 3, [F]: 2, [DU]: 2 }),
  chitin_shell: f(['forager'], { [CO]: 5, [JR]: 2, [WE]: 2 }),
  charcoal: f(['scavenger'], { [IN]: 3, [DU]: 2, [SV]: 2, [F]: 2 }),
  coal: f(['excavator'], { [IN]: 6, [AL]: 3, [TA]: 2 }),
  crude_oil: f(['excavator'], { [IN]: 8, [DE]: 3 }),
  polyethylene: f(['scavenger'], { [DU]: 8, [IN]: 6, [LU]: 4, [CO]: 4, [RI]: 3 }),
  pvc: f(['scavenger'], { [IN]: 6, [DU]: 5, [LU]: 2 }),
  pet_plastic: f(['scavenger'], { [DU]: 8, [IN]: 4, [LU]: 4, [RI]: 3, [CO]: 3 }),
  rubber: f(['scavenger'], { [DU]: 5, [IN]: 4, [LU]: 2 }),
  glass: f(['scavenger'], { [DU]: 7, [IN]: 4, [LU]: 4 }),
  concrete: f(['excavator'], { [DU]: 8, [IN]: 7, [LU]: 4 }),
};

/** Can this item be obtained directly, by some caste, somewhere? */
export function hasDirectRoute(itemId) {
  const entry = FORAGE[itemId];
  if (!entry) return false;
  return entry.gather.some((g) => g !== 'hunter') && Object.keys(entry.biomes).length > 0;
}

/** Everything a given caste can pull out of a given biome, with its weight. */
export function poolFor(gatherType, biomeId) {
  const out = [];
  for (const [itemId, entry] of Object.entries(FORAGE)) {
    if (!entry.gather.includes(gatherType)) continue;
    const weight = entry.biomes[biomeId];
    if (weight > 0) out.push({ itemId, weight });
  }
  return out;
}
