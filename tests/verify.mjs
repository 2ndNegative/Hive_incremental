import { chromium } from 'playwright';
import { BASE, LAUNCH, shot } from './harness.mjs';

/**
 * These suites were written before landing sites existed. A fresh save now
 * opens on the chooser and the hive stays inert until a site is picked, so
 * every test that expects a running game has to land first.
 */
async function ensureLanded(page) {
  const card = await page.$('.origin-card:not(.is-locked):not(.is-placeholder)');
  if (!card) return false;
  await card.click();
  await page.waitForSelector('.origin-backdrop', { state: 'detached', timeout: 5000 });
  return true;
}


/**
 * Open a tab by its label. Nth-child indices broke the moment a tab was
 * inserted in the middle of the bar, which is exactly what happened when
 * Storage arrived — so these address tabs by name instead.
 */
async function openTab(page, label) {
  await page.click(`.tab-bar button:text-is("${label}")`);
  await page.waitForTimeout(140);
}

const base = BASE;
const browser = await chromium.launch(LAUNCH);

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};

const errors = [];
const watch = (p) => {
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
};

/* ============================ 1. tooltip no longer bleeds, at every width === */
for (const w of [1400, 980, 700, 420]) {
  const p = await browser.newPage({ viewport: { width: w, height: 900 } });
  watch(p);
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('.res-row');
  await ensureLanded(p);
  await p.hover('.gather-btn');
  await p.waitForTimeout(350);

  const r = await p.evaluate(() => {
    const tip = document.querySelector('.tip-side .tip-body');
    const t = tip.getBoundingClientRect();
    // Geometric overlap is fine and expected — the tooltip is meant to sit over
    // the rows. What matters is whether anything PAINTS ABOVE it. Ask the
    // browser directly by hit-testing a grid of points inside its rectangle.
    tip.style.pointerEvents = 'auto';
    const strangers = new Set();
    for (let x = 4; x < t.width - 4; x += Math.max(8, t.width / 12)) {
      for (let y = 4; y < t.height - 4; y += Math.max(8, t.height / 14)) {
        const el = document.elementFromPoint(t.left + x, t.top + y);
        if (!el) continue;
        if (el === tip || tip.contains(el)) continue;
        strangers.add(`${el.className || el.tagName}`.split(' ')[0]);
      }
    }
    tip.style.pointerEvents = 'none';
    // And the original symptom: row content extending past the tooltip's edge.
    const rowsBehind = [...document.querySelectorAll('.res-row')]
      .filter((e) => { const b = e.getBoundingClientRect(); return b.top < t.bottom && b.bottom > t.top; });
    const uncovered = rowsBehind.filter((e) => {
      const b = e.getBoundingClientRect();
      return b.right > t.right + 1 && b.left < t.right;
    }).length;
    return { tip: { x: Math.round(t.x), w: Math.round(t.width) }, strangers: [...strangers], uncovered, behind: rowsBehind.length };
  });
  check(`nothing paints over the tooltip @${w}px`, r.strangers.length === 0,
    `tip x=${r.tip.x} w=${r.tip.w}${r.strangers.length ? ` over it: ${r.strangers.join(', ')}` : ''}`);
  check(`no row bleeds past the tooltip edge @${w}px`, r.uncovered === 0,
    `${r.behind} row(s) behind, ${r.uncovered} sticking out`);
  if (w === 1400 || w === 420) {
    await p.screenshot({ path: shot(`tooltip-${w}.png`), clip: { x: 0, y: 0, width: Math.min(w, 700), height: 560 } });
  }
  await p.close();
}

/* ============================ 2. intake tooltip hides unresearched compounds = */
{
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  watch(p);
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('.res-row');
  await ensureLanded(p);
  await p.hover('.gather-btn');
  await p.waitForTimeout(300);

  const before = await p.evaluate(() => {
    const tip = document.querySelector('.tip-side .tip-body');
    return { text: tip.innerText, rows: tip.querySelectorAll('.tip-row').length };
  });
  const leaks = ['Sodium', 'Potassium', 'Calcium', 'Magnesium', 'Zinc', 'Copper', 'Selenium', 'Vitamin A', 'Vitamin K', 'Manganese', 'Iron', 'Phosphorus']
    .filter((n) => before.text.includes(n));
  check('intake tooltip names no unresearched compound', leaks.length === 0,
    leaks.length ? `leaked: ${leaks.join(', ')}` : 'macros only, rest counted');
  // The tooltip no longer previews a fixed mouthful — a click rolls against the
  // hive's own land — so what it owes the player is the odds.
  // The tooltip used to quote the hive's area, which read oddly for a hive with
  // no drones standing on 36 m2. What it owes the player is the odds and the
  // size of a mouthful.
  check('intake tooltip states the odds instead of a fixed yield',
    /%/.test(before.text) && /territory/i.test(before.text) && before.rows > 2,
    `${before.rows} outcomes listed`);

  // Change the ground and the tooltip must change with it.
  await p.evaluate(() => {
    hive.state.territory = { denseUrban: 100 };
  });
  await p.waitForTimeout(250);
  await p.hover('.gather-btn');
  await p.waitForTimeout(250);
  // What the odds are ABOUT is a fact about the ground; what they SAY is
  // limited by what the hive has found. So the ground is checked against the
  // ids, and the rendering against the text.
  const urbanIds = await p.evaluate(() => hive.manualOdds(40).map((o) => o.itemId));
  check('the odds follow the territory the hive holds',
    urbanIds.includes('bread_white') && !urbanIds.includes('leaf_litter'),
    'a city hive is offered bread, not forest floor');

  const blind = await p.evaluate(() => document.querySelector('.tip-side .tip-body').innerText);
  check('and it names none of it until the hive has found it',
    blind.includes('???') && !blind.includes('Bread'),
    blind.split('\n').slice(2, 4).join(' / '));

  // Find one, and only that one is named.
  await p.evaluate(() => hive.discovery.recordFind(hive.state, 'denseUrban', 'bread_white'));
  await p.waitForTimeout(250);
  await p.hover('.gather-btn');
  await p.waitForTimeout(250);
  const urban = await p.evaluate(() => document.querySelector('.tip-side .tip-body').innerText);
  check('finding a thing once puts its name in the odds',
    urban.includes('Bread') && urban.includes('???'),
    'bread named, the rest still anonymous');
  check('and still withholds the rate until the ground is walked',
    /\?%/.test(urban), 'rates stay vague');

  // And it still must not hand over the micronutrient panel for free.
  const urbanLeaks = ['Sodium', 'Potassium', 'Vitamin A', 'Selenium']
    .filter((n) => urban.includes(n));
  check('the odds name items, never unresearched compounds', urbanLeaks.length === 0,
    urbanLeaks.join(', ') || 'items only');
  await p.close();
}


/** Capture a save, rewind its timestamp, and boot a fresh page with it. */
async function bootWithAgedSave(ageSeconds, setup = () => {}) {
  const prep = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await prep.goto(base, { waitUntil: 'networkidle' });
  await prep.waitForSelector('.res-row');
  await ensureLanded(prep);
  await prep.evaluate(setup);
  const saved = await prep.evaluate(() => { hive.save(); return localStorage.getItem('hiveidle.save.v2'); });
  await prep.close();

  const raw = JSON.parse(saved);
  raw.savedAt = Date.now() - ageSeconds * 1000;
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  watch(p);
  await p.addInitScript((payload) => {
    localStorage.setItem('hiveidle.save.v2', payload);
  }, JSON.stringify(raw));
  await p.goto(base, { waitUntil: 'commit' });
  return p;
}

/* ============================ 3. offline progress: unlimited + skippable ===== */
{
  const p = await bootWithAgedSave(365 * 24 * 3600, () => {
    hive.state.castes.dormant = 0;
    hive.state.castes.forager = 2;
  });
  await p.waitForSelector('.modal-backdrop', { timeout: 15000 });
  const modalText = await p.textContent('.modal-card');
  check('a year away shows the catch-up modal', /Simulating time away/.test(modalText));

  const moved = await p.evaluate(async () => {
    const a = hive.offline.done;
    await new Promise((r) => { setTimeout(r, 600); });
    return { a, b: hive.offline.done, total: hive.offline.total, step: hive.offline.stepSeconds };
  });
  check('catch-up makes progress without freezing', moved.b > moved.a,
    `${Math.round(moved.a)}s -> ${Math.round(moved.b)}s of ${Math.round(moved.total)}s, step ${Math.round(moved.step)}s`);
  check('no 8h cap: the whole gap is queued', moved.total > 360 * 86400,
    `${(moved.total / 86400).toFixed(0)} days queued`);

  await p.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 120000 });
  const done = await p.evaluate(() => ({
    playtime: hive.state.playtime,
    drones: hive.state.drones,
    logged: hive.state.log.some((l) => l.type === 'offline'),
  }));
  check('a full year completes and is logged', done.playtime > 360 * 86400 && done.logged,
    `${(done.playtime / 86400).toFixed(0)} days of playtime, ${done.drones} drones`);
  await p.close();
}

/* ============================ 4. skipping forfeits the remainder ============= */
{
  const p = await bootWithAgedSave(365 * 24 * 3600);
  await p.waitForSelector('.modal-backdrop', { timeout: 15000 });
  await p.click('.modal-foot .btn');
  await p.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 15000 });
  const skipped = await p.evaluate(() => ({
    playtime: hive.state.playtime,
    logged: hive.state.log.find((l) => /Skipped the remaining/.test(l.text))?.text ?? '',
  }));
  check('skip stops the catch-up early and says so',
    skipped.playtime < 360 * 86400 && skipped.logged !== '', skipped.logged.slice(0, 70));

  const t1 = await p.evaluate(() => hive.state.playtime);
  await p.waitForTimeout(900);
  const t2 = await p.evaluate(() => hive.state.playtime);
  check('live loop starts after a skip', t2 > t1, `+${(t2 - t1).toFixed(1)}s`);
  await p.close();
}

/* ============================ 5. dev mode ================================== */
{
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  watch(p);
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('.res-row');
  await ensureLanded(p);

  const tabsBefore = await p.$$eval('.tab-bar button', (e) => e.map((x) => x.textContent.trim()));
  check('dev tab hidden until unlocked', !tabsBefore.some((t) => t.startsWith('Dev')), tabsBefore.join(' '));

  await openTab(p, 'Settings');
  await p.waitForSelector('.codex-search[placeholder="code"]');
  await p.fill('.codex-search[placeholder="code"]', 'wrong code');
  await p.click('button:text-is("Unlock")');
  await p.waitForTimeout(200);
  const rejected = await p.evaluate(() => hive.state.dev.enabled);
  check('wrong code is rejected', rejected === false);

  // keyboard path this time, so both ways in are covered
  await p.fill('.codex-search[placeholder="code"]', 'Code Midas');
  await p.press('.codex-search[placeholder="code"]', 'Enter');
  await p.waitForTimeout(300);
  const unlocked = await p.evaluate(() => ({ dev: hive.state.dev.enabled, tab: hive.state.ui.tab }));
  check('Code Midas unlocks dev mode', unlocked.dev === true && unlocked.tab === 'dev');

  await p.waitForSelector('.dev-tech-grid');
  // Measure inside the same evaluate as the fill: the live loop ticks every
  // 100 ms and immediately starts burning fuel and losing water, so a store
  // checked a frame later is legitimately below cap.
  const filled = await p.evaluate(() => {
    hive.dev.fillAllStores();
    const d = hive.derived();
    const short = Object.keys(hive.state.nutrients).filter((n) => hive.state.nutrients[n] < d.caps[n] - 1e-6);
    return { short: short.length, devUsed: hive.state.stats.devUsed, protein: hive.state.nutrients.protein };
  });
  check('fill all tops up every store', filled.short === 0 && filled.devUsed === true,
    `protein ${filled.protein.toFixed(0)} g, save flagged devUsed`);

  await p.click('button:text-is("All assays")');
  await p.waitForTimeout(300);
  const assayed = await p.$$eval('.res-name', (e) => e.length);
  check('all assays reveals the full panel', assayed === 35, `${assayed} nutrient rows`);

  const viaButton = await p.evaluate(() => { hive.state.nutrients.protein = 0; return true; });
  await p.click('button:text-is("Fill all")');
  await p.waitForTimeout(150);
  const buttonWorked = await p.evaluate(() => hive.state.nutrients.protein > 1000);
  check('the Fill all button works from the UI', viaButton && buttonWorked);

  await p.screenshot({ path: shot('dev.png') });

  // persists across a reload
  await p.evaluate(() => hive.save());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('.res-row');
  await ensureLanded(p);
  const persisted = await p.evaluate(() => hive.state.dev.enabled);
  check('dev unlock survives a reload', persisted === true);

  await p.evaluate(() => hive.dev.lockDev());
  await p.waitForTimeout(200);
  const relocked = await p.$$eval('.tab-bar button', (e) => e.map((x) => x.textContent.trim()));
  check('locking hides the tab again', !relocked.some((t) => t.startsWith('Dev')));
  await p.close();
}

console.log(`\nconsole errors: ${errors.length ? errors.slice(0, 5).join(' | ') : 'none'}`);
console.log(fail.length ? `\n=== ${fail.length} CHECK(S) FAILED: ${fail.join('; ')} ===` : '\n=== all checks passed ===');
await browser.close();
console.log('=== verification finished ===');
