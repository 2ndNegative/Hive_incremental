import { chromium } from 'playwright';
import {
  BASE, LAUNCH, ensureLanded, checker, openPage, finish, shot, settle,
} from './harness.mjs';

/**
 * EVERY SCREEN, AT EVERY WIDTH SOMEBODY MIGHT HAVE.
 *
 * The rest of the suite drives the game in one window: 1480×1000, which is a
 * maximised desktop browser and the one size that was ever looked at. Nothing
 * asserted anything about the others, so a panel that did not fit on a laptop,
 * a table that pushed the page sideways on a phone, or a tab that came back
 * blank below some breakpoint were all invisible — and `access-test.mjs` found
 * two of exactly those in one afternoon, by accident, while testing something
 * else.
 *
 * So: a matrix. Ten tabs by four widths, and at each stop the same four
 * questions, which between them are most of what "the layout is broken" means:
 *
 *   1. DOES THE PAGE SCROLL SIDEWAYS? A horizontal scrollbar on the document is
 *      always a bug — there is no screen in this game meant to be panned. It is
 *      also the symptom with the most causes: a fixed-width table, an unwrapped
 *      flex row, a hidden tooltip parked off the right edge.
 *   2. IS ANYTHING OFF THE RIGHT-HAND EDGE? Not the same question. A page can
 *      refuse to scroll (because something clips) while still putting content
 *      where nobody can read it.
 *   3. IS ANYTHING CLIPPED THAT CANNOT BE SCROLLED TO? An element whose content
 *      is wider than itself is fine inside a scroller and a silent truncation
 *      everywhere else.
 *   4. IS THE SCREEN STILL THERE? The cheapest failure to miss: a layout that
 *      collapses to nothing still passes every geometric check ever written,
 *      because an empty box overflows nothing.
 *
 * WIDTHS, and why these four: 1480 is the size everything else tests at, 1100
 * is a laptop or a half-screen window, 760 is a tablet and sits just under the
 * 860px breakpoint where the sidebar stops being a sidebar, and 390 is a phone.
 * The heights are short on purpose — a tall viewport hides every vertical
 * problem by having room for it.
 *
 * The hive is stocked with the dev cheats first, because an empty hive has
 * empty tables and an empty table is the one case that always fits.
 */

const WIDTHS = [
  { w: 1480, h: 1000, name: 'desktop' },
  { w: 1100, h: 800, name: 'laptop' },
  { w: 760, h: 700, name: 'tablet' },
  { w: 390, h: 760, name: 'phone' },
];

const TABS = [
  'Hive', 'Drones', 'Genetics', 'Territory', 'Storage',
  'Metabolism', 'Research', 'Codex', 'Stats', 'Settings',
];

/** Room for a scrollbar, a rounding error and a sub-pixel border. */
const SLACK = 2;

const browser = await chromium.launch(LAUNCH);
const { check, fail } = checker();
const { page: p, errors } = await openPage(browser, { viewport: { width: 1480, height: 1000 } });

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await ensureLanded(p);
await settle(p);

/*
 * A HIVE WITH SOMETHING IN IT. Every assay revealed (so the nutrient panel is
 * all thirty-five rows rather than seven), every tech bought (so Research is a
 * full ladder), stores and shelves full, drones on the ground across several
 * biomes, and a genome written — which between them is the widest each table
 * ever gets.
 */
await p.evaluate(() => {
  hive.loop.stop();
  hive.dev.grantAllResearch();
  hive.dev.grantAllAssays();
  hive.dev.fillAllStores();
  hive.dev.fillStorage();
  hive.dev.fillInsight();
  for (const biome of ['temperateForest', 'grassland', 'denseUrban', 'wetland', 'taiga']) {
    hive.dev.addTerritory(biome, 72);
  }
  hive.dev.addDrones(40);
  for (const id of ['hivecore', 'nodeCluster', 'broodChamber', 'moldingChamber',
    'metabolicGenerator', 'caecum', 'vacuole', 'proteinGranule', 'lipidDroplet']) {
    hive.state.structures[id] = Math.max(hive.state.structures[id] || 0, 4);
  }
  hive.state.energyPool = 1e9;
  hive.setGenome?.('drone:forager', ['quickstep']);
  hive.tick(60, 1);
});
await settle(p);

/**
 * Everything on the page that is sticking out, or clipped with no way to
 * scroll to the rest.
 *
 * IN-FLOW ONLY, which is the whole difficulty. An absolutely positioned child
 * still counts towards its parent's `scrollWidth`, and every `.tip` in the game
 * has one: a hidden tooltip body with `min-width: max(100%, 220px)`. So the
 * first version of this probe reported every tooltip anchor in the game as
 * "clipped, 220 > 96" — four hundred times over, on every tab at every width,
 * which is a check that has learned to cry wolf before it has found anything.
 *
 * The honest question is not "is scrollWidth bigger" but "is there something
 * IN THE FLOW that the box cuts off", so that is what gets asked. An element
 * taken out of the flow is out of the flow: it is placed against something
 * other than its parent's content box, and `overflow-x: clip` on the shell is
 * what keeps it on the screen — proved separately by question 1.
 *
 * Also excluded:
 *   - a hidden tooltip's contents, which nobody can read wrongly;
 *   - anything inside a deliberate scroller (`.assign-scroll`, the codex
 *     tables), where content wider than the viewport is the design — but only
 *     if an ancestor actually scrolls, which is checked rather than assumed;
 *   - zero-sized elements, which are not visible.
 */
function PROBE(slack) {
  const out = { sticking: [], clipped: [] };
  const limit = window.innerWidth + slack;

  const name = (el) => {
    const cls = [...el.classList].slice(0, 3).join('.');
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
  };

  /** Is `el` positioned out of the flow, anywhere between it and `stop`? */
  const outOfFlow = (el, stop) => {
    for (let a = el; a && a !== stop && a !== document.body; a = a.parentElement) {
      const pos = getComputedStyle(a).position;
      if (pos === 'absolute' || pos === 'fixed') return true;
    }
    return false;
  };
  const scrollableAncestor = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };
  const inHiddenTip = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      if (a.classList?.contains('tip-body') && getComputedStyle(a).visibility === 'hidden') {
        return true;
      }
    }
    return false;
  };

  /** Does anything between `el` and `stop` scroll sideways? */
  const scrollerBetween = (el, stop) => {
    for (let a = el.parentElement; a && a !== stop; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };

  /**
   * The name of an in-flow descendant this element cuts off, or null.
   *
   * A descendant sitting inside a scroller BELOW `el` is not cut off by `el` —
   * the assignment grid is wider than the Territory tab on purpose and scrolls
   * inside `.assign-scroll`. Asking only about `el`'s own ancestors missed
   * that and reported the whole column as broken.
   */
  const cutsOff = (el) => {
    const box = el.getBoundingClientRect();
    const right = box.left + el.clientLeft + el.clientWidth;
    for (const d of el.querySelectorAll('*')) {
      if (outOfFlow(d, el)) continue;
      if (scrollerBetween(d, el)) continue;
      const b = d.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (b.right > right + slack) return `${name(d)} to ${Math.round(b.right)}`;
    }
    return null;
  };

  for (const el of document.querySelectorAll('#tab-panel *, .topbar *, .sidebar *, .tab-bar *')) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (inHiddenTip(el)) continue;

    if (box.right > limit && !outOfFlow(el, null) && !scrollableAncestor(el)) {
      out.sticking.push(`${name(el)} to ${Math.round(box.right)}`);
    }

    const ox = getComputedStyle(el).overflowX;
    const scrollsItself = ox === 'auto' || ox === 'scroll';
    if (el.scrollWidth > el.clientWidth + slack && !scrollsItself && !scrollableAncestor(el)) {
      const victim = cutsOff(el);
      if (victim) out.clipped.push(`${name(el)} cuts off ${victim}`);
    }
  }
  // Deduplicated: one bad table puts every cell in it on the list, and the
  // first few are enough to find it.
  out.sticking = [...new Set(out.sticking)].slice(0, 4);
  out.clipped = [...new Set(out.clipped)].slice(0, 4);
  return out;
}

for (const size of WIDTHS) {
  console.log(`\n--- ${size.name} (${size.w}×${size.h}) ---`);
  await p.setViewportSize({ width: size.w, height: size.h });
  await settle(p);

  // The bar itself first: if the tabs cannot be reached at this width, nothing
  // below means anything.
  const bar = await p.evaluate((slack) => {
    const nav = document.querySelector('.tab-bar');
    const tabs = [...nav.querySelectorAll('[role="tab"]')];
    return {
      count: tabs.length,
      offscreen: tabs
        .filter((t) => t.getBoundingClientRect().right > window.innerWidth + slack)
        .map((t) => t.textContent.trim()),
    };
  }, SLACK);
  check(`${size.name}: every tab is on the screen`,
    bar.count >= 10 && bar.offscreen.length === 0,
    bar.offscreen.join(', ') || `${bar.count} tabs`);

  for (const label of TABS) {
    await p.click(`.tab-bar button:text-is("${label}")`);
    await settle(p);

    const page = await p.evaluate(() => {
      const panel = document.getElementById('tab-panel');
      return {
        pageWidth: document.documentElement.scrollWidth,
        inner: window.innerWidth,
        text: (panel?.innerText ?? '').trim().length,
        boxes: panel ? panel.querySelectorAll('*').length : 0,
      };
    });

    // PROBE is a function in node, so it crosses the boundary as source and is
    // rebuilt on the page. Passing it as the argument of an arrow would send a
    // serialised `{}`, which is the trap that makes this worth a comment.
    const probe = await p.evaluate(PROBE, SLACK);

    check(`${size.name}/${label}: the page does not scroll sideways`,
      page.pageWidth <= page.inner + SLACK,
      `${page.pageWidth} wide in ${page.inner}`);
    check(`${size.name}/${label}: nothing hangs off the right-hand edge`,
      probe.sticking.length === 0, probe.sticking.join(' | '));
    check(`${size.name}/${label}: nothing is clipped with nowhere to scroll`,
      probe.clipped.length === 0, probe.clipped.join(' | '));
    check(`${size.name}/${label}: the screen still has something on it`,
      page.text > 20 && page.boxes > 5, `${page.text} chars in ${page.boxes} elements`);

    if (probe.sticking.length || probe.clipped.length) {
      await p.screenshot({ path: shot(`layout-${size.w}-${label.toLowerCase()}.png`) });
    }
  }
}

await p.setViewportSize({ width: 1480, height: 1000 });
await finish({ name: 'every screen at every width', fail, errors, browser });
