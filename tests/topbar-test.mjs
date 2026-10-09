import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * The top bar as a registry rather than a hand-written row.
 *
 * The claims:
 *   1. the six it starts with are pinned, and pinned things never move
 *   2. whatever room is left goes to whatever is MOVING, losing before gaining
 *      and either before standing still
 *   3. clicking the bar opens a list of everything, with what it holds and what
 *      it is doing, and a pin for each
 *   4. a resource added to the registry needs nothing else to appear
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

/* ============================================== 1. the six it starts with */

const start = await p.evaluate(() => ({
  pinned: [...hive.state.ui.pinned],
  order: [...hive.topbar.order],
  defaults: [...hive.topbar.defaultPinned],
  shown: hive.topbar.layout().shown.map((r) => r.id),
  hidden: hive.topbar.layout().hidden.map((r) => r.id),
  text: document.querySelector('.topbar').innerText.replace(/\s+/g, ' '),
}));
check('a new hive starts with every current resource pinned',
  start.pinned.join() === 'energy,draw,hydration,cognition,larvae,insight',
  start.pinned.join(', '));
check('which is the whole registry, so nothing is hidden yet',
  start.hidden.length === 0 && start.shown.length === start.order.length,
  `${start.shown.length} shown, ${start.hidden.length} hidden`);
check('and the bar draws them in declared order',
  /Energy.*Draw.*Cognition.*Larvae.*Insight/.test(start.text),
  start.text.slice(0, 90));

/* ================================================== 2. the ordering rule */

const ranks = await p.evaluate(() => ({
  losing: hive.topbar.urgencyRank(-0.001),
  gaining: hive.topbar.urgencyRank(0.001),
  still: hive.topbar.urgencyRank(0),
  tinyLoss: hive.topbar.urgencyRank(-1e-6),
  hugeGain: hive.topbar.urgencyRank(1e9),
}));
check('losing outranks gaining outranks standing still',
  ranks.losing < ranks.gaining && ranks.gaining < ranks.still,
  `losing ${ranks.losing} < gaining ${ranks.gaining} < still ${ranks.still}`);
check('and only the sign counts — a trickle out beats a torrent in',
  ranks.tinyLoss < ranks.hugeGain,
  'a milligram a second lost ranks above a tonne a second gained');

// Four injected resources, declared in the WRONG order on purpose: if the bar
// simply took them as listed, this test could not tell the difference.
const injected = await p.evaluate(() => {
  const mk = (id, rate) => {
    hive.topbar.defs[id] = {
      id,
      name: id,
      desc: 'injected',
      read: () => ({
        text: id, sub: null, tone: 'muted', store: '0',
        rate, rateText: rate ? String(rate) : null, note: null,
      }),
    };
    hive.topbar.order.push(id);
  };
  mk('__still', 0);
  mk('__gaining', 5);
  mk('__losing', -5);
  mk('__stillToo', 0);
  const l = hive.topbar.layout();
  return { shown: l.shown.map((r) => r.id), hidden: l.hidden.map((r) => r.id), slots: hive.topbar.slots };
});
check('the overflow is sorted losing first',
  injected.shown[6] === '__losing',
  `after the six pinned: ${injected.shown.slice(6).join(', ') || '(none)'}`);
check('then gaining',
  injected.shown[7] === '__gaining', injected.shown[7] ?? '(nothing)');
check('and the ones standing still are what gets left out',
  injected.hidden.join() === '__still,__stillToo',
  `hidden: ${injected.hidden.join(', ')}`);
check('the bar stops at its slot count',
  injected.shown.length === injected.slots, `${injected.shown.length} of ${injected.slots}`);

const stable = await p.evaluate(() => {
  // The pinned six must not reshuffle however loudly the rest behave.
  const before = hive.topbar.layout().shown.slice(0, 6).map((r) => r.id);
  hive.state.nutrients.carb = 0;
  hive.state.larvae = 40;
  for (let i = 0; i < 20; i += 1) hive.tick(0.5); // larvae starving and dying
  const after = hive.topbar.layout().shown.slice(0, 6).map((r) => r.id);
  return { before, after, dying: hive.derived().larvae.dying };
});
check('pinned resources hold their order even when one of them is in crisis',
  stable.before.join() === stable.after.join() && stable.dying,
  `${stable.after.join(', ')} with the brood dying`);

/* ====================================== 3. unpinning hands the room over */

const unpin = await p.evaluate(() => {
  hive.topbar.toggle('insight'); // off the bar
  hive.topbar.toggle('larvae'); // off the bar
  const l = hive.topbar.layout();
  return {
    pinned: [...hive.state.ui.pinned],
    shown: l.shown.map((r) => r.id),
    hidden: l.hidden.map((r) => r.id),
  };
});
check('unpinning takes a resource out of the guaranteed set',
  !unpin.pinned.includes('insight') && !unpin.pinned.includes('larvae'),
  unpin.pinned.join(', '));
check('an unpinned resource that is MOVING still earns its place',
  unpin.shown.includes('larvae'),
  'the brood is dying, so it is on the bar without being pinned');
check('an unpinned resource standing still gives way to one that is not',
  unpin.shown.indexOf('__losing') < unpin.shown.indexOf('insight') ||
  !unpin.shown.includes('insight'),
  `shown: ${unpin.shown.join(', ')}`);

const repin = await p.evaluate(() => {
  hive.topbar.toggle('insight');
  return { pinned: [...hive.state.ui.pinned] };
});
check('re-pinning puts it back in declared order, not click order',
  repin.pinned.join() === 'energy,draw,hydration,cognition,insight',
  repin.pinned.join(', '));

const reset = await p.evaluate(() => {
  hive.topbar.reset();
  // Clean up the fixtures before anything looks at the real bar again.
  for (const id of ['__still', '__gaining', '__losing', '__stillToo']) {
    delete hive.topbar.defs[id];
    hive.topbar.order.splice(hive.topbar.order.indexOf(id), 1);
  }
  hive.state.larvae = 0;
  hive.state.larvaeHunger = 0;
  hive.state.larvaeDying = 0;
  return { pinned: [...hive.state.ui.pinned], order: [...hive.topbar.order] };
});
check('reset puts the starting six back', reset.pinned.join() === reset.order.join(),
  reset.pinned.join(', '));

/* ============================================== 4. the picker, on screen */

await p.waitForTimeout(250);
await p.click('.topbar-resources');
await p.waitForTimeout(300);
const picker = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.picker-table tbody tr')];
  return {
    open: !!document.querySelector('.picker'),
    count: rows.length,
    names: rows.map((r) => r.querySelector('td strong')?.textContent.trim()),
    cells: rows[0]?.innerText.replace(/\s+/g, ' ').trim() ?? null,
    pins: rows.filter((r) => /Pinned/.test(r.innerText)).length,
    tipsHidden: getComputedStyle(
      document.querySelector('.topbar-resources .tip-body'),
    ).display === 'none',
  };
});
check('clicking the bar opens the picker', picker.open);
check('it lists every top-bar resource, not just the shown ones',
  picker.count === 6 && picker.names.join() === 'Energy,Draw,Hydration,Cognition,Larvae,Insight',
  picker.names.join(', '));
// A store and a rate, whatever the numbers happen to be. The landing site
// hands over banked energy, so pinning this to "0 J" only tested the opening.
check('each row carries what it holds and what it is doing',
  /\d+(\.\d+)?\s*[kMGT]?J\b/.test(picker.cells || '') &&
  /\d+(\.\d+)?\s*[kMGT]?W\b/.test(picker.cells || ''),
  picker.cells?.slice(0, 70));
check('and a pin for each', picker.pins === 6, `${picker.pins} pinned`);
check('the chip tooltips get out of the way while it is open', picker.tipsHidden);

const clicked = await p.evaluate(() => {
  const row = [...document.querySelectorAll('.picker-table tbody tr')]
    .find((r) => /Insight/.test(r.innerText));
  row.querySelector('.pin-btn').click();
  return null;
});
await p.waitForTimeout(250);
const afterClick = await p.evaluate(() => ({
  pinned: [...hive.state.ui.pinned],
  label: [...document.querySelectorAll('.picker-table tbody tr')]
    .find((r) => /Insight/.test(r.innerText))?.querySelector('.pin-btn')?.textContent.trim(),
}));
check('the pin button actually unpins',
  !afterClick.pinned.includes('insight') && afterClick.label === 'Pin',
  `${afterClick.pinned.join(', ')} · button now says "${afterClick.label}"`);

await p.click('.picker-foot .btn');
await p.waitForTimeout(250);
const afterReset = await p.evaluate(() => [...hive.state.ui.pinned]);
check('and Reset to default restores the six',
  afterReset.join() === 'energy,draw,hydration,cognition,larvae,insight', afterReset.join(', '));

await p.keyboard.press('Escape');
await p.waitForTimeout(250);
check('Escape closes it', await p.evaluate(() => !document.querySelector('.picker')));

/* ================================================= pins survive a reload */

await p.evaluate(() => {
  hive.topbar.toggle('draw');
  hive.save();
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await p.evaluate(() => hive.loop.stop());
const reloaded = await p.evaluate(() => [...hive.state.ui.pinned]);
check('a pin survives a reload', !reloaded.includes('draw') && reloaded.length === 5,
  reloaded.join(', '));

check('no console errors anywhere in all that', errors.length === 0, errors.slice(0, 3).join(' / '));

await browser.close();
console.log(`\n${fail.length ? `FAILURES (${fail.length}): ${fail.join(', ')}` : 'All checks passed.'}`);
process.exit(fail.length ? 1 : 0);
