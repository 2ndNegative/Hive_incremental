# HiveIdle — design notes

The long version. The README is the short one.

An idle/incremental game in the style of [Evolve](https://pmotschmann.github.io/Evolve/):
an alien hivemind landing on Earth and eating its way up the food chain.

The hook is the nutrition model. The hive stores **nutrients**, not resources, and every
gram it holds is valued in joules. Hunting, foraging and mining are all just different
ways of getting mass into the stores.

In this file: [Playing it](#playing-it) · [The three systems](#the-three-systems) · [Units](#units) · [Layout](#layout)

## Where everything is

This file was one document of fifteen hundred lines, which is a length nobody
reads and everybody searches. It is now the front door: what the game is, the
three systems it runs on, and the file tree. Each part below is its own file,
and each one stands on its own — a chapter you can read start to finish without
holding the other five in your head.

| | |
|---|---|
| **[The systems, one at a time](SYSTEMS.md)** | The item database, the modifier layer, land, genetics |
| **[The economy](ECONOMY.md)** | Efficiency, slack, storage and its wall, costs, durations, balance |
| **[The interface](INTERFACE.md)** | What a screen owes the person reading it, keyboard and small windows included |
| **[The test suites](TESTING.md)** | What `npm test` guarantees, and why there is no framework under it |
| **[Working on it](WORKING.md)** | Dev mode, the debug handle, publishing, repository hygiene, what is not built yet |

## Playing it

**[Play it in a browser.](https://2ndnegative.github.io/Hive_incremental/)** That is the
supported way in, and it is what every push deploys.

To run it locally, see the quick start in `README.md` — `npm install`, then `npm run dev`
for development or `npm run play` for the built game.

> The `.bat` launchers that used to be the headline here are gitignored (`*.bat`), so a
> fresh clone does not have them, and `Play HiveIdle.bat` / `Dev HiveIdle.bat` retired
> themselves some time ago. They are a convenience on one machine, not an entry point this
> document can point at.

`Push to GitHub.bat` commits everything and pushes to
[Hive_incremental](https://github.com/2ndNegative/Hive_incremental). On the first run it
initialises the repo, asks once for the name and email to commit under, and signs you in
through the usual GitHub credential window. After that it shows what changed, asks for a
commit message (blank gives you a dated one) and pushes. On its first run it also
installs `.github/workflows/pages.yml` from `tools/pages-workflow.yml`, which
lints, validates the database, builds, and publishes to GitHub Pages — switch it on under
**Settings → Pages → Source: GitHub Actions**. `base: './'` in the Vite config is what
makes a project-site subpath work.

### Without the launcher

```bash
npm install
npm run play       # build is assumed current; serves and opens the browser
npm run dev        # dev server with hot reload, http://localhost:5173
npm run build      # production bundle into dist/
npm run single     # one self-contained HiveIdle.html, see below
npm run validate   # check the item database
npm run balance    # headless progression simulation
npm test           # every suite, building and serving the game itself
npm run lint
npm run check      # lint, then validate, then the suites
```

Requires Node **20.19+ or 22.12+** — what the locked Vite release declares, and now what
`package.json` declares too, so `npm install` says so rather than failing later in a way
that looks like a bug in the game. `Check HiveIdle.bat` is `npm run check` with the first-run
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

The hive's *chemical* energy is the energy held in what it is carrying — there is no second
bar accruing beside the stores:

```
storedEnergy (J) = Σ nutrient[n] (g) × kjPerGram[n] × 1000
```

There IS a small pool of usable joules (`state.energyPool`), and it is not a counter-example:
nothing fills it but a Metabolic Generator destroying matter, and with no storage building yet
it only ever drains. See *the one-way reserve*. Spending energy is therefore always an act of
destroying matter. The densities are the
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

## Layout

```
src/
  main.js                  boot: load, mount, start the loop, autosave
  App.vue                  shell — topbar, nutrient panel, tab host
  units.js                 SI formatting for joules, grams and watts
  game/
    state.js               the reactive state object, and SAVE_VERSION (24)
    engine.js              computeDerived(), tick(), metabolism  <- the heart
    actions.js             everything the player can do
    save.js                localStorage, versioned and forward-tolerant
    offline.js             the catch-up: scaled step size, chunked, skippable
    run.js                 a run from seed mass to wherever it got to; restarting
    forage.js              forage rolls — what one drone's ground yields
    land.js                room per biome per type, crowding, who stands where
    landvalue.js           what ground is worth, before it is paid for
    genes.js               what is written into what, and what that does to it
    discovery.js           what the hive has found out about its own ground
    focus.js               telling a gathering route what to look for
    expedition.js          Explorers: they leave, and might not come back
    dev.js                 the cheats behind the access code
    format.js              number formatting; treemap.js  squarified layout
    tips.js                pinned tooltips, placement, tap-to-pin; useGame.js  the shared view
    definitions/
      nutrients.js         35 nutrients (7 macro, 28 micro), densities, assay gating
      modifiers.js         the modifier channels — see [The modifier layer](SYSTEMS.md#the-modifier-layer)
      genes.js             traits and genes — see [Genetics: a genome per kind of body](SYSTEMS.md#genetics-a-genome-per-kind-of-body)
      structures.js        hive structures: 18 live, 5 parked; both lists checked
      castes.js            the old caste layer; all of it bar `dormant` is parked
      drones.js            the worker caste and the types inside it, and what they cost
      research.js          the tech ladder: 13 live, 2 parked (lithovory, predation)
      costs.js             the amount ladder and the growth curves
      times.js             the duration ladder and BUILD_COUNT_EXPONENT
      biomes.js            the 26 biomes; forage.js  what each one holds
      organisms.js         prey and butchery yields
      origins.js           landing sites; cognition.js  insight; topbar.js  the chips
      items/               the composition database, five files
  components/
    NutrientPanel.vue      stores, grouped by assay, hidden groups absent
    TabBar.vue             the tablist: roving tabindex, arrow keys, badges
    useDialog.js           focus into a modal, trapped, restored, Escape
    topbar/                the chips: energy, draw, cognition, insight, larvae, hydration
    tabs/                  Hive, Drones, Territory, Storage, Metabolism, Research,
                           Genetics, Codex, Stats, Settings, Dev
tests/
  run-all.mjs              the runner, a bounded pool — see [The test suites](TESTING.md#the-test-suites)
  harness.mjs              checker, openPage, settle, finish, and the facts about the world
  fixtures/saves.mjs       saves from older SAVE_VERSIONs, for history-test
  *-test.mjs, smoke, verify  the browser suites, plus pure-node ones
tools/
  balance-sim.mjs          headless progression simulator
  validate-items.mjs       database validator
  build-single.mjs         the one-file portable build
  needs-build.mjs          whether the launcher has to rebuild, and which file said so
  clean-dist.mjs           which files in dist/assets nothing can reach any more
docs/
  DESIGN.md                this file: the front door
  SYSTEMS.md  ECONOMY.md  INTERFACE.md  TESTING.md  WORKING.md
```

`state.js` holds only *authored* state. Everything derivable — capacities, flows, energy,
unlocks, affordability — is computed in `engine.js`, which is why the panel can never
disagree with what the simulation applies.
