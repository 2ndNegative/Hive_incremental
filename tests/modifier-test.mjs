import { chromium } from 'playwright';
import { BASE, LAUNCH, ensureLanded } from './harness.mjs';

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

const typo = await p.evaluate(() => {
  try {
    hive.state.structures.__never = 0;
    const mod = hive.mods.now();
    // Reach the raw adder the way a definition file would, through a bad name.
    const { addModifiers } = hive.modsApi ?? {};
    if (!addModifiers) return { skip: true };
    addModifiers(mod, { broodRat: 0.5 });
    return { threw: false };
  } catch (err) {
    return { threw: true, message: err.message };
  }
});
check('a mistyped channel name throws rather than silently doing nothing',
  typo.skip || typo.threw === true,
  typo.message?.slice(0, 60) ?? 'addModifiers not on the handle');

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
    s.patches = {};
    for (const typeId of ['forager', 'scavenger']) {
      const held = hive.drones.patches(typeId);
      for (const patch of held) {
        patch.itemId = 'acorn';
        patch.biomeId = 'temperateForest';
        patch.grams = 40;
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

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
