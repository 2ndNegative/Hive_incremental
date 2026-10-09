/**
 * Can a hive get anywhere from anywhere?
 *
 * A pure graph test, run in node rather than a browser: ADJACENCY is a data
 * structure with properties that either hold or do not, and asserting them
 * through a rendered page would only make it slower and less exact.
 *
 * Three things have to be true, and one deliberately is not:
 *   SYMMETRY     — if A borders B then B borders A. Without it a biome can be a
 *                  one-way door, which is how temperate rainforest ended up
 *                  reachable from nowhere.
 *   REACHABILITY — an Explorer can eventually MAP every biome from any start.
 *   REALM        — within a realm, a hive can CLAIM its way to everything in it.
 *   (not) CROSS-REALM — a land hive cannot claim its way into the sea. That is
 *                  the gate the tech tree is meant to open, so it is asserted as
 *                  a fact rather than treated as a failure.
 */

import { ADJACENCY, BIOME_IDS, BIOMES, realmOf } from '../src/game/definitions/biomes.js';

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};

/** Breadth-first walk from `start`, optionally refusing to leave a realm. */
function reach(start, allowed = () => true) {
  const seen = new Set([start]);
  const queue = [start];
  const dist = { [start]: 0 };
  while (queue.length) {
    const here = queue.shift();
    for (const [next, weight] of Object.entries(ADJACENCY[here] || {})) {
      if (weight <= 0 || seen.has(next) || !allowed(next)) continue;
      seen.add(next);
      dist[next] = dist[here] + 1;
      queue.push(next);
    }
  }
  return { seen, dist };
}

/* ======================================================= 1. the table itself */

const missingEntry = BIOME_IDS.filter((id) => !ADJACENCY[id]);
check('every biome has a neighbour list', missingEntry.length === 0, missingEntry.join(', '));

const unknown = [];
for (const [from, near] of Object.entries(ADJACENCY)) {
  if (!BIOMES[from]) unknown.push(from);
  for (const to of Object.keys(near)) if (!BIOMES[to]) unknown.push(`${from} → ${to}`);
}
check('and every name in it is a real biome', unknown.length === 0, unknown.join(', '));

const selfless = Object.keys(ADJACENCY).filter((id) => !ADJACENCY[id][id]);
check('every biome borders more of itself', selfless.length === 0, selfless.join(', '));

const asymmetric = [];
for (const [from, near] of Object.entries(ADJACENCY)) {
  for (const to of Object.keys(near)) {
    if (!ADJACENCY[to]?.[from]) asymmetric.push(`${from} → ${to}`);
  }
}
check('the table is symmetric: no one-way doors',
  asymmetric.length === 0, asymmetric.slice(0, 6).join(', '));

/* ============================================== 2. an Explorer can map it all */

const orphans = [];
let worst = { from: null, to: null, steps: 0 };
for (const from of BIOME_IDS) {
  const { seen, dist } = reach(from);
  const missing = BIOME_IDS.filter((id) => !seen.has(id));
  if (missing.length) orphans.push(`${from} cannot reach ${missing.join('/')}`);
  for (const [to, d] of Object.entries(dist)) {
    if (d > worst.steps) worst = { from, to, steps: d };
  }
}
check('a hive starting anywhere can eventually map every biome',
  orphans.length === 0, orphans.slice(0, 4).join(' · '));
check('and the furthest corner is a reasonable walk',
  worst.steps > 0 && worst.steps <= 10,
  `${worst.from} → ${worst.to} in ${worst.steps} steps`);

// Nothing is an island in the other direction either: every biome is listed by
// somebody other than itself, or no expedition could ever turn it up.
const unlisted = BIOME_IDS.filter((id) =>
  !Object.entries(ADJACENCY).some(([from, near]) => from !== id && near[id] > 0),
);
check('and every biome is somebody else\'s neighbour', unlisted.length === 0, unlisted.join(', '));

/* ========================================= 3. claiming, inside its own realm */

const realms = {};
for (const id of BIOME_IDS) (realms[realmOf(id)] ||= []).push(id);
check('the realms partition every biome',
  Object.values(realms).reduce((a, m) => a + m.length, 0) === BIOME_IDS.length,
  Object.entries(realms).map(([r, m]) => `${r} ${m.length}`).join(', '));

const stranded = [];
for (const from of BIOME_IDS) {
  const realm = realmOf(from);
  const { seen } = reach(from, (id) => realmOf(id) === realm);
  const missing = realms[realm].filter((id) => !seen.has(id));
  if (missing.length) stranded.push(`${from} cannot claim its way to ${missing.join('/')}`);
}
check('a hive can claim its way to everything in its own realm',
  stranded.length === 0, stranded.slice(0, 4).join(' · '));

/* ================================= 4. and NOT across one, which is the point */

const land = realms.land[0];
const { seen: fromLand } = reach(land, (id) => realmOf(id) === 'land');
const wetReached = [...fromLand].filter((id) => realmOf(id) !== 'land');
check('but not out of it — the sea is a gate, not a path',
  wetReached.length === 0,
  `a land hive claims ${fromLand.size} of ${BIOME_IDS.length} biomes`);

// It can still SEE the water from the shore, which is what makes the gate
// legible rather than invisible.
const { seen: mapped } = reach(land);
const wetMapped = [...mapped].filter((id) => realmOf(id) !== 'land');
check('though it can map every bit of it',
  wetMapped.length === BIOME_IDS.length - realms.land.length,
  `${wetMapped.length} wet biomes mappable from land`);

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
process.exit(fail.length ? 1 : 0);
