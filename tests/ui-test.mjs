import { chromium } from 'playwright';
import { BASE, LAUNCH, ensureLanded, openTab } from './harness.mjs';

/**
 * THE INTERFACE TELLS THE TRUTH, AND STAYS ON THE SCREEN.
 *
 * Three fixes that have nothing in common mechanically and everything in common
 * as bugs: in each one the game was right and the screen was wrong, so the
 * player had to decide whether to believe it.
 *
 *   — The draw chip showed "Delivered 685 kW" above "Ceiling 648 kW", which
 *     reads as broken arithmetic. It was not: the hive was spending 37 kW out
 *     of its reserve, and no row said so. Worse, the "ceiling" was generation
 *     wearing the name of a mechanic that was never wired up.
 *   — Tooltips opened downward always, so anything in the lower half of a tall
 *     sidebar opened a panel that ran off the bottom edge.
 *   — Research had no queue, so the player's job between techs was to come back
 *     and press a button at the right moment.
 */

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};

const browser = await chromium.launch(LAUNCH);
const errors = [];
// DELIBERATELY SHORT. The tooltip bug only exists when the window is not tall
// enough to hold the panel below its anchor, and at 1000px nothing clips.
const p = await browser.newPage({ viewport: { width: 1340, height: 560 } });
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
await p.waitForTimeout(250);
await p.evaluate(() => hive.loop.stop());

/* ===================== 1. a tooltip never opens off the bottom of the screen */

const tips = await p.evaluate(async () => {
  const rows = [...document.querySelectorAll('.res-row.tip')];
  const out = [];
  for (const el of rows) {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    // The measurer is synchronous, but the class has to land before layout is
    // read back.
    await new Promise((r) => { setTimeout(r, 10); });
    const body = el.querySelector(':scope > .tip-body');
    if (!body) continue;
    const r = body.getBoundingClientRect();
    out.push({
      name: el.innerText.split('\n')[0].slice(0, 18),
      flipped: el.classList.contains('tip-above'),
      // 2px of slack for sub-pixel layout.
      onScreen: r.bottom <= window.innerHeight + 2 && r.top >= -2,
      taller: r.height > window.innerHeight,
    });
  }
  return out;
});

check('there are rows to test', tips.length > 3, `${tips.length} rows`);
// A tooltip taller than the whole window fits nowhere; flipping it would only
// move which half is unreadable, so it is excluded rather than failed.
const fits = tips.filter((t) => !t.taller);
check('no tooltip opens off the edge of a short window',
  fits.every((t) => t.onScreen),
  fits.filter((t) => !t.onScreen).map((t) => t.name).join(', ') || `${fits.length} checked`);
check('and the ones near the bottom are the ones that flipped',
  tips.some((t) => t.flipped),
  `${tips.filter((t) => t.flipped).length} of ${tips.length} flipped`);

/* ============================ 2. the energy figures add up, and say so */

const energy = await p.evaluate(() => {
  const s = hive.state;
  s.tech = { glycolysis: true, lipolysis: true };
  s.structures.hivecore = 2;
  s.structures.metabolicGenerator = 2;
  s.structures.nodeCluster = 4;
  s.active = { ...s.structures };
  s.power = Object.fromEntries(Object.keys(s.structures).map((k) => [k, 1]));
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 4000;
  s.energyPool = 5e6; // a deep reserve, so spending outruns generation
  const d = hive.derived();
  return {
    demand: d.energy.demand,
    delivered: d.energy.delivered,
    generated: d.energy.generated,
    fromPool: d.energy.fromPool,
    hasFakeCeiling: 'throughput' in d.energy,
  };
});

check('delivered never exceeds demand', energy.delivered <= energy.demand + 1e-6,
  `${Math.round(energy.delivered)} vs ${Math.round(energy.demand)} W`);
check('fromPool is exactly the gap between delivered and generated',
  Math.abs(energy.fromPool - (energy.delivered - energy.generated)) < 1e-6,
  `${Math.round(energy.fromPool)} W out of the reserve`);
check('the figure that was mislabelled "Ceiling" is gone from derived',
  energy.hasFakeCeiling === false,
  'energy.throughput was generation wearing the name of an unwired mechanic');

const chip = await p.evaluate(() => {
  const el = [...document.querySelectorAll('.tip')].find((n) => /Draw/.test(n.innerText));
  return el?.innerText.replace(/\n/g, ' | ') ?? '';
});
check('the draw chip no longer claims a ceiling', !/Ceiling/i.test(chip), chip.slice(0, 90));

/* ========================================= 3. the research queue */

const rq = await p.evaluate(() => {
  const s = hive.state;
  s.tech = { glycolysis: true };
  s.insight = 0;
  s.researchQueue = [];
  const avail = hive.derived().unlocked.research;
  const added = avail.map((id) => hive.researchQueue.add(id));
  return {
    avail,
    added,
    list: hive.researchQueue.list(),
    // Uncapped: everything available goes in.
    all: hive.researchQueue.list().length === avail.length,
    // A tech whose prerequisites are unmet cannot be queued.
    lockedRefused: hive.researchQueue.add('ketogenesis') === false,
    dupeRefused: hive.researchQueue.add(avail[0]) === false,
  };
});
check('every available tech can be queued at once — no cap',
  rq.all, `${rq.list.length} of ${rq.avail.length}`);
check('a tech whose prerequisites are unmet is refused', rq.lockedRefused);
check('and so is a duplicate', rq.dupeRefused);

const drain = await p.evaluate(() => {
  const s = hive.state;
  const head = s.researchQueue[0];
  s.insight = 0;
  const idle = hive.researchQueue.advance();
  s.insight = 1e6;
  const bought = hive.researchQueue.advance();
  return { head, idle, bought, done: s.tech[head] === true, left: s.researchQueue.length };
});
check('a queue the hive cannot pay for buys nothing', drain.idle === 0);
check('and it buys the head the moment it can', drain.done === true, `${drain.head} researched`);
check('several in one pass, since finishing one can afford the next',
  drain.bought > 1, `${drain.bought} bought`);

const order = await p.evaluate(() => {
  const s = hive.state;
  s.tech = { glycolysis: true };
  s.insight = 0;
  s.researchQueue = [];
  const avail = hive.derived().unlocked.research.slice(0, 3);
  for (const id of avail) hive.researchQueue.add(id);
  const before = hive.researchQueue.list();
  hive.researchQueue.move(0, 1);
  const after = hive.researchQueue.list();
  hive.researchQueue.remove(0);
  return { before, after, left: hive.researchQueue.list(), cleared: hive.researchQueue.clear() };
});
check('the player can reorder the queue',
  order.before[0] === order.after[1] && order.before[1] === order.after[0],
  `${order.before.join(' → ')} became ${order.after.join(' → ')}`);
check("and take one off", order.left.length === 2, `${order.before.length} queued, ${order.left.length} left`);

const survives = await p.evaluate(() => {
  const s = hive.state;
  s.tech = { glycolysis: true };
  s.researchQueue = [];
  hive.researchQueue.add(hive.derived().unlocked.research[0]);
  hive.save();
  const key = Object.keys(localStorage).find((k) => /hive/i.test(k));
  const raw = JSON.parse(localStorage.getItem(key));
  return (raw?.state ?? raw)?.researchQueue ?? null;
});
check('the queue round-trips through a save',
  Array.isArray(survives) && survives.length === 1, JSON.stringify(survives));

/* ============================ 4. the "Out now" panel says one thing once */

await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 300, grassland: 150, farmland: 90 };
  s.droneTypes = { forager: 10, scavenger: 4 };
  s.assign = {};
  // The loop is stopped, so the patches have to be rolled by hand: a patch only
  // exists once advanceForage has created it, and until then there is nothing
  // for the panel to group.
  for (let i = 0; i < 20; i += 1) hive.tick(1);
});
await openTab(p, 'Territory');
await p.waitForTimeout(250);

const out = await p.evaluate(() => {
  // Panel heads are uppercased by the stylesheet, so innerText comes back
  // shouting. Matched case-insensitively rather than against the shout.
  const panel = [...document.querySelectorAll('.panel-box')]
    .find((n) => /^out now/i.test(n.innerText));
  const text = panel?.innerText ?? '';
  return {
    found: Boolean(panel),
    stats: panel ? [...panel.querySelectorAll('.land-stat-label')].map((n) => n.innerText) : [],
    // One group header per biome worked, each with a colour dot.
    groups: panel ? [...panel.querySelectorAll('.offer-head')].length : 0,
    dots: panel ? [...panel.querySelectorAll('.offer-head .terr-key-dot')].length : 0,
    // One crew line per (type × biome), each stating how hard that ground is
    // being leaned on. The efficiency belongs to the CREW, so it is said once
    // per crew and not once per find.
    crews: panel ? [...panel.querySelectorAll('.crew-line')].map((n) => n.innerText.trim()) : [],
    rows: panel ? [...panel.querySelectorAll('.field-row')].length : 0,
    saysOut: /drones out/i.test(text),
  };
});

check('the Out now panel is there', out.found);
check('it leads with the three figures as figures, not a sentence',
  out.stats.length === 3 && out.saysOut, out.stats.join(' / '));
check('the finds are grouped under the ground they are on',
  out.groups > 0 && out.dots === out.groups, `${out.groups} groups, ${out.dots} dots`);
check('each crew states its own room once, not once per find',
  out.crews.length > 0 && out.crews.every((c) => /% each/.test(c))
  && out.crews.length < out.rows,
  `${out.crews.length} crew lines across ${out.rows} rows`);
check('and a find is one row however many drones are on it',
  out.rows > 0 && /×\d+/.test(
    [...(out.crews || [])].join(' ') || 'x1',
  ), `${out.rows} rows`);

/* ===================== 5. assignment, and what a claim is worth */

await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 120 };
  s.droneTypes = { forager: 10, scavenger: 4 };
  s.assign = {};
  s.unclaimed = { grassland: 400 };
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e7;
  // The mix table only lists finds the hive could NAME — an unnamed one would
  // read "??? +1.2 g/s", which spoils that something is there without saying
  // anything useful. A fresh save has found nothing at all.
  const PINNED = hive.discovery.EXACT_AT + 15;
  s.found = {};
  for (const b of ['grassland', 'temperateForest']) {
    s.found[b] = Object.fromEntries(
      hive.poolFor('forager', b).map((e) => [e.itemId, PINNED]),
    );
  }
});
await p.waitForTimeout(250);

const assign = await p.evaluate(() => {
  const who = [...document.querySelectorAll('.panel-box')]
    .find((b) => /^who works what/i.test(b.innerText));
  const rows = [...(who?.querySelectorAll('.assign-row') ?? [])];
  // Set a target through the interface, which is the whole point of the panel.
  rows[0]?.querySelector('.assign-input')?.focus();
  return {
    found: Boolean(who),
    rows: rows.length,
    saysRoom: /Room for/.test(who?.innerText ?? ''),
    // Live occupancy beside the target, so the gap between plan and reality is
    // visible while the hive is still molding into it.
    now: [...(who?.querySelectorAll('.assign-now') ?? [])].map((n) => n.innerText),
  };
});
check('the assignment panel gives every type a row on every biome', assign.rows === 2,
  `${assign.rows} rows`);
check('and says how much room each has', assign.saysRoom);
check('with who is standing there right now beside the target',
  assign.now.length === 2 && assign.now.some((n) => Number(n) > 0), assign.now.join(' / '));

/*
 * A NUMBER FIELD YOU CAN ACTUALLY TYPE IN.
 *
 * Twice now: the Drones tab's molding target jittered, and the Territory tab's
 * assignment target sat at zero however much was typed into it. Same cause —
 * these tabs re-render ten times a second and Vue puts the bound value back
 * between keystrokes — and the same fix, now shared as `useDrafts`.
 *
 * Driven through the real keyboard rather than by dispatching events, because
 * the bug lives in the gap between what the DOM holds and what the render
 * binds, and a synthetic `input` event does not reproduce it.
 */
const row = async (n) => p.evaluate((i) => {
  const who = [...document.querySelectorAll('.panel-box')]
    .find((b) => /^who works what/i.test(b.innerText));
  const r = who.querySelectorAll('.assign-row')[0];
  r.querySelectorAll('.btn-mini')[i].click();
}, n);
const readField = () => p.evaluate(() => ({
  field: document.querySelector('.assign-input').value,
  state: hive.state.assign?.temperateForest?.forager ?? 0,
}));

await (await p.$('.assign-input')).click();
await p.keyboard.type('12', { delay: 60 });
await p.waitForTimeout(200);
const typed = await readField();
check('a two-digit target can be typed without the field resetting',
  typed.field === '12' && typed.state === 12, JSON.stringify(typed));

await p.keyboard.press('Tab');
await p.waitForTimeout(250);
const blurred = await readField();
check('and it survives losing focus', blurred.field === '12' && blurred.state === 12,
  JSON.stringify(blurred));

await row(1); await p.waitForTimeout(220);
const up = await readField();
await row(0); await p.waitForTimeout(220);
const down = await readField();
check('the stepper moves it by one in each direction, and the box follows',
  up.state === 13 && up.field === '13' && down.state === 12 && down.field === '12',
  `${typed.state} → ${up.state} → ${down.state}`);

await row(2); await p.waitForTimeout(220);
const filled = await readField();
check('fill sets it to what the ground carries, overriding what was typed',
  filled.state === 30 && filled.field === '30', `${filled.state} on 120 m² at 4 m² each`);



// Back to nobody assigned, so the claim preview below is not reading a hive
// that has just had thirty foragers pinned to one biome.
await p.evaluate(() => {
  const who = [...document.querySelectorAll('.panel-box')]
    .find((b) => /^who works what/i.test(b.innerText));
  who.querySelector('.focus-clear').click();
});
await p.waitForTimeout(220);
const clearedPlan = await p.evaluate(() => ({
  field: document.querySelector('.assign-input').value,
  state: hive.state.assign?.temperateForest?.forager ?? 0,
}));
check('and clear empties both the plan and the box',
  clearedPlan.state === 0 && clearedPlan.field === '', JSON.stringify(clearedPlan));

await p.click('.terr-tile.is-unclaimed');
await p.waitForTimeout(300);

const claim = await p.evaluate(() => {
  const box = document.querySelector('.claim-box');
  const text = box?.innerText ?? '';
  return {
    open: Boolean(box),
    worth: /What this would do/i.test(text),
    // The headline is a count of whole drones per type, which is the thing
    // being bought now that room is per biome.
    perType: /Forager/.test(text) && /Scavenger/.test(text),
    room: /m² each/.test(text),
    mix: /What comes in instead/i.test(text),
  };
});
check('clicking unclaimed ground opens the claim dialog', claim.open);
check('which says what the ground would do, not just what it costs', claim.worth);
check('counting whole drones of each type it would carry',
  claim.perType && claim.room);
check('and showing how the mix of finds would shift', claim.mix);

const threshold = await p.evaluate(() => {
  // A sliver: too small for a scavenger, fine for a forager. The threshold is
  // the sentence this dialog exists to say.
  const input = document.querySelector('.claim-input');
  input.value = '6';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return null;
});
void threshold;
await p.waitForTimeout(300);
const short = await p.evaluate(() => {
  const text = document.querySelector('.claim-box')?.innerText ?? '';
  return { shortBy: /short of the\s+first one/i.test(text), text: text.slice(0, 200) };
});
check('a claim too small for a type says how far short it is',
  short.shortBy, short.text.replace(/\n/g, ' | ').slice(0, 130));

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
