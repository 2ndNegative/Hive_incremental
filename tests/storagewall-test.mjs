import { chromium } from 'playwright';
import { BASE, LAUNCH, ensureLanded, checker, openPage, finish, settle } from './harness.mjs';

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

const { check, fail } = checker();

const browser = await chromium.launch(LAUNCH);
const { page: p, errors } = await openPage(browser, { viewport: { width: 1480, height: 1000 } });

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
await settle(p);
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


/*
 * ================= COARSE STEPS HAVE TO MEAN WHAT FINE STEPS MEAN
 *
 * Offline catch-up takes steps of up to an hour. Four separate things assumed
 * a step was about a tenth of a second, and all four were invisible in normal
 * play and wrong the moment somebody closed the tab overnight.
 */
const coarse = await p.evaluate(() => {
  const s = hive.state;
  const setup = () => {
    s.tech = { ...s.tech, glycolysis: true };
    s.territory = {}; s.assign = {}; s.crews = {};
    s.droneTypes = { forager: 4, scavenger: 0, explorer: 0 };
    s.larvae = 5;
    for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
    s.nutrients.water = 1e6;
    s.nutrients.carb = 1;
  };

  // 1. The ration measured a RATE against a STOCK, so a hive holding ninety
  //    seconds of food reported itself fully fed for a ten-hour step.
  setup();
  const short = hive.derived(600).ration;

  // 2. Drones and larvae each measured themselves against the WHOLE store, so
  //    a tenth of a gram fed both and neither went hungry.
  setup();
  s.nutrients.carb = 0.1;
  const d = hive.derived(1);
  const shared = {
    stock: 0.1,
    droneGets: d.ration.grams,
    larvaeDrain: d.larvae.drain,
    claimed: d.ration.grams + d.larvae.drain,
  };

  // 3. A brood that could not pay BANKED the attempt, despite the comment
  //    beside it promising the opposite, and laid the backlog in one tick the
  //    moment protein arrived.
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e6;
  s.nutrients.protein = 0;
  s.larvae = 0;
  s.energyPool = 1e9;
  for (const id of Object.keys(hive.structureDefs)) {
    if (hive.structureDefs[id].brood) s.structures[id] = 5;
  }
  s.brood = {};
  hive.tick(600, 600);
  const banked = Math.max(...Object.values(s.brood), 0);
  const before = s.larvae;
  s.nutrients.protein = 1e6;
  hive.tick(0.1, 0.1);
  const burst = s.larvae - before;

  return { short, shared, banked, burst };
});

check('a hive with a trace of food does not report itself fed over a long step',
  coarse.short.hungry === true && coarse.short.ratio < 1,
  `ratio ${coarse.short.ratio.toFixed(3)}, hungry ${coarse.short.hungry}`);
check('drones and larvae draw from one stock, not one each',
  coarse.shared.claimed <= coarse.shared.stock + 1e-9,
  `${coarse.shared.claimed.toFixed(3)} g claimed from ${coarse.shared.stock} g`);
check('and the brood eats first, because a larva that goes unfed dies',
  coarse.shared.larvaeDrain > 0 && coarse.shared.droneGets === 0,
  `larvae ${coarse.shared.larvaeDrain}, drones ${coarse.shared.droneGets}`);
check('a brood that cannot pay banks nothing', coarse.banked < 1,
  `${coarse.banked.toFixed(1)} cycles banked over ten unfed minutes`);
check('so protein arriving does not empty a backlog in one tick',
  coarse.burst <= 1, `${coarse.burst} larvae in a tenth of a second`);

await finish({ name: 'the storage wall', fail, errors, browser });
