// Resource definitions.
//
// `kind` drives how a resource behaves and renders:
//   stock  - stockpiled, has a capacity, can overflow
//   pop    - stockpiled, integer, assignable to jobs
//   rate   - not stockpiled; shows supply vs demand (Evolve's Power)
//
// `unlock` is a predicate run against game state. Returning false hides the
// resource from the sidebar entirely until it becomes relevant.

export const RESOURCES = {
  matter: {
    id: 'matter',
    name: 'Matter',
    kind: 'stock',
    baseCap: 200,
    desc: 'Raw bulk material. Everything is built out of it and most machines burn it.',
    unlock: () => true,
  },
  knowledge: {
    id: 'knowledge',
    name: 'Knowledge',
    kind: 'stock',
    baseCap: 100,
    desc: 'Spent on research. Scholars generate it; laboratories let you bank more of it.',
    unlock: () => true,
  },
  alloy: {
    id: 'alloy',
    name: 'Alloy',
    kind: 'stock',
    baseCap: 25,
    desc: 'Refined material for advanced construction. Smelters convert matter into it.',
    unlock: (state) => state.tech.metallurgy,
  },
  workers: {
    id: 'workers',
    name: 'Workers',
    kind: 'pop',
    baseCap: 3,
    integer: true,
    desc: 'Your population. Assign them to jobs; shelters raise the ceiling.',
    unlock: () => true,
  },
  power: {
    id: 'power',
    name: 'Power',
    kind: 'rate',
    desc: 'Produced by generators, drawn by machinery. A deficit throttles every consumer.',
    unlock: (state) => state.tech.powerGrid,
  },
};

/** Stable display order for the sidebar. */
export const RESOURCE_ORDER = ['matter', 'alloy', 'knowledge', 'workers', 'power'];

export const STOCK_RESOURCES = RESOURCE_ORDER.filter(
  (id) => RESOURCES[id].kind === 'stock' || RESOURCES[id].kind === 'pop',
);
