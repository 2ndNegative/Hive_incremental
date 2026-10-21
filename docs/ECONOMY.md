# HiveIdle — The economy

What the hive can hold, what things cost, how long they take, and the rules that stop any of it inventing energy.

The front door is [DESIGN.md](DESIGN.md).

In this file: [Efficiency buys back waste](#efficiency-buys-back-waste-it-never-invents-energy) · [Slack is a resource](#slack-is-a-resource) · [Storage, and the wall underneath it](#storage-and-the-wall-underneath-it) · [What things cost](#what-things-cost) · [How long things take](#how-long-things-take) · [Balance](#balance)

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

### Nothing decides affordability twice

`shortOf(state, cost)` returns what is missing, line by line, and `canAfford` is defined as
"nothing is short". Every screen that greys out a button, and every screen that paints a cost
line red, goes through one of those two — never through a comparison of its own.

That is not tidiness, it is a bug that shipped. The territory claim panel compared the bill to
the stores with a bare `>=` while the engine allowed `EPSILON`, and a bill of
4000.0000000000005 g of fibre against exactly 4000 g greyed the Claim button out on a purchase
`claimTerritory` would have accepted. Both numbers printed as "4 kg", so the screen could not
explain itself, and the only symptom was a dead button.

The same bill had a second defect behind it, and it is the more general one. **"The most you
can afford" is a division that something is about to multiply back, and the two are not exact
inverses.** 4000 ÷ 120 is 33.333…, and 33.333… × 120 is 4000.0000000000005. So `claimableArea`
floors to `CLAIM_STEP` (0.1 m², matching `formatArea`'s one decimal) and then re-checks its own
answer against `canAfford`, stepping down once if it has to — the guarantee enforced rather
than argued. It counts in whole steps and divides at the end, because `333 * 0.1` is
33.300000000000004 while `333 / 10` is 33.3, and this figure goes into a box the player reads
and types back. The whole patch passes through untouched: `unclaimed` is a stored quantity
rather than a division, and rounding it down would leave a sliver nobody could ever take.

Any future "max you can afford" button inherits all of this. The shape to copy is: derive it,
snap it to the grid the interface prints, then ask the engine whether the answer is real.

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

- *"Everything is too expensive"* → LOWER the rungs in `AMOUNT`. They are gram values, so
  raising one makes the thing dearer — the mirror of *"everything takes too long → lower the
  rungs in TIME"* four hundred lines down, which has always been right.
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
