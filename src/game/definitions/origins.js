// Starting sites.
//
// Every run begins with a choice of where the seed mass lands. The site sets
// the hive's opening conditions — what it starts holding, how many drones wake
// up, and anything it begins with already built.
//
// Right now there is one. The registry is shaped for more: each entry declares
// its own unlock condition, checked against the lifetime record, so sites can be
// earned across runs rather than handed over. `unlockHint` is what the locked
// card says, so a player can see what they are working towards.
//
//   unlock(lifetime, state)  true when the site can be picked
//   unlockHint               one line shown while it is locked
//   start                    opening conditions, applied to a blank hive,
//                            including the territory the site sits on — which
//                            is what every forage roll of the run reads from
//   effects                  display lines for the card
//
// A site must never be *required* to progress — it changes the shape of the
// opening, not whether the run is winnable.

export const ORIGINS = {
  anthill: {
    id: 'anthill',
    name: 'Anthill',
    tagline: 'A commandeered colony',
    desc:
      'The seed lands on a mature ant nest and takes it. The tunnels are already dug, the ' +
      'foragers already know every trail within a hundred metres, and the previous occupants ' +
      'become the first meal.',
    unlock: () => true,
    effects: [
      '36 m² of temperate forest',
      'Hivecore at level 1',
      '240 MJ left in the seed — eight minutes of Hivecore',
      'No stores, no drones, nothing else built',
    ],
    // Stores and drones stay at zero for the building and drone rebuild — but
    // the Hivecore is there from the first second, because a hive without one is
    // not a hive, it is mass.
    //
    // THE GRACE PERIOD. What is left in the seed: 240 MJ, which is eight
    // minutes of a Hivecore and nothing else. The hive does not brown out while the
    // player is still reading the screen — it browns out when that runs down,
    // by which time there has been time to gather, grow a gut and get a
    // generator lit. Spent, not stored: nothing refills it but a generator.
    start: {
      territory: { temperateForest: 36 },
      nutrients: {},
      drones: 0,
      energy: 240e6, // joules
      structures: { hivecore: 1 },
    },
    flavour: 'The colony does not understand what has happened to it. It goes on working.',
  },
};

export const ORIGIN_ORDER = ['anthill'];

/** Sites the player can pick right now, and the ones still locked. */
export function originAvailability(lifetime, state) {
  const unlocked = [];
  const locked = [];
  for (const id of ORIGIN_ORDER) {
    const def = ORIGINS[id];
    (def.unlock(lifetime, state) ? unlocked : locked).push(def);
  }
  return { unlocked, locked };
}
