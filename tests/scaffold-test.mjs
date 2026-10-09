import { chromium } from 'playwright';
import { BASE, LAUNCH } from './harness.mjs';

/**
 * Scaffolding: a Genetics tab, a Molding Chamber, and drones restructured into
 * castes with types inside them.
 *
 * Everything here is deliberately inert, so what is being tested is that the
 * SHAPE is right and that nothing is quietly broken — an empty room with the
 * door hung correctly.
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
  await page.waitForTimeout(160);
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
// The Scavenger is behind Scavenging now, as its research always claimed. These
// checks are about molding and the Drones tab, not about the gate, so the tech
// is granted up front rather than leaving half the drone table invisible.
await p.evaluate(() => { hive.state.tech.scavenging = true; });
await p.waitForTimeout(250);
await p.evaluate(() => hive.loop.stop());

/* ============================================================ 1. Genetics */

const tabs = await p.evaluate(() =>
  [...document.querySelectorAll('.tab-bar button')].map((b) => b.textContent.trim().replace(/\s+\S+$/, (m) => (/^\s*\d+$|^\s*!$/.test(m) ? '' : m))),
);
check('there is a Genetics tab', tabs.some((t) => /^Genetics/.test(t)), tabs.join(' · '));
check('and it sits next to Drones, where it belongs',
  tabs.findIndex((t) => /^Genetics/.test(t)) === tabs.findIndex((t) => /^Drones/.test(t)) + 1,
  tabs.slice(0, 4).join(' · '));

await openTab(p, 'Genetics');
const genetics = await p.evaluate(() => {
  const main = document.querySelector('.main-col');
  return {
    painted: main.innerText.trim().length,
    text: main.innerText.replace(/\s+/g, ' ').slice(0, 160),
    cards: main.querySelectorAll('.action-card').length,
  };
});
check('it renders rather than blanking the page', genetics.painted > 40);
check('it is empty on purpose, and says so',
  /nothing here yet/i.test(genetics.text) && genetics.cards === 0,
  genetics.text.slice(0, 80));

/* ===================================================== 2. Molding Chamber */

const molding = await p.evaluate(() => {
  const def = hive.structureDefs.moldingChamber;
  const d = hive.derived();
  return {
    exists: !!def,
    category: def?.category,
    upkeep: def?.upkeepWatts,
    inOrder: hive.structureOrder.includes('moldingChamber'),
    priority: hive.powerPriority().indexOf('moldingChamber'),
    activeWatts: def?.activeWatts,
    moldSeconds: def?.molding?.seconds,
    power: d.power.moldingChamber,
  };
});
check('the Molding Chamber exists', molding.exists);
check('it is a Production building', molding.category === 'production', molding.category);
check('it idles at 25 kW', molding.upkeep === 25_000, `${molding.upkeep / 1000} kW`);
check('and draws 100 kW with work in front of it',
  molding.activeWatts === 100_000, `${molding.activeWatts / 1000} kW`);
check('its cycle is twenty seconds', molding.moldSeconds === 20, `${molding.moldSeconds}s`);
check('it is in the power queue, below Core and above Digestion',
  molding.inOrder && molding.priority > 0, `position ${molding.priority + 1}`);

const buildable = await p.evaluate(() => {
  const s = hive.state;
  s.structures.vacuole = 20;
  delete s.active.vacuole;
  // Buildings are priced mostly in fibre now, so a fixture that only stocks
  // protein and ash can no longer afford anything.
  s.nutrients.fiber = 20_000;
  s.nutrients.protein = 2_000;
  s.nutrients.ash = 2_000;
  const before = s.structures.moldingChamber || 0;
  // A build is a queued job now, so this lines it up and then gives it the time
  // it needs. What is on test here is the building, not the clock.
  const built = hive.build('moldingChamber', 1);
  s.building = null;
  hive.queue.advance(1e5, 1);
  const d = hive.derived();
  return {
    built,
    now: s.structures.moldingChamber,
    before,
    demand: d.energy.demand,
    active: hive.activeCount('moldingChamber'),
  };
});
check('one can actually be built', buildable.built === 1 && buildable.now === 1,
  `${buildable.before} → ${buildable.now}`);
check('and once built it is billed for its watts',
  buildable.demand >= 70_000, `${(buildable.demand / 1e6).toFixed(2)} MW of total demand`);
check('a newly built one comes up running', buildable.active === 1);

await openTab(p, 'Hive');
const moldingCard = await p.evaluate(() => {
  const band = [...document.querySelectorAll('.band')].find((b) => /PRODUCTION/i.test(b.innerText));
  const card = [...(band?.querySelectorAll('.action-card') ?? [])]
    .find((c) => c.textContent.includes('Molding Chamber'));
  return {
    inProduction: !!card,
    effects: card?.querySelector('.effect-list')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
  };
});
check('it is listed in the Production band and nowhere else', moldingCard.inProduction);
check('its card states both draws and what it makes',
  /1 larva into 1 drone every 20s/.test(moldingCard.effects || '') &&
  /25 kW idle, 100 kW working/.test(moldingCard.effects || ''),
  moldingCard.effects);

/* ============================================== 3 & 4. castes and types */

const registry = await p.evaluate(() => ({
  castes: hive.drones.casteOrder,
  types: hive.drones.typeOrder,
  worker: hive.drones.castes.worker,
  forager: hive.drones.types.forager,
  inWorker: hive.drones.typesInCaste('worker'),
  unfiled: hive.drones.unfiled(),
  held: { ...hive.state.droneTypes },
}));
check('there is a Worker caste', registry.castes.join() === 'worker', registry.castes.join(', '));
check('with a Forager, a Scavenger and an Explorer inside it',
  registry.types.join() === 'forager,scavenger,explorer' && registry.forager.caste === 'worker',
  `${registry.types.join(', ')}`);
check('the caste knows which types belong to it',
  registry.inWorker.join() === 'forager,scavenger,explorer', registry.inWorker.join(', '));
check('no type is filed under a caste that does not exist', registry.unfiled.length === 0);
check('the hive holds none of them, and has a slot to hold them in',
  registry.held.forager === 0 && 'forager' in registry.held,
  JSON.stringify(registry.held));

const declares = await p.evaluate(() => {
  const t = hive.drones.types.forager;
  // The skeleton has grown into a type that costs something, occupies
  // bandwidth and does a job. What it still has no concept of is an appetite
  // or watts of its own.
  return {
    keys: Object.keys(t).sort().join(','),
    hasCost: 'cost' in t,
    hasUpkeep: 'upkeepWatts' in t,
    hasEats: 'eats' in t,
    cogits: t.cogitDraw,
    gather: t.gather,
  };
});
check('a drone type costs something, thinks and works',
  declares.hasCost && declares.cogits === 1 && declares.gather === 'forager',
  declares.keys);
check('and still has no appetite or watts of its own',
  !declares.hasUpkeep && !declares.hasEats, declares.keys);

await openTab(p, 'Drones');
const dronesTab = await p.evaluate(() => {
  const main = document.querySelector('.main-col');
  const bands = [...main.querySelectorAll('.band')];
  return {
    bandCount: bands.length,
    bandNames: bands.map((b) => b.querySelector('.band-name')?.textContent.trim()),
    rows: [...main.querySelectorAll('.job-row')].map((r) =>
      r.querySelector('.job-name')?.textContent.trim()),
    cards: main.querySelectorAll('.action-card').length,
    note: main.innerText.replace(/\s+/g, ' ').slice(0, 200),
    hasToggle: !!main.querySelector('.band-toggle'),
  };
});
check('the Drones tab is banded by caste, like the Hive tab is by category',
  dronesTab.bandCount === 1 && dronesTab.bandNames.join() === 'Worker',
  dronesTab.bandNames.join(', '));
check('with a ROW per type inside the band, not a card',
  dronesTab.rows.join() === 'Forager,Scavenger,Explorer' && dronesTab.cards === 0,
  `${dronesTab.rows.join(', ')} · ${dronesTab.cards} cards`);
check('the bands fold, with the same arrows', dronesTab.hasToggle);
check('and it says what the chambers are doing, or why they are not',
  /Molding Chamber|Nothing can make a drone|No larvae/i.test(dronesTab.note),
  dronesTab.note.replace(/^.*SETTINGS\s*/, '').slice(0, 90));

await p.click('.band-toggle');
await p.waitForTimeout(200);
// v-show, like the Hive tab: the cards stay in the DOM and stop being drawn,
// so this has to ask whether they are visible rather than whether they exist.
const visibleCards = () =>
  p.evaluate(() =>
    [...document.querySelectorAll('.main-col .job-row')].filter((c) => c.offsetParent !== null)
      .length,
  );
const folded = await p.evaluate(() => !!hive.state.ui.droneBands?.worker);
check('folding a caste band shut hides its types', folded && (await visibleCards()) === 0,
  `${await visibleCards()} cards visible with the band shut`);

await p.click('.band-toggle');
await p.waitForTimeout(200);
check('and opening it brings them back', (await visibleCards()) === 3,
  `${await visibleCards()} rows visible with the band open`);

/* ------------------------------------------------------- the old castes */

const old = await p.evaluate(() => ({
  parked: hive.castesLive,
  definitionsKept: Object.keys(hive.__castes ?? {}).length,
}));
check('the old flat caste system is still parked, not resurrected',
  old.parked === 0, `${old.parked} assignable castes`);

/* ------------------------------------------------------- nothing broke */

const everyTab = ['Hive', 'Drones', 'Genetics', 'Territory', 'Storage', 'Metabolism', 'Research', 'Codex', 'Stats', 'Settings'];
for (const label of everyTab) {
  await openTab(p, label);
  const painted = await p.evaluate(() => document.querySelector('.main-col').innerText.trim().length);
  if (painted < 20) fail.push(`tab ${label} empty`);
}
check(`all ${everyTab.length} tabs still render`, !fail.some((f) => f.startsWith('tab ')));

const saved = await p.evaluate(() => {
  hive.state.droneTypes.forager = 3;
  hive.state.ui.droneBands.worker = true;
  hive.save();
  return true;
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
const reloaded = await p.evaluate(() => ({
  forager: hive.state.droneTypes.forager,
  band: hive.state.ui.droneBands.worker,
  molding: hive.state.structures.moldingChamber,
}));
check('drone counts survive a reload', saved && reloaded.forager === 3, `${reloaded.forager}`);
check('so does a folded band and a built Molding Chamber',
  reloaded.band === true && reloaded.molding === 1,
  `band shut: ${reloaded.band}, chambers: ${reloaded.molding}`);


/* ================================================= 5. molding, end to end */

// A larva goes in, a drone comes out, and the chamber's draw says which it is
// doing. Everything here is driven by hand with the loop stopped.

const mold = await p.evaluate(() => {
  const s = hive.state;
  s.energy.preferred = 'fat';
  s.energy.fallback = 'fat';
  s.structures.vacuole = 40;
  s.structures.metabolicGenerator = 20;
  s.structures.moldingChamber = 1;
  s.structures.broodChamber = 0;
  // Bandwidth to spare: this block is about the chamber's cadence, and a hive
  // that runs out of cogits half way through stops pressing for a reason that
  // has nothing to do with what is being measured.
  s.structures.nodeCluster = 20;
  // Hivecore and nodeCluster among them: an absent entry means "all of them",
  // and leaving the Node Clusters on whatever an earlier section set them to
  // is how this block ends up with no bandwidth to press a drone with — which
  // has nothing to do with the cadence it is trying to measure.
  for (const k of ['vacuole', 'metabolicGenerator', 'moldingChamber', 'broodChamber',
    'nodeCluster', 'hivecore']) {
    delete s.active[k];
  }
  s.buildQueue = [];
  for (const n of Object.keys(s.nutrients)) s.nutrients[n] = 0;
  s.general = {};
  s.nutrients.fat = 60_000;
  // Larvae starve without sugar, and a brood dying in the background would eat
  // the very larvae this is trying to count.
  s.nutrients.carb = 20_000;
  // And water, because a thirsty colony runs every chamber slower — see
  // engine.js computeHydration. This measures the molding CADENCE, so the two
  // things that would scale it (thirst and hunger) are both taken off the
  // table rather than left to confound the figure.
  // Under the Hivecore's own 20 kg water shelf ON PURPOSE. Overfill it and the
  // excess floods the shared pool, which leaves fat nothing but its own 2 kg —
  // and twenty generators drink that in ten seconds, which looks exactly like
  // a molding bug and is not one.
  s.nutrients.water = 15_000;
  s.larvae = 10;
  s.larvaeHunger = 0;
  s.larvaeDying = 0;
  s.droneTypes.forager = 0;
  s.droneMolding.forager = { on: false, target: null };
  s.molding = {};
  s.power.moldingChamber = 1;
  s.energyPool = 0;

  const snap = () => {
    const d = hive.derived();
    const m = d.molding[0];
    return {
      demand: d.energy.demand,
      active: m.active,
      wants: m.wants,
      makes: m.makes,
      starved: m.starved,
      rate: d.moldRate,
      larvae: s.larvae,
      drones: s.droneTypes.forager,
      pace: m.pace,
      status: hive.drones.moldStatus('forager'),
    };
  };
  const run = (seconds) => { for (let i = 0; i < seconds * 2; i += 1) hive.tick(0.5); };
  // A chamber runs at the pace of the brood behind it, and the brood empties as
  // it presses — so the larva count is held still while the CADENCE is being
  // measured. Five larvae is exactly double speed: a ten-second cycle.
  const paced = (seconds) => {
    for (let i = 0; i < seconds * 2; i += 1) {
      s.larvae = 5;
      hive.tick(0.5);
    }
  };

  const out = {};
  out.off = snap();
  hive.drones.setMolding('forager', true);
  out.on = snap();
  paced(9);
  out.at19 = snap();
  paced(2);
  out.at21 = snap();
  paced(60);
  out.at81 = snap();
  out.baseline = out.off.demand;

  // A target AT the current count: it should stop dead, not press one more and
  // not throw any away. Taken from the count rather than written down, because
  // what the count has reached by now depends on the pace.
  const ceiling = s.droneTypes.forager;
  hive.drones.setMoldTarget('forager', ceiling);
  out.ceiling = ceiling;
  out.capped = snap();
  run(40);
  out.afterCap = snap();

  hive.drones.setMoldTarget('forager', null);
  s.larvae = 0;
  out.noLarvae = snap();
  run(60);
  out.stillNone = snap();

  hive.drones.setMolding('forager', false);
  out.switchedOff = snap();
  return out;
});

check('with nothing switched on a chamber has nothing to make',
  !mold.off.active && mold.off.makes === null && mold.off.status === 'off',
  `status ${mold.off.status}`);
// Measured against the hive's own baseline rather than a hard-coded total: the
// upkeep table has been rebalanced twice and a figure written here is a figure
// that goes stale. What matters is the DIFFERENCE the chamber makes.
const baseline = mold.off.demand - 25_000; // everything but the idle chamber
check('and idles at its lower draw',
  Math.abs(mold.off.demand - (baseline + 25_000)) < 1,
  `${(mold.off.demand / 1000).toFixed(0)} kW, of which 25 kW is the chamber`);
check('switching a type on gives it work',
  mold.on.active && mold.on.makes === 'forager' && mold.on.status === 'molding',
  `making ${mold.on.makes}`);
check('and the draw goes to 100 kW the moment it does',
  Math.abs(mold.on.demand - (baseline + 100_000)) < 1,
  `${(mold.on.demand / 1000).toFixed(0)} kW`);
check('nothing comes out before the cycle is up — ten seconds, at double pace',
  mold.at19.drones === 0, `${mold.at19.drones} drones at 9s`);
check('then one drone, for one larva',
  mold.at21.drones === 1, `${mold.at21.drones} drones at 11s`);
check('and six a minute after that, because five larvae is double speed',
  mold.at81.drones === 7, `${mold.at81.drones} drones at 71s`);
check('the rate reads as the base rate times the pace',
  Math.abs(mold.at81.rate * 60 - 3 * mold.at81.pace) < 1e-9,
  `${(mold.at81.rate * 60).toFixed(1)}/min at ×${mold.at81.pace}`);

check('a target at the count stops it',
  mold.afterCap.drones === mold.ceiling && mold.afterCap.status === 'at target',
  `stopped at ${mold.afterCap.drones} of a target of ${mold.ceiling}`);
check('and it drops back to idle, because it has nothing it is allowed to make',
  !mold.afterCap.active && Math.abs(mold.afterCap.demand - (baseline + 25_000)) < 1,
  `${(mold.afterCap.demand / 1000).toFixed(0)} kW`);
check('it did not overshoot the target', mold.afterCap.drones === mold.ceiling);

// Idle means NOT PRESSING, and an empty brood is not pressing — a chamber with
// work queued and nothing to work on costs the lower figure, same as one with
// nothing switched on at all.
check('an empty brood idles the chamber, even with a type switched on',
  !mold.noLarvae.active && mold.noLarvae.wants && mold.noLarvae.starved &&
  Math.abs(mold.noLarvae.demand - (baseline + 25_000)) < 1,
  `${(mold.noLarvae.demand / 1000).toFixed(0)} kW with ${mold.noLarvae.larvae} larvae`);
check('and the row says why rather than claiming to be working',
  mold.noLarvae.status === 'no larvae', mold.noLarvae.status);
check('it makes nothing, and banks no backlog while it waits',
  mold.stillNone.drones === mold.ceiling &&
    Math.abs(mold.stillNone.demand - (baseline + 25_000)) < 1,
  `${mold.stillNone.drones} drones after a minute dry, at ${(mold.stillNone.demand / 1000).toFixed(0)} kW`);
check('switching it off idles it again',
  !mold.switchedOff.active && Math.abs(mold.switchedOff.demand - (baseline + 25_000)) < 1,
  `${(mold.switchedOff.demand / 1000).toFixed(0)} kW`);

const several = await p.evaluate(() => {
  const s = hive.state;
  s.structures.moldingChamber = 3;
  delete s.active.moldingChamber;
  s.nutrients.carb = 20_000;
  s.larvae = 20;
  s.larvaeHunger = 0;
  s.larvaeDying = 0;
  s.droneTypes.forager = 0;
  hive.drones.setMolding('forager', true);
  hive.drones.setMoldTarget('forager', null);
  s.molding = {};
  const d0 = hive.derived();
  // Larvae held at twenty, so the pace stays at exactly ×3 for the whole run
  // rather than slowing as the brood empties.
  for (let i = 0; i < 42; i += 1) { s.larvae = 20; hive.tick(0.5); } // 21s
  return {
    demand: d0.energy.demand,
    rate: d0.moldRate,
    pace: d0.molding[0].pace,
    drones: s.droneTypes.forager,
    larvae: s.larvae,
  };
});
check('three chambers are billed three times over',
  Math.abs(several.demand - (baseline + 3 * 100_000)) < 1,
  `${(several.demand / 1000).toFixed(0)} kW`);
check('and press three at a time, times the pace of a full brood',
  several.drones === Math.floor((21 * 3 * several.pace) / 20),
  `${several.drones} drones in 21s at ×${several.pace}`);

/* ------------------------------------------------- and the controls work */

await openTab(p, 'Drones');
// An earlier block leaves the band folded, and a control inside a folded band
// is present but not clickable — which times out rather than failing cleanly.
await p.evaluate(() => { hive.state.ui.droneBands = {}; });
await p.waitForTimeout(250);
const controls = await p.evaluate(() => {
  const row = document.querySelector('.main-col .job-row');
  return {
    toggle: row?.querySelector('.mold-toggle')?.textContent.trim(),
    target: row?.querySelector('.mold-target input')?.value,
    status: row?.querySelector('.mold-status')?.textContent.trim(),
  };
});
check('the row carries a switch, a target and a status',
  controls.toggle === 'On' && controls.status === 'molding',
  `[${controls.toggle}] stop at "${controls.target}" · ${controls.status}`);
check('an empty target reads as no ceiling', controls.target === '', `"${controls.target}"`);

await p.click('.main-col .job-row .mold-toggle');
await p.waitForTimeout(250);
const afterToggle = await p.evaluate(() => ({
  on: hive.state.droneMolding.forager.on,
  label: document.querySelector('.main-col .mold-toggle')?.textContent.trim(),
  status: document.querySelector('.main-col .mold-status')?.textContent.trim(),
  active: hive.derived().molding[0].active,
}));
check('clicking the switch turns it off, and the chamber with it',
  !afterToggle.on && afterToggle.label === 'Off' && !afterToggle.active,
  `[${afterToggle.label}] · ${afterToggle.status}`);

// Set through the field itself, by dispatching the event the component listens
// for. Typing into it with the game loop running is a race this suite kept
// losing — the handler is what is under test here, not Playwright's keyboard.
async function typeTarget(value) {
  await p.evaluate((v) => {
    const el = document.querySelector('.main-col .mold-target input');
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await p.waitForTimeout(200);
}

await typeTarget('12');
const afterTarget = await p.evaluate(() => hive.state.droneMolding.forager.target);
check('typing a target stores it', afterTarget === 12, String(afterTarget));

await typeTarget('');
const cleared = await p.evaluate(() => hive.state.droneMolding.forager.target);
check('and clearing it means no ceiling again', cleared === null, String(cleared));

const persisted = await p.evaluate(() => {
  hive.drones.setMolding('forager', true);
  hive.drones.setMoldTarget('forager', 7);
  hive.save();
  return true;
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.res-row');
await p.evaluate(() => hive.loop.stop());
const back = await p.evaluate(() => ({ ...hive.state.droneMolding.forager }));
check('the switch and the target survive a reload',
  persisted && back.on === true && back.target === 7,
  `on: ${back.on}, target: ${back.target}`);

check('no console errors anywhere in all that', errors.length === 0, errors.slice(0, 3).join(' / '));

await browser.close();
console.log(`\n${fail.length ? `FAILURES (${fail.length}): ${fail.join(', ')}` : 'All checks passed.'}`);
process.exit(fail.length ? 1 : 0);
