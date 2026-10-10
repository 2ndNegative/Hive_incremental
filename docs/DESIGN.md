# HiveIdle — design notes

The long version. The README is the short one.

An idle/incremental game in the style of [Evolve](https://pmotschmann.github.io/Evolve/):
an alien hivemind landing on Earth and eating its way up the food chain.

The hook is the nutrition model. The hive stores **nutrients**, not resources, and every
gram it holds is valued in joules. Hunting, foraging and mining are all just different
ways of getting mass into the stores.

## Playing it

**Double-click `Play HiveIdle.bat`.** That is the whole thing. It checks for Node,
installs dependencies the first time, rebuilds only if you have changed something, starts
a local server and opens your browser. Leave the console window open while you play;
closing it stops the game.

The first run takes a minute or two while dependencies install. Every run after that is
a few seconds. If Node is missing or too old, the launcher says so and opens the download
page rather than failing with a stack trace.

`Dev HiveIdle.bat` is the same thing in development mode: no build step, and edits under
`src/` reload in the browser instantly. Use it when you are changing the game, not when
you want to play it.

`Push to GitHub.bat` commits everything and pushes to
[Hive_incremental](https://github.com/2ndNegative/Hive_incremental). On the first run it
initialises the repo, asks once for the name and email to commit under, and signs you in
through the usual GitHub credential window. After that it shows what changed, asks for a
commit message (blank gives you a dated one) and pushes. On its first run it also
installs `.github/workflows/pages.yml` from `tools/pages-workflow.yml`, which
validates the database, builds, and publishes to GitHub Pages — switch it on under
**Settings → Pages → Source: GitHub Actions**. `base: './'` in the Vite config is what
makes a project-site subpath work.

### Without the launcher

```bash
npm install
npm run play       # build is assumed current; serves and opens the browser
npm run dev        # dev server with hot reload, http://localhost:4400
npm run build      # production bundle into dist/
npm run single     # one self-contained HiveIdle.html, see below
npm run validate   # check the item database
npm run balance    # headless progression simulation
npm test           # all 32 browser suites, building and serving the game itself
npm run lint
npm run check      # lint, then validate, then the suites
```

Requires Node 20 or newer. `Check HiveIdle.bat` is `npm run check` with the first-run
installs done for you, including the Chromium the suites drive.

### The portable build

`npm run single` writes **`HiveIdle.html`** — the entire game inlined into one file.
Double-click it and it runs in the browser with no Node, no server and no install, which
makes it the easy thing to copy to another machine or hand to someone else.

Two things to know about it. It is a build artifact, so it only reflects the last time
you ran `npm run single`. And because every `file://` page shares one storage origin, its
save slot is shared with any other local HTML page using the same key — the launcher
serves over `http://localhost`, which gets an origin of its own. For normal play, use the
launcher.

## The three systems

### 1. Energy is the mass, not a resource beside it

There is no energy bar. The hive's energy is the energy held in what it is carrying:

```
storedEnergy (J) = Σ nutrient[n] (g) × kjPerGram[n] × 1000
```

Spending energy is therefore always an act of destroying matter. The densities are the
FAO/WHO general Atwater factors — fat 37, ethanol 29, protein 17, carbohydrate 17,
fibre 8 kJ/g — and **minerals and vitamins are 0**. That is the whole point of the
model: burn a gram of fat and 37 kJ leaves the reserve; burn a gram of sodium and
nothing does, because sodium is already fully oxidised and holds no energy at all.

> If you want minerals to carry a token energy value instead of exactly zero, it is one
> field: `kjPerGram` in `src/game/definitions/nutrients.js`. Everything downstream —
> the fuel list, the metabolism table, the validator — reads from there.

Energy densities are a property of matter, so no tech ever changes them. Techs change
**efficiency** instead: how many joules the hive extracts per joule of stored mass.
That keeps the headline equation exactly true at all times.

### 2. Preferred and fallback energy sources

Every energy consumer — basal metabolism, each caste, each structure — names a fuel it
would like to burn and a fuel to fall back on. To deliver 1 kW for a second the engine
works out the grams required at that fuel's density and efficiency, takes what it can
from the preferred store, takes the remainder from the fallback, and throttles the
consumer if neither can cover it.

Consumers are fed in order, with basal metabolism first: the hive keeps itself alive
before it powers its workforce. Only nutrients with a non-zero density are offered as
fuels, since a zero-density "fuel" could never pay for anything. Set a hive-wide default
and override it per consumer on the **Metabolism** tab.

Fibre is the interesting case: 8 kJ/g sitting in every blade of grass and every plank of
wood, counted in stored energy but *not* in burnable energy until the hive researches
cellulolysis. `fuelRequires` on a nutrient is what expresses that.

### 3. Macros known, micros earned

Seven macronutrients — water, protein, fat, carbohydrate, fibre, ethanol and total
mineral mass — are visible and usable from the first bite.

The 28 micronutrients are not. They **accumulate from the very first tick**, they fill
their own per-nutrient stores, and when a store is full the surplus is **quietly
discarded** — no log line, no counter, nothing in the interface at all. They cannot be
spent: a cost denominated in an unresolved compound reads as `unresolved compound` and
can never be paid, because the hive is holding plenty of it and cannot tell which of its
mass is which.

Researching an assay reveals a group at once, along with the stockpile that was already
there and a note of how much was thrown away in the meantime:

```
Research complete: Bulk Mineral Assay.
7 new compounds resolved: Sodium, Potassium, Calcium, Magnesium, Phosphorus, Chloride, Sulfur.
Already in store, uncounted until now: 17 g potassium, 3.4 g calcium, 2.38 g phosphorus.
Records show 1.2 kg of it was discarded as overflow.
```

Five assays cover the panel: bulk minerals, trace metals, rare elements, fat-soluble
vitamins, water-soluble vitamins.

### Offline progress

There is no cap. Come back after a year and a year is simulated, behind a modal with a
progress bar that you can skip if you would rather not wait.

A year at one-second steps would be 31.5 million ticks, so the step size scales with the
gap: the work stays bounded at roughly 20,000 ticks however long you were away, which is
a 26-minute step for a year and one second for anything under about five hours. Coarse
steps integrate production and consumption correctly; what drifts is anything that
depends on crossing a threshold mid-step, like a store filling and spilling partway
through. The catch-up runs in chunks between animation frames, which is what keeps the
progress bar moving and lets Skip actually interrupt it. Skipping forfeits the remainder,
and the log says how much was thrown away.

Note that reloading the page never yields offline time: the game saves on unload, so the
gap is zero. The time has to pass with the tab closed.

### Mass accounting

Macros partition an item's mass and sum to ~100 g per 100 g. Micros are a *breakdown of
mass already counted in the macros* — the minerals inside the ash fraction, the vitamins
dispersed through the rest — not extra mass. Totalling every store would double-count,
which is harmless because nothing does, and because every micro is 0 kJ/g the energy
equation stays exactly right.

## Units

Everything is stored in one canonical unit and given an SI prefix only when printed:
energy in joules, mass in grams, power in watts. So a vitamin trace reads `59.3 µg` and a
mature hive's reserve reads `11.9 GJ`, from the same code path. Above a kilogram, mass
switches to tonnes (`5.5 kt`) rather than `5.5 Mg`, because that is how people write it.

Energy per second is printed as watts with no `/s`, since that is what a watt is.

## The item database

497 items in `src/game/definitions/items/`, and 25 prey organisms in
`src/game/definitions/organisms.js` — a sibling of that directory, not a file inside it.

| File | Items | Contents |
| --- | --- | --- |
| `animal.js` | 63 | meat, organs, fish and shellfish, insects, eggs and dairy, hominid tissue |
| `plant.js` | 72 | grains, legumes, nuts and seeds, vegetables, fruit, fungi, algae, raw forage |
| `material.js` | 49 | fats and oils, refined foods, minerals, metals, bulk materials, fluids |
| `processed.js` | 136 | what the locals cooked, cured, refined, bottled or extruded — and the only route to several nutrients that barely occur in wild tissue |
| `wild.js` | 177 | what lives where nobody is farming: open ocean to abyssal plain, sea ice, tundra, high desert, canopy |
| `index.js` | — | concatenates all five, normalises, throws on a duplicate id |

The files are organised by **provenance** — where a thing came from — while the codex and
the validator organise by `category`. The two cut across each other: eighteen of the
twenty categories are split over two or more files, `fat` and `refined` over four. That is
deliberate, because provenance is what an author editing a batch of items is thinking
about and category is what a player browsing the codex is thinking about, and neither
should be bent to the other. What is missing is a rule for which file a *new* item goes
in; until there is one, follow the nearest neighbour already in the database.

Composition is authored in the units nutrition tables actually print, and converted to
grams on load:

```js
{
  id: 'beef_liver', name: 'Beef liver', category: 'organ',
  source: 'USDA SR Legacy 13325', confidence: 'high', coverage: 'full',
  g:  { water: 70.8, protein: 20.4, fat: 3.6, carb: 3.9, fiber: 0, ash: 1.3 },
  mg: { sodium: 69, potassium: 313, iron: 4.9, copper: 9.76, vitaminB2: 2.76 },
  ug: { selenium: 39.7, vitaminA: 4968, vitaminB12: 59.3 },
}
```

`carb` is **available** carbohydrate. Reference tables publish "carbohydrate by
difference", which includes fibre, so fibre has been subtracted out — it matters, because
available carbohydrate is 17 kJ/g and fibre is 8.

Every item carries its provenance, and the codex shows it:

- **confidence** — `high` (standard reference table), `medium` (published but variable
  between samples), `low` (order-of-magnitude estimate), `model` (a deliberate game
  abstraction, not a measurement).
- **coverage** — `full`, `partial` (notable micros only), or `macroOnly`. A blank is
  *unknown*, not zero, and the codex says so rather than implying a measurement.

### Non-food matter

The hive has seven macro stores and no others, so everything lands in one of them.
Minerals go to `ash` with the elemental breakdown in the micro fields — a kilogram of
iron is 1000 g of ash that assays as 1000 g of iron, with no energy and no vitamins.
Lignocellulose (wood, paper, cotton) goes to `fiber`, which is chemically where it
belongs and leaves it locked until cellulolysis. Synthetic hydrocarbons (plastics,
bitumen, coal) go to `fat`, because fat is the hive's hydrocarbon pool and these burn
like one — a deliberate abstraction, marked `confidence: 'model'` so the codex admits it.

### Validating it

```bash
node tools/validate-items.mjs            # errors and warnings
node tools/validate-items.mjs --verbose  # plus every item's energy density
```

It checks macro mass balance, parent containment (a micronutrient cannot outweigh the
macro fraction it is declared to live in — the minerals inside the ash, the fat-soluble
vitamins inside the fat, the water-soluble ones inside the water), micronutrient
plausibility, referential integrity of organism parts, an energy regression against 26
published kcal figures, and forage coverage: every item classified in `forage.js`, naming
real biomes, reachable by some route, and every biome offering every caste something.

Sulfur is the one nutrient with two parents, `['ash', 'protein']`, and the check lets it
spill from the first into the second exactly as the engine does. Phosphorus is `['ash']`
alone and gets no such latitude.

It earns its keep — it caught five real errors during the build, including kale carrying
2.4 g of available carbohydrate when its carb-by-difference is 4.4 g and its fibre alone
is 4.1 g.

The energy regression tolerates 12% relative *or* 5 kcal absolute, whichever is kinder —
both have to be exceeded before it errors. The 12% is because the hive uses the
**general** Atwater factors for everything while published kcal often use food-specific
ones: pure sugar reads about 5% high here (sucrose is 3.87 kcal/g against the general
4.06). That is a consequence of keeping one density per nutrient, which the whole game
depends on, so it is tolerated rather than corrected. The 5 kcal floor is because on a
23 kcal vegetable a 2 kcal rounding difference in the source row is 9% and means nothing.
Drift over 4% warns instead.

## Layout

```
src/
  main.js                  boot: load, mount, start the loop, autosave
  App.vue                  shell — topbar, nutrient panel, tab host
  units.js                 SI formatting for joules, grams and watts
  game/
    state.js               the reactive state object, and SAVE_VERSION (23)
    engine.js              computeDerived(), tick(), metabolism  <- the heart
    actions.js             everything the player can do
    save.js                localStorage, versioned and forward-tolerant
    offline.js             the catch-up: scaled step size, chunked, skippable
    run.js                 a run from seed mass to wherever it got to; restarting
    forage.js              forage rolls — what one drone's ground yields
    land.js                room per biome per type, crowding, who stands where
    landvalue.js           what ground is worth, before it is paid for
    discovery.js           what the hive has found out about its own ground
    focus.js               telling a gathering route what to look for
    expedition.js          Explorers: they leave, and might not come back
    dev.js                 the cheats behind the access code
    format.js              number formatting; treemap.js  squarified layout
    tips.js                pinned tooltips; useGame.js  the shared reactive view
    definitions/
      nutrients.js         35 nutrients (7 macro, 28 micro), densities, assay gating
      modifiers.js         the modifier channels — see *The modifier layer*
      structures.js        hive structures: 16 live, 7 deprecated
      castes.js            the old caste layer; all of it bar `dormant` is parked
      drones.js            the worker caste and the types inside it, and what they cost
      research.js          the tech ladder: 12 live, 2 parked (lithovory, predation)
      costs.js             the amount ladder and the growth curves
      times.js             the duration ladder and BUILD_COUNT_EXPONENT
      biomes.js            the 26 biomes; forage.js  what each one holds
      organisms.js         prey and butchery yields
      origins.js           landing sites; cognition.js  insight; topbar.js  the chips
      items/               the composition database, five files
  components/
    NutrientPanel.vue      stores, grouped by assay, hidden groups absent
    topbar/                the chips: energy, draw, cognition, insight, larvae, hydration
    tabs/                  Hive, Drones, Territory, Storage, Metabolism, Research,
                           Genetics, Codex, Stats, Settings, Dev
tests/
  run-all.mjs              the runner — see *The test suites*
  harness.mjs              the only three facts a suite needs from outside itself
  *-test.mjs, smoke, verify  32 suites, each a standalone script
tools/
  balance-sim.mjs          headless progression simulator
  validate-items.mjs       database validator
  build-single.mjs         the one-file portable build
  needs-build.mjs          whether the launcher has to rebuild
```

`state.js` holds only *authored* state. Everything derivable — capacities, flows, energy,
unlocks, affordability — is computed in `engine.js`, which is why the panel can never
disagree with what the simulation applies.

## Efficiency buys back waste — it never invents energy

A gram of fat is 37 kJ. Nothing the hive learns can make it 46.

Every fuel starts **wasteful** — `burnBase` in `definitions/nutrients.js` — and research moves
it **up towards 1 and never past it**. A tech states the efficiency it *reaches* rather than a
bonus it adds, the best one you hold wins, and the result is clamped at 1. Exceeding the
mass's real energy is impossible by inspection of the table, not just by a guard in the code.

| fuel | base | after its tech | capstone | why |
|---|---|---|---|---|
| **Fibre** | 0.95 | — | — | almost lossless, and barely any energy there to lose |
| **Ethanol** | 0.85 | — | — | small, volatile, already half-oxidised |
| **Fat** | 0.70 | Lipolysis → 0.875 | Ketogenesis → **1.00** | what the hive runs on |
| **Protein** | 0.70 | — | Ketogenesis → 0.84 | slow to dismantle; it was tissue a moment ago |
| **Carbohydrate** | 0.60 | Glycolysis → 0.75 | — | needs no learning, and gets the 3× throughput |

One generator, measured across the ladder:

| | fat | carb | protein | fibre | ethanol |
|---|---|---|---|---|---|
| nothing | 259 kW | 275 | 119 | — | 247 |
| Glycolysis | 259 | **344** | 119 | — | 247 |
| + Lipolysis | **324** | 344 | 119 | — | 247 |
| + Cellulolysis | 324 | 344 | 119 | **76** | 247 |
| + Ketogenesis | **370** | 344 | **143** | 76 | 247 |

**370 kW used to be where fat started. It is now where fat ends.** The old balance point is
the ceiling at the end of the fat line, and the early game is about a third poorer with
research as the way out. One generator still covers a 15-drone hive comfortably (259 kW
against 135 kW of demand), so nothing needed compensating elsewhere.

Fibre is the interesting one. At 0.95 it is nearly lossless, but 8 kJ/g is so little that a
generator on fibre makes 76 kW against fat's 259. **Burning it is never an efficiency
question — it is the building material, and every gram burned is a gram not built with.**
That is the only real cost of it, and it is a big one.

Carbohydrate pays twice: 0.60 recovered *and* a further 10% lost to the hurry of the 3×
throughput, so 30 g/s of sugar is 275 kW rather than the 459 a perfect converter would give.
It is still the sprint, and after Ketogenesis fat finally overtakes it on raw output too.

**The drone ration does not go through this.** `burnBase` is what a *Metabolic Generator*
fails to recover; a drone eating is not a generator. The ration stays 0.15 g/s of sugar a
drone whatever the hive has learned.

## Slack is a resource

Two things in the hive pay you for **not** spending them, on the same curve:

| | what it is | what it speeds up |
|---|---|---|
| **Larvae** | brood sitting in the chambers | brood and molding, via `larvaPace` |
| **Spare cogits** | bandwidth not holding a drone | insight ceiling *and* rate, via `cogitFocus` |

Both are `1 + √(n / 5)`, so the first few matter a great deal and the fiftieth does not:

| spare | multiplier |
|---|---|
| 0 | ×1.0 |
| 5 | ×2.0 |
| 20 | ×3.0 |
| 45 | ×4.0 |

They share a shape and a scale deliberately — a player who has learned one should not have
to learn the other.

The cogit half is what makes bandwidth a real decision. Before it, cognition was a ceiling
and nothing else: a cogit either held a drone coherent or sat there, so the correct play was
always to fill every one and a Nerve Node was a drone slot wearing a different hat. Now a
hive can run forty drones and learn nothing, or twenty and think twice as fast, and neither
is wrong. It also gives a young hive something to do with a Nerve Node it cannot yet fill.

Being **over** budget does not push it below ×1. A hive that has overcommitted its cogits is
already punished by being over budget; compounding that into *"and you also forget things"*
is a hole with no bottom.

## The modifier layer

`definitions/modifiers.js`. A **channel** is a named fact about the game that can be made
better or worse — `broodRate` is "how fast larvae are laid", `harvest` is "how much a
gathering drone brings back" — that any number of sources contribute to and that exactly
one place in the engine reads. Structures contribute through their `mult` map, research
through its own, and genetics will contribute through its without a line of engine code
moving. **This is the seam.**

The rules, in short:

- **A channel is named for what it multiplies, never for what supplies it.** The layer this
  replaced had six channels called `forager`, `analyst` and the like, and when those castes
  were parked the names stopped meaning anything.
- **Bonuses add; the result multiplies.** Sources sum into a running total and the engine
  applies `1 + total`, so two sources of +20% give +40%, not +44%. A product of a dozen
  terms is a number nobody can predict from the screen. A total at or below −1 stops the
  thing entirely; `factor()` clamps there rather than going negative.
- **A channel ending in `Cost` means more cost, so a negative contribution is the good
  one.** `rationCost: +0.2` is drones eating twenty per cent more; a gene for frugality
  contributes −0.2. There is no `lower: true` flag on purpose — a flag can be forgotten,
  a name is read every time anyone types it.
- **One reader per channel.** A second reader means two places are computing the same thing,
  which is the bug the brood rate had when `computeDerived` and `tick` each worked the lay
  rate out from scratch and agreed only because someone kept them in step by hand.
- **A building contributes at charge.** `mult` times how many are running, at the charge
  they are running at, so a browned-out building gives a browned-out bonus.
- **An unknown channel name throws.** A typo would otherwise be a bonus that is written,
  summed and silently absent — the hardest balance bug to see, because the number is in the
  file and the screen says the building is built.

Ten live channels: `broodRate`, `moldRate`, `harvest`, `insight`, `digestion`, `storage`,
`mineralStorage`, `vitaminStorage`, `rationCost`, `waterCost`. Three are parked and openly
labelled so, kept only because two parked structures still declare them.

### Why it is tested the way it is

The layer before this one was not wrong. Its channels were declared, the `mult` maps were
summed correctly, the arithmetic came out right — and nothing read the result. `derived.mult`
was computed and discarded on every tick for months, and it looked completely healthy from
the inside, because everything it did, it did correctly.

So `factor()` and `channelTotal()` record which channels they have been asked for, and
`tests/modifier-test.mjs` drives the real game and asks the only question that would have
caught that: given a bonus on a channel, **does the number it names actually move?** Every
channel, one at a time, against the figure its `applied` field points at. It is deliberately
not a unit test of `factor()`; `factor()` was never the part that broke.

## Land: range, crowding, and who stands where

Territory was decorative for most of the game's life. It had a price and a tooltip and no
teeth, and the reason was arithmetic rather than design: a forager needed 2.5 m², so 540 m²
carried 216 of them, and cognition caps the hive at a few dozen. The ceiling was two orders
of magnitude above the floor. Three further things followed from the same model and all of
them were wrong:

- **The patch size was the opening tile.** `AREA_PER_PATCH` was 36, and the Anthill starts on
  36 m² of temperate forest. It had been chosen once and reasoned backwards from ever since.
- **Holding a sliver of everything was strictly correct.** `patchCount` floored at the number
  of biomes held, and every patch rolled a biome against the *whole* territory before it
  rolled a find — so two square metres of anything bought full access to its forage table for
  nothing. That was not an exploit players found. It was the rule, written down.
- **There was no decision in any of it.** Drones were shared out in declared type order,
  which is a tiebreak, not a choice.

### A patch is a drone

The unit is the drone now. Each foraging type declares a `range` in square metres — the
ground one of them needs to work at full rate — and room is counted **per biome**:

```
slots(biome, type) = area(biome) / range(type)
```

The hive does not run out of land. It runs out of *farmland*, and the ninety square metres of
it that exist hold twenty-two foragers or six scavengers and not both. That is the decision,
and it exists because the routes pay in different currencies: standing vegetation is water,
fibre and carbohydrate, carrion is fat and protein. A hive drowning in fibre while starving
for protein — which is what the balance sim has been reporting for months — now has a lever
to pull that is not "build another store".

### Crowding, in one number

Past its room a drone loses ground, and how fast is the type's business:

```
efficiency per drone = min(1, slots / drones) ** crowding
```

Below 1 the curve is concave and the total still climbs: a crowded forager is merely slower,
because there is always another bush. At 1 the total caps — ten scavengers on one carcass
bring back one carcass. Above 1 the total *falls*: two hunters inside one home range do not
split the prey, they drive it off, and the second one costs the hive the first one's dinner.

| route | range | crowding | at 50% of its range | at 10% | drone |
|---|---|---|---|---|---|
| forager | 4 m² | `tolerant` 0.5 | 71% | 32% | Forager |
| scavenger | 14 m² | `touchy` 1.5 | 35% | 3.2% | Scavenger |
| excavator | 10 m² | `even` 1 | 50% | 10% | *not built* |
| siphon | 25 m² | `territorial` 2.5 | 18% | 0.3% | *not built* |
| hunter | 50 m² | `solitary` 4 | 6.3% | 0.01% | *not built* |

One exponent gives both shapes, and it is what makes a sliver of ground *type-dependent*
rather than merely small. Two square metres of farmland is half a forager's range — one
forager at 71%, worth having. It is a twenty-fifth of a hunter's, which at `solitary` is three
ten-thousandths of a hunter. The hive cannot nibble its way to a hunting ground; it has to
take one. That is the pressure towards large contiguous holdings, and it replaces the old
pressure towards a sliver of everything.

The bottom three routes have complete forage tables (119 huntable items plus the prey
organisms, 13 excavated, 4 siphoned) and no drone to work them. Their figures are written
down in `drones.js` so the whole table balances in one place. A Hunter in particular needs the
carcass-into-cuts path wired through the drone route first; today only the parked hunter
*caste* rolls prey.

### Types compete for the same square metres

The first version of this counted room as `area / range` **per type**, which handed every
type the whole biome independently. Twenty-nine foragers and eight scavengers on 117 m² both
read 100% efficient while between them claiming 228 m². The panel's header said "195% of what
it carries" and nothing anywhere enforced it — the hive was being paid in full for land that
does not exist.

They share it in proportion to what they asked for, which is the rule digestion already uses
on the gut:

```
wanted  = Σ over types of (drones × range)
squeeze = min(1, area / wanted)
efficiency per drone = squeeze ** crowding
```

Everyone on an over-subscribed biome is squeezed by the **same** ratio, and what that costs
them is their own exponent. At 51% of the room they asked for, the tolerant forager works at
72% and the touchy scavenger at 37% — identical ground, very different bills. With one type
present it reduces exactly to the single-type case, so nothing about a dedicated biome
changed.

Three figures follow from it, and the panel shows all three because they answer different
questions:

- **`room`** — how many of this type the ground carries at full rate *once the rest of the
  plan has its share*. This is the number a player acts on, and it was the one that was
  wrong.
- **`alone`** — what it would carry with the biome to itself. Kept because "room for 1 here,
  29 if the scavengers were not on it" is two facts and both matter.
- **`squeeze`** — printed on the biome header as "195% committed · everyone gets 51% of the
  room they asked for", so the cost of over-committing is a number rather than a warning.

`fill` fills what is **left**, not the whole biome. Filling with foragers on ground already
pencilled in for scavengers would over-commit it the instant it was clicked, which is a
one-click button whose one click is wrong.

### A target cuts both ways

A molding target used to be a ceiling and nothing else, so a hive that had pressed forty
foragers kept forty forever however low the number went afterwards. The only control over a
workforce ran one way, and the way it ran was up.

A standing count above its target now loses one drone every `CULL_SECONDS` (20 s), worst
overage first, re-read between each one so two types brought down together are trimmed
alternately rather than one being emptied before the other is touched. Flat seconds, **not**
scaled by brood pace or vigour: pressing a drone is work the chambers do and a full brood
does it faster, whereas letting one go is not work and a thriving hive should not be quicker
at it.

The clock resets whenever nobody is over. Without that, a hive sitting at its target for an
hour banks an hour of cull time and kills the first drone the instant a target is nudged
down — and nudging one down and back up is something a player does while thinking.

A type with **no** target is never culled. `null` means "as many as you like", the same as it
does to `nextMoldable`, and reading it as zero would quietly kill the whole workforce of
anyone who had never set one.

Nothing is reclaimed. The matter in a culled drone is simply gone, which is a placeholder
and not a design — a way to get it back is wanted and not yet built.

### The reserve is a grant, not a battery

Surplus energy used to be banked: anything the generators made over demand went into
`state.energyPool`, so a hive with spare capacity quietly accumulated a buffer it had never
built anything to hold.

The energy a run starts with is what the hive **arrived** with. It only goes down, and
nothing refills it. Power made and not spent goes nowhere, because nothing in the game stores
electricity yet.

```js
const poolAfter = Math.min(banked, availableJoules - drawnJoules);
```

That clamp is the whole of it: a step that generates more than it spends leaves the reserve
exactly where it was, and a step that generates less draws the difference out of it. When an
energy storage building lands, this is the line it changes — the clamp becomes the capacity
that building provides rather than the reserve's own current level.

`derived.energy.fromPool` is therefore never negative any more, and `wasted` is the new
figure beside it: generated, not needed, nowhere to put it. The draw chip and the Metabolism
tab both show it, because a hive throwing away two thirds of its output should be able to see
that it is — the fix is to spend it, not to make less.

### Snacking: crowding costs twice

A drone out on ground it can work is standing in the middle of its own dinner. It eats some
of what it finds before it ever gets home — which is why the ration was priced where it was,
on the assumption that a drone covers about half its own keep. `SNACK_SHARE` in `castes.js`
makes that explicit, and the bill becomes

```
billable = drones − Σ over crews of (drones × efficiency) × SNACK_SHARE
```

The interesting word is `efficiency`. A drone crammed onto a tenth of the ground it needs is
finding a tenth as much, so it snacks a tenth as much, so it comes home nearly as hungry as
one that never left. **Crowding therefore costs twice: less comes in and more goes out.**

That is what gives the crowding curve a top. A `tolerant` type's total output is
`sqrt(n × slots)` — it rises forever as you pile drones on, so without a second term there
was no reason not to. With the food bill in, there is an optimum:

| drones | efficiency | haul | food bill | net |
|---|---|---|---|---|
| 1× its room | 100% | 160 kW | 13 kW | 147 kW |
| 4× | 50% | 320 kW | 77 kW | 244 kW |
| **11×** | **30%** | **531 kW** | **238 kW** | **292 kW** |
| 24× | 20% | 784 kW | 550 kW | 234 kW |
| 40× | 16% | 1012 kW | 939 kW | 73 kW |

Generous on purpose — the ceiling should be reachable by a player who is not watching, not a
cliff they fall off. The curve is shallow around the optimum and punishing well past it, which
is the right shape for something nobody should have to compute.

Two drones eat nothing on the job, and both are correct. One with no ground at all, which is
what makes an idle drone genuinely expensive. And one standing on a biome that offers its
route **nothing** — a scavenger where there is no carrion comes back empty and comes back
hungry, and the food bill is the only number on any screen that says the trip was wasted.

It scales with efficiency rather than with grams actually hauled, so a drone on rich ground
does not eat more than one on poor ground. The honest version would make the figure depend on
each biome's load table, and the panel could then no longer say "half your keep" about
anything.

The `grazing` channel multiplies the share, which makes "the hive learns to eat on the move" a
natural gene. It is checked in `modifier-test.mjs` twice: once that the channel moves the
share by exactly ×1.5, and once that a bigger share actually lowers the bill — a share nothing
reads would pass the first check while the drones ate exactly as much as before.

### The biome roll is gone

A drone assigned to wetland is standing in the wetland. It rolls what is on that ground and
nothing else. Two rolls became one, which does three things:

- The forage table becomes readable. A forager on temperate forest draws from that biome's 29
  items, not from an area-weighted blend of every biome held.
- Stars bite harder, because a star competes inside a pool the player chose. Assignment is a
  coarse star and starring is the fine one — two tiers of the same verb.
- Expansion stops being a lottery ticket. More of a biome is more room on *that* biome.

### Targets, and drones that do not exist yet

`state.assign` is biome → type → how many, and it is a **plan**, not a record. It may name
drones the hive has not molded, which is the point: lay out a wetland for four hunters, watch
the ground read as spoken for, then go and press four hunters. `land.js` resolves it against
the headcount every tick.

The rules, in order:

1. **Targets are met first.** If more are asked for than exist, they are handed out in the
   *ratio* asked, by largest remainder — three in the forest and two in the wetland with three
   drones in hand is two and one, because a target is a ratio as much as a number.
2. **Leftovers spread by area**, which is exactly what the game did before any of this
   existed. A player who never opens the panel gets the old behaviour.
3. **Ground with a target on it is skipped by the spread.** Asking for five foragers on the
   farm and finding six there is the interface overruling the player. If every biome is
   spoken for, the leftovers go out by area across all of them rather than standing idle.

Which means nobody is ever really idle any more. A crowded crew is inefficient, not
unemployed, and `idle` is non-zero only when the hive holds no ground a type can work. The
old "N with nowhere to work" warning was about a cap being hit; the new one is about a plan
with a hole in it.

### What that did to the preview

`landvalue.js` used to prove something true and useless. Under pooled capacity the patch count
cancelled out of the forage sum, the hive never came close to filling its ground, and so the
honest answer to "what would claiming this gain" was almost always *nothing*. The preview had
a warning box for it. A preview whose main job is to talk you out of the purchase is a sign
that the purchase has no mechanics behind it.

Now it answers with edges in it: how many more of each type this ground would carry, whether
the claim crosses a **threshold** (fourteen more square metres of wetland is the difference
between no hunters and one hunter), and what the hive would actually bring in more of under
the plan it currently has — which may still be nothing, because ground with nobody on it grows
nothing, and that is now a fixable sentence rather than a dead end.

`tests/landvalue-test.mjs` checks the estimate against twenty thousand ticks of the real
engine and they agree to within half a percent. It also checks that the preview never names a
find the hive has not discovered, because claiming ground must not become a way to read the
forage table for free.

### Discovery had to move with it

`recordFind` fires once per roll, and a roll is now a drone rather than a patch — so a crew of
sixty learns sixty times faster, where the old patch count was capped at twelve however large
the hive grew. `RANGE_AT` went from 10 to 100 and `EXACT_AT` from 25 to 350, and the v23
migration multiplies banked counts by `DISCOVERY_RESCALE` so a returning hive does not forget
what it knew. Change the thresholds and the rescale together.

### One reader, still

`harvest` is lifted out of the patch loop in `computeDerived` and published on `derived.land`,
rather than being read a second time from the modifier layer. See the modifier layer's rule 4:
two `factor()` calls on one channel are two readers that have to be kept in step by hand,
which is precisely the bug the brood rate had.

### Who works what is a matrix, not a stack of forms

The panel started as one mini-form per biome: a heading, a line of prose, and a row per type
inside it. Correct, and 1,726 pixels tall at fourteen biomes — which is to say unreadable,
because the question it exists to answer is *comparative* ("where should these ten foragers
go") and the answer was spread down a page you had to scroll to hold two candidates in your
head at once.

It is now a single table: **a row per biome, a column per forage type**, sorted by area
descending. 510 pixels. Three decisions in it are worth keeping:

- **The capacity figure is the fill button.** Each cell carries `− [target] +` and then
  `/{room}`. A fourth control per cell would be four buttons across five types and twenty-six
  biomes; the number you are filling *to* is already printed, so clicking it is both the
  control and its own label.
- **The live count speaks only when it disagrees.** `.assign-now` is blank whenever the drones
  standing there match the target, which is most cells most of the time. It appears for the
  gap while the hive molds into a plan, and for leftovers spread onto ground nobody claimed.
  A column of figures matching the ones beside them is a column of noise.
- **Ground too small to carry anything folds away.** A 0.7 m² sliver of desert holds no drone
  of any type and took exactly as much of the screen as 156 m² of forest. The fold is
  remembered in `state.ui.terrHideSmall`, and a biome the player has deliberately put
  something on is never folded.

The prose that used to sit beside each figure moved into the cell's tooltip, where it is a
hover away rather than in front of the numbers. Sorting by **area** rather than declared order
is deliberate: the grid is read down a column, and what decides whether a biome deserves a
column's attention is how much of it there is.

### Out now is a grid as well

Same disease, same cure. The panel printed a biome heading, a crew heading, and then **two
lines per find**: the find on one, and under it a help line carrying the crew name, the drone
count, the trip weight and "rolling again within 12s" — three facts in two lines, two of them
already printed on the line above, and a constant presented as if it varied. 2,632 pixels. It
is now 533.

- **The crew is a column**, not a heading. Which kind of drone fetched a thing is one word; it
  does not need a block of its own, and the rows now sort by what they bring in *across* both
  crews, because "what is actually feeding the hive" does not care who fetched it.
- **The ground is a band spanning every column**, carrying the biome, the area, and each crew
  with its headcount, its rate and its room. Those are properties of the crew, not of any
  find. The band spans on purpose: laid out in the columns, the crew summary — the longest
  string in the panel — would set the width of a column holding the word "Forager".
- **The forage cycle is stated once**, in the panel's header.
- **A bar for each find**, measured against the biggest find in the hive rather than against
  the whole haul: forty finds share one hundred per cent between them, so a bar scaled to the
  total never reaches a tenth of its track. The percentage beside it is the true share.
- **The tail folds.** Anything past the fifth find on a biome, or under a hundredth of the
  haul, collapses into one line that states how many finds, how many drones and *what share* —
  a fold that hides how much it hides would be a lie about where the food comes from. Empty
  rolls are never folded: a drone that found nothing is the one zero in there worth reading.

One implementation note worth keeping: `display: flex` on a `<th>` takes the cell out of the
table's layout and cancels its `colspan` with it. The band's flex row is a child of the cell.

### Changing it

- *"Land doesn't matter"* → lower the ranges, or check whether cognition is the real wall.
- *"This type is pointless"* → its `range` against the biomes that carry its route, not its
  load. A route whose biomes are all small is a route nobody can staff.
- *"Crowding is too punishing"* → `CROWDING` in `drones.js`. Below 1 forgives, above 1 bites.
- *"I have to micromanage"* → the spread rule is the defence. Check that leftovers still go
  somewhere sensible before adding more controls.

## Storage, and the wall underneath it

A building you cannot save up for is a building you can never build. If the cost of the next
one exceeds what the hive can *hold* of the resource it is priced in, the number never gets
high enough, nothing says why, and the player concludes the game is broken. Two of these
shipped before anyone noticed, and they are worth keeping written down because the shape
recurs.

### The slow one: fibre

The Cellulose Bale stores fibre and is bought with fibre. On a `steady` curve its cost grew
×1.4 a bale while its shelf grew by a flat 500 g, so cost overtook capacity at the **tenth**
and the hive could never widen its own fibre store again. Fibre is the worst case for a
structural reason: it is what everything is made of *and* what its own store is priced in.

The fix was not a bonus. A geometric cost against a linear capacity always crosses, and a
constant multiplier only slides the crossing point — a flat +50% buys 1.21 more buildings and
then the wall is back, permanently. The fix was the curve: the five dedicated stores still on
`steady` moved to `gentle`, matching the Cistern and Crop Chamber, which already were. The
wall moves to 17, and 19 with Tight Packing.

The Vacuole stays `steady` on purpose. It is *general* storage — a buffer for catching
overflow, not a bigger cupboard — so it should stay expensive to repeat.

### The fast one: minerals, and why researching made it worse

The Hivecore's micronutrient shelf held 2 g of iron. A Gizzard costs 10 g. Before the Trace
Metal Assay `payableCost` charged that as 500 g of mineral mass, which fits easily; after it,
the cost was real iron against a real iron shelf. **Researching made four buildings
permanently unbuildable.**

The numbers came from this file's own `baseCap` column divided by ten — a nutritional table,
describing how much of each element a body wants, answering a question it was never asked.
Rare elements came out at 0.05 g, which no cost could ever fit under.

A ceiling answers *can I hold what I must spend*, and the only numbers bearing on it are the
costs. So `MICRO_BASE_CAP` is **50 g for every micronutrient**, uniformly: micro costs live on
the `tiny` and `slight` rungs, so 50 g holds two of the dearest. Abundance is already modelled,
correctly, in what the hive finds; modelling it twice — in the shelf as well — is what
produced a ceiling below the price of the thing standing on the shelf.

### Two rules that fell out of it

**A store is never denominated in what it stores.** The Mineral Vault used to cost 25 g of
iron against a 2 g iron ceiling: the cure was priced above the ceiling it raises. The same
rule is why Tight Packing, which widens a fibre wall, costs insight and no fibre — a fix for
a bottleneck must not be payable only in the bottleneck.

**Flat room beats a multiplier on a small base.** The vaults used to give `capMult: 1.0`,
doubling their group. Doubling 2 g gives 4 g against a 10 g cost. They now add flat grams per
shelf, generated from the cap group rather than hand-typed, and `capMult` still multiplies the
result — so Tight Packing reaches vault room too.

### What is tested, and what deliberately is not

`tests/storagewall-test.mjs` pins the narrow invariant, and getting it narrow mattered. A
Lipid Droplet is priced in fibre and stores fat: when its fibre cost outruns the fibre shelf
you cannot build one, but you are not stuck — you go and build a Cellulose Bale. That is a
decision, not a dead end, and almost every wall in the game is of that kind.

The dead end is the **self-referential** case: a store priced in the thing it stores, where
the only building that could widen the ceiling is the one the ceiling blocks. The suite walks
every store, finds the resources it both costs and holds, and asserts the wall is at least
fifteen deep. It does not assert the wall is absent — on a `gentle` curve against a flat shelf
one always exists eventually — only that it is further out than a player plausibly builds.

`balance-sim.mjs` reports every wall for every resource after a run, measured against that
run's actual storage. It reports and does not judge: a wall at forty is a curiosity, a wall at
ten is a soft-lock, and only a human can say which.

### `grants`: a tech can hand over a building

A research entry may carry `grants: { mineralVault: 1 }`, applied the moment the tech lands.
It exists for one shape of problem — a tech that *creates* the need for a building. The assays
are the case: a hive that researched before building anything would find the cure priced above
the ceiling it raises, so the tech that opens the hole supplies the first patch.

It is not a reward mechanism and should not become one. If a tech grants something the player
could simply have built, the right change is to the price of the building.

## What things cost

Every build cost in the game is a **named amount** of an **exactly named resource**, plus a
**named growth curve**. No structure or drone definition contains a number of grams.

```js
cost: build('steady', { fiber: 'large', protein: 'small', fat: 'slight' })
cost: flat({ fat: 'minuscule' })          // drones: no curve, the hundredth costs what the first did
cost: tech({ insight: 'theory', protein: 'massive' })   // research: no curve either
```

The ladder and the curves live in `definitions/costs.js`, and that file is the only place
either is written down.

### Why

Thirteen live buildings used to carry thirty-three hand-written numbers between them: ten
fibre bases, eight protein bases, seven growth factors. Almost none were chosen against
each other — 450 against 480 against 520 is drift that accumulated one building at a time,
not a decision. Rebalancing *"fibre is too tight"* meant re-judging ten numbers in ten
places and hoping they still agreed. It is now one line.

### The amount ladder

A 1‑2.5‑5 preferred series, in grams. Round, readable, about ×2.2 a step:

| rung | g | | rung | g |
|---|---|---|---|---|
| `trace` | 2 | | `medium` | 250 |
| `minuscule` | 5 | | `large` | 500 |
| `tiny` | 10 | | `heavy` | 1000 |
| `slight` | 25 | | `massive` | 2500 |
| `small` | 50 | | `colossal` | 5000 |
| `modest` | 100 | | `titanic` | 10000 |

Roughly what each band is for as the table stands: `trace`–`tiny` for micronutrients and
drone mold costs, `slight`–`modest` for the fat, ash, carbohydrate and water a building
needs, `medium`–`large` for fibre and protein, `heavy`–`massive` for research and whatever
ends up being built once.

The top two rungs exist for **research**, the one thing in the game that consumes mass by
the kilo rather than by the handful: a tech is a single irreversible purchase, so it can
ask for more than any building ever does. If a *building* wants `colossal`, the question to
ask is whether its growth curve is wrong.

### The growth curves

How much dearer each one is than the last. **This is the bigger lever by far** — from a
500 g base, by the tenth one:

| curve | | 10th one | ten of them |
|---|---|---|---|
| `flat` | ×1.0 | 0.5 kg | 5 kg |
| `gentle` | ×1.25 | 3.7 kg | 17 kg |
| `steady` | ×1.4 | 10.3 kg | 35 kg |
| `steep` | ×1.6 | 34.4 kg | 91 kg |
| `brutal` | ×1.9 | 161.3 kg | 340 kg |

Gentle to brutal is a **forty-four-fold** spread by the tenth building; the whole amount
ladder spans ten-fold within a resource. So choose the curve first and the rung second, and
treat a curve change as the serious edit it is.

`flat` is for something the hive should be able to spam, `gentle` for bulk infrastructure
it will end up with a lot of, `steady` is the default, `steep` for something where each one
is a real decision, `brutal` for a thing that should hurt to repeat (nothing uses it yet).

### The insight ladder

A separate table from `AMOUNT`, because insight is not mass and the two have no exchange
rate — `medium` meaning 250 g and 250 insight at once would be a coincidence dressed up as
a system. Same ×2.2 spacing and the same 1‑2.5‑5 series, for the same reasons.

| rung | insight | | rung | insight |
|---|---|---|---|---|
| `glimmer` | 50 | | `theory` | 1250 |
| `inkling` | 125 | | `doctrine` | 2500 |
| `notion` | 250 | | `synthesis` | 5000 |
| `concept` | 500 | | `paradigm` | 12500 |

The names are a scale of **understanding**, not of size, because that is what the number
measures: a `glimmer` is noticing something, a `paradigm` is the hive rebuilding how it
thinks. Eight rungs spanning 50 to 12,500 is the real range of a tech tree.

Research was the last table to join the ladder, and it shows why the ladder exists: it
carried fourteen hand-written costs — 50, 140, 260, 320, 480, 900, 1200, 1600, 1800, 2600,
3400, 4800, 6500, 9000 — all fourteen distinct, with step ratios wandering between ×1.13
and ×2.8. Two of them were also priced in `ash`, which rule 5 forbids and which `build()`
would have thrown on; research never called `build()`, so nothing ever checked.

### The rules

1. **The spacing is about ×2.2, and that is not arbitrary.** Below ×1.6 the rungs stop
   being distinguishable and you may as well type the number. At ×2.5 and above everything
   bunches — at that spacing every fibre cost in the game lands on one rung and the Vacuole
   costs exactly what the Crop Chamber does.
2. **The ladder is absolute grams, shared by every resource.** `medium` is 250 g whether it
   is fibre or iron; dear resources simply use low rungs. A rung name always means the same
   weight, at the cost of not self-scaling per resource. That trade was made on purpose.
3. **Pick the rung, then check the neighbours.** A cost that sits between two rungs goes to
   the cheaper one — costs compound through the curve, and a building 60% too dear at level
   one is kilos too dear by level ten.
4. **The ladder generalises the amount and nothing else.** Which resources a building costs
   is a design decision about that building and is spelled out in full in its own
   definition. A Cistern costs water because a cistern holds water.
5. **Nothing ever costs mineral mass — it costs a named mineral.** `ash` is not a resource,
   it is the bag the minerals are hiding in. Pricing a building in ash says the hive needs
   *some mineral, any mineral*, which is true of nothing that is actually built: a
   generator needs iron because iron carries oxygen. So a cost names the element, assayed
   or not, and `build()`, `flat()` and `tech()` throw on `ash` at module load rather than
   leaving it to whoever reads this — a cost priced in mineral mass is a game that does not
   start, which is the right loudness for a rule that `ash` appearing in every resource list
   makes very easy to break by accident. The one exception is `tech(..., { sampling: true })`,
   for an assay learning to sort the pile out of samples of the pile.

   Nothing is lost by it. An unassayed mineral is charged to its parent at
   `LOCKED_COST_MULTIPLIER` (50×), so a young hive still pays in mineral mass, at a bad
   rate, and the assay that makes the element visible is also what stops it overpaying.

   **Mind the multiplier when picking the rung.** `tiny` iron is 10 g after the assay and
   **500 g of mineral mass** before it. The rung is the post-assay price; an early hive pays
   fifty times that. Storage is a different question — the Gizzard holds ash precisely
   because ash is what unsorted mineral mass *is*.

   **On screen, that substituted figure is yellow.** See *One colour, one meaning* below.
6. **When a number really is bespoke, write it.** `build()` and `flat()` both take a raw
   number as well as a rung name — and expect to justify it in a comment, because the next
   person rebalancing the ladder will not see it.

### One colour, one meaning

A bulk resource being spent in place of an element the hive cannot pick out yet is drawn in
**warning yellow**, and nothing else is. It means one thing wherever it appears — *this
figure is inflated fifty-fold, and an assay will shrink it* — and it appears on every screen
that quotes a price: the build cards, the drone rows, the claim dialog.

No sentence underneath. The explanation lives in a `title` for anyone who hovers, and once
the player has met the colour once, a footnote repeating it under every card is noise.

`payableCost` records *which* entries it swapped (`substitutedEntries`), so the colour lands
on the one figure that is standing in rather than on the whole price. The class is
`.cost-unassayed` and nothing else uses it.

### Changing it

- *"Everything is too expensive"* → raise the rungs in `AMOUNT`.
- *"Fibre specifically is too tight"* → nothing in `costs.js`; move the buildings that use
  it down a rung, or change what fibre is worth elsewhere in the economy.
- *"The late game ramps too hard"* → lower `GROWTH.steep` and `GROWTH.steady`.
- *"This one building is wrong"* → change its rung. That is the only per-building edit.
- *"Minerals bite too hard before the assay"* → that is `LOCKED_COST_MULTIPLIER` in
  `definitions/nutrients.js`, not the ladder. At 50× it is the dominant term in any mineral
  cost an unassayed hive pays.

## How long things take

`definitions/times.js`, the companion to `costs.js` and built the same way: every structure
declares a **named duration**, never a number of seconds.

```js
cistern: { cost: build('gentle', { fiber: 'medium', protein: 'small' }), time: 'short' }
```

### Cost gates. Time textures.

This is the governing rule and every number below follows from it. The thing standing
between the hive and its next building should almost always be the **mass**, because mass is
what the player has levers on — where the drones are, what is being burnt, which biome is
being worked. Time only stops an affordable thing from being *instant*.

Before build time existed, a hive that could pay for six Vacuoles had six Vacuoles in the
same instant: a windfall turned straight into finished buildings, and the build queue was an
auto-buy list. Now the queue is a plan the hive works through, a windfall is a head start
rather than a shopping spree, and the difference between a shelf and a Hivecore is something
the player feels rather than reads.

### The duration ladder

| rung | pace-seconds | what it is for |
|---|---|---|
| `moment` | 30 | nothing yet — room below `brief` |
| `brief` | 60 | nothing yet |
| `short` | 120 | storage. A bag is a bag. |
| `middling` | 300 | working organs — generators, nodes, a caecum |
| `long` | 720 | chambers and the Memory Bank |
| `glacial` | 1800 | a mind: the Hivecore and the Interlocutor, nothing else |

About ×2.2 a step, the same spacing and for the same reason as `AMOUNT` — below ×1.6 a rung
stops being a distinguishable choice, and much above ×2.5 everything bunches.

Read those as the figure for a hive with **no brood at all**. See below.

### A growing hive builds faster

What a rung names is a quantity of **pace-seconds**, not wall-clock seconds, and the hive
gets through them at `derived.buildPace` — which is `larvaPace × vigour`, the same number
already driving the brood and molding chambers. So larvae speed up construction along with
everything else, and thirst or hunger slow it.

| tier | 0 larvae | 5 | 20 | 45 |
|---|---|---|---|---|
| `glacial` | 30m | 15m | 10m | 7m30 |
| `long` | 12m | 6m | 4m | 3m |
| `middling` | 5m | 2m30 | 1m40 | 1m15 |
| `short` | 2m | 1m | 40s | 30s |

The headline number being the worst case is the right way round: a player who has just
landed should find a Hivecore slow, and a player with a working nursery should find it brisk.

It also means progress is stored as **work remaining** rather than as a deadline, so a brood
hatching halfway through a build finishes the rest of it faster — which is the behaviour
anyone would expect, and one a stored finish-time could not give.

### The count curve is the gentlest in the game

`(1 + n) ** 0.25`, as `BUILD_COUNT_EXPONENT`. The fiftieth Cistern takes 2.7× as long to
grow as the first; on the cost side, `steady` makes the fiftieth cost fourteen *million*
times the first. That asymmetry is the governing rule expressed as arithmetic — cost is
allowed to run away, time is not. The alternatives were measured and rejected:

| nth | `(1+n)^0.25` | `1+0.15√n` | `√(1+n)` | cost ×1.4 |
|---|---|---|---|---|
| 1st | 1.00 | 1.00 | 1.00 | 1.0 |
| 5th | 1.50 | 1.30 | 2.24 | 3.8 |
| 10th | 1.78 | 1.45 | 3.16 | 20.7 |
| 25th | 2.24 | 1.73 | 5.00 | 3,214 |
| 50th | 2.66 | 2.05 | 7.07 | 14.5 million |

`√(1+n)` is already a wall at twenty-five. `1+0.15√n` is so flat that a hive with fifty of
something may as well have one. The quarter-power sits where the slowdown is felt and never
fought.

### Measured against affordability

Build time only earns its place if neither axis dominates. On a forest hive with glycolysis
and lipolysis, five larvae, after 240 s of settling:

| building | small hive (12 drones) | mid hive (30 drones) | build |
|---|---|---|---|
| Vacuole | 12s to afford | 4s | 1m00 |
| Brood Chamber | 1m11 | 42s | 6m00 |
| Nerve Node | 2m20 | 4m10 | 2m30 |
| Metabolic Generator | 10m39 | 2m46 | 2m30 |
| Interlocutor | 24m22 | 5m35 | 15m00 |

Cheap storage is time-bound, the expensive organs stay cost-bound, and the two cross
somewhere around the Nerve Node. That mix is the target; if a rebalance makes one column
dominate everywhere, the rungs are wrong.

### The rules

1. **Cost gates, time textures.** The rungs top out at half an hour rather than hours, the
   count curve is almost flat, and the whole thing divides by how well the hive is doing.
   Build time must never become the thing the mid-game is waiting on.
2. **The spacing is about ×2.2**, as in the amount ladder, and for the same reason.
3. **The count curve is the gentlest in the game.** `BUILD_COUNT_EXPONENT` is the single
   most dangerous number in the file; raising it to 0.5 changes what the game is about.
4. **A rung is work, not wall-clock.** Divided by `derived.buildPace` as the work is done,
   never baked in.
5. **Pick the rung from what the thing *is*, not from what it costs.** A Cistern is quick
   because it is a bag; an Interlocutor is slow because it is a second mind. Where the two
   disagree, the thing's nature wins — cost already says "expensive", and having time say it
   again just doubles the same statement.
6. **When a number really is bespoke, write it.** `duration` takes a raw number of seconds,
   and expect to justify it in a comment.

Every structure's rung is resolved **at module load** (the loop at the bottom of
`structures.js`), parked ones included. A missing `time` is not merely an error at build
time — it is a building that goes up instantly, which nothing else would notice.

### The construction queue

Build time turns the queue from an auto-buy list into a real construction queue, and the
rules that make it legible are:

- **Two pieces of state.** `state.buildQueue` is what the hive has been *told* to build, in
  order; `state.building` is what it is actually growing. A job leaves the queue, is paid
  for, and becomes the one on the bench.
- **One job at a time.** That is what makes the *order* of the queue mean anything — with
  three jobs running at once the list would be a set rather than a sequence, and moving
  something up it would mean nothing.
- **Paid when the job starts.** Not when queued, or lining five things up would empty the
  stores and the queue would be a way of spending mass rather than of planning. Not on
  completion, or a job could sit at 99% for an hour because fibre dipped. Paying at the
  start means the head waits for affordability exactly as it always did, and once the hive
  has committed the mass the build is certain.
- **Cancelling refunds in full.** The time already spent is lost, which is penalty enough
  and the only one that cannot be gamed. Whether the refund all *fits* is a separate
  question — it goes back as a straight addition, so a full store spills it like any other
  overflow.
- **The job on the bench counts against the cap.** A cap that let the player line up three
  more while something was growing would be a cap of four wearing a label that said three.
  `BUILD_QUEUE_BASE` is 3, which Stigmergy takes to 5 and Nest Planning to 9.
- **There is no instant build.** `buildStructure` is an alias on `queueBuild`, and the card
  on the Hive tab lines something up rather than raising it. `raiseStructure` still exists
  and still pays on the spot, for the debug handle and the test fixtures — a suite that
  wants a hive with four generators should say so in a line rather than ticking twenty
  minutes of game time.

### Changing it

- *"Everything takes too long"* → lower the rungs in `TIME`.
- *"Repeat buildings bog down"* → `BUILD_COUNT_EXPONENT`. Read rule 3 first.
- *"Larvae matter too much / too little to building"* → `LARVA_PACE_SCALE` in `engine.js`,
  which also moves the brood and molding chambers. There is no build-only dial on purpose.
- *"This one building is wrong"* → change its rung. That is the only per-building edit.

## Balance

```bash
node tools/balance-sim.mjs 6              # 6 hours of simulated time
node tools/balance-sim.mjs 24 --quiet     # final report only
node tools/balance-sim.mjs 6 --seed 4     # a different opening
```

A greedy bot feeds the hive, researches and builds, then reports where it got to and what
the hidden micronutrients were doing while nobody could see them:

```
micronutrients  24 resolved, 4 still invisible
  (unseen) Chromium    holding 2.8 g, quietly discarded 656 g
```

**It is deterministic, and that was not free.** The same command used to give different
answers — two consecutive runs came back with `0/12 research, stalled before Glycolysis`
and `7/12, stalled before Cellulolysis`. Not noise around a figure: two different games.
The forage rolls decide what the hive finds in its first minutes and a bad opening
compounds, because no protein means no drones means no gathering means no protein. That
is worth knowing about the economy and useless as a regression check, so the whole run now
goes through one seeded generator. `--seed N` picks a different game; the default is fixed.

**Current numbers: 8 of 13 techs in 6 simulated hours on every seed from 1 to 6, no drones
lost, starving 0–8% of ticks, stalling before Cellulolysis.**

**The bot now expands, and that changed what the sim is worth.** It used to sit on its 36 m²
landing site for the whole run, on every seed, which meant it was measuring a game nobody
plays — and measuring it wrong: three seeds in seven reported "stalled before Glycolysis,
0/13 research", and the honest reading of that was not "the economy is broken" but "the bot
refused to go outside". With one Explorer and a claim rule, the same three seeds reach 8/13.
A balance sim that will not pull the main economic lever is a screenshot, not a measurement.

Two things that took to make work, and both are findings rather than bot plumbing:

- **The Explorer slot has to be reserved, and only when it can be paid for.** `nextMoldable`
  presses the first eligible type in declared order and the Forager is first, so without a
  ceiling on the gatherers the cap fills and no Explorer is ever pressed. The ceiling is on
  their SUM, not per type — capping each at `cap − 1` just let the Forager take two and the
  Scavenger the third.
- **Expansion is gated on fat, not on insight.** An Explorer costs 250 g of fat against a
  Forager's 5 — fifty times — plus 250 g each of water and unassayed mineral mass. A young
  hive cannot afford one for a long while, and the ones it does afford sometimes do not come
  back. That is why the bot's holdings end at 36–55 m² rather than hundreds: it is expanding
  as fast as the fat allows, which is not very fast.

One run is one sample. Before reading any of this as a result, sweep a few seeds.

## The test suites

35 of them in `tests/`, each a standalone script that opens a real browser, drives the real
game and prints `PASS`/`FAIL` lines. There is no shared framework on purpose: a suite that
goes red can be run on its own with `node tests/<name>.mjs` and read top to bottom with no
indirection, which is how most of them got written.

```bash
npm test                  # build, serve, run all 35
npm test -- queue water   # just those two, by name
npm test -- --bail        # stop at the first red suite
npm test -- --no-build    # against whatever dist/ already holds
npm run lint              # eslint over src, tools, tests and the configs
npm run validate          # the item database
npm run check             # lint, then validate, then the suites
```

What `tests/run-all.mjs` guarantees, and why:

- **It builds and serves the game itself**, on port 4188 — not 4173 and not 5173, so a run
  started while `npm run dev` is open does not fight it for the port. A runner that assumed
  a server was already up would silently test a stale build, which is worse than testing
  nothing because it looks like it passed. `tests/harness.mjs` reads the URL from `HIVE_URL`,
  so a single suite can be pointed at a server you already have running instead.
- **It runs them strictly one at a time.** Every suite clears `localStorage` for the origin
  and then drives a fresh hive; two at once on the same origin would wipe each other
  mid-run and fail at random. The price is wall-clock time, which is the right thing to
  spend here.
- **The order is cheap-and-foundational first**, so a break in something everything else
  depends on is the first line you read rather than the twenty-ninth. Anything not named in
  `ORDER` still runs, after those.
- **It exits non-zero if anything is red**, and prints only the lines that say what went
  wrong — the suites print a `PASS` line per check and there are hundreds of them.

Playwright needs a browser. After `npx playwright install chromium` it finds its own and
nothing has to be configured. Set **`PW_CHROMIUM`** to an existing Chromium binary to point
it at that instead, for a machine that already ships one and does not want a second few
hundred megabytes downloaded.

`single-test.mjs` opens `HiveIdle.html`, so the runner rebuilds the portable one-file build
as well as `dist/` — otherwise it would be testing a version of the game nobody is running.

## Not built yet

- **Hunting.** The data is in place — organisms, live masses, butchery yields, biome
  weights — and so is the engine path: `forage.js` pools prey with huntable items for a
  `gather: 'hunter'` route, and `engine.js` turns one roll into a carcass and butchers it
  into its cuts. What is missing is a drone that does it. `DRONE_TYPES` has forager,
  scavenger and explorer; the old Hunter caste is parked with the rest of the caste layer,
  so nothing in a live hive ever takes that branch. Also missing: prey populations that
  regenerate and deplete, choosing a target species, and the risk that a hunt costs drones.
- **Genetics.** The tab is a reserved empty slot, so the navigation settles into its final
  shape before there is anything to put in it. The seam it will contribute through is
  already built — see *The modifier layer*.
- A prestige layer, and achievements.

## Developer mode

Enter **`Code Midas`** in Settings → Access code. A Dev tab appears, and the unlock
persists in the save until you lock it again.

It can fill every store to capacity (or only the ones you have actually assayed, which is
the honest way to test), empty them again, grant or revoke research, resolve all five
assays at once to inspect the full 35-nutrient panel, add insight and drones, ingest any
item from the database at any quantity, fill or stock the storage racks, grant and clear
territory, reroll what the hive's land is offering, and skip time.

Every action sets `stats.devUsed` on the save, so a doctored run is never mistaken for a
real one.

## Debug handle

`window.hive` in the browser console:

```js
hive.state.nutrients.fat = 1e6
hive.derived()                 // every computed number, including the fuel allocation
hive.tick(3600)                // fast-forward an hour
hive.research('bulkMineralAssay')
hive.ingestItem('beef_liver', 5000)
hive.loop.stop()               // hand control of the clock, so samples are exact
hive.mods.now()                // the live modifier totals, channel by channel
```

The handle is also the test suites' whole interface to the game: `loop.stop()` is why a
suite can take exact samples instead of racing the live loop, and the `drones`, `topbar`,
`focus_` and `expedition` sub-objects are there so a suite can assert against the same
functions the interface calls rather than against rendered text.

## GitHub Pages

Pages must be set to **Settings → Pages → Build and deployment → Source: GitHub Actions**,
not "Deploy from a branch".

In branch mode Pages serves the repository root, which means it serves the *source*
`index.html` — the Vite entry point, whose `<script type="module" src="/src/main.js">`
points at unbuilt Vue source the browser cannot execute. The result is a blank page with
the correct title, and nothing in the GitHub UI suggests anything is wrong: the deployment
reports as live, because it genuinely did deploy the wrong thing.

The giveaway is that files which only exist in the repository, never in a build, are
reachable on the live site. If `https://<site>/vite.config.js` returns the actual config
file, Pages is serving the repo root and the Actions workflow is not what you are looking
at.

With Source set to GitHub Actions, `.github/workflows/pages.yml` validates the item
database, builds, and publishes `dist/` instead. The URL does not change.

## Repository hygiene

`.gitignore` covers dependencies and builds, the local `.bat` launchers, the portable
`HiveIdle.html`, assistant scratch state (`.claude/`, `.cursor/`, `.aider*` and friends),
logs, caches, editor and OS droppings, and anything that looks like a secret. `CLAUDE.md`
is deliberately *not* ignored — project instructions are worth committing.

One trap worth knowing: Cowork drops screenshots into a folder called **`Claude
outputs`** — with a space. A plain `outputs/` rule does not match it, which is how 750 kB
of PNGs ended up committed. The rules now use `[Cc]laude?[Oo]utput*/`, where `?` matches
the space, hyphen or underscore, plus a separator-free variant. When adding ignore rules,
check the actual folder name on disk rather than the one you assume it has.

`.gitattributes` normalises line endings to LF, except for `.bat`/`.cmd`/`.ps1` which stay
CRLF. Without it, committing from Windows stores CRLF and every file looks modified the
moment it is touched anywhere else.

**A gitignore rule only stops files being tracked in the first place.** Anything already
committed stays committed, which is why adding a rule looks like it did nothing. The fix
is to untrack it:

```bash
git ls-files -ci --exclude-standard                      # what is tracked but now ignored
git ls-files -ci --exclude-standard | while IFS= read -r f; do git rm --cached "$f"; done
git commit -m "Stop tracking local launchers and assistant state"
```

Quote the filename and read line by line — plain word-splitting breaks on names like
`Play HiveIdle.bat` and silently leaves them tracked. `Push to GitHub.bat` runs this
automatically on every push, so the repository stays in step with the ignore rules.

That removes the files going forward but leaves them in history. To clear history too,
`Reset GitHub History.bat` squashes everything into one fresh commit and force-pushes.

That script has one non-obvious requirement. `git checkout --orphan` starts a branch with
no parent, but it **keeps the existing index** — everything that was tracked before is
still staged, ignored or not. So `git add -A` straight afterwards re-commits the very
files the reset was meant to drop, and the whole operation silently achieves nothing. The
index has to be cleared first:

```bash
git checkout --orphan clean
git rm -r --cached .      # <- without this, the reset is a no-op for tracked files
git add -A                # now this actually respects .gitignore
git commit -m "..."
```

Worth doing only while the repository is young and unshared. GitHub can keep unreferenced
commits reachable by their exact SHA for a while, so treat it as tidying rather than as a
way to unpublish a leaked secret — if a credential was ever pushed, rotate it.

The launchers are local-only by design, so a fresh clone will not have them. Copy them
across, or regenerate them.

