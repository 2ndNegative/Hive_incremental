import { formatCogits } from '../src/game/units.js';
import { computeCognition } from '../src/game/engine.js';
import { BASE_COGIT_CAPACITY, COGIT_PER_DRONE, COGIT } from '../src/game/definitions/cognition.js';
import { STRUCTURES } from '../src/game/definitions/structures.js';

let fails = 0;
const ck = (l, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ` — ${d}` : ''}`); if (!ok) fails++; };

/* ------------------------------------------------------------- the unit */
ck('cogits print with SI prefixes',
  formatCogits(0) === '0 Cg' && formatCogits(420) === '420 Cg' &&
  formatCogits(4200) === '4.2 kCg' && formatCogits(1.1e6) === '1.1 MCg' &&
  formatCogits(2.5e9) === '2.5 GCg',
  [0, 420, 4200, 1.1e6, 2.5e9].map(formatCogits).join(' · '));
ck('it never drops below a whole cogit', formatCogits(0.25) === '0.25 Cg', formatCogits(0.25));
ck('the symbol is Cg', COGIT === 'Cg');

/* -------------------------------------------------------- the empty hive */
const blank = () => ({ structures: {}, castes: {}, drones: 0, cognition: { reservations: {} } });
{
  const c = computeCognition(blank());
  ck('a landed hive has no bandwidth at all',
    c.capacity === 0 && c.used === 0 && c.free === 0 && !c.over,
    `${formatCogits(c.used)} of ${formatCogits(c.capacity)}`);
  ck('an idle hive is not over budget', c.ratio === 1 && !c.over);
  ck('nothing supplies or occupies it yet', c.supply.length === 0 && c.load.length === 0);
}

/* -------------------------------------------------- structures declare it */
{
  // Injected rather than taken from a real building: every structure is parked
  // for the rebuild, and what is being tested is that the declaration is read.
  STRUCTURES.__testGanglion = { id: '__testGanglion', name: 'Test ganglion', cogitCapacity: 250 };
  STRUCTURES.__testDrain = { id: '__testDrain', name: 'Test drain', cogitDraw: 40 };
  const { STRUCTURE_ORDER } = await import('../src/game/definitions/structures.js');
  STRUCTURE_ORDER.push('__testGanglion', '__testDrain');

  const s = blank();
  s.structures.__testGanglion = 3;
  s.structures.__testDrain = 2;
  const c = computeCognition(s);
  ck('a structure can supply bandwidth', c.capacity === 750, formatCogits(c.capacity));
  ck('a structure can occupy bandwidth', c.used === 80, formatCogits(c.used));
  ck('free is what is left', c.free === 670, formatCogits(c.free));
  ck('both sides are itemised', c.supply.length === 1 && c.load.length === 1,
    `${c.supply[0].label} +${c.supply[0].amount}, ${c.load[0].label} -${c.load[0].amount}`);

  /* ------------------------------------------------------- reservations */
  s.cognition.reservations.assay = { amount: 600, label: 'Assaying something' };
  const held = computeCognition(s);
  ck('an action can hold a block of it', held.used === 680 && held.free === 70,
    `${formatCogits(held.used)} in flight`);
  ck('a held block is named in the breakdown',
    held.load.some((l) => l.label === 'Assaying something'));

  s.cognition.reservations.assay = { amount: 900, label: 'Assaying something' };
  const over = computeCognition(s);
  ck('going over budget is flagged, not clamped',
    over.over && over.used === 980 && over.free === -230,
    `${formatCogits(over.used)} of ${formatCogits(over.capacity)}, free ${formatCogits(over.free)}`);
  ck('the ratio says how much of it can be thought',
    Math.abs(over.ratio - 750 / 980) < 1e-9, over.ratio.toFixed(3));

  delete s.cognition.reservations.assay;
  ck('releasing gives it back', computeCognition(s).used === 80);

  STRUCTURE_ORDER.length = STRUCTURE_ORDER.length - 2;
  delete STRUCTURES.__testGanglion;
  delete STRUCTURES.__testDrain;
}

/* ------------------------------------------------- the rebuild's hooks */
ck('the opening capacity is zero on purpose', BASE_COGIT_CAPACITY === 0);
ck('the per-drone cost is wired but unset', COGIT_PER_DRONE === 0);
{
  const s = blank();
  s.drones = 12;
  ck('drones cost nothing until the rebuild sets a price',
    computeCognition(s).used === 0, 'COGIT_PER_DRONE is 0');
}

console.log(fails ? `\n=== ${fails} FAILED ===` : '\n=== cognition verified ===');
process.exit(fails ? 1 : 0);
