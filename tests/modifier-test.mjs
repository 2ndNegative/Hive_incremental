import { chromium } from 'playwright';
import { BASE, LAUNCH, ensureLanded, checker, openPage, finish, settle } from './harness.mjs';

/**
 * THE MODIFIER LAYER.
 *
 * There was a multiplier layer here before this one. It had six channels, a
 * summing pass that ran on every derive, and no reader at all — `derived.mult`
 * was computed and thrown away, every tick, for months. Nothing about it looked
 * broken from the inside: the channels were declared, the structures' `mult`
 * maps were summed correctly, the number came out right. It simply went
 * nowhere, and no test could have noticed, because every test asked it the
 * wrong question.
 *
 * So this suite asks the only question that would have caught it: when a
 * channel is given a bonus, DOES THE NUMBER IT NAMES ACTUALLY MOVE? Every
 * channel, one at a time, against the figure its `applied` field points at.
 *
 * It is deliberately not a unit test of `factor()`. `factor()` was never the
 * part that broke.
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

/* =========================================== 1. the channels are declared */

const shape = await p.evaluate(() => ({
  order: hive.mods.order,
  channels: Object.fromEntries(
    Object.entries(hive.mods.channels).map(([id, c]) => [id, c.applied]),
  ),
  live: hive.mods.now(),
}));

check('there is a channel list', shape.order.length >= 10, `${shape.order.length} channels`);
check('every channel says where it is applied',
  shape.order.every((id) => typeof shape.channels[id] === 'string' && shape.channels[id]),
  shape.order.filter((id) => !shape.channels[id]).join(', ') || 'all of them');
check('a fresh hive starts at zero on every channel',
  shape.order.every((id) => shape.live[id] === 0),
  Object.entries(shape.live).filter(([, v]) => v !== 0).map(([k, v]) => `${k}=${v}`).join(' ') || 'all zero');

/* ====================================== 2. a typo is refused, not ignored */

/*
 * NO SKIP. This used to read the adder off `hive.modsApi`, which has never
 * existed, and treat the miss as a pass — so the one check standing between a
 * mistyped channel name and a bonus that silently does nothing could not fail.
 * The adder is on the handle now, for exactly this.
 */
const typo = await p.evaluate(() => {
  const out = {};
  const mod = hive.mods.empty();
  try {
    hive.mods.add(mod, { broodRat: 0.5 });
    out.typo = { threw: false };
  } catch (err) {
    out.typo = { threw: true, message: err.message };
  }
  // And a correctly spelled one still lands, so the guard is not just refusing
  // everything.
  try {
    hive.mods.add(mod, { broodRate: 0.5 });
    out.good = { threw: false, value: mod.broodRate };
  } catch (err) {
    out.good = { threw: true, message: err.message };
  }
  return out;
});
check('a mistyped channel name throws rather than silently doing nothing',
  typo.typo.threw === true && /broodRat/.test(typo.typo.message ?? ''),
  typo.typo.message?.slice(0, 70) ?? 'did not throw');
check('and a real one still lands',
  typo.good.threw === false && typo.good.value === 0.5,
  JSON.stringify(typo.good));

/*
 * ============ 2b. A CHANNEL MOVES THE SIMULATION, NOT JUST THE DISPLAY
 *
 * `broodRate` and `moldRate` were applied to the advertised `.rate` while the
 * tick advanced an unmodified `.cycleRate`. Nothing contributes to either
 * channel yet, so nothing was visibly wrong — the first gene aimed at one
 * would have shipped a screen that disagreed with the hive.
 *
 * The invariant that holds whatever the modifier is: the figure the interface
 * quotes is DERIVED from the figure the tick advances. Checked on the real
 * derive rather than on arithmetic repeated here.
 */
const oneRate = await p.evaluate(() => {
  const s = hive.state;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e7;
  s.energyPool = 1e9;
  s.larvae = 50;
  for (const id of Object.keys(hive.structureDefs)) {
    if (hive.structureDefs[id].brood || hive.structureDefs[id].molding) s.structures[id] = 2;
  }
  hive.tick(1, 1);
  const d = hive.derived();
  return {
    brood: d.brood.map((b) => ({ id: b.id, rate: b.rate, cycle: b.cycleRate, yield: b.yield })),
    molding: d.molding.map((m) => ({ id: m.id, rate: m.rate, cycle: m.cycleRate })),
  };
});
check('the brood rate the screen shows is the cycle rate the tick advances',
  oneRate.brood.length > 0
  && oneRate.brood.every((b) => Math.abs(b.rate - b.cycle * b.yield) < 1e-12),
  oneRate.brood.map((b) => `${b.id} ${b.rate} vs ${b.cycle}×${b.yield}`).join(' | '));
check('and so is the molding rate',
  oneRate.molding.length > 0
  && oneRate.molding.every((m) => Math.abs(m.rate - m.cycle) < 1e-12),
  oneRate.molding.map((m) => `${m.id} ${m.rate} vs ${m.cycle}`).join(' | '));

/* ============================ 3. EVERY CHANNEL MOVES THE NUMBER IT NAMES

   The heart of it. Each case grants a bonus through a research entry's `mult`
   map — the one source that is flat and needs no building — then reads the
   figure that channel is supposed to govern and checks it moved the right way.

   Costs go the other way on purpose: `rationCost: +0.5` must make the bill
   BIGGER. See modifiers.js rule 3. */

const CASES = [
  { channel: 'broodRate', dir: 'up', read: 'brood' },
  { channel: 'moldRate', dir: 'up', read: 'mold' },
  { channel: 'harvest', dir: 'up', read: 'harvest' },
  // Grazing multiplies a SHARE rather than a figure — how much of its keep a
  // working drone covers out on the ground — and the bill is that share
  // subtracted from a headcount. So the ×1.5 check is pointed at the share,
  // which is the thing the channel actually multiplies, and the check below
  // proves the share reaches the bill.
  { channel: 'grazing', dir: 'up', read: 'grazeShare' },
  { channel: 'insight', dir: 'up', read: 'insight' },
  { channel: 'digestion', dir: 'up', read: 'digestion' },
  { channel: 'storage', dir: 'up', read: 'bulkCap' },
  { channel: 'mineralStorage', dir: 'up', read: 'mineralCap' },
  { channel: 'vitaminStorage', dir: 'up', read: 'vitaminCap' },
  { channel: 'rationCost', dir: 'up', read: 'ration' },
  { channel: 'waterCost', dir: 'up', read: 'waterDraw' },
];

const moved = await p.evaluate((cases) => {
  const s = hive.state;

  // A hive with something running on every channel at once, so none of the
  // readings below is zero before the bonus lands. A channel whose figure is
  // zero either way would pass this test while being completely disconnected.
  const setup = () => {
    s.tech = { glycolysis: true, lipolysis: true };
    s.larvae = 10;
    s.drones = 8;
    s.structures.hivecore = 3;
    s.structures.broodChamber = 2;
    s.structures.moldingChamber = 2;
    s.structures.caecum = 2;
    s.structures.nodeCluster = 2;
    s.structures.interlocutor = 1;
    s.structures.metabolicGenerator = 4;
    s.active = { ...s.structures };
    s.power = Object.fromEntries(Object.keys(s.structures).map((k) => [k, 1]));
    for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 5000;
    for (const id of Object.keys(s.droneTypes || {})) s.droneTypes[id] = 4;

    // A chamber only counts as MOLDING when it has something it is allowed to
    // make and a larva to make it from, and a drone only HARVESTS when it is
    // standing on a worked patch. Both figures are zero otherwise — and a
    // reading of zero would pass a "did it move" test while the channel was
    // completely disconnected, which is the failure this whole suite exists for.
    s.droneMolding ??= {};
    for (const id of Object.keys(s.droneMolding)) s.droneMolding[id].on = true;
    s.territory = { temperateForest: 400 };
    s.forage = {};
    // A patch is created empty and only gets grams once a forage roll lands on
    // it, so seed them by hand rather than ticking — a tick would advance the
    // whole economy between the two readings and the ratio would be measuring
    // the economy rather than the channel.
    //
    // Patches hang off the CREW now — one drone type on one biome — and which
    // crews exist is decided by the assignment layer, so the seeding has to ask
    // it where everyone ended up rather than assuming.
    s.crews = {};
    s.assign = {};
    const where = hive.land.assignment();
    for (const typeId of ['forager', 'scavenger']) {
      for (const [biomeId, drones] of Object.entries(where[typeId] || {})) {
        if (drones < 1) continue;
        for (const patch of hive.drones.patches(typeId, biomeId, drones)) {
          patch.itemId = 'acorn';
          patch.grams = 40;
        }
      }
    }
  };

  // Read every governed figure out of one derive.
  const readings = () => {
    const d = hive.derived();
    const sum = (list, key) => (list || []).reduce((a, x) => a + (x[key] || 0), 0);
    return {
      brood: sum(d.brood, 'rate'),
      mold: sum(d.molding, 'rate'),
      harvest: Object.values(d.droneForage || {}).reduce((a, f) => a + (f.rate || 0), 0),
      insight: d.insightRate,
      digestion: d.digestion,
      bulkCap: d.caps.fiber,
      mineralCap: d.caps.iron ?? d.caps.ash,
      vitaminCap: d.caps.vitaminC ?? d.caps.water,
      ration: d.ration.joules,
      grazeShare: d.ration.share,
      waterDraw: d.hydration.draw,
    };
  };

  const out = [];
  for (const c of cases) {
    setup();
    // No bonus anywhere: the baseline.
    hive.researchDefs.glycolysis.mult = undefined;
    const before = readings()[c.read];

    // One source, one channel, +50%.
    hive.researchDefs.glycolysis.mult = { [c.channel]: 0.5 };
    const after = readings()[c.read];

    hive.researchDefs.glycolysis.mult = undefined;
    out.push({
      channel: c.channel,
      read: c.read,
      before,
      after,
      // 1.5x, within floating-point noise. Not just "it moved": a channel
      // applied twice by mistake would give 2.25x and still read as "moved".
      exact: before > 0 && Math.abs(after / before - 1.5) < 1e-6,
      ratio: before > 0 ? after / before : null,
    });
  }
  return out;
}, CASES);

for (const m of moved) {
  check(`${m.channel} moves ${m.read}`,
    m.exact,
    m.before <= 0
      ? `baseline was ${m.before} — the fixture does not exercise this`
      : `×${m.ratio.toFixed(4)} (want ×1.5)`);
}

// A share nothing reads would pass the ×1.5 check above while the drones ate
// exactly as much as before, which is the failure this whole suite exists for.
const grazes = await p.evaluate(() => {
  const s = hive.state;
  s.tech = { glycolysis: true };
  s.territory = { temperateForest: 400 };
  s.assign = {};
  s.droneTypes = { forager: 20, scavenger: 0 };
  hive.forage.resetForage(s);
  hive.tick(1);
  hive.researchDefs.glycolysis.mult = undefined;
  const before = hive.derived().ration;
  hive.researchDefs.glycolysis.mult = { grazing: 0.5 };
  const after = hive.derived().ration;
  hive.researchDefs.glycolysis.mult = undefined;
  return { before: before.billable, after: after.billable, grazed: before.grazed };
});
check('and a bigger share actually lowers the food bill',
  grazes.grazed > 0 && grazes.after < grazes.before,
  `${grazes.before.toFixed(1)} → ${grazes.after.toFixed(1)} drones on the stores`);

/* ================================= 4. nothing is left summing into the void */

const unread = await p.evaluate(() => ({
  unread: hive.mods.unread(),
  read: hive.mods.read(),
}));
check('every live channel has a reader',
  unread.unread.length === 0,
  unread.unread.length ? `nobody reads: ${unread.unread.join(', ')}` : `${unread.read.length} read`);

/* ========================== 5. two sources add, they do not compound */

const stacking = await p.evaluate(() => {
  const s = hive.state;
  s.tech = { glycolysis: true, lipolysis: true };
  s.larvae = 10;
  s.structures.broodChamber = 2;
  s.active = { ...s.structures };
  s.power = Object.fromEntries(Object.keys(s.structures).map((k) => [k, 1]));
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 5000;

  const rate = () => (hive.derived().brood || []).reduce((a, b) => a + (b.rate || 0), 0);
  hive.researchDefs.glycolysis.mult = undefined;
  hive.researchDefs.lipolysis.mult = undefined;
  const base = rate();

  hive.researchDefs.glycolysis.mult = { broodRate: 0.2 };
  const one = rate();
  hive.researchDefs.lipolysis.mult = { broodRate: 0.2 };
  const two = rate();

  hive.researchDefs.glycolysis.mult = undefined;
  hive.researchDefs.lipolysis.mult = undefined;
  return { base, one, two };
});
check('two sources of +20% give +40%, not +44%',
  Math.abs(stacking.two / stacking.base - 1.4) < 1e-6,
  `×${(stacking.two / stacking.base).toFixed(4)} (compounding would be ×1.44)`);

await finish({ name: 'the modifier layer', fail, errors, browser });
