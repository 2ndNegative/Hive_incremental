// Where everything is found, and who can get it.
//
// Every item in the database has an entry here. An entry says two things:
//
//   gather   which castes can obtain it directly — 'forager', 'scavenger',
//            'excavator', 'siphon', 'hunter'. A hunter rolls prey and huntable
//            items together: a deer is an ORGANISM, because it butchers into a
//            dozen cuts at once, while a lanternfish is just a lanternfish. An
//            item tagged 'hunter' with no biomes of its own is a cut that only
//            ever arrives off a carcass.
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
  shrimp: f(['forager'], { [CO]: 5, [SH]: 5, [ES]: 4, [WE]: 3, [RE]: 3 }),
  crab: f(['forager'], { [CO]: 6, [SH]: 5, [ES]: 4, [RE]: 3, [WE]: 2 }),
  lobster: f(['forager'], { [CO]: 3, [SH]: 4, [RE]: 2 }),
  mussel: f(['forager'], { [CO]: 9, [KE]: 6, [SH]: 5, [ES]: 4 }),
  oyster: f(['forager'], { [CO]: 8, [ES]: 7, [SH]: 4, [WE]: 2 }),
  clam: f(['forager'], { [CO]: 8, [SH]: 6, [ES]: 5, [WE]: 3 }),
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
  kombu: f(['forager'], { [KE]: 9, [CO]: 8, [PO]: 3 }),
  wakame: f(['forager'], { [KE]: 8, [CO]: 7 }),
  nori: f(['forager'], { [CO]: 7, [KE]: 5, [ES]: 3 }),
  dulse: f(['forager'], { [CO]: 6, [KE]: 5, [PO]: 2 }),
  spirulina: f(['forager'], { [LK]: 6, [WE]: 5, [RI]: 4 }),
  chlorella: f(['forager'], { [LK]: 6, [RI]: 4, [WE]: 4 }),

  /* ------------------------------------------------------- bulk and forage */
  // The three things that are everywhere. Grass is the floor of the economy:
  // thin, endless, and available on almost any ground the hive can hold.
  pasture_grass: f(['forager'], {
    [GR]: 10, [FA]: 7, [SV]: 6, [LU]: 5, [WE]: 4, [RI]: 4, [F]: 3, [AL]: 3, [TU]: 2, [DU]: 2,
  }),
  leaf_litter: f(['forager', 'scavenger'], { [F]: 10, [TR]: 9, [JR]: 8, [TA]: 7, [LU]: 3, [WE]: 3 }),
  // Things die everywhere, including at sea — and on the abyssal plain a single
  // whale fall is the richest event in a decade.
  carrion: f(['scavenger'], {
    [SV]: 6, [GR]: 5, [DU]: 5, [FA]: 5, [F]: 4, [JR]: 4, [LU]: 4, [AB]: 4,
    [TR]: 3, [TA]: 3, [WE]: 3, [RI]: 3, [CO]: 3, [SH]: 3, [ES]: 3,
    [TU]: 2, [DE]: 2, [AL]: 2, [LK]: 2, [KE]: 2, [RE]: 2, [OO]: 2, [TW]: 2, [PO]: 2, [HV]: 2,
  }),
  compost: f(['scavenger'], { [FA]: 5, [LU]: 5, [DU]: 3, [F]: 2 }),

  /* ----------------------------------------------------------------- fluid */
  beer: f(['scavenger'], { [DU]: 5, [LU]: 3 }),
  wine_red: f(['scavenger'], { [DU]: 4, [LU]: 2 }),
  spirits_40: f(['scavenger'], { [DU]: 3, [LU]: 1 }),
  fresh_water: f(['siphon'], {
    [LK]: 10, [RI]: 10, [WE]: 9, [TR]: 7, [JR]: 6, [F]: 5, [TA]: 5, [AL]: 5,
    [LU]: 4, [DU]: 4, [FA]: 4, [GR]: 3, [TU]: 3, [PO]: 3, [SV]: 2, [IN]: 2,
  }),
  seawater: f(['siphon'], {
    [CO]: 10, [OO]: 10, [SH]: 9, [ES]: 7, [KE]: 8, [RE]: 8,
    [TW]: 9, [AB]: 9, [HV]: 8, [PO]: 8,
  }),
  urine: f(['scavenger'], { [DU]: 4, [LU]: 2 }),

  /* --------------------------------------------------------------- mineral */
  table_salt: f(['excavator', 'scavenger'], { [DE]: 6, [CO]: 4, [ES]: 3, [DU]: 3 }),
  limestone: f(['excavator'], { [AL]: 7, [RE]: 6, [DE]: 5, [GR]: 4, [CO]: 4, [F]: 3, [IN]: 3, [SV]: 2 }),
  gypsum: f(['excavator'], { [DE]: 7, [AL]: 3, [IN]: 2 }),
  apatite: f(['excavator'], { [DE]: 4, [AL]: 3, [IN]: 2 }),
  quartz_sand: f(['excavator'], { [DE]: 8, [CO]: 7, [SH]: 5, [RI]: 4, [LK]: 3, [KE]: 2 }),
  sulfur_native: f(['excavator'], { [HV]: 8, [AL]: 4, [IN]: 3, [DE]: 3 }),
  magnetite: f(['excavator'], { [AL]: 6, [IN]: 4, [HV]: 4, [AB]: 3, [DE]: 2 }),
  clay: f(['excavator'], { [RI]: 6, [WE]: 6, [LK]: 5, [FA]: 4, [ES]: 4, [AB]: 4, [F]: 3, [SV]: 2, [TU]: 2 }),
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
  chitin_shell: f(['forager'], { [CO]: 5, [SH]: 4, [RE]: 3, [JR]: 2, [WE]: 2, [AB]: 2 }),
  charcoal: f(['scavenger'], { [IN]: 3, [DU]: 2, [SV]: 2, [F]: 2 }),
  coal: f(['excavator'], { [IN]: 6, [AL]: 3, [TA]: 2 }),
  crude_oil: f(['excavator'], { [IN]: 8, [DE]: 3 }),
  polyethylene: f(['scavenger'], { [DU]: 8, [IN]: 6, [LU]: 4, [CO]: 4, [RI]: 3, [OO]: 3, [LK]: 2, [AB]: 1 }),
  pvc: f(['scavenger'], { [IN]: 6, [DU]: 5, [LU]: 2 }),
  pet_plastic: f(['scavenger'], { [DU]: 8, [IN]: 4, [LU]: 4, [RI]: 3, [CO]: 3, [OO]: 3, [LK]: 2 }),
  rubber: f(['scavenger'], { [DU]: 5, [IN]: 4, [LU]: 2 }),
  glass: f(['scavenger'], { [DU]: 7, [IN]: 4, [LU]: 4 }),
  concrete: f(['excavator'], { [DU]: 8, [IN]: 7, [LU]: 4 }),

  /* ============================================================== THE SEA ==
     Depth is the organising fact. Sunlight stops at about 200 m, so the open
     surface is productive and crowded, the twilight zone is a vast migrating
     mass of small oily fish, and everything below is living off what falls.
     The vent is the exception: it runs on sulfide and owes the sun nothing. */

  /* -- open ocean and surface */
  anchovy: f(['hunter'], { [OO]: 7, [SH]: 5, [CO]: 3 }),
  sardine_fresh: f(['hunter'], { [OO]: 6, [SH]: 5, [CO]: 3 }),
  flying_fish: f(['hunter'], { [OO]: 5 }),
  bonito: f(['hunter'], { [OO]: 5 }),
  swordfish: f(['hunter'], { [OO]: 3 }),
  marlin: f(['hunter'], { [OO]: 2 }),
  mahi_mahi: f(['hunter'], { [OO]: 4 }),
  blue_whiting: f(['hunter'], { [SH]: 5, [OO]: 3 }),
  capelin: f(['hunter'], { [PO]: 6, [OO]: 4 }),
  menhaden: f(['hunter'], { [SH]: 5, [ES]: 4, [CO]: 3 }),
  albacore: f(['hunter'], { [OO]: 4 }),
  krill_antarctic: f(['forager'], { [PO]: 10, [OO]: 3 }),
  copepod_mass: f(['forager'], { [OO]: 7, [PO]: 5, [TW]: 4, [SH]: 3 }),
  salp: f(['forager'], { [OO]: 5, [TW]: 3 }),
  jellyfish_dried: f(['forager', 'scavenger'], { [CO]: 3, [OO]: 2, [DU]: 2 }),

  /* -- twilight zone. The largest fish biomass on the planet, and almost all
        of it rises to the surface at night and sinks again before dawn. */
  lanternfish: f(['hunter'], { [TW]: 9 }),
  hatchetfish: f(['hunter'], { [TW]: 6 }),
  bristlemouth: f(['hunter'], { [TW]: 8 }),
  viperfish: f(['hunter'], { [TW]: 4 }),
  humboldt_squid: f(['hunter'], { [TW]: 5, [OO]: 3 }),
  vampire_squid: f(['hunter'], { [TW]: 3 }),
  krill_deep: f(['forager'], { [TW]: 7 }),

  /* -- abyssal plain and the vent */
  grenadier: f(['hunter'], { [AB]: 6 }),
  deepsea_anglerfish: f(['hunter'], { [AB]: 4 }),
  sea_cucumber: f(['forager'], { [AB]: 5, [RE]: 4, [SH]: 3 }),
  brittle_star: f(['forager'], { [AB]: 6 }),
  giant_isopod: f(['forager'], { [AB]: 5 }),
  sleeper_shark: f(['hunter'], { [AB]: 3, [PO]: 3 }),
  whale_fall_blubber: f(['scavenger'], { [AB]: 5 }),
  whale_bone: f(['scavenger'], { [AB]: 4, [CO]: 1, [PO]: 1 }),
  tube_worm: f(['forager'], { [HV]: 9 }),
  vent_shrimp: f(['forager', 'hunter'], { [HV]: 7 }),
  vent_mussel: f(['forager'], { [HV]: 8 }),
  bacterial_mat: f(['forager'], { [HV]: 10, [AB]: 2 }),

  /* -- reef and kelp */
  parrotfish: f(['hunter'], { [RE]: 7 }),
  grouper: f(['hunter'], { [RE]: 5 }),
  snapper: f(['hunter'], { [RE]: 6, [SH]: 3 }),
  sea_urchin_roe: f(['forager'], { [KE]: 6, [RE]: 5, [CO]: 3 }),
  abalone: f(['forager'], { [KE]: 6, [RE]: 4 }),
  giant_clam: f(['forager'], { [RE]: 5 }),
  kelp_fresh: f(['forager'], { [KE]: 10, [CO]: 4, [PO]: 2 }),
  sea_lettuce: f(['forager'], { [CO]: 6, [ES]: 5, [KE]: 4 }),
  bladderwrack: f(['forager'], { [CO]: 7, [KE]: 5 }),
  irish_moss: f(['forager'], { [CO]: 6, [KE]: 4 }),
  coral_polyp: f(['forager'], { [RE]: 8 }),
  sponge: f(['forager'], { [RE]: 5, [SH]: 2 }),

  /* -- continental shelf */
  halibut: f(['hunter'], { [SH]: 4, [PO]: 3 }),
  plaice_flounder: f(['hunter'], { [SH]: 7 }),
  sole: f(['hunter'], { [SH]: 6 }),
  monkfish: f(['hunter'], { [SH]: 4 }),
  skate_wing: f(['hunter'], { [SH]: 4 }),
  scallop: f(['forager'], { [SH]: 7 }),
  whelk: f(['forager'], { [SH]: 5, [CO]: 5 }),
  cockle: f(['forager'], { [CO]: 7, [ES]: 5 }),
  razor_clam: f(['forager'], { [CO]: 6, [SH]: 4 }),
  brown_crab: f(['forager'], { [SH]: 6, [CO]: 4 }),
  langoustine: f(['forager'], { [SH]: 5 }),
  sand_eel: f(['hunter'], { [SH]: 6, [CO]: 3 }),
  pollock: f(['hunter'], { [SH]: 7, [PO]: 4 }),
  haddock: f(['hunter'], { [SH]: 7 }),
  hake: f(['hunter'], { [SH]: 6 }),

  /* -- estuary, where the river meets the tide */
  mullet: f(['hunter'], { [ES]: 7, [CO]: 4 }),
  sea_bass: f(['hunter'], { [ES]: 5, [CO]: 4, [KE]: 4, [SH]: 3 }),
  eel: f(['hunter'], { [ES]: 6, [RI]: 5, [LK]: 4 }),
  samphire: f(['forager'], { [ES]: 8, [CO]: 5 }),
  saltmarsh_grass: f(['forager'], { [ES]: 9, [CO]: 4, [WE]: 3 }),
  brackish_diatom_mat: f(['forager'], { [ES]: 7, [WE]: 3 }),

  /* -- lake and river */
  perch: f(['hunter'], { [LK]: 7, [RI]: 5 }),
  pike: f(['hunter'], { [LK]: 6, [RI]: 4 }),
  carp: f(['hunter'], { [LK]: 7, [RI]: 4 }),
  tilapia: f(['hunter'], { [LK]: 5, [RI]: 3, [FA]: 2 }),
  catfish: f(['hunter'], { [RI]: 6, [LK]: 5 }),
  zander: f(['hunter'], { [LK]: 5, [RI]: 3 }),
  bream: f(['hunter'], { [LK]: 6, [RI]: 4 }),
  roach: f(['hunter'], { [LK]: 6, [RI]: 5 }),
  freshwater_mussel: f(['forager'], { [RI]: 6, [LK]: 6 }),
  crayfish: f(['forager'], { [RI]: 6, [LK]: 5, [WE]: 3 }),
  lamprey: f(['hunter'], { [RI]: 4, [ES]: 3 }),
  char: f(['hunter'], { [LK]: 5, [PO]: 3, [AL]: 3 }),
  whitefish: f(['hunter'], { [LK]: 6, [RI]: 3 }),
  water_lily_root: f(['forager'], { [LK]: 6, [WE]: 5 }),
  reed_rhizome: f(['forager'], { [WE]: 7, [LK]: 5, [RI]: 4 }),
  duckweed: f(['forager'], { [LK]: 7, [WE]: 6 }),
  freshwater_snail: f(['forager'], { [LK]: 5, [RI]: 4, [WE]: 4 }),

  /* -- the polar sea. Algae on the underside of the ice, krill on the algae,
        and everything else on the krill. */
  arctic_cod: f(['hunter'], { [PO]: 8 }),
  seal_blubber: f(['hunter'], { [PO]: 5 }),
  seal_meat: f(['hunter'], { [PO]: 5 }),
  walrus_meat: f(['hunter'], { [PO]: 3 }),
  muktuk: f(['hunter'], { [PO]: 3 }),
  ice_algae: f(['forager'], { [PO]: 9 }),
  // One serving is an acutely toxic dose of retinol. The hive will work that
  // out the hard way, or not at all.
  polar_bear_liver: f(['hunter'], { [PO]: 1 }),

  /* =========================================================== COLD LAND == */
  reindeer_caribou: f(['hunter'], { [TU]: 7, [TA]: 5 }),
  muskox: f(['hunter'], { [TU]: 5 }),
  ptarmigan: f(['hunter'], { [TU]: 6, [AL]: 4, [TA]: 3 }),
  arctic_hare: f(['hunter'], { [TU]: 6, [TA]: 3 }),
  moose: f(['hunter'], { [TA]: 6, [WE]: 2, [TU]: 2 }),
  elk: f(['hunter'], { [TA]: 5, [F]: 4, [AL]: 3 }),
  bear_meat: f(['hunter'], { [TA]: 4, [TR]: 3, [F]: 2 }),
  beaver: f(['hunter'], { [RI]: 5, [TA]: 4, [LK]: 3 }),
  lichen: f(['forager'], { [TU]: 10, [TA]: 6, [AL]: 5 }),
  cloudberry: f(['forager'], { [TU]: 7, [TA]: 5, [WE]: 4 }),
  lingonberry: f(['forager'], { [TU]: 7, [TA]: 7 }),
  crowberry: f(['forager'], { [TU]: 8, [TA]: 5 }),
  bilberry: f(['forager'], { [TA]: 6, [F]: 4, [TU]: 4 }),
  rosehip: f(['forager'], { [GR]: 4, [F]: 4, [TU]: 3, [AL]: 3, [LU]: 3 }),
  pine_nut: f(['forager'], { [TA]: 6, [F]: 3, [AL]: 3 }),
  birch_sap: f(['siphon'], { [TA]: 7, [F]: 4 }),
  spruce_tip: f(['forager'], { [TA]: 8, [AL]: 4, [F]: 3 }),
  fiddlehead_fern: f(['forager'], { [TR]: 6, [F]: 5, [TA]: 4 }),
  cattail_root: f(['forager'], { [WE]: 8, [LK]: 5, [RI]: 4 }),
  wild_garlic: f(['forager'], { [F]: 6, [TR]: 5 }),
  chaga: f(['forager'], { [TA]: 7, [F]: 3 }),
  morel: f(['forager'], { [F]: 5, [TA]: 4 }),
  chanterelle: f(['forager'], { [F]: 6, [TA]: 5, [TR]: 4 }),
  porcini: f(['forager'], { [F]: 6, [TA]: 4, [TR]: 3 }),
  truffle: f(['forager'], { [F]: 3, [FA]: 2 }),

  /* ========================================================== DRY LAND == */
  camel_meat: f(['hunter'], { [DE]: 6, [SV]: 3 }),
  camel_milk: f(['scavenger'], { [DE]: 4, [SV]: 2 }),
  ostrich_meat: f(['hunter'], { [SV]: 6, [DE]: 3 }),
  antelope: f(['hunter'], { [SV]: 8, [GR]: 3 }),
  warthog: f(['hunter'], { [SV]: 6 }),
  zebra: f(['hunter'], { [SV]: 6, [GR]: 3 }),
  mopane_worm: f(['forager'], { [SV]: 7 }),
  witchetty_grub: f(['forager'], { [DE]: 6, [SV]: 4 }),
  prickly_pear: f(['forager'], { [DE]: 7, [SV]: 3 }),
  nopal: f(['forager'], { [DE]: 7, [SV]: 3 }),
  saguaro_fruit: f(['forager'], { [DE]: 5 }),
  wattleseed: f(['forager'], { [DE]: 5, [SV]: 4 }),
  baobab_fruit: f(['forager'], { [SV]: 7 }),
  marula_fruit: f(['forager'], { [SV]: 6 }),
  tef: f(['forager'], { [FA]: 4, [AL]: 3, [SV]: 3 }),
  sorghum: f(['forager'], { [FA]: 6, [SV]: 6 }),
  fonio: f(['forager'], { [SV]: 5, [FA]: 3 }),
  desert_truffle: f(['forager'], { [DE]: 5 }),
  agave_sap: f(['siphon'], { [DE]: 6, [SV]: 2 }),
  mesquite_pod_flour: f(['forager'], { [DE]: 5, [SV]: 3 }),
  jojoba_seed: f(['forager'], { [DE]: 5 }),
  argan_nut: f(['forager'], { [DE]: 4, [SV]: 2 }),

  /* ============================================================= ALPINE == */
  chamois_ibex: f(['hunter'], { [AL]: 7 }),
  marmot: f(['hunter'], { [AL]: 7 }),
  yak_meat: f(['hunter'], { [AL]: 6 }),
  yak_butter: f(['scavenger'], { [AL]: 4 }),
  alpine_herb_pasture: f(['forager'], { [AL]: 9 }),
  juniper_berry: f(['forager'], { [AL]: 6, [TA]: 4, [F]: 3 }),
  rowan_berry: f(['forager'], { [AL]: 6, [TA]: 4, [F]: 3 }),

  /* ========================================================== THE CANOPY == */
  capybara: f(['hunter'], { [JR]: 5, [WE]: 4 }),
  peccary: f(['hunter'], { [JR]: 6 }),
  tapir: f(['hunter'], { [JR]: 4 }),
  monkey_meat: f(['hunter'], { [JR]: 5 }),
  iguana: f(['hunter'], { [JR]: 5 }),
  caiman: f(['hunter'], { [JR]: 4, [WE]: 3 }),
  tarantula: f(['hunter'], { [JR]: 4 }),
  palm_weevil_larva: f(['forager'], { [JR]: 6 }),
  leafcutter_ant: f(['forager'], { [JR]: 7 }),
  cassava_root: f(['forager'], { [JR]: 6, [FA]: 5, [SV]: 3 }),
  taro: f(['forager'], { [JR]: 5, [WE]: 4, [FA]: 3 }),
  yam: f(['forager'], { [JR]: 5, [FA]: 4, [SV]: 3 }),
  plantain: f(['forager'], { [JR]: 6, [FA]: 5 }),
  breadfruit: f(['forager'], { [JR]: 6 }),
  jackfruit: f(['forager'], { [JR]: 6, [FA]: 2 }),
  durian: f(['forager'], { [JR]: 5 }),
  papaya: f(['forager'], { [JR]: 6, [FA]: 3 }),
  guava: f(['forager'], { [JR]: 6, [FA]: 3 }),
  passion_fruit: f(['forager'], { [JR]: 5, [FA]: 3 }),
  acai: f(['forager'], { [JR]: 6 }),
  palm_heart: f(['forager'], { [JR]: 5 }),
  palm_oil: f(['forager', 'scavenger'], { [JR]: 4, [FA]: 3, [DU]: 3, [IN]: 2 }),
  cocoa_bean: f(['forager'], { [JR]: 5, [FA]: 3 }),
  bamboo_shoot: f(['forager'], { [JR]: 6, [TR]: 4 }),

  /* ============================================================ WETLAND == */
  wild_rice: f(['forager'], { [WE]: 7, [LK]: 4 }),
  watercress: f(['forager'], { [RI]: 6, [WE]: 5 }),
  water_chestnut: f(['forager'], { [WE]: 6, [LK]: 4 }),
  lotus_root: f(['forager'], { [WE]: 6, [LK]: 5 }),
  frog_legs: f(['hunter'], { [WE]: 7, [RI]: 4, [LK]: 3 }),
  escargot: f(['forager'], { [WE]: 4, [F]: 4, [LU]: 3, [FA]: 3 }),
  papyrus_rhizome: f(['forager'], { [WE]: 6 }),
  peat: f(['excavator'], { [WE]: 9, [TU]: 6, [TA]: 4 }),

  /* ====================================================== WHAT THEY MADE ==
     Cooked, cured, bottled, extruded and thrown away. Almost all of it is
     scavenged, almost all of it in a city, and collectively it is the single
     richest thing a hive can hold territory over. */

  /* -- bread and baking */
  wholemeal_bread: f(['scavenger'], { [DU]: 7, [LU]: 6 }),
  rye_bread: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  sourdough_bread: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  baguette: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  croissant: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  bagel: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  flour_tortilla: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  naan: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  pita_bread: f(['scavenger'], { [DU]: 3, [LU]: 3 }),
  pretzel: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  cookie: f(['scavenger'], { [DU]: 5, [LU]: 5 }),
  digestive_biscuit: f(['scavenger'], { [DU]: 3, [LU]: 3 }),
  cracker: f(['scavenger'], { [DU]: 4, [LU]: 4 }),
  sponge_cake: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  doughnut: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  pancake: f(['scavenger'], { [DU]: 2, [LU]: 3 }),
  waffle: f(['scavenger'], { [DU]: 2, [LU]: 3 }),
  corn_flakes: f(['scavenger'], { [DU]: 4, [LU]: 4 }),
  granola: f(['scavenger'], { [DU]: 3, [LU]: 3 }),
  muesli: f(['scavenger'], { [DU]: 2, [LU]: 3 }),
  porridge_oats_cooked: f(['scavenger'], { [DU]: 2, [LU]: 3 }),
  couscous_cooked: f(['scavenger'], { [DU]: 2, [LU]: 2 }),
  bulgur_cooked: f(['scavenger'], { [DU]: 2, [LU]: 2 }),
  semolina: f(['scavenger'], { [DU]: 2, [IN]: 2 }),
  instant_noodles: f(['scavenger'], { [DU]: 6, [LU]: 4 }),
  rice_noodles_cooked: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  egg_noodles_cooked: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  cornstarch: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  wheat_flour_white: f(['scavenger'], { [DU]: 5, [LU]: 4, [FA]: 3 }),
  wheat_bran: f(['scavenger'], { [DU]: 3, [IN]: 2, [FA]: 2 }),
  wheat_germ: f(['scavenger'], { [DU]: 2, [IN]: 2 }),
  baking_powder: f(['scavenger'], { [DU]: 3, [LU]: 3 }),

  /* -- dairy */
  brie: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  parmesan: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  feta: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  cottage_cheese: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  cream_cheese: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  processed_cheese_slice: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  condensed_milk: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  evaporated_milk: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  milk_powder_whole: f(['scavenger'], { [DU]: 3, [IN]: 2 }),
  milk_powder_skim: f(['scavenger'], { [DU]: 3, [IN]: 2 }),
  ice_cream: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  custard: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  kefir: f(['scavenger'], { [DU]: 2, [LU]: 2 }),
  buttermilk: f(['scavenger'], { [DU]: 2, [FA]: 2 }),
  quail_egg: f(['scavenger', 'forager'], { [DU]: 2, [FA]: 2, [LU]: 2 }),
  century_egg: f(['scavenger'], { [DU]: 2 }),
  mayonnaise: f(['scavenger'], { [DU]: 5, [LU]: 4 }),

  /* -- cured and processed meat */
  bacon: f(['scavenger'], { [DU]: 5, [LU]: 4, [FA]: 2 }),
  ham: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  salami: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  chorizo: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  pepperoni: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  hot_dog: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  bratwurst: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  black_pudding: f(['scavenger'], { [DU]: 2, [LU]: 2 }),
  liver_pate: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  corned_beef: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  luncheon_meat: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  beef_jerky: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  meatball: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  chicken_nugget: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  pork_scratchings: f(['scavenger'], { [DU]: 3, [LU]: 2 }),

  /* -- fish, out of a tin */
  fish_finger: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  canned_tuna_oil: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  canned_salmon: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  anchovy_canned: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  anchovy_paste: f(['scavenger'], { [DU]: 2 }),
  surimi_crab_stick: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  smoked_salmon: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  pickled_herring: f(['scavenger'], { [DU]: 2, [LU]: 2 }),
  caviar: f(['scavenger'], { [DU]: 1 }),
  fish_sauce: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  shrimp_paste: f(['scavenger'], { [DU]: 2 }),

  /* -- jars, tins and condiments */
  tomato_ketchup: f(['scavenger'], { [DU]: 6, [LU]: 5 }),
  mustard: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  soy_sauce: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  vinegar: f(['scavenger'], { [DU]: 3, [LU]: 3 }),
  pickled_cucumber: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  sauerkraut: f(['scavenger'], { [DU]: 3, [LU]: 2, [FA]: 2 }),
  kimchi: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  baked_beans: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  tomato_paste: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  peanut_butter: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  jam_strawberry: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  marmalade: f(['scavenger'], { [DU]: 3, [LU]: 3 }),
  chocolate_hazelnut_spread: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  tahini: f(['scavenger'], { [DU]: 2, [LU]: 2 }),
  hummus: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  guacamole: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  pesto: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  gravy: f(['scavenger'], { [DU]: 3, [LU]: 3 }),
  stock_cube: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  instant_soup_powder: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  condensed_tomato_soup: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  margarine: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  vegetable_shortening: f(['scavenger'], { [DU]: 3, [IN]: 3 }),
  ghee: f(['scavenger'], { [DU]: 2, [LU]: 2 }),
  molasses: f(['scavenger'], { [DU]: 3, [IN]: 2 }),
  corn_syrup: f(['scavenger'], { [DU]: 4, [IN]: 3 }),
  agave_syrup: f(['scavenger'], { [DU]: 2, [LU]: 2 }),
  artificial_sweetener: f(['scavenger'], { [DU]: 3, [LU]: 2 }),

  /* -- snacks and confectionery */
  potato_crisps: f(['scavenger'], { [DU]: 7, [LU]: 6 }),
  tortilla_chips: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  popcorn: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  salted_peanuts: f(['scavenger'], { [DU]: 4, [LU]: 4 }),
  milk_chocolate: f(['scavenger'], { [DU]: 6, [LU]: 5 }),
  white_chocolate: f(['scavenger'], { [DU]: 3, [LU]: 3 }),
  caramel_toffee: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  marshmallow: f(['scavenger'], { [DU]: 3, [LU]: 3 }),
  jelly_dessert: f(['scavenger'], { [DU]: 3, [LU]: 3 }),
  hard_candy: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  chewing_gum: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  energy_bar: f(['scavenger'], { [DU]: 4, [LU]: 3 }),

  /* -- the protein aisle */
  soy_protein_isolate: f(['scavenger'], { [DU]: 2, [IN]: 3 }),
  seitan: f(['scavenger'], { [DU]: 2, [LU]: 1 }),
  tempeh: f(['scavenger'], { [DU]: 2, [LU]: 2 }),
  miso_paste: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  natto: f(['scavenger'], { [DU]: 2 }),
  yeast_extract: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  nutritional_yeast: f(['scavenger'], { [DU]: 2, [LU]: 2 }),

  /* -- drinks */
  chocolate_milk: f(['scavenger'], { [DU]: 4, [LU]: 4 }),
  cola: f(['scavenger'], { [DU]: 7, [LU]: 5 }),
  orange_juice: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  apple_juice: f(['scavenger'], { [DU]: 4, [LU]: 4 }),
  coffee_brewed: f(['scavenger'], { [DU]: 6, [LU]: 4 }),
  tea_brewed: f(['scavenger'], { [DU]: 5, [LU]: 4 }),
  energy_drink: f(['scavenger'], { [DU]: 5, [LU]: 3 }),
  sports_drink: f(['scavenger'], { [DU]: 4, [LU]: 3 }),
  cider: f(['scavenger'], { [DU]: 3, [LU]: 3 }),
  stout: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  coconut_water: f(['scavenger'], { [DU]: 3, [LU]: 2 }),
  soy_milk: f(['scavenger'], { [DU]: 3, [LU]: 3 }),
  oat_milk: f(['scavenger'], { [DU]: 3, [LU]: 3 }),
  almond_milk: f(['scavenger'], { [DU]: 3, [LU]: 3 }),
};

/**
 * Can this item be obtained directly, by some caste, somewhere?
 *
 * A 'hunter' tag counts the same as any other now: small prey is rolled as an
 * item. An item tagged only 'hunter' with no biomes is still reachable, but
 * only by butchering an organism that yields it.
 */
export function hasDirectRoute(itemId) {
  const entry = FORAGE[itemId];
  if (!entry) return false;
  return entry.gather.length > 0 && Object.keys(entry.biomes).length > 0;
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
