import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * The build queue.
 *
 * It buys nothing the player could not have bought by hand — the whole claim is
 * that it does it at the right moment instead of making them watch for it. So
 * the things worth testing are the ones where a queue can quietly betray that:
 * spending resources it was not meant to, reordering the player's priorities by
 * skipping a head it cannot afford, or jamming forever on an entry that can
 * never be built.
 */

async function ensureLanded(page) {
  const card = await page.$('.origin-card:not(.is-locked):not(.is-placeholder)');
  if (!card) return false;
  await card.click();
  await page.waitForSelector('.origin-backdrop', { state: 'detached', timeout: 5000 });
  return true;
}

async function openTab(page, label) {
  await page.click(`.tab-bar button:text-is("${label}")`);
  await page.waitForTimeout(200);
}

const base = BASE;
const browser = await chromium.launch(LAUNCH);

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};

/** Three ones, in any arrangement the merge happens to produce. */
const added3 = (list) => list.slice(0, 3).every((n) => n === 1);

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

/** A hive with nothing queued, no research, and empty stores. */
async function fixture() {
  return p.evaluate(() => {
    const s = hive.state;
    s.buildQueue = [];
    s.building = null;
    s.tech = {};
    for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
    // Two cheap, unlevelled things to line up against each other.
    const order = hive.structureOrder.filter(
      (id) => hive.structureDefs[id].unlock(s) && !hive.structureDefs[id].leveled,
    );
    return { cap: hive.queue.cap(), buildable: order };
  });
}

const start = await fixture();
check('a fresh hive can hold three jobs in mind', start.cap === 3, `${start.cap} slots`);
check('and there is something to put in them', start.buildable.length >= 2,
  start.buildable.slice(0, 3).join(', '));

const [cheap, other] = start.buildable;

/* ============================================= 1. the cap, and what it counts */

const filled = await p.evaluate(({ cheap, other }) => {
  const added = [
    hive.queue.add(cheap, 1),
    hive.queue.add(other, 1),
    hive.queue.add(cheap, 1),
    hive.queue.add(other, 1), // the queue is full by now
  ];
  return { added, used: hive.queue.used(), list: hive.queue.list() };
}, { cheap, other });
check('three jobs go in', added3(filled.added));
check('and a fourth is refused rather than quietly dropping one',
  filled.added[3] === 0 && filled.used === 3,
  `${filled.used} queued`);

const partial = await p.evaluate(({ cheap }) => {
  hive.queue.clear();
  // Asking for five with two slots means two, not a refusal: the intent is
  // clear and refusing would only mean pressing again.
  const added = hive.queue.add(cheap, 5);
  return { added, used: hive.queue.used() };
}, { cheap });
check('asking for more than fits queues what fits',
  partial.added === 3 && partial.used === 3, `${partial.added} of 5 taken`);

const merged = await p.evaluate(() => hive.queue.list());
check('repeats of the same building merge into one line',
  merged.length === 1 && merged[0].n === 3, JSON.stringify(merged));

/* ========================================= 2. it spends nothing until it can */

const idle = await p.evaluate(() => {
  const s = hive.state;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  const before = JSON.stringify(s.nutrients);
  const owned = { ...s.structures };
  hive.tick(60);
  return {
    sameStores: JSON.stringify(s.nutrients) === before,
    sameStructures: JSON.stringify(s.structures) === JSON.stringify(owned),
    stillQueued: hive.queue.used(),
  };
});
check('a queue the hive cannot pay for spends nothing',
  idle.sameStores && idle.sameStructures, 'stores and buildings both untouched');
check('and keeps waiting rather than giving up', idle.stillQueued === 3);

/* ============== 3. it STARTS the moment it can pay, and finishes in its time */

const paid = await p.evaluate(({ cheap }) => {
  const s = hive.state;
  const had = s.structures[cheap] || 0;
  // Exactly enough for one, and not a gram more.
  const cost = hive.derived() && hive.structureCost(cheap, 1);
  for (const [n, amount] of Object.entries(cost)) s.nutrients[n] = amount;
  hive.tick(1);
  const job = hive.buildTime.now();
  return {
    startedNotFinished: (s.structures[cheap] || 0) - had === 0 && Boolean(job),
    growing: job?.id,
    spent: Object.entries(cost).every(([n]) => (s.nutrients[n] || 0) < 1e-6),
    // One tick of a two-minute job is barely any of it.
    progress: job?.progress ?? 1,
  };
}, { cheap });
check('the head goes onto the bench as soon as it is affordable',
  paid.startedNotFinished, `growing ${paid.growing}`);
check('it pays for it up front', paid.spent);
check('and it is not finished a second later',
  paid.progress < 0.2, `${Math.round((paid.progress || 0) * 100)}% through`);

const finished = await p.evaluate(({ cheap }) => {
  const s = hive.state;
  const had = s.structures[cheap] || 0;
  // Long enough for anything on the ladder, at any pace.
  hive.tick(2400);
  return {
    built: (s.structures[cheap] || 0) - had,
    bench: hive.buildTime.now(),
    left: hive.queue.used(),
  };
}, { cheap });
check('given its time, it goes up', finished.built === 1);
check('and the bench is handed to the next job',
  finished.bench === null || finished.bench.id !== cheap,
  finished.bench ? `now growing ${finished.bench.id}` : 'bench empty');
check('the finished one is off the queue', finished.left <= 2, `${finished.left} left`);

const logged = await p.evaluate(() =>
  hive.state.log.slice(0, 3).map((l) => l.text).join(' | '));
check('a queued build reads in the log exactly like a pressed one',
  /Grew |raised to level/.test(logged), logged.slice(0, 70));

/* ================================== 4. strictly in order, head first

   Driven through the drain directly rather than a full tick: a thirty-second
   tick runs the whole economy, and a generator quietly burning the fat this is
   measuring would turn a real ordering failure into a confusing one. That the
   drain is actually wired into tick() is section 3's job. */

const order = await p.evaluate(() => {
  const s = hive.state;
  hive.queue.clear();
  s.building = null;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;

  const priced = hive.structureOrder
    .filter((id) => hive.structureDefs[id].unlock(s))
    .map((id) => ({ id, total: Object.values(hive.structureCost(id, 1)).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => a.total - b.total);
  const low = priced[0];
  const high = priced[priced.length - 1];

  // Something expensive in front, something cheap behind it. A queue that let
  // the cheap one jump the line would invert the player's priorities at
  // exactly the moment they matter most.
  hive.queue.add(high.id, 1);
  hive.queue.add(low.id, 1);

  // Enough for the cheap one several times over, nowhere near the dear one.
  for (const [n, amount] of Object.entries(hive.structureCost(low.id, 1))) {
    s.nutrients[n] = amount * 3;
  }

  const hadLow = s.structures[low.id] || 0;
  const hadHigh = s.structures[high.id] || 0;
  const built = hive.queue.advance(3000, 1);
  return {
    distinct: low.id !== high.id,
    low: low.id,
    high: high.id,
    built,
    builtLow: (s.structures[low.id] || 0) - hadLow,
    builtHigh: (s.structures[high.id] || 0) - hadHigh,
    queued: hive.queue.used(),
  };
});
check('the fixture really does pit a dear job against a cheap one',
  order.distinct, `${order.high} in front of ${order.low}`);
check('the cheap job behind an unaffordable head does not jump the line',
  order.builtLow === 0 && order.builtHigh === 0 && order.built === 0,
  `${order.high} is still at the head`);
check('and both are still waiting', order.queued === 2);

const unblocked = await p.evaluate(({ low, high }) => {
  const s = hive.state;
  for (const [n, amount] of Object.entries(hive.structureCost(high, 1))) {
    s.nutrients[n] = (s.nutrients[n] || 0) + amount;
  }
  const hadHigh = s.structures[high] || 0;
  const hadLow = s.structures[low] || 0;
  const built = hive.queue.advance(3000, 1);
  return {
    built,
    builtHigh: (s.structures[high] || 0) - hadHigh,
    builtLow: (s.structures[low] || 0) - hadLow,
    queued: hive.queue.used(),
  };
}, { low: order.low, high: order.high });
check('paying for the head lets the whole queue through',
  unblocked.builtHigh === 1 && unblocked.builtLow === 1 && unblocked.queued === 0,
  `both went up in one pass (${unblocked.built} built)`);

/* ============================== 5. an entry that can never be built is dropped */

const levelled = await p.evaluate(() => {
  const s = hive.state;
  hive.queue.clear();
  s.building = null;
  const id = hive.structureOrder.find((x) => hive.structureDefs[x].leveled);
  if (!id) return { skip: true };
  // Queue an upgrade, then take it to its cap by hand so the queued one can
  // never happen. Without the drop it would sit at the head forever.
  hive.queue.add(id, 1);
  s.structures[id] = hive.maxLevelOf(id);
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e9;
  hive.tick(1);
  return {
    id,
    left: hive.queue.used(),
    said: s.log.slice(0, 3).some((l) => /dropped from the queue/.test(l.text)),
  };
});
check('a job that can never be built is thrown out rather than jamming the queue',
  levelled.skip || levelled.left === 0, `${levelled.id} was at its cap`);
check('and the log says why', levelled.skip || levelled.said === true);

const overQueue = await p.evaluate(() => {
  const s = hive.state;
  hive.queue.clear();
  s.building = null;
  const id = hive.structureOrder.find((x) => hive.structureDefs[x].leveled);
  if (!id) return { skip: true };
  s.structures[id] = hive.maxLevelOf(id) - 1;
  // One upgrade left, so the second request has nowhere to go.
  return { skip: false, first: hive.queue.add(id, 1), second: hive.queue.add(id, 1) };
});
check('and the queue refuses to accept one in the first place',
  overQueue.skip || (overQueue.first === 1 && overQueue.second === 0),
  'what is already queued counts against the level cap');

/* ========================================== 6. reordering and removing */

const edited = await p.evaluate(({ cheap, other }) => {
  const s = hive.state;
  s.building = null;
  s.structures[cheap] = 0;
  s.structures[other] = 0;
  hive.queue.clear();
  hive.queue.add(cheap, 1);
  hive.queue.add(other, 1);
  const before = hive.queue.list().map((e) => e.id);
  hive.queue.move(0, 1);
  const after = hive.queue.list().map((e) => e.id);
  hive.queue.remove(0, true);
  return { before, after, left: hive.queue.list().map((e) => e.id) };
}, { cheap, other });
check('the player can reorder the queue',
  edited.before[0] === edited.after[1] && edited.before[1] === edited.after[0],
  `${edited.before.join(' → ')} became ${edited.after.join(' → ')}`);
check('and take something out of it', edited.left.length === 1, edited.left.join(', '));

const partialRemove = await p.evaluate(({ cheap }) => {
  hive.queue.clear();
  hive.state.building = null;
  hive.queue.add(cheap, 2);
  hive.queue.remove(0, false);
  return hive.queue.list();
}, { cheap });
check('removing one of a run leaves the rest',
  partialRemove.length === 1 && partialRemove[0].n === 1, JSON.stringify(partialRemove));

/* ===================================== 7. research widens it */

const widened = await p.evaluate(() => {
  const s = hive.state;
  s.tech = {};
  const base = hive.queue.cap();
  s.tech.stigmergy = true;
  const one = hive.queue.cap();
  s.tech.nestPlanning = true;
  const two = hive.queue.cap();
  return { base, one, two };
});
check('research widens the queue', widened.base === 3 && widened.one === 5 && widened.two === 9,
  `${widened.base} → ${widened.one} → ${widened.two}`);

const deeper = await p.evaluate(({ cheap }) => {
  hive.queue.clear();
  hive.buildTime.cancel();
  hive.state.structures[cheap] = 0;
  return { added: hive.queue.add(cheap, 'max'), used: hive.queue.used() };
}, { cheap });
check('and the extra room is usable', deeper.used === 9, `${deeper.used} queued`);

/* =========================================== 8. a save keeps the queue */

const saved = await p.evaluate(() => {
  hive.queue.clear();
  hive.state.building = null;
  hive.queue.add(hive.queue.list().length ? 'x' : hive.structureOrder[0], 1);
  hive.save();
  const key = Object.keys(localStorage).find((k) => /hive/i.test(k));
  const raw = JSON.parse(localStorage.getItem(key));
  const s = raw?.state ?? raw;
  return { version: s?.version, queue: s?.buildQueue, key, json: JSON.stringify(raw) };
});
const SAVE_VERSION = await p.evaluate(() => hive.saveVersion);
check('the queue round-trips through a save',
  Array.isArray(saved.queue) && saved.queue.length === 1, JSON.stringify(saved.queue));
check('at the current save version', saved.version === SAVE_VERSION, `v${saved.version}`);

/* ========================================= 9. an older save loads clean */

const stale = await p.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => /hive/i.test(k));
  const raw = JSON.parse(localStorage.getItem(key));
  const s = raw?.state ?? raw;
  delete s.buildQueue;
  delete s.building;
  s.version = 19;
  return { key, json: JSON.stringify(raw) };
});
// Seeded on a fresh page: reloading a running one fires beforeunload, which
// saves the live state over the tampered one before load() ever sees it.
const q = await browser.newPage({ viewport: { width: 1480, height: 1000 } });
const qErrors = [];
q.on('pageerror', (e) => qErrors.push(e.message));
await q.addInitScript(([key, json]) => localStorage.setItem(key, json), [stale.key, stale.json]);
await q.goto(base, { waitUntil: 'networkidle' });
await q.waitForSelector('.res-row');
await q.waitForTimeout(400);
const afterLoad = await q.evaluate(() => {
  hive.loop.stop();
  hive.tick(5);
  return { queue: hive.state.buildQueue, version: hive.state.version, cap: hive.queue.cap() };
});
check('a save from before the queue loads with an empty one',
  Array.isArray(afterLoad.queue) && afterLoad.queue.length === 0,
  JSON.stringify(afterLoad.queue));
check('and ticks without complaint', qErrors.length === 0, qErrors.slice(0, 2).join(' | '));
await q.close();

/* ========================================== 10. the Hive tab, end to end

   Pressing a building card LINES IT UP. There is no instant build any more, so
   the card is the queue button and the old separate one is gone — which means
   an unaffordable card must still be pressable, because waiting for the mass is
   the queue's job. */

await p.evaluate(() => {
  const s = hive.state;
  hive.queue.clear();
  s.building = null;
  s.tech = {};
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
});
await openTab(p, 'Hive');
await p.waitForTimeout(400);

const strip = await p.evaluate(() => {
  const box = document.querySelector('.queue-strip');
  const cards = [...document.querySelectorAll('.action-card')];
  return {
    there: Boolean(box),
    cap: box?.querySelector('.queue-cap')?.innerText.trim() ?? '',
    empty: Boolean(box?.querySelector('.queue-empty')),
    cards: cards.length,
    // Nothing is affordable — the stores are empty — and every card must still
    // be pressable, or the queue could never be used to plan ahead.
    pressable: cards.filter((c) => !c.disabled).length,
    grow: [...document.querySelectorAll('.action-grow')].map((n) => n.innerText.trim()),
  };
});
check('the Hive tab shows the construction strip', strip.there && strip.empty);
check('with how full it is', /0\s*\/\s*3/.test(strip.cap), strip.cap);
check('a card the hive cannot afford is still pressable',
  strip.cards > 0 && strip.pressable === strip.cards,
  `${strip.pressable} of ${strip.cards}`);
check('and every card says how long it takes to grow',
  strip.grow.length === strip.cards && strip.grow.every((t) => /to grow/.test(t)),
  strip.grow[0]);

await p.evaluate(() => document.querySelectorAll('.action-card')[0].click());
await p.waitForTimeout(300);
const afterClick = await p.evaluate(() => {
  const box = document.querySelector('.queue-strip');
  return {
    used: hive.queue.used(),
    rows: box.querySelectorAll('.queue-item').length,
    cap: box.querySelector('.queue-cap')?.innerText.trim() ?? '',
    state: box.querySelector('.queue-state')?.innerText.trim() ?? '',
    mine: document.querySelector('.queue-mine')?.innerText.trim() ?? '',
  };
});
check('pressing a card lines something up',
  afterClick.used === 1 && afterClick.rows === 1, `${afterClick.rows} row`);
check('the counter moves', /1\s*\/\s*3/.test(afterClick.cap), afterClick.cap);
check('the card says it has one promised', /1 promised/.test(afterClick.mine), afterClick.mine);
check('and the row says what it is waiting on, never a blank figure',
  /^(affordable in .+|starting now|next.*|waiting its turn|nothing coming in to pay for it)$/
    .test(afterClick.state),
  afterClick.state);

/* --- the bar on the bench ----------------------------------------------- */

const bench = await p.evaluate(() => {
  const s = hive.state;
  hive.queue.clear();
  s.building = null;
  // The cheapest unlevelled thing on the board, funded by hand. Anything dear
  // would cost more than the hive can hold, and the store reconcile would spill
  // the fixture before the queue ever saw it.
  const id = hive.structureOrder[hive.structureOrder.length - 1];
  s.structures[id] = 0;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  for (const [n, amount] of Object.entries(hive.structureCost(id, 1))) {
    s.nutrients[n] = amount;
  }
  hive.queue.add(id, 1);
  // The drain directly rather than a full tick: the economy underneath would
  // move the stores, and what is on test here is the bench.
  hive.queue.advance(1, 1);
  return { id, bench: hive.buildTime.now()?.id };
});
check('the fixture got a job started', bench.bench === bench.id, `${bench.bench}`);
await p.waitForTimeout(300);
const benchRow = await p.evaluate(() => {
  const row = document.querySelector('.queue-job');
  return {
    there: Boolean(row),
    name: row?.querySelector('.job-name')?.innerText.trim() ?? '',
    left: row?.querySelector('.job-left')?.innerText.trim() ?? '',
    width: row?.querySelector('.job-bar > span')?.style.width ?? '',
    cancel: Boolean(row?.querySelector('button')),
  };
});
check('a job that has started shows on the bench, not in the list',
  benchRow.there && /^Growing /.test(benchRow.name), benchRow.name);
check('with a bar that has only just started',
  /^\d/.test(benchRow.width) && parseFloat(benchRow.width) < 20, benchRow.width);
check('and how long is left', /left$/.test(benchRow.left), benchRow.left);

const abandoned = await p.evaluate(() => {
  const paid = { ...hive.buildTime.now().paid };
  const before = Object.fromEntries(
    Object.keys(paid).map((n) => [n, hive.state.nutrients[n] || 0]),
  );
  document.querySelector('.queue-job button').click();
  return {
    paid,
    refunded: Object.entries(paid).every(
      ([n, amount]) => (hive.state.nutrients[n] || 0) >= before[n] + amount - 1e-6,
    ),
    bench: hive.buildTime.now(),
  };
});
check('abandoning it hands the mass back', abandoned.refunded, JSON.stringify(abandoned.paid));
check('and clears the bench', abandoned.bench === null);

await p.evaluate(() => {
  hive.queue.clear();
  hive.state.building = null;
  for (const n of Object.keys(hive.state.nutrients)) hive.state.nutrients[n] = 0;
});
await p.waitForTimeout(300);

// Distinct cards, because a levelled building may only have one upgrade left
// and clicking it twice would fill one slot rather than two. queueBuild clamps
// every press itself, so clicking past the point it fills is harmless.
const full = await p.evaluate(() => {
  for (const card of document.querySelectorAll('.action-card')) {
    if (hive.queue.room() <= 0) break;
    card.click();
  }
  return hive.queue.used();
});
await p.waitForTimeout(300);
const atCap = await p.evaluate(() => ({
  used: hive.queue.used(),
  disabled: [...document.querySelectorAll('.action-card')].every((b) => b.disabled),
  warned: document.querySelector('.queue-cap')?.classList.contains('warn'),
}));
check('a full queue disables every card',
  atCap.used === 3 && atCap.disabled, `${atCap.used} queued`);
check('and says so', atCap.warned === true);

await p.evaluate(() => document.querySelector('.queue-clear').click());
await p.waitForTimeout(300);
const cleared = await p.evaluate(() => ({
  used: hive.queue.used(),
  empty: Boolean(document.querySelector('.queue-empty')),
}));
check('clear empties it', cleared.used === 0 && cleared.empty);

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
