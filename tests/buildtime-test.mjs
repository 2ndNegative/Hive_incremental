import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * BUILD TIME.
 *
 * The claim is narrow and worth stating, because almost every test below is a
 * way of checking it: cost gates, time only textures. So the things that would
 * break it are the things under test —
 *
 *   — a rung that resolves to nothing, which is an instant building;
 *   — a count curve that runs away, which turns time into the binding
 *     constraint somewhere around the twentieth of something;
 *   — progress stored as a deadline rather than as work, which would mean a
 *     brood hatching mid-build did nothing;
 *   — a tick that is not frame-rate independent, which would make the game
 *     faster on a fast machine and offline catch-up a lottery;
 *   — and the cost being charged twice, or a cancel refunding the wrong amount,
 *     either of which is mass appearing or vanishing.
 */

async function ensureLanded(page) {
  const card = await page.$('.origin-card:not(.is-locked):not(.is-placeholder)');
  if (!card) return false;
  await card.click();
  await page.waitForSelector('.origin-backdrop', { state: 'detached', timeout: 5000 });
  return true;
}

const base = BASE;
const browser = await chromium.launch(LAUNCH);

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};

const errors = [];
const p = await browser.newPage({ viewport: { width: 1480, height: 1000 } });
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await p.goto(base, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
await p.waitForTimeout(250);
await p.evaluate(() => hive.loop.stop());

/** A hive with an empty bench, an empty queue and nothing in the stores. */
const reset = () => p.evaluate(() => {
  const s = hive.state;
  s.buildQueue = [];
  s.building = null;
  s.larvae = 0;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
});

/* ====================================================== 1. the ladder itself */

const ladder = await p.evaluate(() => ({
  rungs: hive.buildTime.rungs,
  order: hive.buildTime.order,
  exponent: hive.buildTime.exponent,
  table: hive.buildTime.table(),
}));

check('there is a duration ladder', ladder.order.length === 6, ladder.order.join(', '));

const seconds = ladder.order.map((n) => ladder.rungs[n]);
check('and it only goes up', seconds.every((v, i) => i === 0 || v > seconds[i - 1]),
  seconds.join(' < '));

const steps = seconds.slice(1).map((v, i) => v / seconds[i]);
check('about ×2.2 a step, so a rung is a real choice',
  steps.every((r) => r >= 1.6 && r <= 2.6), steps.map((r) => r.toFixed(2)).join(' '));

check('the longest is half an hour, not hours — cost gates, time textures',
  seconds[seconds.length - 1] === 1800, `${seconds[seconds.length - 1]}s`);

check('every live building declares a rung',
  ladder.table.every((r) => typeof r.rung === 'string' && ladder.rungs[r.rung] > 0),
  ladder.table.filter((r) => !ladder.rungs[r.rung]).map((r) => r.id).join(', ') || 'all of them');

/* A missing rung is the dangerous case: it is not an error at the point of use,
   it is a building that goes up instantly. The resolver has to refuse it. */
const refuses = await p.evaluate(() => {
  const bad = [];
  for (const v of [undefined, null, 'quick', 'LONG', {}, -5]) {
    try { hive.buildTime.duration(v); bad.push(String(v)); } catch { /* as it should */ }
  }
  return { bad, raw: hive.buildTime.duration(45) };
});
check('an unknown or missing rung throws rather than resolving to nothing',
  refuses.bad.length === 0, `accepted ${refuses.bad.join(', ')}`);
check('and a bespoke number of seconds still works', refuses.raw === 45);

/* ================================================= 2. the count curve, gently */

const curve = await p.evaluate(() => {
  const f = (n) => hive.buildTime.workOf('short', n) / hive.buildTime.workOf('short', 0);
  return { at: [1, 5, 10, 25, 50].map((n) => ({ n, mult: f(n) })), exponent: hive.buildTime.exponent };
});
check('the count curve is the quarter power', curve.exponent === 0.25);

const fiftieth = curve.at.find((r) => r.n === 50).mult;
check('the fiftieth of something takes 2.7× as long as the first, not 7×',
  fiftieth > 2.6 && fiftieth < 2.75, `×${fiftieth.toFixed(2)}`);

const tenth = curve.at.find((r) => r.n === 10).mult;
check('and the tenth is under twice', tenth > 1.7 && tenth < 1.85, `×${tenth.toFixed(2)}`);

/* The asymmetry IS the design. If time ever compounds like cost, the mid-game
   stops being about mass. */
const asymmetry = await p.evaluate(() => {
  const g = hive.costs.growth.steady ** 25;
  const t = hive.buildTime.workOf('short', 25) / hive.buildTime.workOf('short', 0);
  return { cost: g, time: t };
});
check('cost runs away where time does not',
  asymmetry.cost > 1000 && asymmetry.time < 2.5,
  `×${Math.round(asymmetry.cost)} cost against ×${asymmetry.time.toFixed(2)} time`);

/* ======================================== 3. a rung is WORK, not wall-clock */

await reset();
const paced = await p.evaluate(() => {
  const s = hive.state;
  const id = hive.structureOrder[hive.structureOrder.length - 1]; // a storage bag
  const out = [];
  for (const larvae of [0, 5, 20, 45]) {
    s.larvae = larvae;
    out.push({
      larvae,
      pace: hive.buildTime.pace(),
      seconds: hive.buildTime.seconds(id),
    });
  }
  s.larvae = 0;
  return { id, out, work: hive.buildTime.workOf('short', 0) };
});
check('a hive with no brood at all gets the headline figure',
  Math.abs(paced.out[0].seconds - paced.out[0].pace ** -1 * paced.work) < 2,
  `${Math.round(paced.out[0].seconds)}s`);
check('larvae make building faster, on the same curve as the chambers',
  paced.out.every((r, i) => i === 0 || r.seconds < paced.out[i - 1].seconds),
  paced.out.map((r) => `${r.larvae}→${Math.round(r.seconds)}s`).join(' '));
check('and the pace is the brood pace, not a second dial of its own',
  Math.abs(paced.out[1].pace - 1 - Math.sqrt(5 / 5)) < 0.3,
  `×${paced.out[1].pace.toFixed(2)} at five larvae`);

/* ================================= 4. remaining WORK, not a stored deadline */

const midBuild = await p.evaluate(() => {
  const s = hive.state;
  s.buildQueue = [];
  s.building = null;
  s.larvae = 0;
  const id = hive.structureOrder[hive.structureOrder.length - 1];
  for (const [n, amount] of Object.entries(hive.structureCost(id, 1))) s.nutrients[n] = amount;
  hive.queue.add(id, 1);
  hive.tick(1);
  const slow = hive.buildTime.now().seconds;
  // A brood hatches halfway through. The REST of the build should speed up; a
  // stored finish time could not do this.
  s.larvae = 45;
  const fast = hive.buildTime.now().seconds;
  const work = hive.buildTime.now().remaining;
  s.larvae = 0;
  return { id, slow, fast, work };
});
check('a brood hatching mid-build finishes the rest of it faster',
  midBuild.fast < midBuild.slow * 0.5,
  `${Math.round(midBuild.slow)}s left became ${Math.round(midBuild.fast)}s`);
check('because what is stored is work, not a deadline',
  midBuild.work > 1, `${Math.round(midBuild.work)} pace-seconds left`);

/* ============================================= 5. nothing is instant any more */

await reset();
const instant = await p.evaluate(() => {
  const s = hive.state;
  // Every tech, because this is about the CLOCK, not about unlocks. The Mineral
  // Vault and Vitamin Lattice are gated behind their assays, and a locked
  // building the queue refuses looks exactly like a building that went up
  // instantly — which is the thing this section exists to catch.
  s.tech = Object.fromEntries(hive.researchOrder.map((t) => [t, true]));
  const results = [];
  for (const id of hive.structureOrder) {
    s.buildQueue = [];
    s.building = null;
    const had = s.structures[id] || 0;
    for (const [n, amount] of Object.entries(hive.structureCost(id, 1))) {
      s.nutrients[n] = amount * 2;
    }
    hive.queue.add(id, 1);
    hive.tick(1);
    results.push({ id, built: (s.structures[id] || 0) - had, onBench: hive.buildTime.now()?.id });
  }
  s.building = null;
  s.buildQueue = [];
  return results;
});
check('not one building in the game goes up in a single tick',
  instant.every((r) => r.built === 0),
  instant.filter((r) => r.built).map((r) => r.id).join(', ') || 'all of them wait');
check('and every one of them is on the bench instead',
  instant.every((r) => r.onBench === r.id),
  instant.filter((r) => r.onBench !== r.id).map((r) => r.id).join(', ') || 'all accounted for');

/* ============================ 6. the same construction however it is ticked

   One tick of sixty seconds and sixty ticks of one second have to get through
   the same work, or the game runs at the speed of the player's machine and
   offline catch-up is a lottery. */

const framerate = await p.evaluate(() => {
  const id = hive.structureOrder[hive.structureOrder.length - 1];
  const run = (step, total) => {
    const s = hive.state;
    s.buildQueue = [];
    s.building = null;
    s.larvae = 7;
    // Pinned, because the count is part of the work: a first run that finished
    // its job would hand the second a longer one and the comparison would be
    // measuring the count curve rather than the tick.
    s.structures[id] = 0;
    for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
    for (const [n, amount] of Object.entries(hive.structureCost(id, 1))) {
      s.nutrients[n] = amount * 4;
    }
    hive.queue.add(id, 1);
    // The queue drain directly, so the economy running underneath cannot move
    // the stores and change which jobs are affordable between the two runs.
    let done = 0;
    while (done < total) {
      const dt = Math.min(step, total - done);
      hive.queue.advance(dt, 2);
      done += dt;
    }
    return hive.buildTime.now()?.remaining ?? 0;
  };
  // Deliberately short of finishing: a completed job has no remainder to
  // compare, and the question here is about the arithmetic in between.
  const coarse = run(40, 40);
  const fine = run(1, 40);
  hive.state.larvae = 0;
  return { coarse, fine };
});
check('one long tick and many short ones get through the same work',
  Math.abs(framerate.coarse - framerate.fine) < 0.01,
  `${framerate.coarse.toFixed(2)} vs ${framerate.fine.toFixed(2)} left`);

/* A tick with time left over after finishing a job starts the next one with the
   remainder rather than throwing it away — which is what makes offline
   catch-up honest. */
const spillover = await p.evaluate(() => {
  const s = hive.state;
  s.buildQueue = [];
  s.building = null;
  s.larvae = 0;
  const id = hive.structureOrder[hive.structureOrder.length - 1];
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  for (const [n, amount] of Object.entries(hive.structureCost(id, 1))) {
    s.nutrients[n] = amount * 20;
  }
  hive.queue.add(id, 3);
  const had = s.structures[id] || 0;
  // Three jobs' worth of time in one go, at pace 1.
  const built = hive.queue.advance(6000, 1);
  return { built, got: (s.structures[id] || 0) - had, bench: hive.buildTime.now() };
});
check('a tick with time to spare starts the next job with the remainder',
  spillover.got === 3 && spillover.bench === null,
  `${spillover.got} went up in one pass`);

const bounded = await p.evaluate(() => {
  const s = hive.state;
  s.buildQueue = [];
  s.building = null;
  s.larvae = 0;
  const id = hive.structureOrder[hive.structureOrder.length - 1];
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  for (const [n, amount] of Object.entries(hive.structureCost(id, 1))) {
    s.nutrients[n] = amount * 20;
  }
  hive.queue.add(id, 3);
  const had = s.structures[id] || 0;
  // Enough for one and a bit. The rest must still be waiting.
  const built = hive.queue.advance(hive.buildTime.workOf('short', s.structures[id] || 0) + 1, 1);
  return { built, got: (s.structures[id] || 0) - had, left: hive.queue.used() };
});
check('and a tick that only buys one job only gets one',
  bounded.got === 1, `${bounded.got} went up`);

/* ================================================= 7. the mass adds up */

const money = await p.evaluate(() => {
  const s = hive.state;
  s.buildQueue = [];
  s.building = null;
  s.larvae = 0;
  const id = hive.structureOrder[hive.structureOrder.length - 1];
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  const cost = hive.structureCost(id, 1);
  // Exactly twice the cost, so paying twice would be visible and paying once
  // leaves exactly one lot behind.
  for (const [n, amount] of Object.entries(cost)) s.nutrients[n] = amount * 2;
  hive.queue.add(id, 1);
  hive.queue.advance(1, 1);
  const afterStart = Object.fromEntries(Object.keys(cost).map((n) => [n, s.nutrients[n] || 0]));
  // Ticked a long way through, well past the point a per-tick charge would show.
  for (let i = 0; i < 40; i += 1) hive.queue.advance(1, 1);
  const during = Object.fromEntries(Object.keys(cost).map((n) => [n, s.nutrients[n] || 0]));
  return { cost, afterStart, during, bench: Boolean(hive.buildTime.now()) };
});
check('the cost is taken once, when the job starts',
  Object.entries(money.cost).every(
    ([n, amount]) => Math.abs(money.afterStart[n] - amount) < 1e-6,
  ),
  JSON.stringify(money.afterStart));
check('and not again on every tick it is growing',
  money.bench && Object.keys(money.cost).every(
    (n) => Math.abs(money.during[n] - money.afterStart[n]) < 1e-6,
  ),
  JSON.stringify(money.during));

const refund = await p.evaluate(() => {
  const s = hive.state;
  // Room for the refund to land in, or the store would spill it and the
  // comparison below would be measuring storage rather than the refund.
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.buildQueue = [];
  s.building = null;
  const id = hive.structureOrder[hive.structureOrder.length - 1];
  const cost = hive.structureCost(id, 1);
  for (const [n, amount] of Object.entries(cost)) s.nutrients[n] = amount;
  hive.queue.add(id, 1);
  hive.queue.advance(1, 1);
  const emptied = Object.keys(cost).every((n) => (s.nutrients[n] || 0) < 1e-6);
  const job = hive.buildTime.cancel();
  const back = Object.entries(cost).every(
    ([n, amount]) => Math.abs((s.nutrients[n] || 0) - amount) < 1e-6,
  );
  return { emptied, back, cancelled: Boolean(job), bench: hive.buildTime.now() };
});
check('starting a job empties the stores it was paid out of', refund.emptied);
check('and abandoning it hands back exactly what was paid',
  refund.cancelled && refund.back && refund.bench === null);

/* ======================================= 8. a half-grown job survives a save */

const roundTrip = await p.evaluate(() => {
  const s = hive.state;
  s.buildQueue = [];
  s.building = null;
  s.larvae = 0;
  const id = hive.structureOrder[hive.structureOrder.length - 1];
  for (const [n, amount] of Object.entries(hive.structureCost(id, 1))) {
    s.nutrients[n] = amount;
  }
  hive.queue.add(id, 1);
  hive.queue.advance(40, 1); // a third of the way in, give or take
  hive.save();
  const key = Object.keys(localStorage).find((k) => /hive/i.test(k));
  const raw = JSON.parse(localStorage.getItem(key));
  const saved = raw?.state ?? raw;
  return {
    id,
    version: saved?.version,
    building: saved?.building,
    progress: hive.buildTime.now()?.progress,
  };
});
const SAVE_VERSION = await p.evaluate(() => hive.saveVersion);
check('a job on the bench is written to the save',
  roundTrip.building?.id === roundTrip.id, JSON.stringify(roundTrip.building));
check('with its work, what is left of it, and what it was paid',
  roundTrip.building?.work > 0
  && roundTrip.building?.remaining > 0
  && roundTrip.building?.remaining < roundTrip.building?.work
  && roundTrip.building?.paid
  && Object.keys(roundTrip.building.paid).length > 0,
  `${Math.round(roundTrip.building?.remaining)} of ${Math.round(roundTrip.building?.work)} left`);
check('at the current save version', roundTrip.version === SAVE_VERSION, `v${roundTrip.version}`);

/* An older save has no bench at all — everything it ever built went up the
   instant it was paid for — and must come back with an empty one. */
const stale = await p.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => /hive/i.test(k));
  const raw = JSON.parse(localStorage.getItem(key));
  const s = raw?.state ?? raw;
  delete s.building;
  s.version = 21;
  return { key, json: JSON.stringify(raw) };
});
const q = await browser.newPage({ viewport: { width: 1480, height: 1000 } });
const qErrors = [];
q.on('pageerror', (e) => qErrors.push(e.message));
await q.addInitScript(([key, json]) => localStorage.setItem(key, json), [stale.key, stale.json]);
await q.goto(base, { waitUntil: 'networkidle' });
await q.waitForSelector('.res-row');
await q.waitForTimeout(400);
const loaded = await q.evaluate(() => {
  hive.loop.stop();
  hive.tick(5);
  return {
    bench: hive.state.building,
    version: hive.state.version,
    cap: hive.queue.cap(),
  };
});
check('a save from before build time loads with an empty bench',
  loaded.bench === null || loaded.bench === undefined, JSON.stringify(loaded.bench));
check('and ticks without complaint', qErrors.length === 0, qErrors.slice(0, 2).join(' | '));
await q.close();

/* ============================== 9. the bench counts against the queue cap */

const counted = await p.evaluate(() => {
  const s = hive.state;
  s.buildQueue = [];
  s.building = null;
  s.tech = {};
  const id = hive.structureOrder[hive.structureOrder.length - 1];
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  for (const [n, amount] of Object.entries(hive.structureCost(id, 1))) s.nutrients[n] = amount;
  hive.queue.add(id, 'max');
  const queued = hive.queue.used();
  hive.queue.advance(1, 1); // one job moves from the queue to the bench
  return {
    cap: hive.queue.cap(),
    queued,
    afterStart: hive.queue.used(),
    onBench: Boolean(hive.buildTime.now()),
    inFlight: hive.queue.inFlight(id),
    room: hive.queue.room(),
  };
});
check('a fresh hive holds three jobs', counted.cap === 3 && counted.queued === 3,
  `${counted.queued} of ${counted.cap}`);
check('the one on the bench still counts as one of them',
  counted.onBench && counted.afterStart === 3 && counted.room === 0,
  `${counted.afterStart} in mind, ${counted.room} free`);
check('and inFlight counts it too, so a level cap cannot be overshot',
  counted.inFlight === 3, `${counted.inFlight} promised`);

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
