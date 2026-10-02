// Building definitions.
//
// Every field is data; `engine.js` reads these and never hard-codes a specific
// building. To add one, append an entry here — the UI picks it up automatically.
//
//   cost(n)    cost of the NEXT unit, given n already owned
//   caps       capacity added per unit
//   power      net power per unit (+ produces, - draws)
//   inputs     resources consumed per unit per second
//   outputs    resources produced per unit per second
//   jobSlots   job capacity added per unit
//   mult       multiplicative bonuses added per unit (see MULTIPLIERS below)
//   feedOrder  lower numbers get first claim on a scarce input resource

const geo = (base, growth) => (n) => base * growth ** n;

export const BUILDINGS = {
  shelter: {
    id: 'shelter',
    name: 'Shelter',
    desc: 'Housing. Raises the population ceiling so new workers keep arriving.',
    unlock: () => true,
    cost: (n) => ({ matter: geo(18, 1.32)(n) }),
    caps: { workers: 2 },
    power: 0,
    feedOrder: 0,
  },
  archive: {
    id: 'archive',
    name: 'Archive',
    desc: 'Shelves, ledgers and a filing habit. Raises how much knowledge you can bank.',
    unlock: () => true,
    cost: (n) => ({ matter: geo(40, 1.4)(n) }),
    caps: { knowledge: 110 },
    power: 0,
    feedOrder: 0,
  },
  depot: {
    id: 'depot',
    name: 'Storage Depot',
    desc: 'Racking and bins. Expands how much matter and alloy you can hold.',
    unlock: (state) => state.tech.basicTools,
    cost: (n) => ({ matter: geo(70, 1.38)(n) }),
    caps: { matter: 250, alloy: 60 },
    power: 0,
    feedOrder: 0,
  },
  generator: {
    id: 'generator',
    name: 'Generator',
    desc: 'Burns matter to put power on the grid. Everything electrical depends on these.',
    unlock: (state) => state.tech.powerGrid,
    cost: (n) => ({ matter: geo(150, 1.3)(n) }),
    power: 8,
    inputs: { matter: 0.6 },
    feedOrder: 1, // generators eat before smelters do
  },
  foundry: {
    id: 'foundry',
    name: 'Foundry',
    desc: 'A smelting floor. Each foundry opens one smelter position.',
    unlock: (state) => state.tech.metallurgy,
    cost: (n) => ({ matter: geo(240, 1.34)(n) }),
    power: -4,
    jobSlots: { smelter: 1 },
    feedOrder: 2,
  },
  laboratory: {
    id: 'laboratory',
    name: 'Laboratory',
    desc: 'Banks more knowledge and makes every scholar more productive.',
    unlock: (state) => state.tech.scientificMethod,
    cost: (n) => ({ matter: geo(320, 1.35)(n), alloy: geo(30, 1.35)(n) }),
    caps: { knowledge: 150 },
    power: -3,
    mult: { scholar: 0.15 },
    feedOrder: 2,
  },
};

export const BUILDING_ORDER = [
  'shelter',
  'archive',
  'depot',
  'generator',
  'foundry',
  'laboratory',
];

/**
 * Named multiplier channels. Buildings and research both feed into these; the
 * engine sums them and applies `1 + total`.
 */
export const MULTIPLIERS = ['gatherer', 'scholar', 'smelter', 'storage'];
