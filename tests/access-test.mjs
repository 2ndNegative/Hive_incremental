import { chromium } from 'playwright';
import { BASE, LAUNCH, ensureLanded, openTab, finish, settle } from './harness.mjs';

/**
 * THE GAME WITHOUT A MOUSE, AND THE GAME ON A SMALL WINDOW.
 *
 * Every assertion here was a bug, and all of them were invisible to the rest
 * of the suite because the rest of the suite drives the game by `page.click`,
 * which is a mouse. A tab bar with no roles, a dropdown with no name, a dialog
 * that does not take the keyboard and a card whose buttons are off the bottom
 * of the window all read as perfectly fine to a test that clicks coordinates.
 *
 * The claims:
 *   1. the tab bar is a tablist: one tab stop, arrow keys inside it, and the
 *      panel it controls says which tab named it
 *   2. nothing that takes input is nameless
 *   3. a dialog takes the keyboard, keeps it, and gives it back
 *   4. a dialog on a short window can still be reached to the last button
 *   5. the topbar wraps rather than pushing the page sideways
 *   6. a tooltip opens for a keyboard too
 *   7. the one failure that costs a run announces itself
 *   8. molding says which of the three ways it is stalled
 */

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

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
await settle(p);
await p.evaluate(() => hive.loop.stop());

/* ================================================= 1. the bar is a tablist */

/*
 * `.is-active` is a colour, and a colour is not a state anything but an eye
 * can read. Eleven buttons with no relation between them were also eleven tab
 * stops between the topbar and the first control on the screen.
 */
const bar = await p.evaluate(() => {
  const nav = document.querySelector('.tab-bar');
  const tabs = [...nav.querySelectorAll('[role="tab"]')];
  return {
    role: nav.getAttribute('role'),
    named: Boolean(nav.getAttribute('aria-label')),
    count: tabs.length,
    buttons: nav.querySelectorAll('button').length,
    selected: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length,
    stops: tabs.filter((t) => t.tabIndex === 0).length,
    ids: tabs.every((t) => t.id.startsWith('tab-')),
    controls: tabs.every((t) => t.getAttribute('aria-controls') === 'tab-panel'),
  };
});
check('the bar declares itself a tablist, with a name', bar.role === 'tablist' && bar.named,
  `${bar.role} / named=${bar.named}`);
check('and every button in it is a tab', bar.count === bar.buttons && bar.count > 8,
  `${bar.count} tabs of ${bar.buttons} buttons`);
check('exactly one is selected', bar.selected === 1, `${bar.selected} selected`);
check('and exactly one is a tab stop, not eleven', bar.stops === 1, `${bar.stops} stops`);
check('each tab is addressable and points at the panel', bar.ids && bar.controls);

const panel = await p.evaluate(() => {
  const el = document.getElementById('tab-panel');
  return {
    role: el?.getAttribute('role'),
    labelledBy: el?.getAttribute('aria-labelledby'),
    namedByTheSelected: el?.getAttribute('aria-labelledby')
      === document.querySelector('[role="tab"][aria-selected="true"]')?.id,
    reachable: el?.tabIndex === 0,
    holdsTheTab: (el?.innerText.length ?? 0) > 50,
  };
});
check('the screen is a tabpanel named by the tab that opened it',
  panel.role === 'tabpanel' && panel.namedByTheSelected,
  `${panel.role} ← ${panel.labelledBy}`);
check('and is a tab stop of its own, so the keyboard lands in it',
  panel.reachable && panel.holdsTheTab);

/*
 * THE ARROW KEYS, which is the half of the pattern a screen reader promises on
 * the strength of `role="tablist"`. Declaring the role without them would have
 * been worse than leaving the buttons alone: the player is told to press a key
 * that does nothing.
 */
await p.focus('[role="tab"][aria-selected="true"]');
const before = await p.evaluate(() => hive.state.ui.tab);
await p.keyboard.press('ArrowRight');
await settle(p);
const afterRight = await p.evaluate(() => ({
  tab: hive.state.ui.tab,
  focusedIsSelected: document.activeElement === document.querySelector('[role="tab"][aria-selected="true"]'),
  panelFollowed: document.getElementById('tab-panel').getAttribute('aria-labelledby')
    === document.querySelector('[role="tab"][aria-selected="true"]').id,
}));
check('right arrow moves to the next tab', afterRight.tab !== before, `${before} → ${afterRight.tab}`);
check('and the keyboard goes with it', afterRight.focusedIsSelected);
check('and the panel is renamed by the new tab', afterRight.panelFollowed);

await p.keyboard.press('ArrowLeft');
await settle(p);
check('left arrow comes back', await p.evaluate(() => hive.state.ui.tab) === before);

await p.keyboard.press('End');
await settle(p);
const atEnd = await p.evaluate(() => hive.state.ui.tab);
await p.keyboard.press('ArrowRight');
await settle(p);
const wrapped = await p.evaluate(() => hive.state.ui.tab);
check('End goes to the last tab and the arrows wrap round it',
  atEnd === 'settings' && wrapped === 'hive', `${atEnd} → ${wrapped}`);

await p.keyboard.press('Home');
await settle(p);
check('Home goes to the first', await p.evaluate(() => hive.state.ui.tab) === 'hive');

/* ====================================== 2. nothing nameless takes an input */

/*
 * The Metabolism tab's fuel rows are two IDENTICAL dropdowns side by side,
 * repeated once per generator, and the only thing that said which was which
 * was their order and a paragraph of prose. A screen reader got "combobox,
 * combobox" per row and nothing else.
 */
await openTab(p, 'Metabolism');
await settle(p);
const fuel = await p.evaluate(() => {
  const selects = [...document.querySelectorAll('.fuel-select')];
  const labels = selects.map((s) => s.getAttribute('aria-label'));
  const head = document.querySelector('.fuel-row.is-head');
  return {
    n: selects.length,
    allNamed: labels.every((l) => l && l.length > 4),
    distinctPerRow: new Set(labels).size === labels.length,
    labels: labels.slice(0, 2),
    headShown: Boolean(head) && head.offsetParent !== null,
    headText: head?.innerText.replace(/\s+/g, ' ').trim(),
    headHidden: head?.getAttribute('aria-hidden') === 'true',
  };
});
check('every fuel dropdown has a name', fuel.n >= 2 && fuel.allNamed, `${fuel.n} selects`);
check('and no two of them have the same one', fuel.distinctPerRow, fuel.labels.join(' | '));
check('the columns are headed on screen too',
  fuel.headShown && /reaches for/i.test(fuel.headText ?? ''), fuel.headText);
check('and the heading is not read twice, since the selects carry it',
  fuel.headHidden);

/*
 * The filter boxes relied on `placeholder`, which is not a name: it is a hint
 * that several readers skip and that every reader loses the moment a character
 * is typed into the box.
 */
const named = {};
for (const [tab, selector] of [['Storage', '.codex-search'], ['Codex', '.codex-search']]) {
  await openTab(p, tab);
  await settle(p);
  named[tab] = await p.evaluate((sel) => {
    const inputs = [...document.querySelectorAll(sel)];
    return {
      n: inputs.length,
      ok: inputs.length > 0 && inputs.every((i) => (i.getAttribute('aria-label') ?? '').length > 3),
    };
  }, selector);
}
check('the storage filter has a name', named.Storage.ok, `${named.Storage.n} inputs`);
check('and so does the codex search', named.Codex.ok, `${named.Codex.n} inputs`);

/* ============================== 3. a dialog takes the keyboard and gives it back */

/*
 * THE ONE THAT MATTERS MOST. The wipe confirmation asks you to type DELETE and
 * then destroys the run, and it was a plain div: no role, nothing moved into
 * it, and Tab walked straight out into the page behind — so you could be
 * typing into something you could not see, and a stray Enter is forever.
 */
await openTab(p, 'Settings');
await settle(p);
await p.click('.btn.is-danger:text-is("Wipe save")');
await settle(p);

const dlg = await p.evaluate(() => {
  const card = document.querySelector('.modal-card');
  return {
    role: card?.getAttribute('role'),
    modal: card?.getAttribute('aria-modal'),
    titled: Boolean(document.getElementById(card?.getAttribute('aria-labelledby') ?? '')),
    focusInside: Boolean(card?.contains(document.activeElement)),
    behindHidden: document.getElementById('app')?.getAttribute('aria-hidden') === 'true',
  };
});
check('the dialog says it is a dialog, and a modal one',
  dlg.role === 'dialog' && dlg.modal === 'true', `${dlg.role} / ${dlg.modal}`);
check('and is named by its own heading', dlg.titled);
check('the keyboard is moved into it', dlg.focusInside);
check('and the page behind it is hidden from a reader, not merely covered',
  dlg.behindHidden);

// Tab round the whole card and check the keyboard never leaves it. Twice the
// number of controls, so a trap that is off by one is caught.
const inside = await p.evaluate(() => document.querySelectorAll(
  '.modal-card a[href], .modal-card button:not([disabled]), .modal-card input:not([disabled])',
).length);
let escaped = false;
for (let i = 0; i < inside * 2 + 2; i += 1) {
  await p.keyboard.press('Tab');
  if (!await p.evaluate(() => document.querySelector('.modal-card')?.contains(document.activeElement))) {
    escaped = true;
    break;
  }
}
check('Tab cannot walk out of it', !escaped, `${inside} controls, ${inside * 2 + 2} presses`);

await p.keyboard.press('Escape');
await settle(p);
const closed = await p.evaluate(() => ({
  gone: !document.querySelector('.modal-card'),
  stillRunning: Boolean(hive.state.origin),
  behindBack: document.getElementById('app')?.getAttribute('aria-hidden') === null,
  focusBack: document.activeElement !== document.body,
}));
check('Escape cancels it — and cancels means cancels, the run is still here',
  closed.gone && closed.stillRunning);
check('the page behind is readable again', closed.behindBack);
check('and the keyboard is back on the page, not at the top of the document',
  closed.focusBack);

/* ========================================= 4. and it fits on a short window */

/*
 * The backdrop is `position: fixed` and centres its card, so a card taller
 * than the viewport overflowed equally off the top and the bottom with no way
 * to scroll it — and what went off the bottom was `.modal-foot`, which is
 * where every button is. A dialog you cannot reach the buttons of is a dialog
 * you cannot dismiss.
 */
await p.setViewportSize({ width: 900, height: 400 });
await settle(p);
await p.click('.btn.is-danger:text-is("Wipe save")');
await settle(p);
const short = await p.evaluate(() => {
  const card = document.querySelector('.modal-card');
  const foot = card?.querySelector('.modal-foot');
  const box = card.getBoundingClientRect();
  const footBox = foot.getBoundingClientRect();
  const body = card.querySelector('.modal-body');
  return {
    fits: box.top >= -1 && box.bottom <= window.innerHeight + 1,
    footVisible: footBox.bottom <= window.innerHeight + 1 && footBox.top >= 0,
    bodyScrolls: getComputedStyle(body).overflowY === 'auto',
  };
});
check('the card stays inside a 400px-tall window', short.fits);
check('so its buttons are on the screen', short.footVisible);
check('and the long part in the middle is what scrolls', short.bodyScrolls);
await p.keyboard.press('Escape');
await settle(p);

/* ================================= 5. the topbar wraps rather than overflows */

/*
 * The bar holds the brand, six resource chips and the save state, and on a
 * narrow window it was simply wider than the viewport: a horizontal scrollbar
 * on the whole page, with the readouts on the right-hand end off the edge.
 */
await p.setViewportSize({ width: 420, height: 820 });
await settle(p);
const narrow = await p.evaluate(() => {
  const bar = document.querySelector('.topbar');
  const chips = [...bar.querySelectorAll('.res-chip, .topbar-resources > *')];
  return {
    pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
    barWithin: bar.getBoundingClientRect().right <= window.innerWidth + 1,
    wrapped: getComputedStyle(bar).flexWrap === 'wrap',
    taller: bar.getBoundingClientRect().height > 48,
    chipsOnScreen: chips.every((c) => c.getBoundingClientRect().right <= window.innerWidth + 1),
  };
});
check('a phone-width window does not scroll the page sideways',
  !narrow.pageScrollsSideways);
check('the bar is set to wrap, and has', narrow.wrapped && narrow.taller,
  narrow.taller ? 'two lines or more' : 'one line');
check('so nothing in it is off the right-hand edge',
  narrow.barWithin && narrow.chipsOnScreen);

/*
 * AND THE TOOLTIPS STILL CLEAR IT. The slide used a hard 56px for the bar's
 * height, which is right for one line and wrong for two: a tooltip slid to 56
 * on a narrow window went under a bar twice that tall, and the line it hid was
 * the tooltip's own title.
 */
const gutter = await p.evaluate(() => {
  const bar = document.querySelector('.topbar').getBoundingClientRect();
  // The sidebar's own rows. `.res-row` is also the topbar picker's row class,
  // and which of those happen to be mounted depends on whether the picker was
  // left open — a probe that picked "the last one on the page" was measuring a
  // different element run to run.
  const rows = [...document.querySelectorAll('.sidebar .res-row.tip')];
  const row = rows[rows.length - 1];
  if (!row) return null;
  row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  const body = row.querySelector(':scope > .tip-body');
  const box = body.getBoundingClientRect();
  return { barHeight: bar.height, tipTop: box.top, clears: box.top >= bar.bottom - 1 };
});
check('a tooltip slid upwards still clears a wrapped topbar',
  gutter === null || gutter.clears,
  gutter ? `bar ${Math.round(gutter.barHeight)}px, tip at ${Math.round(gutter.tipTop)}px` : 'no rows');

await p.setViewportSize({ width: 1480, height: 1000 });
await settle(p);

/* ================================== 6. a tooltip opens without a pointer too */

/*
 * A great many tooltips wrap a control, and the explanation of what the
 * control does was reachable only by hovering it. `:focus-within` costs
 * nothing and adds no tab stops — it fires on things that were already tab
 * stops.
 */
await openTab(p, 'Metabolism');
await settle(p);
const focusTip = await p.evaluate(() => {
  const tip = [...document.querySelectorAll('.tip')].find(
    (t) => t.querySelector('select, button:not([disabled]), input:not([disabled])')
      && t.querySelector(':scope > .tip-body'),
  );
  if (!tip) return null;
  const body = tip.querySelector(':scope > .tip-body');
  const hiddenBefore = getComputedStyle(body).visibility;
  tip.querySelector('select, button:not([disabled]), input:not([disabled])').focus();
  return { hiddenBefore, shownAfter: getComputedStyle(body).visibility };
});
if (focusTip === null) {
  // Not a failure of the rule, but the suite must say so rather than report a
  // pass it did not establish.
  check('a tooltip around a control opens on focus', false, 'no such tooltip on this screen');
} else {
  check('a tooltip around a control is hidden until the keyboard arrives',
    focusTip.hiddenBefore === 'hidden', focusTip.hiddenBefore);
  check('and open once it does', focusTip.shownAfter === 'visible', focusTip.shownAfter);
}

/* ================================== 7. the failure that costs a run is spoken */

const live = await p.evaluate(() => {
  const region = document.querySelector('[role="alert"][aria-live]');
  return {
    exists: Boolean(region),
    emptyWhileFine: (region?.innerText.trim() ?? 'x') === '',
    assertive: region?.getAttribute('aria-live') === 'assertive',
  };
});
check('there is a live region mounted before anything goes wrong',
  live.exists && live.assertive);
check('and it is silent while saving is working', live.emptyWhileFine);

const spoken = await p.evaluate(() => {
  hive.saveStatus.ok = false;
  hive.saveStatus.error = 'Site storage refused the write.';
  // Two frames: one for Vue to flush the patch, one for the layout it causes.
  return new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const region = document.querySelector('[role="alert"][aria-live]');
      done({
        text: region.innerText.replace(/\s+/g, ' ').trim(),
        insideTheRegion: Boolean(region.querySelector('.save-alert')),
      });
    }));
  });
});
check('a storage failure appears inside that region, not beside it',
  spoken.insideTheRegion && /not being saved/.test(spoken.text), spoken.text.slice(0, 70));
await p.evaluate(() => { hive.saveStatus.ok = true; hive.saveStatus.error = null; });

/* ============================ 8. molding says which way it is stalled */

/*
 * `derived.molding[].broke` was computed from the day the mold loop was
 * written and nothing ever read it, which left one of the three ways molding
 * can stall with no explanation on the screen — and the player's next move
 * depends entirely on which of the three it is.
 */
await p.evaluate(() => {
  const s = hive.state;
  s.structures.moldingChamber = 1;
  s.structures.nodeCluster = 10;
  s.structures.glycogenGranule = 100;
  s.structures.lipidDroplet = 100;
  s.structures.proteinGranule = 100;
  s.energyPool = 1e9;
  s.larvae = 20;
  s.larvaeHunger = 0;
  s.molding = {};
  hive.drones.setMoldTarget('forager', '');
  hive.drones.setMolding('forager', true);
  // A larva in hand and not a gram to press it out of: the one case that used
  // to say nothing at all.
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  hive.tick(0.1);
});
await openTab(p, 'Drones');
await settle(p);
const stalled = await p.evaluate(() => ({
  broke: hive.derived().molding.some((m) => m.broke),
  text: document.querySelector('#tab-panel').innerText.replace(/\s+/g, ' '),
}));
check('the hive is in the broke state', stalled.broke);
check('and the screen says so, naming what is short',
  /Nothing to press it out of/.test(stalled.text) && /Short /.test(stalled.text),
  (stalled.text.match(/Nothing to press it out of[^.]*\./) ?? ['not said'])[0].slice(0, 110));

await finish({ name: 'keyboard and small-window access', fail, errors, browser });
