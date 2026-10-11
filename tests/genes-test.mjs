/*
 * GENETICS: the model, the engine it reaches, and the screen that drives it.
 *
 * The thing this suite exists to prove is the one modifiers.js was written
 * after: that a layer which computes correctly is ALSO read by something. A
 * trait summed into a key nobody divides by looks perfectly healthy from the
 * inside — the number is in the file, the screen says the gene is written in,
 * and nothing whatsoever happens.
 *
 * So the engine checks all take the same shape: measure, write a gene, measure
 * again, and insist the figure moved by the amount the gene claims.
 */
import { chromium } from 'playwright';
import { LAUNCH, BASE, shot } from './harness.mjs';

const browser = await chromium.launch(LAUNCH);
const p = await browser.newPage({ viewport: { width: 1480, height: 1020 } });
const errors = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

await p.goto(BASE);
const card = await p.$('.origin-card:not(.is-locked):not(.is-placeholder)');
if (card) {
  await card.click();
  await p.waitForSelector('.origin-backdrop', { state: 'detached', timeout: 5000 });
}
await p.waitForTimeout(350);

/* ================================================ 1. a plain genome is plain */

await p.evaluate(() => {
  const s = hive.state;
  s.territory = { temperateForest: 400 };
  s.droneTypes = { forager: 10, scavenger: 0, explorer: 2 };
  s.assign = {};
  s.genes = {};
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 1e7;
  hive.forage.resetForage(s);
  for (let i = 0; i < 20; i += 1) hive.tick(1);
});

const plain = await p.evaluate(() => ({
  traits: hive.genes.traitsOf('drone:forager'),
  genome: hive.genes.genome('drone:forager'),
  cycle: hive.genes.cycleFor('forager'),
  subjects: hive.genes.subjects().map((s) => s.id),
}));
check('a body with nothing written into it has every trait at 1',
  Object.values(plain.traits).every((v) => near(v, 1)), JSON.stringify(plain.traits));
check('and an empty genome', plain.genome.length === 0);
check('the forage cycle is the plain twelve seconds', near(plain.cycle, 12), `${plain.cycle}s`);
check('every drone type is a subject, locked or not',
  plain.subjects.length === 3 && plain.subjects.includes('drone:scavenger'),
  plain.subjects.join(', '));

/* ============================================ 2. what a gene is allowed into */

const fits = await p.evaluate(() => ({
  quickstepForager: hive.genes.blocked('quickstep', 'drone:forager'),
  quickstepExplorer: hive.genes.blocked('quickstep', 'drone:explorer'),
  thriftForager: hive.genes.blocked('thrift', 'drone:forager'),
  thriftScavenger: hive.genes.blocked('thrift', 'drone:scavenger'),
}));
check('a gene for every body fits every body',
  fits.quickstepForager === null && fits.quickstepExplorer === null);
check('a gene for one body fits that one', fits.thriftForager === null);
check('and refuses the others with a reason, not a shrug',
  typeof fits.thriftScavenger === 'string' && /Forager/.test(fits.thriftScavenger),
  String(fits.thriftScavenger).slice(0, 60));

// A genome is a claim about what a body IS, so it must not be able to hold one
// that is false — a hand-edited save cannot give a scavenger a forager's gut.
const refused = await p.evaluate(() => {
  hive.genes.write('drone:scavenger', ['thrift', 'quickstep']);
  return {
    stored: hive.genes.genome('drone:scavenger'),
    appetite: hive.genes.droneTrait('scavenger', 'appetite'),
  };
});
check('a gene that does not fit is dropped on the way in, not stored and ignored',
  refused.stored.length === 1 && refused.stored[0] === 'quickstep'
  && near(refused.appetite, 1), JSON.stringify(refused));

/* ====================================== 3. pace reaches the engine, two ways */

const paced = await p.evaluate(() => {
  const s = hive.state;
  s.genes = {};
  s.assign = { temperateForest: { forager: 10 } };
  hive.forage.resetForage(s);
  for (let i = 0; i < 40; i += 1) hive.tick(1);

  // Measured off the engine's own published rate rather than off a formula
  // repeated here, which would only prove this file agrees with itself.
  const rate = () => hive.derived().crews.reduce((a, c) => a + c.rate, 0);
  const before = rate();
  const expBefore = hive.expedition.seconds('explorer');

  hive.genes.write('drone:forager', ['quickstep']);
  hive.genes.write('drone:explorer', ['quickstep']);
  const after = rate();
  return {
    before, after, expBefore,
    expAfter: hive.expedition.seconds('explorer'),
    cycle: hive.genes.cycleFor('forager'),
  };
});
check('pace shortens the forage cycle by exactly its multiplier',
  near(paced.cycle, 12 / 1.15, 1e-9), `${paced.cycle.toFixed(3)}s`);
// The same trips, more often: the rate is the trip weight over the cycle, so a
// 15% faster cycle is 15% more coming in and the loads are untouched.
check('and the hive brings in that much more',
  paced.before > 0 && near(paced.after / paced.before, 1.15, 0.001),
  `${paced.before.toFixed(3)} → ${paced.after.toFixed(3)} g/s`);
check('an explorer has no forage cycle, so pace lands on its expedition instead',
  near(paced.expAfter / paced.expBefore, 1 / 1.15, 0.001),
  `${Math.round(paced.expBefore)}s → ${Math.round(paced.expAfter)}s`);

/* ============================================== 4. appetite reaches the bill */

const fed = await p.evaluate(() => {
  const s = hive.state;
  s.genes = {};
  // Nobody on any ground, so nothing is grazing and the bill is the whole
  // headcount — the figure the gene is supposed to move, with nothing else
  // moving it.
  s.territory = {};
  s.assign = {};
  s.droneTypes = { forager: 10, scavenger: 0, explorer: 0 };
  hive.forage.resetForage(s);
  hive.tick(1);
  const before = hive.derived().ration.joules;

  hive.genes.write('drone:forager', ['thrift']);
  const after = hive.derived().ration.joules;

  // And a type WITHOUT the gene must be unmoved by it, which is the whole
  // reason this is a per-body trait rather than a hive-wide channel.
  s.droneTypes = { forager: 0, scavenger: 0, explorer: 10 };
  const others = hive.derived().ration.joules;
  return { before, after, others };
});
check('appetite moves the ration bill by exactly its multiplier',
  fed.before > 0 && near(fed.after / fed.before, 0.8, 1e-9),
  `${Math.round(fed.before)} → ${Math.round(fed.after)} J/s`);
check('and only for the body it is written into',
  near(fed.others, fed.before, 1e-6),
  `${Math.round(fed.others)} J/s for ten plain explorers`);

/* ================================= 5. nothing is summed that nothing reads */

const unread = await p.evaluate(() => {
  const declared = Object.keys(hive.genes.traits);
  const read = hive.genes.read();
  return declared.filter((id) => !read.includes(id));
});
check('every declared trait has been produced for a reader', unread.length === 0,
  unread.join(', '));

/* ============================================= 6. a save carries the genome */

const saved = await p.evaluate(() => {
  hive.state.genes = { 'drone:forager': ['quickstep', 'thrift'] };
  hive.save();
  const key = Object.keys(localStorage).find((k) => /hive/i.test(k));
  const raw = JSON.parse(localStorage.getItem(key));
  const st = raw?.state ?? raw;
  return { version: st?.version, genes: st?.genes };
});
const SAVE_VERSION = await p.evaluate(() => hive.saveVersion);
check('the genome round-trips', saved.genes?.['drone:forager']?.length === 2,
  JSON.stringify(saved.genes));
check('at the current save version', saved.version === SAVE_VERSION, `v${saved.version}`);

/* ============================================= 7. the screen, end to end */

await p.evaluate(() => {
  const s = hive.state;
  s.genes = {};
  s.territory = { temperateForest: 200 };
  s.droneTypes = { forager: 8, scavenger: 0, explorer: 2 };
  s.assign = {};
  hive.forage.resetForage(s);
  for (let i = 0; i < 20; i += 1) hive.tick(1);
});
await p.click('.tab-bar button:text-is("Genetics")');
await p.waitForTimeout(400);

const laid = await p.evaluate(() => ({
  cols: document.querySelectorAll('.gene-cols > .panel-box').length,
  subjects: document.querySelectorAll('.gene-subject').length,
  genes: document.querySelectorAll('.gene-row').length,
  traits: document.querySelectorAll('.gene-trait').length,
  // The empty kind is a band with no rows and a line saying so, rather than
  // an absence — "buildings, not yet" is a true thing for the tab to say.
  empty: Boolean(document.querySelector('.gene-empty')),
}));
check('the tab is three columns', laid.cols === 3, `${laid.cols}`);
check('with every body on the left and every gene on the right',
  laid.subjects === 3 && laid.genes === 2, `${laid.subjects} bodies, ${laid.genes} genes`);
check('the middle shows one block per trait', laid.traits === 2, `${laid.traits}`);
check('and the kind with nothing in it still has a band', laid.empty);

// Selecting a gene PREVIEWS it. Nothing reaches the hive until it is written.
await p.click('.gene-row:not(:disabled)');
await p.waitForTimeout(250);
const preview = await p.evaluate(() => {
  const moved = [...document.querySelectorAll('.gene-trait.is-moved')];
  return {
    moved: moved.length,
    text: moved[0]?.innerText.replace(/\s+/g, ' ') ?? '',
    // The state is untouched: this is a proposal, not a write.
    state: hive.genes.genome('drone:forager').length,
    commit: document.querySelector('.gene-commit')?.innerText.replace(/\s+/g, ' ') ?? '',
  };
});
check('picking a gene highlights the trait it moves, and only that one',
  preview.moved === 1, `${preview.moved} of 2 marked`);
check('showing both the multiplier and what it means in seconds',
  /×1\.00 → ×1\.15/.test(preview.text) && /12\.0s/.test(preview.text) && /10\.4s/.test(preview.text),
  preview.text.slice(0, 90));
check('and the hive is not touched until it is written in',
  preview.state === 0 && /writing in/.test(preview.commit), preview.commit.slice(0, 60));

await p.click('.gene-write');
await p.waitForTimeout(350);
const wrote = await p.evaluate(() => ({
  state: hive.genes.genome('drone:forager'),
  moved: document.querySelectorAll('.gene-trait.is-moved').length,
  held: document.querySelectorAll('.gene-row.is-held').length,
}));
check('writing it in commits the proposal', wrote.state.join(',') === 'quickstep',
  wrote.state.join(', ') || '(empty)');
check('and the panel settles: nothing is moving any more, one gene is held',
  wrote.moved === 0 && wrote.held === 1, `${wrote.moved} moving, ${wrote.held} held`);

// Clicking a gene that is already in stages its REMOVAL, which is the same
// gesture — there is no second set of controls for taking something out.
await p.click('.gene-row.is-held');
await p.waitForTimeout(250);
const pulling = await p.evaluate(() => ({
  out: document.querySelectorAll('.gene-row.is-out').length,
  commit: document.querySelector('.gene-commit')?.innerText.replace(/\s+/g, ' ') ?? '',
  text: document.querySelector('.gene-trait.is-moved')?.innerText.replace(/\s+/g, ' ') ?? '',
}));
check('clicking a written gene stages taking it out',
  pulling.out === 1 && /taking out/.test(pulling.commit), pulling.commit.slice(0, 60));
check('and the preview runs the other way', /×1\.15 → ×1\.00/.test(pulling.text),
  pulling.text.slice(0, 60));

// A blocked gene says why, in the row, where the player is looking.
await p.evaluate(() => {
  [...document.querySelectorAll('.gene-subject')].find((n) => /Explorer/.test(n.innerText)).click();
});
await p.waitForTimeout(300);
const blocked = await p.evaluate(() => {
  const row = document.querySelector('.gene-row.is-blocked');
  return {
    rows: document.querySelectorAll('.gene-row.is-blocked').length,
    why: row?.querySelector('.gene-row-why')?.innerText.replace(/\s+/g, ' ') ?? '',
    disabled: row?.disabled,
    // The reason must not be faded along with the rest of the row — see the
    // .assign-cap trap in theme.css. Opacity on a row fades its explanation.
    opacity: row ? Number(getComputedStyle(row).opacity) : 0,
  };
});
check('a gene that cannot go in is listed, not hidden', blocked.rows === 1);
check('and says why, in full, unfaded',
  /Only a Forager/.test(blocked.why) && blocked.disabled === true && blocked.opacity === 1,
  `${blocked.why.slice(0, 50)} @ opacity ${blocked.opacity}`);

// Switching subject drops a half-finished thought rather than carrying it over.
const switched = await p.evaluate(() => document.querySelector('.gene-commit')?.innerText ?? '');
check('switching body discards the proposal staged against the last one',
  /Pick a gene on the right/.test(switched), switched.replace(/\s+/g, ' ').slice(0, 60));

/* ------------------------------------------------------------------ errors */

if (fail.length) await p.screenshot({ path: shot('genes.png') });
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${fail.length ? `FAILURES: ${fail.join(', ')}` : 'all green'}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
