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

const fresh = async () => {
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', (e) => console.log('   pageerror:', e.message));
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('.res-row');
  await ensureLanded(p);
  return p;
};

/* ---------------------------------------------- 1. how big is a save really? */
{
  const p = await fresh();
  const small = await p.evaluate(() => { hive.save(); return hive.saveStatus.bytes; });

  // Play it out hard: full stores, all research, a long log, every override set.
  const big = await p.evaluate(() => {
    hive.dev.fillAllStores();
    hive.dev.grantAllResearch();
    hive.dev.addDrones(500);
    for (let i = 0; i < 200; i += 1) hive.state.log.unshift({ text: 'x'.repeat(120), type: 'info', at: Date.now(), playtime: i });
    for (const d of hive.derived().demands) hive.state.energy.overrides[d.key] = { preferred: 'fat', fallback: 'carb' };
    hive.tick(3600 * 24 * 30, 600); // coarse steps, as offline catch-up uses
    hive.save();
    return hive.saveStatus.bytes;
  });
  check('a fresh save is small', small > 0 && small < 20_000, `${small} bytes`);
  check('a heavily played save stays small', big < 60_000, `${big} bytes (${(big / 1024).toFixed(1)} kB)`);
  check('the save is nowhere near a 5 MB quota', big < 5_000_000 / 50,
    `${(5_000_000 / big).toFixed(0)}x headroom against a typical quota`);
  await p.close();
}

/* ------------------------------------------- 2. quota exhaustion is detected */
{
  const p = await fresh();
  const result = await p.evaluate(() => {
    // Two things make this harder to provoke than it looks:
    //  - overwriting a key with a same-sized value needs no new quota, so a
    //    full origin alone does not break saving; the save has to GROW.
    //  - a fill loop that stops at the first throw can leave most of a block
    //    free, so it has to step down through smaller blocks to truly saturate.
    localStorage.removeItem('hiveidle.save.v2');
    let i = 0;
    let chars = 0;
    for (const size of [256 * 1024, 64 * 1024, 16 * 1024, 4096, 1024, 128]) {
      const block = 'x'.repeat(size);
      for (;;) {
        try {
          localStorage.setItem(`junk.${i}`, block);
          i += 1;
          chars += size;
        } catch {
          break;
        }
      }
    }

    // Grow the save well past whatever crumbs are left.
    for (let n = 0; n < 400; n += 1) {
      hive.state.log.unshift({ text: 'z'.repeat(400), type: 'info', at: Date.now(), playtime: n });
    }
    const logBefore = hive.state.log.length;
    const ok = hive.save();
    return {
      filledMB: (chars / 1024 / 1024).toFixed(2),
      ok,
      logBefore,
      logAfter: hive.state.log.length,
      status: { ...hive.saveStatus },
      errorLogged: hive.state.log.some((l) => l.type === 'error'),
      trimLogged: hive.state.log.some((l) => /trimmed/i.test(l.text)),
    };
  });

  const trimmedToFit = result.ok === true && result.logAfter < result.logBefore;
  check('a full origin is never silently accepted as a successful save',
    result.ok === false || trimmedToFit,
    `origin saturated with ${result.filledMB} MB of chars; ` +
      (trimmedToFit ? `recovered by trimming the log ${result.logBefore} -> ${result.logAfter}` : `flagged: ${result.status.reason}`));
  check('the player is told either way', result.errorLogged === true,
    trimmedToFit ? 'trim reported' : 'failure reported');

  if (trimmedToFit) {
    check('the trim is explained, not silent', result.trimLogged === true);
  } else {
    check('the failure is identified as a quota problem', result.status.reason === 'quota', result.status.reason);
    check('the message tells the player what to do',
      /export/i.test(result.status.error || ''), (result.status.error || '').slice(0, 70));
    await p.waitForTimeout(250);
    const banner = await p.textContent('.save-alert').catch(() => null);
    check('a banner appears, not just a log line', banner !== null && /not being saved/i.test(banner));
    const indicator = await p.textContent('.topbar .meta:last-of-type');
    check('the header stops claiming it saved', /FAILING/.test(indicator));
    await p.screenshot({ path: shot('save-quota.png'), clip: { x: 0, y: 0, width: 1400, height: 200 } });
  }

  const recovered = await p.evaluate(() => {
    Object.keys(localStorage).filter((k) => k.startsWith('junk.')).forEach((k) => localStorage.removeItem(k));
    return { ok: hive.save(), status: { ...hive.saveStatus } };
  });
  await p.waitForTimeout(250);
  const gone = await p.$('.save-alert');
  check('it recovers when space is freed',
    recovered.ok === true && recovered.status.ok === true && gone === null);
  await p.close();
}

/* --------------------------------------- 3. blocked storage is caught at boot */
{
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await p.addInitScript(() => {
    // Simulate private mode / blocked site data: present but throws on write.
    const real = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => ({
        getItem: (k) => real.getItem(k),
        key: (i) => real.key(i),
        get length() { return real.length; },
        removeItem: () => {},
        clear: () => {},
        setItem() {
          const e = new Error('The quota has been exceeded.');
          e.name = 'QuotaExceededError';
          throw e;
        },
      }),
    });
  });
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.waitForSelector('.res-row');
  await ensureLanded(p);
  const status = await p.evaluate(() => ({ ...hive.saveStatus }));
  check('blocked storage is detected before any progress is lost',
    status.supported === false && status.ok === false, status.reason);
  const banner = await p.textContent('.save-alert').catch(() => null);
  check('blocked storage shows the banner at boot', banner !== null && /not being saved/i.test(banner));
  await p.close();
}

/* ------------------------------- 4. a write that does not stick is caught too */
{
  const p = await fresh();
  const result = await p.evaluate(() => {
    const realSet = Storage.prototype.setItem;
    // The nastiest case: setItem reports success but stores nothing.
    Storage.prototype.setItem = function (k, v) {
      if (k === 'hiveidle.save.v2') return; // silently drop it
      return realSet.call(this, k, v);
    };
    localStorage.removeItem('hiveidle.save.v2');
    const ok = hive.save();
    Storage.prototype.setItem = realSet;
    return { ok, status: { ...hive.saveStatus } };
  });
  check('a silently dropped write is caught by reading it back',
    result.ok === false && result.status.reason === 'mismatch', result.status.error?.slice(0, 60));
  await p.close();
}

/* ------------------------------------------------- 5. the storage test button */
{
  const p = await fresh();
  await openTab(p, 'Settings');
  await p.waitForSelector('button:text-is("Test storage")');
  await p.click('button:text-is("Test storage")');
  await p.waitForTimeout(2500);
  const measured = await p.evaluate(() => hive.state.log.find((l) => /Storage test/.test(l.text))?.text ?? '');
  check('the storage test reports real figures', /free/.test(measured), measured.slice(0, 70));
  const stillSaves = await p.evaluate(() => hive.save());
  check('the storage test cleans up after itself', stillSaves === true);
  await p.close();
}

/* --------------------------------------------- 6. corrupt save is not clobbered */
{
  // Seeded via addInitScript: reloading a running page fires beforeunload, which
  // saves valid data over the corruption before load() can ever see it.
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await p.addInitScript(() => localStorage.setItem('hiveidle.save.v2', '{not json at all'));
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.waitForSelector('.res-row');
  await ensureLanded(p);
  const backup = await p.evaluate(() => localStorage.getItem('hiveidle.save.v2.corrupt'));
  const logged = await p.evaluate(() => hive.state.log.some((l) => /unreadable/i.test(l.text)));
  check('unreadable save data is backed up rather than overwritten',
    backup === '{not json at all' && logged, backup ? 'copy kept and reported' : 'LOST');
  await p.close();
}

console.log(fail.length ? `\n=== ${fail.length} CHECK(S) FAILED: ${fail.join('; ')} ===` : '\n=== save layer verified ===');
await browser.close();
console.log('=== save test finished ===');
