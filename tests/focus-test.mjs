import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * Telling a route what to look for.
 *
 * The claim being tested is a bracket, not a number: a star has to beat
 * "discard every trip that came back wrong" — which would leave the item at its
 * natural abundance and waste everything else — while staying visibly short of
 * "every trip brings this". Everything else here is about the cost of breadth
 * and about the gate, which is what stops focus being an opening move.
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

/** A hive holding one forest, with that ground fully mapped. */
async function fixture() {
  return p.evaluate(() => {
    const s = hive.state;
    s.territory = { temperateForest: 36 };
    s.unclaimed = {};
    s.focus = {};
    s.found = { temperateForest: {} };
    // Pin down everything the forest offers a forager, so the gate is open.
    // Off the real threshold, not a number: EXACT_AT moved by an order of
    // magnitude when a roll became a drone rather than a patch.
    for (const e of hive.poolFor('forager', 'temperateForest')) {
      s.found.temperateForest[e.itemId] = hive.discovery.EXACT_AT + 15;
    }
    const pool = hive.poolFor('forager', 'temperateForest');
    const total = pool.reduce((a, e) => a + e.weight, 0);
    return {
      size: pool.length,
      natural: Object.fromEntries(pool.map((e) => [e.itemId, e.weight / total])),
    };
  });
}

const ground = await fixture();
check('the forest offers a forager plenty to choose between',
  ground.size > 20, `${ground.size} finds`);

/* ============================================ 1. the gate: what can be starred */

const gate = await p.evaluate(() => {
  const s = hive.state;
  const pool = hive.poolFor('forager', 'temperateForest');
  const known = pool[0].itemId;
  const unknown = pool[1].itemId;
  s.found.temperateForest[unknown] = hive.discovery.EXACT_AT - 1; // one short
  return {
    knownOk: hive.focus_.starrable('temperateForest', known),
    unknownOk: hive.focus_.starrable('temperateForest', unknown),
    tookKnown: hive.focus_.set('forager', 'temperateForest', known, true),
    tookUnknown: hive.focus_.set('forager', 'temperateForest', unknown, true),
    stars: hive.focus_.stars('forager', 'temperateForest'),
    known,
    unknown,
  };
});
check('ground the hive has pinned down can be focused', gate.knownOk === true);
check('ground it has only bracketed cannot', gate.unknownOk === false,
  '24 finds, one short of the exact rate');
check('and a star on it is refused rather than quietly kept',
  gate.tookKnown === true && gate.tookUnknown === false &&
    gate.stars.length === 1 && gate.stars[0] === gate.known,
  gate.stars.join(', '));

// A star may outlive the knowledge that earned it, so taking one off is always
// allowed — otherwise a player could be stuck with orders they cannot rescind.
await p.evaluate((key) => {
  hive.state.found.temperateForest[key] = 0;
}, gate.known);
const removable = await p.evaluate((key) => {
  const off = hive.focus_.set('forager', 'temperateForest', key, false);
  return { off, left: hive.focus_.stars('forager', 'temperateForest').length };
}, gate.known);
check('a star can always be taken off, even once the rate is forgotten',
  removable.off === true && removable.left === 0);

/* ================================= 2. one star: the bracket it has to land in */

await fixture();

/** Roll `n` patch trips and count what came back. */
async function sample(n, stars = []) {
  return p.evaluate(({ n, stars }) => {
    const s = hive.state;
    s.focus = {};
    for (const key of stars) hive.focus_.set('forager', 'temperateForest', key, true);
    const counts = {};
    const patch = { elapsed: 0 };
    for (let i = 0; i < n; i += 1) {
      hive.drones.rollPatch('forager', 'temperateForest', patch);
      if (patch.itemId) counts[patch.itemId] = (counts[patch.itemId] || 0) + 1;
    }
    return counts;
  }, { n, stars });
}

const TRIALS = 20000;
const items = Object.keys(ground.natural).sort((a, b) => ground.natural[b] - ground.natural[a]);
const target = items[Math.floor(items.length / 2)]; // something middling, not the commonest
const naturalRate = ground.natural[target];

const unfocused = await sample(TRIALS);
check('without a star a find turns up at its natural rate',
  Math.abs((unfocused[target] || 0) / TRIALS - naturalRate) < 0.02,
  `${(((unfocused[target] || 0) / TRIALS) * 100).toFixed(1)}% against ${(naturalRate * 100).toFixed(1)}% natural`);

const one = await sample(TRIALS, [target]);
const oneRate = (one[target] || 0) / TRIALS;
const SHARE = await p.evaluate(() => hive.focus_.share);
check('one star sends most of the route after it',
  Math.abs(oneRate - (SHARE + (1 - SHARE) * naturalRate)) < 0.025,
  `${(oneRate * 100).toFixed(1)}% of trips`);
check('which beats discarding every wrong trip, by a mile',
  oneRate > naturalRate * 5,
  `${(oneRate / naturalRate).toFixed(1)}× the natural rate`);
check('and still falls short of every trip bringing it',
  oneRate < 0.9, `${(oneRate * 100).toFixed(1)}%, not 100%`);
check('the rest of the ground keeps turning up',
  Object.keys(one).length > 5,
  `${Object.keys(one).length} different finds still came back`);

/* ============================================ 3. what the second star costs */

const pair = [target, items[Math.floor(items.length / 2) + 1]];
const two = await sample(TRIALS, pair);
const twoTotal = pair.reduce((a, k) => a + (two[k] || 0), 0) / TRIALS;
const twoEach = (two[target] || 0) / TRIALS;

check('a second star cuts the first one down sharply',
  twoEach < oneRate * 0.6,
  `${(oneRate * 100).toFixed(0)}% → ${(twoEach * 100).toFixed(0)}% for the same find`);
check('and the pair together claim less than the single star did',
  twoTotal < oneRate && twoTotal > twoEach,
  `${(twoTotal * 100).toFixed(0)}% across both`);

const three = await sample(TRIALS, [...pair, items[Math.floor(items.length / 2) + 2]]);
const threeTotal = [...pair, items[Math.floor(items.length / 2) + 2]]
  .reduce((a, k) => a + (three[k] || 0), 0) / TRIALS;
check('and a third costs again — breadth is paid for, not free',
  threeTotal < twoTotal, `${(twoTotal * 100).toFixed(0)}% → ${(threeTotal * 100).toFixed(0)}%`);

const curve = await p.evaluate(() => [1, 2, 3, 4].map((n) => hive.focus_.strength(n)));
check('the strength curve is the 1/√n one',
  Math.abs(curve[0] - 0.75) < 1e-9 &&
  Math.abs(curve[1] - 0.75 / Math.SQRT2) < 1e-9 &&
  Math.abs(curve[3] - 0.375) < 1e-9,
  curve.map((c) => `${(c * 100).toFixed(0)}%`).join(' / '));

/* ======================================= 4. starring everything changes nothing */

const all = await sample(TRIALS, items);
const allSpread = Object.keys(all).length;
const allTop = (all[items[0]] || 0) / TRIALS;
check('starring the whole table cannot manufacture a focus',
  Math.abs(allTop - ground.natural[items[0]]) < 0.025 && allSpread > 20,
  `commonest find at ${(allTop * 100).toFixed(1)}% against ${(ground.natural[items[0]] * 100).toFixed(1)}% natural`);

/* ====================================== 5. the quoted odds match the rolls */

const quoted = await p.evaluate((key) => {
  hive.state.focus = {};
  hive.focus_.set('forager', 'temperateForest', key, true);
  const odds = hive.focus_.odds('forager', 'temperateForest');
  const sum = Object.values(odds).reduce((a, v) => a + v, 0);
  return { mine: odds[key], sum };
}, target);
check('the odds the panel quotes are a real distribution',
  Math.abs(quoted.sum - 1) < 1e-9, `sums to ${quoted.sum.toFixed(6)}`);
check('and they agree with what actually comes back',
  Math.abs(quoted.mine - oneRate) < 0.025,
  `quoted ${(quoted.mine * 100).toFixed(1)}%, rolled ${(oneRate * 100).toFixed(1)}%`);

/* ================================ 6. stars are per biome AND per route */

const separate = await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 20, grassland: 20 };
  s.found.grassland = {};
  const PINNED = hive.discovery.EXACT_AT + 15;
  for (const e of hive.poolFor('forager', 'grassland')) s.found.grassland[e.itemId] = PINNED;
  for (const e of hive.poolFor('scavenger', 'temperateForest')) {
    s.found.temperateForest[e.itemId] = PINNED;
  }
  s.focus = {};
  const forestForage = hive.poolFor('forager', 'temperateForest')[0].itemId;
  const forestScav = hive.poolFor('scavenger', 'temperateForest')[0].itemId;
  const grassForage = hive.poolFor('forager', 'grassland')[0].itemId;
  hive.focus_.set('forager', 'temperateForest', forestForage, true);
  hive.focus_.set('scavenger', 'temperateForest', forestScav, true);
  hive.focus_.set('forager', 'grassland', grassForage, true);
  return {
    forestForage: hive.focus_.stars('forager', 'temperateForest'),
    forestScav: hive.focus_.stars('scavenger', 'temperateForest'),
    grassForage: hive.focus_.stars('forager', 'grassland'),
    // One route's orders on one biome must not leak into another's.
    leaked: hive.focus_.stars('scavenger', 'grassland'),
    sameKeyDifferentRoute: forestForage !== forestScav,
  };
});
check('one biome holds separate orders for each route',
  separate.forestForage.length === 1 && separate.forestScav.length === 1,
  'forager and scavenger each have their own star in the forest');
check('and one route holds separate orders for each biome',
  separate.grassForage.length === 1 &&
    separate.grassForage[0] !== separate.forestForage[0],
  'the forest and the grassland are focused on different things');
check('nothing leaks into a route and biome that was never set',
  separate.leaked.length === 0);

/* ============================ 7. a star on ground the hive no longer holds */

const kept = await p.evaluate(() => {
  const s = hive.state;
  const before = hive.focus_.stars('forager', 'grassland').length;
  s.territory = { temperateForest: 36 }; // the grassland is gone
  const after = hive.focus_.stars('forager', 'grassland').length;
  return { before, after };
});
check('abandoning ground keeps the orders standing on it',
  kept.before === 1 && kept.after === 1,
  'a star is a preference, not a fact about the land');

/* ========================================== 8. the panel, end to end */

await fixture();
await openTab(p, 'Territory');
await p.waitForTimeout(400);

const panel = await p.evaluate(() => {
  const chips = [...document.querySelectorAll('.offer-chip')];
  return {
    chips: chips.length,
    withStar: chips.filter((c) => c.querySelector('.star-btn')).length,
    anyFilled: chips.filter((c) => c.querySelector('.star-btn.star-on')).length,
  };
});
check('every pinned-down find on screen offers a star',
  panel.chips > 0 && panel.withStar === panel.chips,
  `${panel.withStar} of ${panel.chips} chips`);
check('and none of them starts starred', panel.anyFilled === 0);

const vague = await p.evaluate(() => {
  const s = hive.state;
  const pool = hive.poolFor('forager', 'temperateForest');
  s.found.temperateForest[pool[0].itemId] = 12; // bracketed only
  return pool[0].itemId;
});
await p.waitForTimeout(300);
const gated = await p.evaluate(() => {
  const chips = [...document.querySelectorAll('.offer-chip')];
  const vagueChip = chips.find((c) => /–\d+%|\?%/.test(c.innerText));
  return {
    found: Boolean(vagueChip),
    hasStar: Boolean(vagueChip?.querySelector('.star-btn')),
  };
});
check('a find the hive has only bracketed shows no star at all',
  gated.found && gated.hasStar === false,
  'the gate is visible, not just enforced');

await p.evaluate((key) => {
  hive.state.found.temperateForest[key] = hive.discovery.EXACT_AT + 15;
}, vague);
await p.waitForTimeout(300);

const clicked = await p.evaluate(() => {
  const chip = [...document.querySelectorAll('.offer-chip')].find((c) => c.querySelector('.star-btn'));
  const name = chip.innerText.split('\n')[0];
  chip.querySelector('.star-btn').click();
  return name;
});
await p.waitForTimeout(300);
const afterClick = await p.evaluate(() => {
  // Scoped to the offerings panel. Three panels on this tab use `.offer-head`
  // now — the assignment grid and "Out now" both group by biome the same way —
  // so an unscoped query picks whichever is highest on the page.
  const panel = [...document.querySelectorAll('.panel-box')]
    .find((b) => /ground offers/i.test(b.innerText));
  const head = panel?.querySelector('.offer-head');
  const chip = [...document.querySelectorAll('.offer-chip')].find((c) =>
    c.querySelector('.star-btn.star-on'));
  return {
    filled: Boolean(chip),
    shows: chip?.querySelector('.offer-focused')?.innerText.trim() ?? '',
    note: head?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    state: Object.keys(hive.state.focus?.forager?.temperateForest || {}).length,
  };
});
check('clicking a star sets it', afterClick.filled && afterClick.state === 1, clicked);
check('and the chip says what the orders made it worth',
  /→\s*\d+%/.test(afterClick.shows), afterClick.shows);
check('and the biome header says how much of the route is spoken for',
  /1 focused/.test(afterClick.note) && /75% of trips/.test(afterClick.note),
  afterClick.note.slice(0, 80));

await p.evaluate(() => {
  const panel = [...document.querySelectorAll('.panel-box')]
    .find((b) => /ground offers/i.test(b.innerText));
  panel.querySelector('.focus-clear').click();
});
await p.waitForTimeout(300);
const cleared = await p.evaluate(() => ({
  state: Object.keys(hive.state.focus?.forager?.temperateForest || {}).length,
  filled: document.querySelectorAll('.offer-chip .star-btn.star-on').length,
}));
check('and "clear" drops every star on that ground',
  cleared.state === 0 && cleared.filled === 0);

/* ================================ 9. switching route switches the star set */

const perRoute = await p.evaluate(() => {
  const s = hive.state;
  s.focus = {};
  const key = hive.poolFor('forager', 'temperateForest')[0].itemId;
  hive.focus_.set('forager', 'temperateForest', key, true);
  return key;
});
await p.waitForTimeout(300);
const foragerView = await p.evaluate(() =>
  document.querySelectorAll('.offer-chip .star-btn.star-on').length);
await p.selectOption('.filter-row select', 'scavenger');
await p.waitForTimeout(350);
const scavengerView = await p.evaluate(() =>
  document.querySelectorAll('.offer-chip .star-btn.star-on').length);
await p.selectOption('.filter-row select', 'forager');
await p.waitForTimeout(350);
const backAgain = await p.evaluate(() =>
  document.querySelectorAll('.offer-chip .star-btn.star-on').length);
check('the panel shows the selected route\'s stars and no others',
  foragerView === 1 && scavengerView === 0 && backAgain === 1,
  `forager ${foragerView}, scavenger ${scavengerView}, back to ${backAgain}`);

/* ========================================== 10. a save keeps the orders */

const saved = await p.evaluate(() => {
  hive.save();
  const key = Object.keys(localStorage).find((k) => /hive/i.test(k));
  const raw = JSON.parse(localStorage.getItem(key));
  const s = raw?.state ?? raw;
  return { version: s?.version, focus: s?.focus };
});
const SAVE_VERSION = await p.evaluate(() => hive.saveVersion);
check('the orders round-trip through a save',
  Object.keys(saved.focus?.forager?.temperateForest || {}).length === 1,
  JSON.stringify(saved.focus));
check('at the current save version', saved.version === SAVE_VERSION, `v${saved.version}`);

// A v18 save, with no focus in it at all. Seeded through addInitScript on a
// FRESH page rather than written and reloaded: reloading a running page fires
// beforeunload, which saves the live state over the tampered one before load()
// can ever see it — the same trap save-test documents.
const old = await p.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => /hive/i.test(k));
  const raw = JSON.parse(localStorage.getItem(key));
  const s = raw?.state ?? raw;
  delete s.focus;
  s.version = 18;
  return { key, json: JSON.stringify(raw) };
});

const q = await browser.newPage({ viewport: { width: 1480, height: 1000 } });
const qErrors = [];
q.on('pageerror', (e) => qErrors.push(e.message));
await q.addInitScript(([key, json]) => localStorage.setItem(key, json), [old.key, old.json]);
await q.goto(base, { waitUntil: 'networkidle' });
await q.waitForSelector('.res-row');
await q.waitForTimeout(400);
const afterLoad = await q.evaluate(() => {
  hive.loop.stop();
  const patch = { elapsed: 0 };
  hive.drones.rollPatch('forager', 'temperateForest', patch);
  return {
    focus: hive.state.focus,
    version: hive.state.version,
    rolls: patch.itemId ? 'temperateForest' : 'none',
  };
});
check('a save from before focus loads and focuses nothing',
  afterLoad.focus && Object.keys(afterLoad.focus).length === 0,
  JSON.stringify(afterLoad.focus));
check('and is brought up to the current version', afterLoad.version === SAVE_VERSION,
  `v${afterLoad.version}`);
check('and it still rolls its ground', afterLoad.rolls !== 'none', afterLoad.rolls);
check('with nothing thrown on the way in', qErrors.length === 0, qErrors.slice(0, 2).join(' | '));
await q.close();

/* ------------------------------------------------------------------ errors */

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
