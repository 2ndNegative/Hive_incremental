import { chromium } from 'playwright';
import { BASE, LAUNCH, ensureLanded } from './harness.mjs';

/**
 * THE STORAGE WALL.
 *
 * A building you cannot save up for is a building you can never build. If the
 * cost of the next one of something exceeds what the hive can hold of the
 * resource it is priced in, the run is over for that building and nothing says
 * so — the player just finds the number never gets high enough.
 *
 * Two of these shipped. Fibre was the slow one: the Cellulose Bale was on a
 * `steady` curve against a shelf that grew by a flat 500 g a bale, so cost
 * overtook capacity at the tenth and the hive could never widen its own fibre
 * store again. Minerals were the fast one and far worse: the Hivecore held 2 g
 * of iron, a Gizzard cost 10 g, and the Trace Metal Assay turned a payable
 * 500 g ash bill into an unpayable 10 g iron one — so RESEARCHING made four
 * buildings permanently unbuildable.
 *
 * Neither had a test, because neither is visible in any single number. What
 * this suite pins is the invariant itself: for every live building, at every
 * count a player could plausibly reach, the cost must fit inside the ceiling.
 */

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};

const browser = await chromium.launch(LAUNCH);
const errors = [];
const p = await browser.newPage({ viewport: { width: 1480, height: 1000 } });
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
await p.waitForTimeout(250);
await p.evaluate(() => hive.loop.stop());

/* ============================== 1. researching never takes a building away */

const assayTrap = await p.evaluate(() => {
  const s = hive.state;
  s.tech = {};
  s.structures.hivecore = 1;
  s.active = { hivecore: 1 };
  s.power = { hivecore: 1 };

  // What a Gizzard costs, and whether the hive could ever hold it — before the
  // assay (charged to mineral mass) and after it (charged to real iron).
  const reach = () => {
    const cost = hive.structureCost('gizzard', 1);
    const caps = hive.derived().capsMax;
    return {
      cost,
      holdable: Object.entries(cost).every(([n, g]) => g <= (caps[n] ?? Infinity)),
    };
  };
  const before = reach();
  s.tech.bulkMineralAssay = true;
  s.tech.traceMetalAssay = true;
  const after = reach();
  s.tech = {};
  return { before, after };
});
check('a Gizzard is affordable before the mineral assays',
  assayTrap.before.holdable, JSON.stringify(assayTrap.before.cost));
check('and STILL affordable after them',
  assayTrap.after.holdable,
  `${JSON.stringify(assayTrap.after.cost)} — research must never remove a building`);

/* ============== 2. THE SELF-REFERENTIAL CASE, which is the only dead end

   The invariant is narrower than "nothing ever walls", and getting that wrong
   is easy. A Lipid Droplet is priced in fibre and stores fat: when its fibre
   cost outruns the fibre shelf you cannot build one, but you are not stuck —
   you go and build a Cellulose Bale, and that is a decision rather than a dead
   end. Almost every wall in the game is of that kind.

   The dead end is a store that is priced in the thing it stores. Then the only
   building that could widen the ceiling is the one the ceiling is blocking, and
   there is no move. Fibre is the case that matters, because the Cellulose Bale
   is bought with fibre, and fibre is what everything else is bought with too.

   This does not assert that no such wall exists — on a `gentle` curve against a
   flat shelf one always will, eventually. It asserts the wall is further out
   than a player plausibly builds. It was at TEN. */

const SELF_WALL_FLOOR = 15;

const selfRef = await p.evaluate(() => {
  const s = hive.state;
  s.tech = Object.fromEntries(hive.researchOrder.map((id) => [id, true]));
  const out = [];
  for (const id of hive.structureOrder) {
    const def = hive.structureDefs[id];
    if (def.category !== 'storage') continue;
    // Only the resources this store both COSTS and HOLDS can trap it.
    const selfish = Object.keys(def.cost(0)).filter((r) => (def.storage || {})[r] > 0);
    if (!selfish.length) continue;
    let wall = Infinity;
    for (let n = 0; n < 60; n += 1) {
      for (const other of hive.structureOrder) s.structures[other] = 0;
      s.structures.hivecore = 1;
      s.structures[id] = n;
      s.active = { ...s.structures };
      s.power = Object.fromEntries(Object.keys(s.structures).map((k) => [k, 1]));
      const caps = hive.derived().capsMax;
      const cost = hive.costs.payable(s, def.cost(n));
      if (selfish.some((r) => cost[r] > (caps[r] ?? Infinity))) { wall = n; break; }
    }
    out.push({ id, selfish, wall: wall === Infinity ? null : wall });
  }
  return out;
});

for (const r of selfRef) {
  check(`${r.id} can keep building itself past ${SELF_WALL_FLOOR}`,
    r.wall === null || r.wall >= SELF_WALL_FLOOR,
    r.wall === null ? `never walls (${r.selfish.join(', ')})` : `walls at ${r.wall} on ${r.selfish.join(', ')}`);
}
check('something was actually measured', selfRef.length > 0,
  selfRef.map((r) => r.id).join(', '));

/* ============================= 3. the vaults actually buy room */

const vaults = await p.evaluate(() => {
  const s = hive.state;
  s.tech = { bulkMineralAssay: true, traceMetalAssay: true, lipidAssay: true };
  for (const id of hive.structureOrder) s.structures[id] = 0;
  s.structures.hivecore = 1;
  s.active = { hivecore: 1 };
  s.power = { hivecore: 1 };
  const base = hive.derived().caps;

  s.structures.mineralVault = 1; s.active.mineralVault = 1; s.power.mineralVault = 1;
  s.structures.vitaminLattice = 1; s.active.vitaminLattice = 1; s.power.vitaminLattice = 1;
  const built = hive.derived().caps;

  s.tech.stigmergy = true; s.tech.tightPacking = true;
  const packed = hive.derived().caps;
  return {
    ironBase: base.iron, ironBuilt: built.iron, ironPacked: packed.iron,
    vitBase: base.vitaminA, vitBuilt: built.vitaminA,
    // The vault must not be priced in what it stores.
    vaultCost: hive.structureDefs.mineralVault.cost(0),
    latticeCost: hive.structureDefs.vitaminLattice.cost(0),
  };
});
check('a Mineral Vault adds real room, not a multiple of almost nothing',
  vaults.ironBuilt > vaults.ironBase * 4,
  `${vaults.ironBase} g -> ${vaults.ironBuilt} g`);
check('a Vitamin Lattice does the same for vitamins',
  vaults.vitBuilt > vaults.vitBase * 4, `${vaults.vitBase} g -> ${vaults.vitBuilt} g`);
check('Tight Packing multiplies the vault\'s room too, not just the base',
  Math.abs(vaults.ironPacked - vaults.ironBuilt * 1.5) < 1,
  `${vaults.ironBuilt} g -> ${vaults.ironPacked} g`);

// The rule that the old pricing broke: a store is never denominated in what it
// stores, or the cure costs more than the ceiling it raises.
const MINERALS = ['iron', 'zinc', 'copper', 'manganese', 'selenium', 'iodine', 'chromium', 'molybdenum'];
check('a Mineral Vault is not priced in a trace metal',
  !MINERALS.some((m) => vaults.vaultCost[m] > 0), JSON.stringify(vaults.vaultCost));
check('a Vitamin Lattice is not priced in a vitamin',
  !Object.keys(vaults.latticeCost).some((k) => k.startsWith('vitamin')),
  JSON.stringify(vaults.latticeCost));

/* ========================= 4. the assay hands over the first vault */

const granted = await p.evaluate(() => {
  const s = hive.state;
  // bulkMineralAssay requires glycolysis; without it research() refuses and
  // the grant never gets a chance to fire.
  s.tech = { glycolysis: true };
  s.structures.mineralVault = 0;
  s.structures.vitaminLattice = 0;
  s.insight = 100_000;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e6;
  const ok = hive.research('bulkMineralAssay');
  return {
    ok,
    vaults: s.structures.mineralVault,
    // The whole log, not the first few lines: the assay pushes a reveal
    // block after the grant, so the free-vault line is several entries down.
    said: s.log.some((l) => /at no cost/i.test(l.text)),
  };
});
check('the mineral assay grants the first Mineral Vault', granted.ok && granted.vaults === 1,
  `${granted.vaults} standing`);
check('and the log says it was free', granted.said === true);

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
