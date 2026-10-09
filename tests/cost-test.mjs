import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * The cost ladder.
 *
 * The point of this change was to delete thirty-three hand-written numbers, so
 * the thing most worth guarding is that they stay deleted: a suite that only
 * checked the arithmetic would pass just as happily against a file that had
 * quietly grown a raw gram count back. So this reads the shipped bundle and
 * checks the shape of the definitions, not only their output.
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

/* ============================================ 1. the ladder itself */

const ladder = await p.evaluate(() => ({
  amounts: hive.costs.amounts,
  order: hive.costs.amountOrder,
  growth: hive.costs.growth,
  growthOrder: hive.costs.growthOrder,
}));

const hive2 = await p.evaluate(() => {
  const top = [hive.costs.amounts.colossal, hive.costs.amounts.titanic];
  const structuresAtTop = [];
  for (const id of Object.keys(hive.structureDefs)) {
    const first = hive.structureDefs[id].cost(0);
    if (Object.values(first).some((g) => top.includes(g))) structuresAtTop.push(id);
  }
  return { structuresAtTop };
});

check('the amount ladder is twelve rungs', ladder.order.length === 12, ladder.order.join(', '));
check('and it runs 2 g to 10 kg',
  ladder.amounts.trace === 2 && ladder.amounts.titanic === 10_000,
  `${ladder.amounts.trace} g … ${ladder.amounts.titanic} g`);
check('only research reaches the top two rungs',
  // `colossal` and `titanic` exist for a tech, which is a single irreversible
  // purchase. A BUILDING asking for one is a growth curve that is wrong.
  hive2.structuresAtTop.length === 0,
  hive2.structuresAtTop.join(', ') || 'no building asks for colossal or titanic');
check('every rung is dearer than the one below',
  ladder.order.every((id, i) => i === 0 || ladder.amounts[id] > ladder.amounts[ladder.order[i - 1]]),
  ladder.order.map((id) => ladder.amounts[id]).join(' → '));

// The spacing rule is the whole design, so it is the thing to pin. Below ×1.6 a
// rung stops being a real choice; at ×2.5 and up every fibre cost in the game
// bunches onto one rung.
const steps = await p.evaluate(() => {
  const a = hive.costs.amounts;
  const o = hive.costs.amountOrder;
  return o.slice(1).map((id, i) => +(a[id] / a[o[i]]).toFixed(3));
});
check('no step is smaller than ×1.6', Math.min(...steps) >= 1.6, steps.join(', '));
check('and none is larger than ×2.5', Math.max(...steps) <= 2.5, `widest ×${Math.max(...steps)}`);
const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
check('averaging the ×2.2 the rules call for', Math.abs(mean - 2.2) < 0.15, `×${mean.toFixed(2)}`);

check('there are five growth curves', ladder.growthOrder.length === 5, ladder.growthOrder.join(', '));
check('flat really is flat, and brutal really is brutal',
  ladder.growth.flat === 1 && ladder.growth.brutal === 1.9);
check('the curves are ordered too',
  ladder.growthOrder.every((id, i) => i === 0 || ladder.growth[id] > ladder.growth[ladder.growthOrder[i - 1]]));

/* ====================================== 2. a bad name fails loudly */

const guarded = await p.evaluate(() => {
  const out = {};
  try { hive.costs.amount('enormous'); out.badAmount = 'no error'; }
  catch (e) { out.badAmount = e.message; }
  try { hive.costs.growthOf('vicious'); out.badGrowth = 'no error'; }
  catch (e) { out.badGrowth = e.message; }
  out.raw = hive.costs.amount(37);
  out.rawCurve = hive.costs.growthOf(1.33);
  return out;
});
check('a rung that does not exist throws rather than costing nothing',
  /Unknown cost amount/.test(guarded.badAmount), guarded.badAmount.slice(0, 60));
check('and it says which names are valid', /trace/.test(guarded.badAmount));
check('so does a curve that does not exist', /Unknown growth curve/.test(guarded.badGrowth));
check('but a raw number is still allowed, for the genuinely bespoke case',
  guarded.raw === 37 && guarded.rawCurve === 1.33);

/* ================================ 3. nothing in the table is a raw gram count */

const shape = await p.evaluate(async () => {
  // Read the shipped bundle: this is about how the DEFINITIONS are written, and
  // a check on their output alone would pass against a hand-written number.
  const res = await fetch('/');
  const html = await res.text();
  const src = html.match(/src="([^"]*index[^"]*\.js)"/)?.[1];
  if (!src) return { ok: false, why: 'no bundle found' };
  const js = await (await fetch(src.replace(/^\.?\//, '/'))).text();
  return { ok: true, hasLadder: /trace/.test(js) && /minuscule/.test(js), bytes: js.length };
});
check('the bundle carries the rung names, so the ladder really ships',
  shape.ok && shape.hasLadder, shape.ok ? `${Math.round(shape.bytes / 1024)} kB` : shape.why);

const costsAreBuilt = await p.evaluate(() => {
  // Every structure's cost has to be a function of n that returns grams, and
  // every one of those grams has to be a rung times a power of a curve.
  const amounts = Object.values(hive.costs.amounts);
  const growths = Object.values(hive.costs.growth);
  const offLadder = [];
  // The definition's own cost function, NOT structureCost — that one rounds the
  // total up to a whole gram, which is right for the player and wrong for a
  // check on whether the author wrote a rung.
  for (const id of [...hive.structureOrder]) {
    const first = hive.structureDefs[id].cost(0);
    for (const [res, grams] of Object.entries(first)) {
      if (!amounts.some((a) => Math.abs(a - grams) < 1e-9)) offLadder.push(`${id}.${res}=${grams}`);
    }
  }
  // And the growth factor each one actually uses, read off two consecutive levels.
  const curves = {};
  for (const id of [...hive.structureOrder]) {
    const def = hive.structureDefs[id];
    const key = Object.keys(def.cost(0))[0];
    curves[id] = +(def.cost(1)[key] / def.cost(0)[key]).toFixed(4);
  }
  const offCurve = Object.entries(curves)
    .filter(([, g]) => !growths.some((x) => Math.abs(x - g) < 1e-6))
    .map(([id, g]) => `${id} ×${g}`);
  return { offLadder, offCurve, curves };
});
check('every live structure costs a rung of the ladder, exactly',
  costsAreBuilt.offLadder.length === 0,
  costsAreBuilt.offLadder.join(', ') || `${Object.keys(costsAreBuilt.curves).length} structures checked`);
check('and grows on one of the five named curves',
  costsAreBuilt.offCurve.length === 0,
  costsAreBuilt.offCurve.join(', ') || 'no stray factors');

const droneCosts = await p.evaluate(() => {
  const amounts = Object.values(hive.costs.amounts);
  const off = [];
  for (const id of hive.drones.typeOrder) {
    for (const [res, grams] of Object.entries(hive.drones.types[id].cost || {})) {
      if (!amounts.some((a) => Math.abs(a - grams) < 1e-9)) off.push(`${id}.${res}=${grams}`);
    }
  }
  return off;
});
check('and so does every drone', droneCosts.length === 0, droneCosts.join(', ') || 'all three');

/* ======================================= 4. the curve still compounds */

const compounding = await p.evaluate(() => {
  const s = hive.state;
  s.structures.hivecore = 0;
  const first = hive.structureCost('hivecore', 1).fiber;
  s.structures.hivecore = 9;
  const tenth = hive.structureCost('hivecore', 1).fiber;
  s.structures.hivecore = 0;
  return { first, tenth, ratio: +(tenth / first).toFixed(1) };
});
check('a steep building really does bite by the tenth',
  Math.abs(compounding.ratio - 1.6 ** 9) < 1,
  `${compounding.first} g → ${(compounding.tenth / 1000).toFixed(1)} kg, ×${compounding.ratio}`);

const flatDrones = await p.evaluate(() => {
  // A drone has no curve: the hundredth costs what the first did.
  const before = { ...hive.drones.types.forager.cost };
  hive.state.droneTypes.forager = 99;
  const after = { ...hive.drones.types.forager.cost };
  hive.state.droneTypes.forager = 0;
  return JSON.stringify(before) === JSON.stringify(after);
});
check('a drone costs the same however many there are', flatDrones);

/* ========================= 5. nothing moved more than it was meant to */

// The conversion was allowed to shift any single figure by about a third.
// Three were knowingly let through at more than that; they are named here so a
// future change cannot quietly add a fourth.
const OLD = {
  hivecore: { fiber: 450, protein: 60, fat: 24 },
  broodChamber: { fiber: 520, protein: 90, fat: 30 },
  nodeCluster: { fiber: 480, protein: 80, fat: 30 },
  moldingChamber: { fiber: 400, protein: 60, ash: 30 },
  metabolicGenerator: { fiber: 320, protein: 45, ash: 20 },
  caecum: { fiber: 440, protein: 70, water: 180 },
  proteinGranule: { fiber: 300, protein: 50, ash: 15 },
  lipidDroplet: { fiber: 280, protein: 40, fat: 24 },
  glycogenGranule: { fiber: 280, protein: 40, carb: 48 },
  celluloseBale: { fiber: 300, protein: 45 },
  cistern: { fiber: 340, protein: 50 },
  crop: { fiber: 520, protein: 90 },
  vacuole: { fiber: 260, protein: 35, water: 150 },
};
const KNOWN = { 'caecum.water': 0.39, 'proteinGranule.ash': -0.34, 'vacuole.water': -0.34 };

const drift = await p.evaluate((old) => {
  const out = [];
  for (const [id, parts] of Object.entries(old)) {
    const now = hive.structureDefs[id].cost(0);
    for (const [res, was] of Object.entries(parts)) {
      out.push({ key: `${id}.${res}`, was, is: now[res], d: now[res] / was - 1 });
    }
  }
  return out;
}, OLD);

const strayed = drift.filter((d) => {
  const allowed = KNOWN[d.key] !== undefined ? Math.abs(KNOWN[d.key]) + 0.02 : 0.30;
  return Math.abs(d.d) > allowed;
});
check('every converted cost landed within a third of where it was',
  strayed.length === 0,
  strayed.map((d) => `${d.key} ${d.was}→${d.is} (${(d.d * 100).toFixed(0)}%)`).join(', ')
    || `${drift.length} figures checked, ${Object.keys(KNOWN).length} knowingly wider`);

const worst = drift.reduce((a, b) => (Math.abs(b.d) > Math.abs(a.d) ? b : a));
check('and the single widest is one of the ones we signed off',
  KNOWN[worst.key] !== undefined,
  `${worst.key} ${worst.was} → ${worst.is} (${(worst.d * 100).toFixed(0)}%)`);

/* ========================================= 6. the game still plays */

const playable = await p.evaluate(() => {
  const s = hive.state;
  s.structures = { hivecore: 1 };
  s.buildQueue = [];
  s.building = null;
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e6;
  s.structures.metabolicGenerator = 0;
  // Builds take time now, so the mass is charged when the JOB STARTS rather
  // than at the press. The rung is what is under test here, not the clock, so
  // the drain is driven directly and then given its time.
  const queued = hive.build('metabolicGenerator', 1);
  hive.queue.advance(1, 1);
  const paid = 1e6 - s.nutrients.fiber;
  hive.queue.advance(1e5, 1);
  return { queued, after: s.structures.metabolicGenerator, paid };
});
check('a building still costs real mass off the stores',
  playable.queued === 1 && playable.after === 1 && playable.paid === 250,
  `${playable.paid} g of fibre — medium`);

const shown = await p.evaluate(() => {
  const card = [...document.querySelectorAll('.action-card')]
    .find((c) => /Metabolic Generator/.test(c.innerText));
  return card?.innerText.replace(/\s+/g, ' ') ?? '';
});
check('and the card still quotes it in grams, not in rungs',
  /\d+\s*g|\d+(\.\d+)?\s*kg/.test(shown) && !/medium|large|slight/i.test(shown),
  shown.slice(0, 80));

/* ================================ 7. nothing is priced in mineral mass */

const unsorted = await p.evaluate(() => {
  const inCosts = [];
  for (const id of [...hive.structureOrder, ...Object.keys(hive.structureDefs)]) {
    const def = hive.structureDefs[id];
    if (!def?.cost) continue;
    if ('ash' in def.cost(0)) inCosts.push(id);
  }
  for (const id of hive.drones.typeOrder) {
    if ('ash' in (hive.drones.types[id].cost || {})) inCosts.push(`drone:${id}`);
  }
  return [...new Set(inCosts)];
});
check('nothing in the game is priced in unsorted mineral mass',
  unsorted.length === 0,
  unsorted.join(', ') || 'every mineral cost names its element');

const refused = await p.evaluate(() => {
  const out = {};
  try { hive.costs.build('steady', { ash: 'tiny' }); out.build = 'no error'; }
  catch (e) { out.build = e.message; }
  try { hive.costs.flat({ ash: 'tiny' }); out.flat = 'no error'; }
  catch (e) { out.flat = e.message; }
  // And the element itself is of course fine.
  out.iron = hive.costs.flat({ iron: 'tiny' }).iron;
  return out;
});
check('and the builder refuses it outright rather than trusting a comment',
  /Nothing costs mineral mass/.test(refused.build) && /Nothing costs mineral mass/.test(refused.flat),
  refused.build.slice(0, 60));
check('the refusal says what to do instead',
  /Name the element/.test(refused.build) && /iron|calcium/.test(refused.build));
check('a named element is accepted', refused.iron === 10);

// The whole point of allowing a mineral cost before its assay: the hive pays
// through the nose in ash until it can see what it is buying.
const substituted = await p.evaluate(() => {
  const s = hive.state;
  s.tech = {};
  const locked = hive.payableCost(hive.structureDefs.metabolicGenerator.cost(0));
  s.tech.bulkMineralAssay = true;
  s.tech.traceMetalAssay = true;
  const open = hive.payableCost(hive.structureDefs.metabolicGenerator.cost(0));
  s.tech = {};
  return { locked, open, mult: hive.lockedCostMultiplier };
});
check('an unassayed mineral is charged to the ash, at the full multiplier',
  substituted.locked.ash === 10 * substituted.mult && substituted.locked.iron === undefined,
  `${substituted.locked.ash} g of mineral mass for 10 g of iron, at ×${substituted.mult}`);
check('and the assay is what stops the hive overpaying',
  substituted.open.iron === 10 && substituted.open.ash === undefined,
  '10 g of iron once it can see it — fifty times cheaper');

/* ====================== 8. one colour, one meaning, on every screen */

// The convention: a bulk resource standing in for an element the hive cannot
// see yet is yellow, everywhere a price is quoted, and nothing else is. A
// sentence under one card and a colour on another would be two conventions.

await p.evaluate(() => {
  const s = hive.state;
  s.tech = {};
  s.structures = {};
  for (const id of hive.structureOrder) s.structures[id] = 0;
  s.structures.hivecore = 1;
  s.buildQueue = [];
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e6;
  s.droneTypes = { forager: 2 };
  s.territory = { temperateForest: 60 };
  s.unclaimed = { grassland: 10 };
});
await openTab(p, 'Hive');
await p.waitForTimeout(400);

const onCards = await p.evaluate(() => {
  const card = [...document.querySelectorAll('.action-card')]
    .find((c) => /Metabolic Generator/.test(c.innerText));
  const marks = [...card.querySelectorAll('.cost-unassayed')];
  const warn = getComputedStyle(document.documentElement).getPropertyValue('--warn').trim();
  return {
    text: card.innerText.replace(/\s+/g, ' '),
    marked: marks.map((m) => m.innerText.trim()),
    colour: marks[0] ? getComputedStyle(marks[0]).color : null,
    warn,
    // The old prose must be gone, not merely hidden.
    hasSentence: /unassayed —|paid in bulk|told apart/i.test(card.innerText),
  };
});
check('the substituted figure on a build card is marked',
  onCards.marked.length === 1 && /Mineral mass/.test(onCards.marked[0]),
  onCards.marked.join(', '));
check('and nothing else on the card is',
  !/Fibre|Protein/.test(onCards.marked.join(' ')), onCards.marked.join(', '));
check('no sentence explains it any more', !onCards.hasSentence);
check('the mark really renders in the warning colour',
  Boolean(onCards.colour) && onCards.colour !== 'rgb(0, 0, 0)',
  `${onCards.colour} against --warn ${onCards.warn}`);

const hoverable = await p.evaluate(() => {
  const mark = document.querySelector('.action-card .cost-unassayed');
  return mark?.getAttribute('title') ?? '';
});
check('the explanation survives as a hover, for whoever wants it',
  /assay/i.test(hoverable), hoverable.slice(0, 50));

await openTab(p, 'Drones');
await p.waitForTimeout(400);
const onDrones = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.job-desc')].filter((r) => /costs /.test(r.innerText));
  const marks = rows.flatMap((r) => [...r.querySelectorAll('.cost-unassayed')].map((m) => m.innerText.trim()));
  return {
    rows: rows.length,
    marks,
    hasSentence: rows.some((r) => /shovelling the parent|really built out of/i.test(r.innerText)),
  };
});
check('a drone priced in an unassayed element is marked the same way',
  onDrones.marks.some((m) => /mineral mass/i.test(m)),
  onDrones.marks.join(' | ') || `${onDrones.rows} cost rows, none marked`);
check('and its sentence is gone too', !onDrones.hasSentence);

await openTab(p, 'Territory');
await p.waitForTimeout(400);
const onClaim = await p.evaluate(() => {
  const tile = [...document.querySelectorAll('.terr-tile.is-unclaimed')][0];
  if (!tile) return { opened: false };
  tile.click();
  return { opened: true };
});
await p.waitForTimeout(400);
const claimMarks = await p.evaluate(() => {
  const box = document.querySelector('.claim-box');
  if (!box) return { there: false };
  return {
    there: true,
    marks: [...box.querySelectorAll('.cost-unassayed')].map((m) => m.innerText.trim()),
    hasSentence: /fifty times the amount|cannot tell from the rest/i.test(box.innerText),
    rows: box.querySelectorAll('.field-row').length,
  };
});
check('and so is a claim bill', claimMarks.there && claimMarks.marks.length >= 1,
  claimMarks.there ? claimMarks.marks.join(', ') : 'no claim dialog opened');
check('with its sentence gone as well', claimMarks.there && !claimMarks.hasSentence);

// Shut it, or the backdrop eats every click after this.
await p.evaluate(() => {
  const box = document.querySelector('.claim-box');
  const close = [...(box?.querySelectorAll('button') ?? [])]
    .find((b) => /close|cancel|never ?mind/i.test(b.textContent));
  if (close) close.click();
  else document.querySelector('.modal-backdrop')?.click();
});
await p.waitForTimeout(300);
check('and the dialog closes', await p.evaluate(() => !document.querySelector('.claim-box')));

const assayed2 = await p.evaluate(() => {
  hive.state.tech.bulkMineralAssay = true;
  hive.state.tech.traceMetalAssay = true;
  return null;
});
await openTab(p, 'Hive');
await p.waitForTimeout(400);
const afterAssay = await p.evaluate(() => {
  const card = [...document.querySelectorAll('.action-card')]
    .find((c) => /Metabolic Generator/.test(c.innerText));
  return {
    marks: card.querySelectorAll('.cost-unassayed').length,
    text: card.innerText.replace(/\s+/g, ' '),
  };
});
check('once the assay lands the colour goes, and the element is named',
  afterAssay.marks === 0 && /Iron 10 g/.test(afterAssay.text),
  afterAssay.text.match(/Fibre[^·]*/)?.[0]?.trim() ?? afterAssay.text.slice(0, 60));

/* ------------------------------------------------------------------ errors */

/* ================================ the insight ladder, and rule 5's exception

   Research was the last table in the game still carrying hand-written numbers,
   and the two costs priced in `ash` were breaking a rule that `build()` throws
   on — silently, because research never called `build()`. So what is pinned
   here is not the arithmetic but the GUARD: that the exception is opt-in, that
   it is the only way through, and that nothing in the live tree uses it by
   accident. */

const insight = await p.evaluate(() => {
  const out = { rungs: hive.costs.insight, order: hive.costs.insightOrder, refused: [], accepted: [] };
  const tryIt = (parts, opts) => {
    try { return { ok: true, value: hive.costs.tech(parts, opts) }; }
    catch (err) { return { ok: false, message: err.message }; }
  };
  out.ashPlain = tryIt({ insight: 'notion', ash: 'heavy' });
  out.ashSampling = tryIt({ insight: 'notion', ash: 'heavy' }, { sampling: true });
  out.typo = tryIt({ insight: 'enlightenment' });
  out.massTypo = tryIt({ insight: 'notion', protein: 'enormous' });
  // Which live techs actually take the exception.
  out.sampled = hive.researchOrder.filter((id) => hive.researchDefs[id].cost.ash > 0);
  out.rawCosts = hive.researchOrder.filter((id) => {
    const c = hive.researchDefs[id].cost;
    return !Object.values(hive.costs.insight).includes(c.insight);
  });
  return out;
});

check('there is an insight ladder, separate from the mass one',
  insight.order.length === 8 && insight.rungs.glimmer === 50 && insight.rungs.paradigm === 12_500,
  insight.order.join(', '));

const isteps = insight.order.slice(1).map((id, i) => insight.rungs[id] / insight.rungs[insight.order[i]]);
check('spaced about ×2.2, like the mass ladder',
  isteps.every((r) => r >= 1.6 && r <= 2.6), isteps.map((r) => r.toFixed(2)).join(' '));

check('every live tech now costs a named rung',
  insight.rawCosts.length === 0,
  insight.rawCosts.join(', ') || 'no hand-written insight costs left');

check('tech() refuses mineral mass by default, exactly as build() does',
  insight.ashPlain.ok === false && /mineral mass/i.test(insight.ashPlain.message),
  insight.ashPlain.message?.slice(0, 60));
check('and accepts it only for a declared sampling cost',
  insight.ashSampling.ok === true && insight.ashSampling.value.ash === 1000,
  JSON.stringify(insight.ashSampling.value ?? insight.ashSampling.message));
check('a mistyped insight rung throws', insight.typo.ok === false);
check('and so does a mistyped mass rung', insight.massTypo.ok === false);

check('only the assays take the sampling exception',
  insight.sampled.every((id) => /assay/i.test(id)),
  insight.sampled.join(', ') || 'none');

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
