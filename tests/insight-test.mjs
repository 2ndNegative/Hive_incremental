import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * Thinking: the two buildings that do it, and what the hive does with bandwidth
 * it is not using.
 *
 * The third item is the interesting one. Cognition used to be a ceiling and
 * nothing else, so the correct play was always to fill every cogit with drones
 * and a Nerve Node was a drone slot wearing a hat. Making the slack think turns
 * that into a real choice, and the thing worth testing hardest is that it is a
 * choice rather than a trap — that it never goes backwards, never compounds a
 * hive that is already over budget, and is visible enough that a player can see
 * why their numbers moved when they molded a drone.
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
  await page.waitForTimeout(250);
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

/** A quiet hive: one Hivecore, nothing else, no drones, fully paid. */
async function fixture() {
  return p.evaluate(() => {
    const s = hive.state;
    s.structures = {};
    for (const id of hive.structureOrder) s.structures[id] = 0;
    s.structures.hivecore = 1;
    s.structures.metabolicGenerator = 4; // plenty of power, so nothing browns out
    s.active = {};
    s.power = {};
    s.buildQueue = [];
    s.droneTypes = {};
    s.castes = {};
    s.drones = 0;
    s.larvae = 0;
    s.insight = 0;
    s.tech = {};
    for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e6;
    hive.tick(0.5);
    return null;
  });
}

/* ============================================ 1. the two buildings */

const defs = await p.evaluate(() => {
  const bank = hive.structureDefs.memoryBank;
  const talk = hive.structureDefs.interlocutor;
  return {
    bank: bank && {
      category: bank.category, cap: bank.insightCap, watts: bank.upkeepWatts, cost: bank.cost(0),
    },
    talk: talk && {
      category: talk.category, insight: talk.insight, watts: talk.upkeepWatts, cost: talk.cost(0),
    },
    inOrder: ['memoryBank', 'interlocutor'].every((id) => hive.structureOrder.includes(id)),
  };
});
check('there is a Memory Bank, in the cognition band',
  Boolean(defs.bank) && defs.bank.category === 'cognition' && defs.inOrder);
check('it adds 400 insight storage and draws 50 kW',
  defs.bank.cap === 400 && defs.bank.watts === 50_000,
  `+${defs.bank.cap} at ${defs.bank.watts / 1000} kW`);
check('for medium fibre and tiny potassium',
  defs.bank.cost.fiber === 250 && defs.bank.cost.potassium === 10,
  JSON.stringify(defs.bank.cost));

check('there is an Interlocutor, in the cognition band',
  Boolean(defs.talk) && defs.talk.category === 'cognition');
check('it makes 0.2 insight a second and draws 100 kW',
  defs.talk.insight === 0.2 && defs.talk.watts === 100_000,
  `${defs.talk.insight}/s at ${defs.talk.watts / 1000} kW`);
check('for modest fibre, medium protein and slight potassium',
  defs.talk.cost.fiber === 100 && defs.talk.cost.protein === 250
    && defs.talk.cost.potassium === 25,
  JSON.stringify(defs.talk.cost));

/* ====================================== 2. they actually do their jobs */

await fixture();
const working = await p.evaluate(() => {
  const s = hive.state;
  const bare = hive.derived();
  s.structures.memoryBank = 1;
  const banked = hive.derived();
  s.structures.interlocutor = 1;
  const talking = hive.derived();
  return {
    capBefore: bare.insightCapBase,
    capAfter: banked.insightCapBase,
    rateBefore: banked.insightRateBase,
    rateAfter: talking.insightRateBase,
  };
});
check('a Memory Bank raises the ceiling by exactly its 400',
  working.capAfter - working.capBefore === 400,
  `${working.capBefore} → ${working.capAfter}`);
check('an Interlocutor adds exactly its 0.2/s',
  Math.abs((working.rateAfter - working.rateBefore) - 0.2) < 1e-9,
  `${working.rateBefore.toFixed(2)} → ${working.rateAfter.toFixed(2)}/s`);

const banked = await p.evaluate(() => {
  const s = hive.state;
  s.insight = 0;
  for (let i = 0; i < 10; i += 1) hive.tick(1);
  return { insight: +s.insight.toFixed(2), rate: +hive.derived().insightRate.toFixed(3) };
});
check('and the insight actually arrives in the store',
  banked.insight > 0 && Math.abs(banked.insight - banked.rate * 10) < banked.rate,
  `${banked.insight} after ten seconds at ${banked.rate}/s`);

const browned = await p.evaluate(() => {
  const s = hive.state;
  const full = hive.derived().insightRateBase;
  s.power.interlocutor = 0.5;
  const half = hive.derived().insightRateBase;
  s.power.interlocutor = 1;
  return { full, half };
});
check('a half-powered Interlocutor argues at half speed',
  Math.abs(browned.half - browned.full / 2) < 1e-9,
  `${browned.full.toFixed(2)}/s → ${browned.half.toFixed(2)}/s`);

/* ======================================= 3. the cogit focus curve */

const curve = await p.evaluate(() => {
  const at = (free) => +hive.cogitFocusFrom(free).toFixed(3);
  return {
    scale: hive.cogitFocusScale,
    zero: at(0), five: at(5), twenty: at(20), fortyFive: at(45), negative: at(-10),
  };
});
check('no spare bandwidth is no bonus, not a penalty', curve.zero === 1);
check('and the curve is the same square root a full brood gives the chambers',
  curve.five === 2 && curve.twenty === 3 && curve.fortyFive === 4,
  `5 → ×${curve.five} · 20 → ×${curve.twenty} · 45 → ×${curve.fortyFive}`);
check('being over budget cannot push it below one',
  curve.negative === 1,
  'a hive that has overcommitted is already punished; forgetting things too is a hole with no bottom');

/* ============================ 4. it applies to BOTH storage and generation */

await fixture();
const applied = await p.evaluate(() => {
  const s = hive.state;
  s.structures.memoryBank = 1;
  s.structures.interlocutor = 1;
  s.structures.nodeCluster = 4; // 20 more cogits of room
  hive.tick(0.5);

  const read = () => {
    const d = hive.derived();
    return {
      free: d.cognition.free,
      focus: +d.cogitFocus.toFixed(3),
      cap: Math.round(d.insightCap),
      capBase: Math.round(d.insightCapBase),
      rate: +d.insightRate.toFixed(3),
      rateBase: +d.insightRateBase.toFixed(3),
    };
  };
  const idle = read();
  // Fill the bandwidth with drones and watch the thinking stop.
  s.droneTypes = { forager: idle.free };
  hive.tick(0.5);
  const busy = read();
  return { idle, busy };
});
check('an idle hive thinks with the bandwidth it is not using',
  applied.idle.focus > 1 && applied.idle.free > 0,
  `${applied.idle.free} spare cogits → ×${applied.idle.focus}`);
check('the ceiling is multiplied by it',
  applied.idle.cap === Math.round(applied.idle.capBase * applied.idle.focus),
  `${applied.idle.capBase} → ${applied.idle.cap}`);
// Compared loosely on purpose: every figure here is rounded for reading, so an
// exact equality would be testing the rounding rather than the rule.
check('and so is the rate — both, as asked',
  Math.abs(applied.idle.rate - applied.idle.rateBase * applied.idle.focus) < 0.002,
  `${applied.idle.rateBase}/s → ${applied.idle.rate}/s at ×${applied.idle.focus}`);
check('filling every cogit with drones stops the bonus dead',
  applied.busy.free === 0 && applied.busy.focus === 1,
  `${applied.busy.free} spare → ×${applied.busy.focus}`);
check('which is the choice: forty drones and no thinking, or twenty and twice the thinking',
  applied.busy.rate < applied.idle.rate && applied.busy.cap < applied.idle.cap,
  `${applied.idle.rate}/s idle against ${applied.busy.rate}/s busy`);

const clamped = await p.evaluate(() => {
  // The clamp in tick() has to use the SAME ceiling the panel shows, or insight
  // quietly stops at a number nothing on screen mentions.
  const s = hive.state;
  s.droneTypes = {};
  hive.tick(0.5);
  const cap = hive.derived().insightCap;
  s.insight = cap * 2;
  hive.tick(1);
  return { cap: Math.round(cap), held: Math.round(s.insight) };
});
check('and the store is clamped to the figure the panel quotes',
  clamped.held === clamped.cap, `${clamped.held} against a quoted ${clamped.cap}`);

/* ===================================== 5. a Nerve Node is worth something empty */

const emptyNode = await p.evaluate(() => {
  const s = hive.state;
  s.structures.nodeCluster = 0;
  s.droneTypes = {};
  hive.tick(0.5);
  const before = hive.derived();
  s.structures.nodeCluster = 1;
  hive.tick(0.5);
  const after = hive.derived();
  return {
    rateBefore: +before.insightRate.toFixed(3),
    rateAfter: +after.insightRate.toFixed(3),
    capBefore: Math.round(before.insightCap),
    capAfter: Math.round(after.insightCap),
  };
});
check('a Nerve Node with no drone in it is no longer a wasted building',
  emptyNode.rateAfter > emptyNode.rateBefore && emptyNode.capAfter > emptyNode.capBefore,
  `${emptyNode.rateBefore}/s → ${emptyNode.rateAfter}/s, ceiling ${emptyNode.capBefore} → ${emptyNode.capAfter}`);

/* ========================================= 6. it is visible */

await openTab(p, 'Hive');
await p.waitForTimeout(400);
const cards = await p.evaluate(() => {
  const find = (name) => [...document.querySelectorAll('.action-card')]
    .find((c) => c.innerText.startsWith(name))?.innerText.replace(/\s+/g, ' ') ?? '';
  return { bank: find('Memory Bank'), talk: find('Interlocutor') };
});
check('the Memory Bank card says what it holds',
  /\+400 insight storage/.test(cards.bank), cards.bank.slice(0, 90));
check('and the Interlocutor card says what it makes',
  /\+0\.2\/s insight/.test(cards.talk), cards.talk.slice(0, 90));

// A real hover: the tooltip opens on CSS :hover, which a synthetic mouseover
// event does not trigger.
const insightCell = await p.evaluate(() =>
  [...document.querySelectorAll('.topbar-resources .tip')]
    .findIndex((c) => /Insight/.test(c.innerText)));
await p.locator('.topbar-resources .tip').nth(insightCell).hover();
await p.waitForTimeout(350);
const chip = await p.evaluate(() => {
  const body = [...document.querySelectorAll('.topbar-resources .tip')]
    .find((c) => /Insight/.test(c.innerText))?.querySelector('.tip-body');
  return {
    text: body?.innerText.replace(/\s+/g, ' ') ?? '',
    visible: body ? getComputedStyle(body).visibility !== 'hidden' : false,
  };
});
check('and the top bar explains why the ceiling moved',
  chip.visible && /Spare bandwidth/.test(chip.text) && /×\d/.test(chip.text),
  chip.text.slice(chip.text.indexOf('Spare'), chip.text.indexOf('Spare') + 70)
    || chip.text.slice(0, 70));

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
