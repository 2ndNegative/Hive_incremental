<script setup>
/**
 * Territory — what the hive holds, and what holding it means.
 *
 * Area does one job: it sets the odds. Every forage roll picks a biome weighted
 * by its share of the hive's land and then picks something from that biome, so
 * this tab is really a view of a probability distribution that happens to be
 * measured in square metres.
 *
 * The second panel is the part worth reading: for each gather type, what each
 * biome actually offers, so the consequences of a holding are visible before
 * the hive spends an hour discovering them.
 */
import { computed, ref } from 'vue';
import { state, derived, showInCodex, useDrafts } from '../../game/useGame.js';
import {
  BIOMES, CLIMATES, holdings, totalArea, biomeShares, needsLightText,
  isDangerous, colonisationBlock,
} from '../../game/definitions/biomes.js';
import { squarify } from '../../game/treemap.js';

import { GATHER_TYPES, poolFor } from '../../game/definitions/forage.js';
import { ORGANISMS, preyFor } from '../../game/definitions/organisms.js';
import { ITEMS } from '../../game/definitions/items/index.js';
import { DRONE_TYPES, foragingTypes } from '../../game/definitions/drones.js';
import { describeSlot, FORAGE_CYCLE } from '../../game/forage.js';
import { formatMass, formatMassFlow, formatArea } from '../../game/units.js';
import {
  claimCost, claimableArea, claimTerritory, abandonTerritory, DANGEROUS_CLAIM_MULTIPLIER,
  setLandTarget, fillLandTarget, clearLandTargets,
} from '../../game/actions.js';
import { NUTRIENTS, substitutedEntries } from '../../game/definitions/nutrients.js';
import { isPinned, pinHandlers } from '../../game/tips.js';
import {
  isStarred, isStarrable, starsFor, toggleStar, clearStars, focusedOdds, focusStrength,
  FOCUS_SHARE,
} from '../../game/focus.js';
import {
  isNamed, rateLabel, rateConfidence, timesFound, preyKey, RANGE_AT, EXACT_AT,
} from '../../game/discovery.js';
import { claimPreview, offersAnything } from '../../game/landvalue.js';
import { SNACK_SHARE } from '../../game/definitions/castes.js';

const area = computed(() => totalArea(state));
const land = computed(() => holdings(state)); // already sorted largest first
const shares = computed(() => biomeShares(state));

/**
 * The holdings as a treemap. Laid out against a fixed virtual frame and then
 * expressed in percentages, so it stretches with the panel without having to
 * measure anything — the aspect ratio only has to be roughly right for the
 * tiles to come out roughly square.
 */
const FRAME = { w: 1000, h: 300 };
/**
 * Ground an Explorer has mapped but the hive has not paid for, largest first.
 * It sits on the SAME treemap as the holdings — a patch of unclaimed forest is
 * next to the forest it was found from, which is the whole point of it — but
 * hatched, dimmed and labelled, because it is not doing anything yet.
 */
const mapped = computed(() =>
  Object.entries(state.unclaimed || {})
    .filter(([, area]) => area > 0)
    .map(([id, area]) => ({
      id,
      def: BIOMES[id],
      area,
      dangerous: isDangerous(id),
      blocked: colonisationBlock(state, id),
    }))
    .sort((a, b) => b.area - a.area),
);

const tiles = computed(() =>
  squarify(
    [
      ...land.value.map((h) => ({ id: h.id, value: h.area })),
      ...mapped.value.map((m) => ({ id: `unclaimed:${m.id}`, value: m.area })),
    ],
    FRAME.w,
    FRAME.h,
  ).map((t) => {
    const unclaimed = t.id.startsWith('unclaimed:');
    const biomeId = unclaimed ? t.id.slice('unclaimed:'.length) : t.id;
    const def = BIOMES[biomeId];
    const share = unclaimed ? 0 : shares.value[biomeId] || 0;
    // A tile too small for its own name hands the job to the legend below.
    const roomForName = t.w > 120 && t.h > 40;
    const roomForFigure = t.w > 74 && t.h > 22;
    return {
      id: t.id,
      biomeId,
      unclaimed,
      dangerous: unclaimed && isDangerous(biomeId),
      blocked: unclaimed ? colonisationBlock(state, biomeId) : null,
      def,
      share,
      area: t.value,
      // Worked out HERE rather than called from the template, for two reasons.
      // It was `topFinds(t.id)` down there, and for a mapped tile `t.id` is
      // "unclaimed:forest" rather than a biome — so every hatched tile reported
      // that the ground offers nothing at all, which is the one tooltip a
      // player reads before deciding whether to pay for it. And the template
      // called it twice per tile, each call walking the whole forage table, on
      // every one of the ten renders a second.
      finds: topFinds(biomeId),
      roomForName,
      roomForFigure,
      // Too small for any label at all — and therefore too small for the
      // padding that holds one. `box-sizing: border-box` shrinks the CONTENT
      // box, never the padding, so a tile with 6px of vertical padding has a
      // floor of 14px however small the layout says it is. That floor, not the
      // 3px one, is what pushed the bottom row out of the map.
      sliver: !roomForName && !roomForFigure,
      // A tooltip on a tile at the right-hand edge of the map opens off the
      // side of the window — and the tiles at that edge are the smallest ones,
      // which are exactly the ones a player needs the tooltip to read. So the
      // right-hand half of the map hangs its tooltips the other way.
      tipRight: t.x + t.w > FRAME.w * 0.5,
      ink: needsLightText(def.colour) ? '#eef1f5' : '#0f1113',
      inkDim: needsLightText(def.colour) ? 'rgba(238,241,245,0.78)' : 'rgba(15,17,19,0.74)',
      // THE MINIMUM SIZE IS CLAMPED INTO THE FRAME, not just applied.
      //
      // A sliver — 0.7 m² of desert against 464 m² of everything else — lays
      // out a fraction of a pixel tall, and a floor of 3px is what keeps it
      // visible and hoverable. But the floor used to be a `min-height` in the
      // stylesheet applied to a tile positioned by `top`, so the last tile in
      // the bottom row grew DOWNWARDS out of the map and hung below the panel.
      //
      // Done here in `min()`/`max()` rather than in the stylesheet because the
      // clamp needs both numbers at once: the floor is in pixels, the position
      // is a percentage, and only the browser knows how many pixels a percent
      // is. `overflow: hidden` is not the fix — see the note on .terr-map;
      // it would take the tooltips with it.
      style: {
        left: `min(${(t.x / FRAME.w) * 100}%, calc(100% - max(3px, ${(t.w / FRAME.w) * 100}%)))`,
        top: `min(${(t.y / FRAME.h) * 100}%, calc(100% - max(3px, ${(t.h / FRAME.h) * 100}%)))`,
        width: `max(3px, ${(t.w / FRAME.w) * 100}%)`,
        height: `max(3px, ${(t.h / FRAME.h) * 100}%)`,
        // `backgroundColor`, never the `background` shorthand: the shorthand
        // resets `background-image`, and an inline style beats the stylesheet,
        // so it would silently wipe the hatching off every unclaimed tile.
        backgroundColor: def.colour,
      },
    };
  }),
);

/* ------------------------------------------------------------- claiming it */

/** Which patch the claim dialog is open on, or null. */
const claiming = ref(null);
/** What the player has dialled in, in square metres. */
const claimWant = ref(0);

function openClaim(tile) {
  if (!tile.unclaimed) return;
  claiming.value = tile.biomeId;
  claimWant.value = Math.min(
    state.unclaimed?.[tile.biomeId] || 0,
    Math.max(0, claimableArea(tile.biomeId)),
  );
}
function closeClaim() {
  claiming.value = null;
}

const claimPatch = computed(() => {
  const id = claiming.value;
  if (!id) return null;
  const area = state.unclaimed?.[id] || 0;
  if (area <= 0) return null;
  const want = Math.max(0, Math.min(Number(claimWant.value) || 0, area));
  const unit = claimCost(id, 1);
  const bill = claimCost(id, want);
  return {
    id,
    def: BIOMES[id],
    area,
    want,
    unit,
    bill,
    // Which lines of the bill are bulk standing in for an element the hive
    // cannot see yet. Coloured, not explained — see substitutedEntries.
    standingIn: substitutedEntries(unit),
    affordable: want > 0 && Object.entries(bill).every(([n, g]) => (state.nutrients[n] || 0) >= g),
    most: claimableArea(id),
    dangerous: isDangerous(id),
    multiplier: DANGEROUS_CLAIM_MULTIPLIER,
    blocked: colonisationBlock(state, id),
  };
});

function doClaim() {
  const patch = claimPatch.value;
  if (!patch) return;
  if (claimTerritory(patch.id, patch.want) > 0) closeClaim();
}
function doAbandon() {
  if (claiming.value) abandonTerritory(claiming.value);
  closeClaim();
}

/** What the explorers are doing, for the panel above the map. */
const expeditions = computed(() => derived.value.expeditions ?? []);

/** What the selected gather type would find on one biome, for its tooltip. */
function topFinds(biomeId, limit = 4) {
  const raw =
    gather.value === 'hunter'
      ? [...preyFor(biomeId).map((p) => ({ name: ORGANISMS[p.organismId].name, weight: p.weight })),
         ...poolFor('hunter', biomeId).map((p) => ({ name: ITEMS[p.itemId].name, weight: p.weight }))]
      : poolFor(gather.value, biomeId).map((p) => ({ name: ITEMS[p.itemId].name, weight: p.weight }));
  const total = raw.reduce((a, e) => a + e.weight, 0);
  return raw
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((e) => ({ ...e, chance: total > 0 ? e.weight / total : 0 }));
}

const GATHERS = ['forager', 'scavenger', 'hunter', 'excavator', 'siphon'];
const gather = computed({
  get: () => state.ui.territoryGather || 'forager',
  set: (v) => { state.ui.territoryGather = v; },
});

/** What each held biome offers for the selected gather type, likeliest first. */
/**
 * What the ground offers — as far as the hive knows.
 *
 * The real table is complete from the first tick and the hive does not get to
 * see it. An entry it has never found shows as ??? at ?%: the player can see
 * that SOMETHING is there, and how many somethings, but not what or how often.
 * Finding it once names it everywhere; finding it ten times in this biome
 * brackets the rate; twenty-five resolves it.
 *
 * Deliberately still sorted by the TRUE rate, so the list order is itself a
 * weak hint — the hive can tell that the top of the list is commoner than the
 * bottom long before it can say by how much.
 */
const offerings = computed(() =>
  land.value.map((h) => {
    const raw =
      gather.value === 'hunter'
        ? preyFor(h.id).map((p) => ({
          id: p.organismId, key: preyKey(p.organismId),
          name: ORGANISMS[p.organismId].name, weight: p.weight, prey: true,
        }))
        : poolFor(gather.value, h.id).map((p) => ({
          id: p.itemId, key: p.itemId, name: ITEMS[p.itemId].name, weight: p.weight,
        }));
    const total = raw.reduce((a, e) => a + e.weight, 0);
    // What a trip to this ground ACTUALLY comes back with once the stars are
    // on. With nothing starred this is just the natural distribution again.
    const odds = focusedOdds(state, gather.value, h.id, raw.map((e) => ({ ...e })));
    const stars = starsFor(state, gather.value, h.id);
    // A star on something this ground no longer offers. Kept rather than
    // silently dropped — the player put it there — but it claims nothing, so
    // the panel has to say so or it reads as a focus that stopped working.
    const live = new Set(raw.map((e) => e.key));
    const dead = stars.filter((k) => !live.has(k));
    return {
      ...h,
      share: shares.value[h.id] || 0,
      starCount: stars.length - dead.length,
      dead: dead.length,
      // What each star is worth here, for the panel's one-line summary.
      strength: focusStrength(stars.length - dead.length),
      entries: raw
        .map((e) => {
          const chance = total > 0 ? e.weight / total : 0;
          const named = isNamed(state, e.key);
          const seen = timesFound(state, h.id, e.key);
          const level = rateConfidence(state, h.id, e.key);
          return {
            ...e,
            chance,
            // What it is worth per trip with the stars applied. Shown beside
            // the natural rate rather than instead of it, so a player can see
            // what their own orders are doing rather than just the result.
            focused: odds[e.key] ?? chance,
            named,
            seen,
            level,
            starrable: isStarrable(state, h.id, e.key),
            starred: isStarred(state, gather.value, h.id, e.key),
            label: named ? e.name : '???',
            rate: rateLabel(state, h.id, e.key, chance),
            // How much more work would sharpen the figure.
            toNext: level === 'unknown' ? RANGE_AT - seen : level === 'range' ? EXACT_AT - seen : 0,
          };
        })
        .sort((a, b) => b.chance - a.chance),
    };
  }),
);

/** Star or unstar one find for the selected route on one biome. */
function star(biomeId, entry) {
  if (!entry.starrable && !entry.starred) return;
  toggleStar(state, gather.value, biomeId, entry.key);
}

/** Drop every star on one biome for the selected route. */
function unfocus(biomeId) {
  clearStars(state, gather.value, biomeId);
}

/** How much of the selected ground the hive has actually worked out. */
const learned = computed(() => {
  let known = 0;
  let exact = 0;
  let total = 0;
  for (const o of offerings.value) {
    for (const e of o.entries) {
      total += 1;
      if (e.named) known += 1;
      if (e.level === 'exact') exact += 1;
    }
  }
  return { known, exact, total };
});

/**
 * WHO IS STANDING WHERE, grouped by the ground they are standing on.
 *
 * A crew is one drone TYPE on one BIOME, and a patch inside it is one drone.
 * Both of those used to be something else — a patch was 36 m² of unspecified
 * ground worked by a fraction of a drone, and which biome it rolled was luck —
 * so this panel used to be a flat list of twenty-five rows in no order, each
 * stamped with the same drones-per-patch figure as if it varied.
 *
 * The rows are AGGREGATED BY ITEM rather than listed per drone. Eight foragers
 * on acorns is one line that says eight, not eight lines that say one, and it
 * keeps reading at sixty drones as well as at six — which the per-drone version
 * would not, and that was the real objection to a patch being a drone.
 */
const outNow = computed(() => {
  const groups = [];
  for (const biome of derived.value.land?.biomes ?? []) {
    const crews = [];
    let rate = 0;
    for (const crew of derived.value.crews ?? []) {
      if (crew.biomeId !== biome.biomeId) continue;
      // itemId -> { drones on it, what they are bringing in }
      const byItem = new Map();
      for (const patch of crew.patches) {
        const key = patch.itemId ?? '';
        const row = byItem.get(key) ?? {
          key, itemId: patch.itemId, drones: 0, rate: 0, grams: 0,
        };
        row.drones += 1;
        row.rate += patch.rate;
        row.grams += patch.grams;
        byItem.set(key, row);
      }
      const rows = [...byItem.values()]
        .map((row) => ({
          ...row,
          id: `${crew.droneId}-${biome.biomeId}-${row.key}`,
          // The average trip weight across the drones on this find, which is
          // what the tooltip wants — the sum would be a number nothing means.
          each: row.drones > 0 ? row.grams / row.drones : 0,
          found: describeSlot({ itemId: row.itemId }, biome.biomeId),
        }))
        .sort((a, b) => b.rate - a.rate);
      crews.push({ ...crew, name: DRONE_TYPES[crew.droneId]?.name ?? crew.droneId, rows });
      rate += crew.rate;
    }
    if (crews.length) groups.push({ ...biome, crews, rate });
  }
  return groups.sort((a, b) => b.rate - a.rate);
});

/** What the land is doing overall. */
const ground = computed(
  () => derived.value.land ?? { area: 0, patches: 0, working: 0, idle: 0, biomes: [] },
);
const totalRate = computed(() => outNow.value.reduce((a, g) => a + g.rate, 0));
const anyPatches = computed(() => outNow.value.length > 0);

/*
 * THE TAIL OF THE HAUL.
 *
 * The panel lists one line per FIND, and a temperate forest pool holds
 * twenty-nine of them. A hive working four biomes therefore produces eighty-odd
 * lines, of which the bottom sixty are a tenth of a gram apiece — and those
 * lines are not information about the haul, they are the shape of the pool,
 * which "what the ground offers" already draws in full.
 *
 * So anything under a hundredth of the hive's intake folds into one line per
 * biome. The top few are always shown, so a biome never collapses to nothing
 * but its own tail, and a drone that found NOTHING is never folded: an empty
 * roll is a wasted drone, which is the one zero in here worth reading.
 */
const TAIL_SHARE = 0.01;
const KEEP_AT_LEAST = 3;
/*
 * And a hard cap per biome on top of the share rule, because the share rule
 * alone does not bound anything: twenty finds at 3% each are all above the
 * threshold and all of them are the twentieth-biggest thing the hive eats.
 * Five is what fits beside a biome heading without the heading being lost.
 */
const MOST_ROWS = 5;

/** Expanded tails, remembered across sessions like the grid's small-ground fold. */
const showAllFinds = computed({
  get: () => state.ui.terrAllFinds === true,
  set: (v) => { state.ui.terrAllFinds = v; },
});

/**
 * One row per find, flattened across the crews on a biome.
 *
 * Crews stop being headings and become a COLUMN. A biome with foragers and
 * scavengers on it used to print two sub-headings and then repeat the crew name
 * and the drone count on every row underneath them, in a help line that also
 * carried the forage cycle — the same twelve seconds, on every row in the
 * panel. The cycle is stated once in the panel's own header; the crew is a
 * word in its own column; and the rows sort by what they bring in, across both
 * crews, because "what is actually feeding the hive" does not care which kind
 * of drone fetched it.
 */
const outGroups = computed(() => {
  const total = totalRate.value;
  // The bar is drawn against the BIGGEST find in the hive, not against the
  // whole haul. Against the haul every bar is a stub — forty finds share one
  // hundred per cent between them — and a chart where nothing reaches a tenth
  // of its track is a chart of nothing. The percentage printed beside it is
  // still the true share, so the absolute figure is not lost.
  const peak = outNow.value.reduce((best, b) => b.crews.reduce(
    (m, c) => c.rows.reduce((n, r) => Math.max(n, r.rate), m), best,
  ), 0);

  return outNow.value.map((g) => {
    const rows = [];
    for (const c of g.crews) {
      for (const r of c.rows) rows.push({ ...r, crewName: c.name, crew: c });
    }
    rows.sort((a, b) => b.rate - a.rate);

    const shown = [];
    const folded = [];
    rows.forEach((r, i) => {
      const big = i < KEEP_AT_LEAST || !r.itemId
        || (i < MOST_ROWS && (total <= 0 || r.rate / total >= TAIL_SHARE));
      (showAllFinds.value || big ? shown : folded).push(r);
    });

    return {
      ...g,
      // Share of the WHOLE hive's intake, not of this biome's — so the figures
      // are comparable down the panel, which is the only reason to print them.
      shown: shown.map((r) => ({
        ...r,
        share: total > 0 ? r.rate / total : 0,
        bar: peak > 0 ? r.rate / peak : 0,
      })),
      tail: folded.length ? {
        count: folded.length,
        drones: folded.reduce((a, r) => a + r.drones, 0),
        rate: folded.reduce((a, r) => a + r.rate, 0),
        // The folded rows carry their share too. A long flat tail can be half
        // the biome's haul, and a fold that hides how much it hides is a lie
        // about where the food is coming from.
        share: total > 0 ? folded.reduce((a, r) => a + r.rate, 0) / total : 0,
      } : null,
    };
  });
});

/** Rows folded away across the whole panel, for the expand control's label. */
const foldedFinds = computed(
  () => outGroups.value.reduce((a, g) => a + (g.tail?.count ?? 0), 0),
);

/* --------------------------------------------------------------- assignment */

/**
 * The assignment panel: every biome held, every forage type, and the room each
 * pairing has.
 *
 * `target` is the plan and `drones` is who actually turned up — they differ
 * whenever the hive has not molded enough yet, which is the case the panel
 * exists to make visible. `planned` is the efficiency the target WOULD run at,
 * so a wetland laid out for four hunters reads as full before the first hunter
 * exists.
 */
const plan = computed(() => {
  const rates = {};
  for (const c of derived.value.crews ?? []) rates[`${c.biomeId}:${c.droneId}`] = c.rate;

  return (derived.value.land?.biomes ?? []).map((biome) => {
    const rows = FORAGE_TYPES.map((typeId) => {
      const def = DRONE_TYPES[typeId];
      // Straight off the engine's own figures where the crew exists, so the
      // panel and the simulation cannot disagree about who has how much room.
      // A type with nothing here yet gets the empty case worked out the same
      // way: what is left of the biome once the rest of the plan has taken its
      // share. THAT is the number the player is acting on.
      const crew = biome.crews.find((c) => c.droneId === typeId);
      const otherClaim = biome.crews
        .filter((c) => c.droneId !== typeId)
        .reduce((a, c) => a + c.target * c.range, 0);
      const free = crew ? crew.free : Math.max(0, biome.area - otherClaim);
      const room = Math.floor(free / def.range);
      const alone = crew?.alone ?? Math.floor(biome.area / def.range);
      const planned = crew?.planned ?? 0;
      const offers = offersAnything(def.gather, biome.biomeId);
      return {
        droneId: typeId,
        name: def.name,
        range: def.range,
        target: crew?.target ?? 0,
        drones: crew?.drones ?? 0,
        rate: rates[`${biome.biomeId}:${typeId}`] ?? 0,
        free,
        room,
        // What it would carry with the ground to itself, so a contested biome
        // can say both: "room for 1 — 29 if the scavengers were not here".
        alone,
        contested: room < alone,
        // Square metres to the next whole one, against the ground left over.
        toNext: (room + 1) * def.range - free,
        efficiency: crew?.efficiency ?? 0,
        planned,
        // Ground that offers this route nothing at all. A crew sent here comes
        // back empty every single time, which the grid has to say before the
        // player spends an hour finding out.
        offers,
        // One word for the cell's colour, so the template does not carry the
        // thresholds: they are a reading of the crowding curve and belong with
        // the figure they describe.
        tone: !offers ? 'bad' : planned === 0 ? 'muted'
          : planned > 0.85 ? 'good' : planned > 0.4 ? 'warn' : 'bad',
        // The share of its ration this crew would still owe the stores. A
        // drone grazes in proportion to what it finds, so crowding raises the
        // food bill at the same time as it lowers the haul — see SNACK_SHARE.
        keep: 1 - SNACK_SHARE * (offers ? (planned || crew?.efficiency || 0) : 0),
      };
    });

    return {
      ...biome,
      rows,
      rate: rows.reduce((a, r) => a + r.rate, 0),
      // GROUND NOTHING CAN WORK. A 0.7 m² sliver of desert holds no drone of
      // any type and never will until it grows — but it used to take exactly
      // as much of the screen as 156 m² of forest, which is how fourteen
      // biomes became seventeen hundred pixels. Folded away by default,
      // unless the player has deliberately put something on it.
      tiny: rows.every((r) => r.room < 1 && r.target === 0 && r.drones === 0),
    };
  });
});

/** Fold away ground too small to carry anything. Remembered across sessions. */
const hideSmall = computed({
  get: () => state.ui.terrHideSmall !== false,
  set: (v) => { state.ui.terrHideSmall = v; },
});
const tinyRows = computed(() => plan.value.filter((b) => b.tiny));
/*
 * BIGGEST GROUND FIRST, not declared order.
 *
 * The list is sorted by area because the grid exists to be compared down a
 * column, and the thing that decides whether a biome is worth a column's
 * attention is how much of it there is. Declared order put 6.5 m² of temperate
 * rainforest above 47 m² of taiga, which is an arbitrary ranking presented as
 * if it meant something.
 */
const shownPlan = computed(() =>
  (hideSmall.value ? plan.value.filter((b) => !b.tiny) : [...plan.value])
    .slice()
    .sort((a, b) => b.area - a.area));

/** The foot of the grid: what the hive is holding against what it has placed. */
const placed = computed(() => FORAGE_TYPES.map((typeId) => {
  let sent = 0;
  for (const b of plan.value) {
    sent += b.rows.find((r) => r.droneId === typeId)?.drones ?? 0;
  }
  return { droneId: typeId, sent, held: state.droneTypes?.[typeId] || 0 };
}));

/** Forage types that exist as drones, for the assignment grid's columns. */
const FORAGE_TYPES = foragingTypes();

/**
 * The target fields, one per (biome × type), keyed "<biome>:<type>".
 *
 * Through a draft, because this tab re-renders ten times a second and a bound
 * `value` is otherwise put back between keystrokes — the field sat at zero
 * however much was typed into it. See `useDrafts`, which the Drones tab's
 * molding targets share.
 */
// A target of nobody shows as an EMPTY box with a 0 placeholder rather than a
// literal 0. A box reading "0" means clicking into it and typing 12 gives you
// 120, which is the kind of small cruelty nobody reports and everybody notices.
const key = (biomeId, typeId) => `${biomeId}:${typeId}`;
const target = useDrafts((k, raw) => {
  const [biomeId, typeId] = k.split(':');
  setLandTarget(biomeId, typeId, raw);
});

/**
 * The stepper and `fill` write state by another route, so the draft has to go
 * — otherwise the box keeps showing what was typed rather than what was set.
 */
function bump(biomeId, typeId, by) {
  const row = plan.value
    .find((b) => b.biomeId === biomeId)?.rows.find((r) => r.droneId === typeId);
  setLandTarget(biomeId, typeId, Math.max(0, (row?.target ?? 0) + by));
  target.clear(key(biomeId, typeId));
}
function fill(biomeId, typeId) {
  fillLandTarget(biomeId, typeId);
  target.clear(key(biomeId, typeId));
}
/**
 * Wipe the whole plan.
 *
 * One control rather than a `clear` on every biome: with the grid, a single
 * biome is cleared by zeroing its cells, and fourteen clear links were
 * fourteen more things in the way of the numbers.
 */
function clearPlan() {
  clearLandTargets();
  for (const b of plan.value) {
    for (const r of b.rows) target.clear(key(b.biomeId, r.droneId));
  }
}

/* ----------------------------------------------- what a claim would be worth */

/**
 * The claim dialog's second half: not what this ground costs, but what it does.
 *
 * Recomputed as the player moves the figure, from the same arithmetic the engine
 * runs — see landvalue.js. What it leads with is now a count of whole drones
 * this ground would carry, because that is the thing being bought. The intake
 * delta is underneath, and is often zero: ground with nobody assigned to it
 * grows nothing until the player sends someone.
 */
const claimValue = computed(() => {
  const patch = claimPatch.value;
  if (!patch || patch.want <= 0 || patch.blocked) return null;
  const d = derived.value;
  const preview = claimPreview(state, patch.id, patch.want, {
    vigour: d.vigour ?? 1,
    harvest: d.land?.harvest ?? 1,
  });
  return {
    ...preview,
    // Only the movers worth a line, and only ones the hive could name. An
    // unnamed find would be "??? +1.2 g/s", which spoils that there is
    // something there without saying anything useful about it.
    movers: preview.shifts.filter((x) => x.label && Math.abs(x.delta) > 1e-4).slice(0, 4),
    unknowns: preview.shifts.filter((x) => !x.label && x.delta > 1e-4).length,
  };
});

</script>

<template>
  <div class="main-col">
    <!-- ------------------------------------------------------- the holdings -->
    <div class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Holdings</span>
        <span class="muted num">{{ formatArea(area) }} m²</span>
      </div>

      <div class="panel-body">
        <p class="muted" style="font-size: 0.78rem; margin: 0 0 0.5rem">
          Every time a drone goes out it picks a patch of this land at random — weighted by nothing
          but area — and brings back whatever that patch had. Half city and half forest is a coin
          flip, every time.
        </p>
      </div>

      <div v-if="!land.length" class="panel-body">
        <span class="warn" style="font-size: 0.78rem">
          The hive holds no ground. Nothing can be found anywhere.
        </span>
      </div>

      <div v-else class="panel-body">
        <!-- Every tile's AREA is its share of the next roll. No axis to read
             and no bars to compare: the biggest thing on screen is the thing
             the hive is most likely to find. -->
        <div class="terr-map">
          <div
            v-for="t in tiles"
            :key="t.id"
            class="terr-tile tip"
            :class="{
              'tip-right': t.tipRight,
              'is-pinned': isPinned(`terr:${t.id}`),
              'is-unclaimed': t.unclaimed,
              'is-blocked': Boolean(t.blocked),
              'is-dangerous': t.dangerous,
              'is-sliver': t.sliver,
            }"
            :style="t.style"
            :role="t.unclaimed ? 'button' : null"
            :tabindex="t.unclaimed ? 0 : null"
            v-on="pinHandlers(`terr:${t.id}`)"
            @click="openClaim(t)"
            @keydown.enter="openClaim(t)"
          >
            <span v-if="t.roomForName" class="terr-tile-name" :style="{ color: t.ink }">
              {{ t.def.name }}
            </span>
            <span v-if="t.roomForFigure" class="terr-tile-figure" :style="{ color: t.inkDim }">
              <template v-if="t.unclaimed">{{ formatArea(t.area) }} m² · ?</template>
              <template v-else>
                {{ formatArea(t.area) }} m² · {{ (t.share * 100).toFixed(0) }}%
              </template>
            </span>
            <span v-if="t.unclaimed && !t.roomForFigure" class="terr-tile-flag">?</span>

            <span class="tip-body">
              <!-- Type and size first, because on a sliver too small to label
                   the tooltip is the only place either of them appears. -->
              <span class="tip-title">
                {{ t.def.name }} · {{ formatArea(t.area) }} m²<span
                  v-if="t.unclaimed"
                  class="warn"
                > · unclaimed</span>
              </span>
              <span class="muted" style="display: block; margin-bottom: 0.3rem">
                {{ CLIMATES[t.def.climate] }} · {{ t.def.desc }}
              </span>
              <span v-if="t.unclaimed" class="tip-row">
                <span :class="t.blocked ? 'bad' : 'warn'">
                  {{ t.blocked || (t.dangerous ? 'People are on it.' : 'Mapped, not taken.') }}
                </span>
                <span>{{ t.blocked ? '—' : 'click to claim' }}</span>
              </span>
              <span class="tip-row">
                <span>{{ t.unclaimed ? 'Mapped' : 'Held' }}</span>
                <span>{{ formatArea(t.area) }} m²</span>
              </span>
              <span class="tip-row">
                <span>Share of every roll</span>
                <span>{{ (t.share * 100).toFixed(1) }}%</span>
              </span>
              <hr style="border-color: var(--border); margin: 0.3rem 0" />
              <span class="tip-title" style="font-size: 0.72rem">
                Likeliest {{ GATHER_TYPES[gather].name.toLowerCase() }} here
              </span>
              <span v-for="fnd in t.finds" :key="fnd.name" class="tip-row">
                <span>{{ fnd.name }}</span>
                <span>{{ (fnd.chance * 100).toFixed(0) }}%</span>
              </span>
              <span v-if="!t.finds.length" class="tip-row warn">
                <span>Nothing for this caste</span><span>—</span>
              </span>
            </span>
          </div>
        </div>

        <p v-if="mapped.length" class="muted" style="font-size: 0.76rem; margin: 0.5rem 0 0">
          The hatched tiles are ground the hive has MAPPED and not taken. Click one to claim it.
        </p>

        <!-- The legend carries the slivers the map has no room to label. -->
        <div class="terr-legend">
          <div v-for="h in land" :key="h.id" class="terr-key">
            <span class="terr-key-dot" :style="{ background: h.def.colour }"></span>
            <span class="terr-key-name">{{ h.def.name }}</span>
            <span class="terr-key-num num">{{ formatArea(h.area) }} m²</span>
            <span class="terr-key-pct num">{{ ((shares[h.id] || 0) * 100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ----------------------------------------------------------- expeditions -->
    <div v-if="expeditions.length" class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Out past the edge</span>
        <span class="muted num">{{ expeditions.reduce((a, e) => a + e.count, 0) }}</span>
      </div>
      <div class="panel-body">
        <div v-for="e in expeditions" :key="e.droneId" class="field-row">
          <span class="field-label">
            {{ e.name }} <span class="muted">×{{ e.count }}</span>
            <span class="field-help">
              A trip takes {{ Math.round(e.seconds) }}s across {{ formatArea(area) }} m² of
              holdings — the more ground the hive stands on, the longer it takes to reach
              anywhere new.
            </span>
          </span>
          <span class="num muted">{{ (e.progress * 100).toFixed(0) }}%</span>
        </div>
        <div class="gut-meter" style="margin-top: 0.4rem">
          <span :style="{ width: `${(expeditions[0].progress || 0) * 100}%` }" />
        </div>
      </div>
    </div>

    <!-- ----------------------------------------------------- claiming the map -->
    <div v-if="claimPatch" class="modal-backdrop" @click.self="closeClaim">
      <div class="panel-box claim-box">
        <div class="panel-head">
          <span>{{ claimPatch.def.name }}</span>
          <span class="muted num">{{ formatArea(claimPatch.area) }} m² mapped</span>
        </div>

        <div class="panel-body">
          <p class="muted" style="font-size: 0.78rem; margin: 0 0 0.5rem">
            {{ claimPatch.def.desc }}
          </p>

          <p v-if="claimPatch.blocked" class="notice is-warn" style="margin: 0 0 0.5rem">
            <strong class="bad">{{ claimPatch.blocked }}</strong>
            An Explorer can map it, and that is all. Something the hive has not grown yet would
            have to change before any of this could be taken.
          </p>
          <p v-else-if="claimPatch.dangerous" class="notice is-warn" style="margin: 0 0 0.5rem">
            <strong class="warn">People are on this ground.</strong>
            It can be taken, at {{ claimPatch.multiplier }}× the usual price — the hive is not
            moving into an empty field, it is moving in around something that will notice.
          </p>

          <template v-if="!claimPatch.blocked">
            <div class="field-row">
              <span class="field-label">
                How much
                <span class="field-help">
                  Up to {{ formatArea(claimPatch.area) }} m² mapped; the hive can pay for
                  {{ formatArea(claimPatch.most) }} m² right now.
                </span>
              </span>
              <input
                v-model.number="claimWant"
                class="claim-input"
                type="number"
                min="0"
                :max="claimPatch.area"
                step="0.1"
                aria-label="Square metres to claim"
              />
            </div>

            <div class="stepper" style="margin-bottom: 0.5rem">
              <button class="btn" style="width: auto; height: auto" @click="claimWant = claimPatch.most">
                All it can pay for
              </button>
              <button class="btn" style="width: auto; height: auto" @click="claimWant = claimPatch.area">
                All of it
              </button>
            </div>

            <div class="data-table">
              <div v-for="(grams, n) in claimPatch.bill" :key="n" class="field-row">
                <span>{{ NUTRIENTS[n]?.name ?? n }}</span>
                <span
                  class="num"
                  :class="claimPatch.standingIn.has(n) ? 'cost-unassayed'
                    : (state.nutrients[n] || 0) >= grams ? '' : 'bad'"
                  :title="claimPatch.standingIn.has(n)
                    ? 'Bulk, standing in for an element the hive cannot pick out yet. Assaying it cuts the price fifty-fold.'
                    : null"
                >
                  {{ formatMass(grams) }}
                </span>
              </div>
            </div>

            <!-- ---------------------------------- and what it would be worth -->
            <template v-if="claimValue">
              <hr style="border-color: var(--border); margin: 0.6rem 0 0.5rem" />
              <div class="offer-head" style="margin-bottom: 0.3rem">
                <span>What this would do</span>
                <span
                  class="num"
                  :class="claimValue.rateGain > 0 ? 'good' : 'muted'"
                >{{ formatMassFlow(claimValue.rateGain) }}</span>
              </div>

              <!-- THE HEADLINE IS A COUNT OF DRONES. Room is per biome and
                   per type now, so "what would this carry" has whole numbers in
                   it, and the threshold — how much further to the next whole
                   one — is the sentence that turns a price into a goal. -->
              <div class="data-table">
                <div
                  v-for="c in claimValue.capacity"
                  :key="c.droneId"
                  class="field-row stacked-help"
                >
                  <span class="field-label">
                    {{ c.name }}
                    <span v-if="!c.offers" class="bad">· nothing here for them</span>
                    <span class="field-help">
                      {{ c.range }} m² each.
                      <template v-if="c.gain > 0">
                        <span class="good">Room for {{ c.gain }} more.</span>
                      </template>
                      <template v-else-if="c.none">
                        <span class="bad">Still {{ formatArea(c.needed) }} m² short of the
                          first one</span> — this much is not enough ground for even one.
                      </template>
                      <template v-else>
                        No extra room: {{ formatArea(c.shortBy) }} m² more would buy the next.
                      </template>
                    </span>
                  </span>
                  <span class="num">
                    {{ c.was }} → <strong :class="c.gain > 0 ? 'good' : ''">{{ c.have }}</strong>
                  </span>
                </div>
              </div>

              <p v-if="claimValue.employs > 0" class="notice" style="margin: 0.45rem 0 0">
                <strong class="good">{{ claimValue.employs }}
                  drone{{ claimValue.employs === 1 ? '' : 's' }} would walk over on their
                  own</strong>, pulled off ground nobody has claimed for them
                <template v-if="claimValue.rateGain > 0">
                  — worth {{ formatMassFlow(claimValue.rateGain) }}</template>. Set a target to
                send more, or to send different ones.
              </p>
              <p v-else class="notice" style="margin: 0.45rem 0 0">
                <strong>Nobody walks over on their own.</strong>
                Every drone the hive owns is pinned by a target somewhere else, so this buys
                room and nothing else until a target sends someone — which is usually the point
                of buying it.
              </p>

              <!-- What changes about WHAT comes in. The signed deltas matter:
                   more of one biome dilutes every other one, and a player about
                   to drown their acorns in roadkill should see it first. -->
              <template v-if="claimValue.movers.length">
                <div class="offer-head" style="margin: 0.5rem 0 0.2rem">
                  <span class="muted" style="font-size: 0.74rem">What comes in instead</span>
                </div>
                <div class="data-table">
                  <div v-for="m in claimValue.movers" :key="m.key" class="field-row">
                    <span>{{ m.label }}</span>
                    <span class="num" :class="m.delta > 0 ? 'good' : 'bad'">
                      {{ formatMassFlow(m.delta) }}
                    </span>
                  </div>
                </div>
              </template>
              <p
                v-if="claimValue.unknowns"
                class="muted"
                style="font-size: 0.74rem; margin: 0.35rem 0 0"
              >
                And {{ claimValue.unknowns }} thing{{ claimValue.unknowns === 1 ? '' : 's' }}
                on this ground the hive has never found, so it cannot say what they are worth.
              </p>
            </template>
          </template>
        </div>

        <div class="panel-body" style="display: flex; gap: 0.4rem">
          <button
            v-if="!claimPatch.blocked"
            class="btn"
            style="width: auto; height: auto"
            :disabled="!claimPatch.affordable"
            @click="doClaim"
          >
            Claim {{ formatArea(claimPatch.want) }} m²
          </button>
          <button class="btn" style="width: auto; height: auto" @click="doAbandon">
            Forget it
          </button>
          <button class="btn" style="width: auto; height: auto" @click="closeClaim">Close</button>
        </div>
      </div>
    </div>

    <!-- --------------------------------------------------- who works what ground -->
    <!--
      ONE GRID, NOT FOURTEEN FORMS.
      ======================================================================
      This was a stack of per-biome mini-forms, each row carrying six facts as
      a sentence: room, room-if-alone, metres to the next, planned rate, N of M
      there, keep. All true, none of it scannable — and at fourteen biomes it
      was seventeen hundred pixels of it.

      The decision the panel exists for is "where should THIS drone type go",
      which is a comparison down a column, and a column is the one thing a list
      of sentences cannot give you. So: biomes are rows, drone types are
      columns, and the prose moved into the cell's tooltip where it is still a
      hover away but is no longer in front of the numbers.
    -->
    <div v-if="plan.length" class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Who works what</span>
        <span class="muted num">{{ ground.working }} out · {{ ground.idle }} idle</span>
      </div>

      <div class="panel-body">
        <div class="assign-bar">
          <span class="muted" style="font-size: 0.78rem">
            A drone works one biome and finds only what is on it. Columns are the drone, rows
            are the ground — set a target and the hive sends them.
          </span>
          <span class="assign-bar-end">
            <label v-if="tinyRows.length" class="assign-toggle">
              <input v-model="hideSmall" type="checkbox" />
              Hide ground too small to work
              <span class="muted">({{ tinyRows.length }})</span>
            </label>
            <button class="focus-clear" @click="clearPlan">clear the plan</button>
          </span>
        </div>
        <p v-if="ground.idle > 0" class="warn" style="font-size: 0.78rem; margin: 0.4rem 0 0">
          <strong class="bad">{{ ground.idle }} standing idle.</strong>
          Every target is filled and these had nowhere left to go — raise one, or take ground.
        </p>
      </div>

      <div class="panel-body tight assign-scroll">
        <table class="assign-grid">
          <thead>
            <tr>
              <th scope="col">Ground</th>
              <th scope="col" class="num">Area</th>
              <th v-for="t in FORAGE_TYPES" :key="t" scope="col" class="assign-col">
                {{ DRONE_TYPES[t].name }}
                <span class="muted">{{ DRONE_TYPES[t].range }} m²</span>
              </th>
              <th scope="col" class="assign-fill-col">Committed</th>
              <th scope="col" class="num">Bringing in</th>
            </tr>
          </thead>

          <tbody>
            <tr v-for="b in shownPlan" :key="b.biomeId">
              <th scope="row" class="assign-ground">
                <span class="terr-key-dot" :style="{ background: b.def.colour }"></span>
                {{ b.def.name }}
              </th>
              <td class="num muted">{{ formatArea(b.area) }}</td>

              <td v-for="r in b.rows" :key="r.droneId" class="assign-cell">
                <span class="assign-controls">
                  <!-- WHO IS ACTUALLY THERE, when it differs from the plan.
                       Silent when the two agree, which is most cells most of
                       the time — a column of numbers that match the ones
                       beside them is a column of noise. It speaks up for the
                       gap while the hive molds into a target, and for drones
                       spread onto ground nobody has claimed. -->
                  <span
                    class="assign-now num"
                    :class="r.target > 0 ? 'warn' : 'muted'"
                    :title="r.drones !== r.target
                      ? `${r.drones} standing here now, against a target of ${r.target}`
                      : null"
                  >{{ r.drones === r.target ? '' : r.drones }}</span>
                  <button
                    class="btn-mini"
                    :disabled="r.target <= 0"
                    :aria-label="`Fewer ${r.name} on ${b.def.name}`"
                    @click="bump(b.biomeId, r.droneId, -1)"
                  >−</button>
                  <input
                    class="assign-input num"
                    :class="r.target > 0 ? r.tone : ''"
                    type="number"
                    min="0"
                    placeholder="0"
                    :value="target.value(key(b.biomeId, r.droneId), r.target || '')"
                    :aria-label="`${r.name} on ${b.def.name}`"
                    @input="target.input(key(b.biomeId, r.droneId), $event)"
                    @change="target.input(key(b.biomeId, r.droneId), $event)"
                    @blur="target.commit(key(b.biomeId, r.droneId))"
                  />
                  <button
                    class="btn-mini"
                    :aria-label="`More ${r.name} on ${b.def.name}`"
                    @click="bump(b.biomeId, r.droneId, 1)"
                  >+</button>

                  <!-- THE CAPACITY FIGURE IS THE FILL BUTTON. A fourth button
                       per cell would be four buttons × five types × twenty-six
                       biomes; the number you are filling TO is already there,
                       so clicking it is both the control and its own label. -->
                  <button
                    class="assign-cap tip"
                    :class="r.tone"
                    :disabled="!r.offers || r.room < 1"
                    :aria-label="`Fill ${b.def.name} with ${r.room} ${r.name.toLowerCase()}s`"
                    @click="fill(b.biomeId, r.droneId)"
                  ><span class="assign-cap-n">/{{ r.room }}</span><span class="tip-body tip-cell">
                    <span class="tip-title">{{ r.name }} · {{ b.def.name }}</span>
                    <template v-if="r.offers">
                      <span class="tip-row">
                        <span>Room at full rate</span>
                        <span>{{ r.room }}<template v-if="r.contested">
                          <span class="muted"> of {{ r.alone }} alone</span></template></span>
                      </span>
                      <span class="tip-row">
                        <span>{{ r.room < 1 ? 'Short of even one by' : 'Another would want' }}</span>
                        <span>{{ formatArea(r.toNext) }} m²</span>
                      </span>
                      <span v-if="r.target > 0" class="tip-row">
                        <span>Each one works at</span>
                        <span :class="r.tone">{{ (r.planned * 100).toFixed(0) }}%</span>
                      </span>
                      <span v-if="r.target > 0 && r.drones !== r.target" class="tip-row">
                        <span class="warn">Molded so far</span>
                        <span class="warn">{{ r.drones }} of {{ r.target }}</span>
                      </span>
                      <span v-if="r.target > 0" class="tip-row">
                        <span>Eats from the stores</span>
                        <span :class="r.keep > 0.75 ? 'bad' : ''">
                          {{ (r.keep * 100).toFixed(0) }}%
                        </span>
                      </span>
                      <span v-else-if="r.drones > 0" class="tip-row">
                        <span>Spread here by area, untargeted</span>
                        <span>{{ r.drones }}</span>
                      </span>
                      <span v-if="r.rate > 0" class="tip-row">
                        <span>Bringing in</span>
                        <span class="good">{{ formatMassFlow(r.rate) }}</span>
                      </span>
                      <!-- Only where the button does something. "Click to fill
                           this ground to 0" is an instruction to press a
                           control that is disabled precisely because there is
                           nothing to fill. -->
                      <span v-if="r.room >= 1" class="tip-note">
                        Click to fill this ground to {{ r.room }}.
                      </span>
                    </template>
                    <span v-else class="tip-note bad">
                      This ground offers the {{ r.name.toLowerCase() }} route nothing at all. A
                      drone sent here walks out, finds nothing and walks back, every trip.
                    </span>
                  </span></button>
                </span>
              </td>

              <td class="assign-fill-col">
                <span class="assign-meter tip" :class="{ 'is-pinned': false }">
                  <span class="assign-meter-track">
                    <span
                      class="assign-meter-fill"
                      :class="b.claimed > 1 ? 'is-over' : ''"
                      :style="{ width: `${Math.min(100, b.claimed * 100)}%` }"
                    ></span>
                  </span>
                  <span class="num" :class="b.claimed > 1 ? 'bad' : 'muted'">
                    {{ b.claimed > 0 ? `${(b.claimed * 100).toFixed(0)}%` : '—' }}
                  </span>
                  <span class="tip-body tip-cell">
                    <span class="tip-title">{{ b.def.name }} · {{ formatArea(b.area) }} m²</span>
                    <span v-if="b.claimed > 1" class="tip-row">
                      <span class="bad">Promised to more than it carries</span>
                      <span class="bad">{{ (b.claimed * 100).toFixed(0) }}%</span>
                    </span>
                    <span v-else class="tip-row">
                      <span>Ground the plan has spoken for</span>
                      <span>{{ (b.claimed * 100).toFixed(0) }}%</span>
                    </span>
                    <span class="tip-row">
                      <span>Drones standing on it</span><span>{{ b.drones }}</span>
                    </span>
                    <!-- A SENTENCE, SO A LINE OF ITS OWN. It was the value half
                         of a label-and-figure row, where it wrapped against a
                         label that was also wrapping and the two interleaved
                         into something that read like a rendering fault. -->
                    <span v-if="b.claimed > 1" class="tip-note">
                      Everyone on it works
                      {{ (b.planSqueeze * 100).toFixed(0) }}% of the ground they were
                      promised.
                    </span>
                  </span>
                </span>
              </td>

              <td class="num" :class="b.rate > 0 ? 'good' : 'muted'">
                {{ b.rate > 0 ? formatMassFlow(b.rate) : '—' }}
              </td>
            </tr>

            <tr v-if="hideSmall && tinyRows.length" class="assign-tiny">
              <th scope="row" class="assign-ground muted">
                {{ tinyRows.length }} biome{{ tinyRows.length === 1 ? '' : 's' }}
                too small for anything
              </th>
              <td class="num muted">
                {{ formatArea(tinyRows.reduce((a, b) => a + b.area, 0)) }}
              </td>
              <td :colspan="FORAGE_TYPES.length" class="assign-tiny-list muted">
                {{ tinyRows.map((b) => b.def.name.toLowerCase()).slice(0, 5).join(' · ')
                }}<template v-if="tinyRows.length > 5"> …</template>
              </td>
              <td class="assign-fill-col">
                <button class="focus-clear" @click="hideSmall = false">show</button>
              </td>
              <td class="num muted">—</td>
            </tr>
          </tbody>

          <tfoot>
            <tr>
              <th scope="row" class="assign-ground">Total</th>
              <td class="num">{{ formatArea(area) }}</td>
              <td v-for="t in placed" :key="t.droneId" class="assign-cell num">
                {{ t.sent }} <span class="muted">of {{ t.held }}</span>
              </td>
              <td class="assign-fill-col muted">
                {{ ground.idle > 0 ? `${ground.idle} idle` : 'nothing idle' }}
              </td>
              <td class="num good">{{ formatMassFlow(totalRate) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="panel-body assign-legend muted">
        <span><span class="good">green</span> room to spare</span>
        <span><span class="warn">amber</span> crowded, still worth it</span>
        <span><span class="bad">red</span> over its range — intake falls</span>
        <span class="assign-legend-end">hover a figure for the whole story</span>
      </div>
    </div>

    <!--
      ================================================= WHAT IS COMING IN, AND FROM WHERE

      Was: a biome heading, a crew heading, and then two lines per find — the
      find on one, and underneath it a help line repeating the crew name and the
      drone count and finishing "rolling again within 12s", which is the same
      twelve seconds on every row in the panel. Three facts, two lines, and a
      constant presented as if it varied.

      Now: one line per find, crews as a column, and a bar for the share each
      find is of the whole haul — because the question this panel answers is
      which of these is actually feeding the hive, and that is a comparison no
      column of absolute rates makes for you.
    -->
    <div v-if="anyPatches" class="panel-box" style="margin-bottom: 0.75rem">
      <div class="panel-head">
        <span>Out now</span>
        <span class="muted num">{{ formatMassFlow(totalRate) }}</span>
      </div>

      <div class="panel-body">
        <div class="land-stats">
          <span class="land-stat">
            <span class="land-stat-num num">{{ ground.working }}<span
              class="muted"
            >/{{ ground.working + ground.idle }}</span></span>
            <span class="land-stat-label">drones out</span>
          </span>
          <span class="land-stat">
            <span class="land-stat-num num">{{ outNow.length }}</span>
            <span class="land-stat-label">biomes worked</span>
          </span>
          <span class="land-stat">
            <span class="land-stat-num num">{{ formatArea(area) }}</span>
            <span class="land-stat-label">m² held</span>
          </span>
        </div>
        <!-- THE CYCLE, ONCE. It used to end every row in the panel. -->
        <div class="out-note muted">
          <span>Every drone works its own ground and rolls again within
            {{ FORAGE_CYCLE }}s. Bars measure each find against the biggest;
            the figure beside one is its share of the whole haul.</span>
          <button
            v-if="foldedFinds > 0 || showAllFinds"
            class="focus-clear"
            @click="showAllFinds = !showAllFinds"
          >{{ showAllFinds ? 'fold the small finds away'
            : `show ${foldedFinds} smaller find${foldedFinds === 1 ? '' : 's'}` }}</button>
        </div>
      </div>

      <div class="panel-body tight assign-scroll">
        <table class="out-grid">
          <thead>
            <tr>
              <th scope="col">Find</th>
              <th scope="col">Crew</th>
              <th scope="col" class="num">On it</th>
              <th scope="col" class="num">Each trip</th>
              <th scope="col" class="out-share-col">Share of the haul</th>
              <th scope="col" class="num">Brings in</th>
            </tr>
          </thead>

          <tbody>
            <template v-for="g in outGroups" :key="g.biomeId">
              <!-- THE GROUND, AND THE CREWS ON IT, AS A BAND ACROSS THE WHOLE
                   TABLE. The crew headings carried ×count, the rate each one
                   works at and the room it has; all three are properties of
                   the crew, not of any find, so they belong here rather than
                   above a block of rows that then repeat them.

                   It spans every column on purpose. Laid out in the columns
                   instead, the crew summary — the longest string in the panel —
                   set the width of a column holding the word "Forager", and
                   opened a hand's width of nothing between "on it" and "each
                   trip" on all forty find rows below it. -->
              <tr class="out-ground-row">
                <th scope="rowgroup" colspan="6" class="out-ground">
                  <!-- The flex row is INSIDE the cell. Putting `display: flex`
                       on the cell itself takes it out of the table's layout,
                       which quietly cancels the colspan and leaves the band
                       half the width of the grid it is meant to head. -->
                  <span class="out-ground-inner">
                    <span class="out-ground-name">
                      <span class="terr-key-dot" :style="{ background: g.def.colour }"></span>
                      {{ g.def.name }}
                      <span class="muted num">{{ formatArea(g.area) }} m² ·
                        {{ g.drones }} drone{{ g.drones === 1 ? '' : 's' }}</span>
                    </span>
                    <span class="out-crews">
                      <span v-for="c in g.crews" :key="c.droneId" class="crew-line">
                        {{ c.name }} ×{{ c.drones }}
                        <span
                          :class="c.efficiency > 0.85 ? 'muted'
                            : c.efficiency > 0.4 ? 'warn' : 'bad'"
                        >· {{ (c.efficiency * 100).toFixed(0) }}% each</span>
                        <span v-if="c.slots < c.drones" class="muted">
                          · room for {{ Math.floor(c.slots) }}
                        </span>
                      </span>
                    </span>
                    <span class="num" :class="g.rate > 0 ? 'good' : 'muted'">
                      {{ formatMassFlow(g.rate) }}
                    </span>
                  </span>
                </th>
              </tr>

              <tr v-for="r in g.shown" :key="r.id" class="out-find-row">
                <td class="out-find">
                  <button
                    v-if="r.itemId"
                    class="codex-link"
                    @click="showInCodex(r.itemId)"
                  >{{ r.found.label.toLowerCase() }}</button>
                  <span v-else class="warn tip">nothing found<span class="tip-body tip-cell">
                    <span class="tip-title">An empty trip</span>
                    These {{ r.drones }} went out, rolled, and came back with
                    nothing. Either the ground offers this route too little to
                    be worth standing on, or there are more drones here than it
                    has finds to go round.
                  </span></span>
                </td>
                <td class="out-crew muted">{{ r.crewName }}</td>
                <td class="num">{{ r.drones }}</td>
                <td class="num muted">{{ r.each ? formatMass(r.each) : '—' }}</td>
                <td class="out-share-col">
                  <span class="out-share">
                    <span class="out-share-track">
                      <span
                        class="out-share-fill"
                        :style="{ width: `${Math.min(100, r.bar * 100)}%` }"
                      ></span>
                    </span>
                    <span class="num muted">{{ (r.share * 100).toFixed(0) }}%</span>
                  </span>
                </td>
                <td class="num" :class="r.rate > 0 ? 'good' : 'bad'">
                  {{ formatMassFlow(r.rate) }}
                </td>
              </tr>

              <tr v-if="g.tail" class="out-tail-row">
                <td class="out-find muted">
                  <button class="focus-clear" @click="showAllFinds = true">
                    and {{ g.tail.count }} smaller find{{ g.tail.count === 1 ? '' : 's' }}
                  </button>
                </td>
                <td class="out-crew muted">—</td>
                <td class="num muted">{{ g.tail.drones }}</td>
                <td class="num muted">—</td>
                <!-- The share, but no track. An empty track beside "38%" reads
                     as a bar at zero, and a FULL one would draw thirteen finds
                     as though they were one big one. -->
                <td class="out-share-col num muted">
                  {{ (g.tail.share * 100).toFixed(0) }}%
                </td>
                <td class="num muted">{{ formatMassFlow(g.tail.rate) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ----------------------------------------------------- what is out there -->
    <div class="panel-box">
      <div class="panel-head">
        <span>What the ground offers</span>
      </div>

      <div class="panel-body">
        <div class="filter-row">
          <select v-model="gather">
            <option v-for="g in GATHERS" :key="g" :value="g">{{ GATHER_TYPES[g].name }}</option>
          </select>
          <span class="muted" style="font-size: 0.76rem">{{ GATHER_TYPES[gather].desc }}</span>
        </div>
        <p class="muted" style="font-size: 0.76rem; margin: 0.4rem 0 0">
          The hive knows {{ learned.known }} of {{ learned.total }} of these by name and has the
          exact rate for {{ learned.exact }}. Everything else it has to find out by going and
          looking — a thing is named the first time it turns up anywhere, bracketed after
          {{ RANGE_AT }} finds on the same ground, and pinned down after {{ EXACT_AT }}.
        </p>
        <p class="muted" style="font-size: 0.76rem; margin: 0.35rem 0 0">
          Star anything the hive has pinned down and this route will spend
          {{ (FOCUS_SHARE * 100).toFixed(0) }}% of its trips on that ground going after it. Stars
          are set per biome and per route, so the forest can work one thing while the river works
          another. A second star on the same ground splits the focus and weakens it — see the
          figure beside each one.
        </p>
      </div>

      <div v-for="o in offerings" :key="o.id" class="panel-body tight">
        <div class="offer-head">
          <span>{{ o.def.name }}</span>
          <span class="offer-head-right">
            <span v-if="o.starCount" class="focus-note">
              <span class="star-on">★</span>
              {{ o.starCount }} focused · {{ (o.strength * 100).toFixed(0) }}% of trips
              <button class="focus-clear" @click="unfocus(o.id)">clear</button>
            </span>
            <span v-if="o.dead" class="focus-note bad">
              {{ o.dead }} star{{ o.dead === 1 ? '' : 's' }} on nothing this ground offers
            </span>
            <span class="muted num">{{ (o.share * 100).toFixed(0) }}% of the hive's land</span>
          </span>
        </div>

        <div v-if="!o.entries.length" class="offer-empty warn">
          Nothing here for this caste. A drone sent out rolls this ground and comes back with
          nothing at all.
        </div>

        <div v-else class="offer-list">
          <span
            v-for="e in o.entries"
            :key="e.id"
            class="offer-chip tip"
            :class="{ 'is-pinned': isPinned(`offer:${o.id}:${e.id}`) }"
            v-on="pinHandlers(`offer:${o.id}:${e.id}`)"
          >
            <button
              v-if="!e.prey && e.named"
              class="codex-link"
              @click="showInCodex(e.id)"
            >{{ e.label }}</button>
            <span v-else :class="{ 'offer-unknown': !e.named }">{{ e.label }}</span>
            <span class="offer-pct" :class="e.level === 'exact' ? 'muted' : 'offer-vague'">
              {{ e.rate }}
            </span>
            <!-- What the orders did to it, beside what chance gives. Only on
                 ground where the stars are actually doing something, so an
                 unfocused biome reads exactly as it did before. -->
            <span v-if="o.starCount && e.starred" class="offer-focused">
              → {{ (e.focused * 100).toFixed(0) }}%
            </span>
            <button
              v-if="e.starrable || e.starred"
              class="star-btn"
              :class="{ 'star-on': e.starred }"
              :title="e.starred ? 'Stop focusing on this' : 'Focus this route here'"
              @click.stop="star(o.id, e)"
            >{{ e.starred ? '★' : '☆' }}</button>

            <span class="tip-body">
              <span class="tip-title">{{ e.label }}</span>
              <span class="tip-row">
                <span>Found here</span>
                <span>{{ e.seen }}×</span>
              </span>
              <span class="tip-row">
                <span>Chance per roll here</span><span>{{ e.rate }}</span>
              </span>
              <span v-if="e.level === 'exact'" class="tip-row">
                <span>Across the whole hive</span>
                <span>{{ (e.chance * o.share * 100).toFixed(1) }}%</span>
              </span>
              <span v-if="e.toNext > 0" class="tip-row muted" style="margin-top: 0.25rem">
                <span>{{ e.level === 'unknown' ? 'Bracket the rate in' : 'Pin it down in' }}</span>
                <span>{{ e.toNext }} more</span>
              </span>
              <template v-if="e.starred">
                <hr style="border-color: var(--border); margin: 0.3rem 0" />
                <span class="tip-row">
                  <span class="star-on">★ Focused — chance per trip</span>
                  <span class="star-on">{{ (e.focused * 100).toFixed(0) }}%</span>
                </span>
              </template>
              <span v-else-if="e.starrable" class="tip-row muted" style="margin-top: 0.25rem">
                <span>Pinned down — this can be focused</span><span>☆</span>
              </span>
              <span v-else-if="e.level !== 'exact'" class="tip-row muted" style="margin-top: 0.25rem">
                <span>Focus needs the exact rate</span><span>{{ e.toNext }} more finds</span>
              </span>
              <template v-if="e.prey">
                <hr style="border-color: var(--border); margin: 0.3rem 0" />
                <span class="muted">{{ ORGANISMS[e.id].liveMass >= 1000
                  ? `${(ORGANISMS[e.id].liveMass / 1000).toFixed(0)} kg live`
                  : `${ORGANISMS[e.id].liveMass} g live` }}, butchers into
                  {{ Object.keys(ORGANISMS[e.id].parts).length }} separate cuts.</span>
              </template>
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
