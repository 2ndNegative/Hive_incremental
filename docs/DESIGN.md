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
```

Requires Node 20 or newer.

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

184 items and 13 prey organisms, in `src/game/definitions/items/`.

| File | Contents |
| --- | --- |
| `animal.js` | meat, organs, fish and shellfish, insects, eggs and dairy, hominid tissue |
| `plant.js` | grains, legumes, nuts and seeds, vegetables, fruit, fungi, algae, raw forage |
| `material.js` | fats and oils, refined foods, minerals, metals, bulk materials, fluids |
| `organisms.js` | prey species and what fraction of live mass butchers into which item |

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

It checks macro mass balance, mineral containment (identified minerals cannot outweigh
the ash they live in, exempting sulfur and phosphorus which have major organic forms),
micronutrient plausibility, referential integrity of organism parts, and an energy
regression against 26 published kcal figures.

It earns its keep — it caught five real errors during the build, including kale carrying
2.4 g of available carbohydrate when its carb-by-difference is 4.4 g and its fibre alone
is 4.1 g.

The energy regression tolerates 12%, because the hive uses the **general** Atwater
factors for everything while published kcal often use food-specific ones. Pure sugar
reads about 5% high here (sucrose is 3.87 kcal/g against the general 4.06). That is a
consequence of keeping one density per nutrient, which the whole game depends on, so it
is tolerated rather than corrected.

## Layout

```
src/
  main.js                  boot: load, mount, start the loop, autosave
  App.vue                  shell — topbar, nutrient panel, tab host
  units.js                 SI formatting for joules, grams and watts
  game/
    state.js               the reactive state object
    engine.js              computeDerived(), tick(), metabolism  <- the heart
    actions.js             everything the player can do
    save.js                localStorage, offline catch-up, export/import
    definitions/
      nutrients.js         35 nutrients, densities, assay gating
      structures.js        hive structures
      castes.js            drone castes and what they harvest
      research.js          the tech ladder
      organisms.js         prey and butchery yields
      items/               the composition database
  components/
    NutrientPanel.vue      stores, grouped by assay, hidden groups absent
    tabs/                  Hive, Drones, Metabolism, Research, Codex, Stats, Settings
tools/
  balance-sim.mjs          headless progression simulator
  validate-items.mjs       database validator
```

`state.js` holds only *authored* state. Everything derivable — capacities, flows, energy,
unlocks, affordability — is computed in `engine.js`, which is why the panel can never
disagree with what the simulation applies.

## Balance

```bash
node tools/balance-sim.mjs 6           # 6 hours of simulated time
node tools/balance-sim.mjs 24 --quiet  # final report only
```

A greedy bot feeds the hive, researches and builds, then reports where it got to and what
the hidden micronutrients were doing while nobody could see them:

```
micronutrients  24 resolved, 4 still invisible
  (unseen) Chromium    holding 2.8 g, quietly discarded 656 g
```

Current numbers reach 10 of 12 techs in 6 simulated hours with no starvation.

## Not built yet

- **Hunting.** The data is in place — organisms, live masses, butchery yields, difficulty
  ratings — and the Hunter caste already butchers deer through it. What is missing is the
  loop around it: biomes to scout, prey populations that regenerate and deplete, choosing
  a target species, and the risk that a hunt costs drones.
- Per-structure on/off toggles (the engine throttles globally instead).
- A prestige layer, achievements, and queued construction.

## Developer mode

Enter **`Code Midas`** in Settings → Access code. A Dev tab appears, and the unlock
persists in the save until you lock it again.

It can fill every store to capacity (or only the ones you have actually assayed, which is
the honest way to test), grant or revoke research, resolve all five assays at once to
inspect the full 35-nutrient panel, add insight and drones, ingest any item from the
database at any quantity, and fast-forward by up to a year.

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
```

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

