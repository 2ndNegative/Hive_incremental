# HiveIdle — The systems, one at a time

The item database, the modifier layer, land, and genetics — the four models everything else in the game is expressed in terms of.

The front door is [DESIGN.md](DESIGN.md).

In this file: [The item database](#the-item-database) · [The modifier layer](#the-modifier-layer) · [Land](#land-range-crowding-and-who-stands-where) · [Parked, or forgotten](#parked-or-forgotten-a-declared-answer) · [Genetics](#genetics-a-genome-per-kind-of-body)

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

- *"Land doesn't matter"* → RAISE the ranges, or check whether cognition is the real wall.
  `slots = area / range`, so a bigger range is fewer drones per biome and ground that binds
  sooner. This said "lower" for a while, which is the dial turned the wrong way.
- *"This type is pointless"* → its `range` against the biomes that carry its route, not its
  load. A route whose biomes are all small is a route nobody can staff.
- *"Crowding is too punishing"* → `CROWDING` in `drones.js`. Below 1 forgives, above 1 bites.
- *"I have to micromanage"* → the spread rule is the defence. Check that leftovers still go
  somewhere sensible before adding more controls.

### One squeeze, not three

The crowding squeeze — the share of the ground it asked for that each type gets — was
written out three times: the live squeeze and the planned squeeze in `landUse`, and a third
in `landvalue.js`. They are not three independent facts. `landvalue.js` exists to answer
"what would this ground be worth", and an answer computed by its own copy of the rule is an
answer that can disagree with the simulation — quietly, because a forage rate a few per
cent out reads as the dice rather than as a bug. `squeezeFor(area, wanted)` and
`demandOn(counts)` are now the only implementation, and both guards in them matter:
`wanted > area` is what makes spare room not a bonus, and `wanted > 0` is what stops an
empty biome returning `area / 0` — Infinity on a held biome, NaN on an empty one, and NaN
propagates through `efficiencyOf` into a forage rate that formats as "?".

## Parked, or forgotten? A declared answer

Three of these tables work by omission. A structure not in `STRUCTURE_ORDER`, a tech not in
`RESEARCH_ORDER`, a caste not in `CASTE_ORDER` is parked: nothing shows it, nothing can buy
or build it, and a save round-trips whatever the player already had of it.

Which means "parked" and "forgotten" had exactly the same shape. A structure added to the
table and left off the order is not a parked structure — it is a structure with no card, on
no screen, which nothing can reach and which is not even seeded into the save, so any count
a player had of it was dropped on the next load rather than kept. There was no way to tell
the two apart by reading the file, and no error either way.

So each table now accounts for every entry in it, checked at module load:
`STRUCTURE_ORDER` plus `DEPRECATED_STRUCTURE_ORDER` must be exactly the keys of
`STRUCTURES`, each one once; the same for castes; and research grew a
`PARKED_RESEARCH_ORDER` to say out loud what it had only ever said in a comment.
`DRONE_TYPE_ORDER` has nothing parked, so its check is the simple one — the order *is* the
table, and a type left off is a drone nothing can mold, no screen lists, and genetics
builds no subject for.

Moving an entry rather than copying it is the point: a check that refuses an id on both
lists is what makes the two lists one fact.

## Genetics: a genome per kind of body

A gene is written into a **subject** — one drone type today, a structure type later — and
every body of that kind gets it. It is not something an individual drone carries. That is the
single decision the whole system falls out of: it is why the left-hand column of the tab is a
list of *types*, why molding another forager mints another copy of whatever the forager
genome currently says, and why a save needs one array per type rather than per drone.

### Why this is not the modifier layer

The modifier layer already does "a named thing any number of sources make better or worse",
and the honest answer to "why a second one" is **scope**. A channel is hive-wide: `harvest` is
how much *any* gathering drone brings back. "Foragers eat less" is not a fact about the hive,
and a global `appetite` would be wrong for every other type the moment a second one existed.

So `definitions/genes.js` is a parallel layer with a deliberately **identical grammar** —
bonuses add, the result multiplies, a trait named for a cost means more cost, one reader per
trait — and a different scope. The two stack: `rationCost` (the hive is hungrier) and
`appetite` (this body is thrifty) both apply to the same bill.

The one thing it has that the modifier layer refuses to have is `better: 'up' | 'down'`. The
engine does not need it and modifiers.js is right to argue that a flag is a thing you can
forget to read — it gets the sign from the name. The **interface** does need it: a screen
whose entire job is to show what a gene would change has to know whether to paint +15% green
or red, and deriving that from a substring of the trait's name would be a guess.

### The traits, and where they land

| Trait | Direction | Read by |
| --- | --- | --- |
| `pace` | up is better | `forage.js cycleFor`, `expedition.js expeditionSeconds` |
| `appetite` | down is better | `engine.js computeRation`, the per-type bill |

`pace` **divides**, in both readers: a drone at +20% is twelve seconds over 1.2, not twelve
plus a bit. It carries a `floor` well clear of zero because a pace of nothing is not a drone
standing still, it is a cycle length of infinity and a NaN in every rate on the screen. It
lands in two places because a forager's work cycle is a trip and an explorer's is an
expedition — same trait, same arithmetic, two different clocks.

`FORAGE_CYCLE` stopped being imported directly and became `cycleFor(state, typeId)`. The
constant was imported in three files and divided by in two of them, which is exactly the shape
that leaves one site un-updated and a *displayed* rate disagreeing with the matter actually
arriving.

The ration bill was a headcount times a constant; it is now summed per type, because appetite
belongs to one kind of body. With no genes written anywhere the two are identical arithmetic —
which is why landing genetics moved no number in any of the other thirty-five suites.

### The preview is the real function

`traitsOf(state, key, override)` takes a genome to use *instead of* the stored one. That is
the whole of the tab's preview. A preview that recomputed the numbers by a parallel route
would be a second implementation of the thing it is previewing, and the two would agree right
up until one of them was edited; here the figure on the screen is produced by the function the
engine calls.

### The tab: three columns, and a staging model

Bodies on the left, what it does in the middle, genes on the right — the screen is a sentence
read left to right, and the middle is the only column that moves.

Clicking a gene does **not** write it. It joins a *proposed* genome, and the middle column
shows what that genome would do against what the current one does. Clicking a gene already
written in stages its removal the same way. Nothing reaches the hive until the commit button.
That buys three things: several changes can be lined up and judged together, adding and
removing are one gesture rather than two sets of controls, and the proposal is exactly what
gets committed.

Two smaller rules the tab keeps:

- **Every gene is listed, always**, including ones that cannot go into the selected body, with
  the reason printed in the row. A gene that does not fit is still a fact about the game, and
  a list that silently shortened itself as you clicked around the left column would make the
  system look smaller than it is. `blocks(subject)` returns a *reason*, not a boolean, for
  exactly this — a locked door with no sign on it is the worst thing an interface can do.
- **A multiplier is not an effect.** "×1.15 pace" is arithmetic; "a trip every 10.4s, was
  12.0s" is what happens. Every trait renders a concrete figure in the units the rest of the
  game quotes, computed per subject — which is how the same trait reads as seconds-per-trip
  for a forager and seconds-per-expedition for an explorer.

### What is deliberately missing

Genes cost nothing, take effect instantly, and nothing has to be unlocked to use one. All
three are placeholders, flagged as such on the tab, and none is a design decision — the shape
of the screen was what needed settling, and a cost model would have settled the wrong thing
first. Whatever genes end up costing gets charged in `writeGenome` and nowhere else.

The `structure` subject kind is declared and empty. The tab renders a kind with nothing in it
rather than hiding it, so "buildings, not yet" is a true thing the screen says and the second
kind arriving is a change to one list.

### Changing it

- *"A gene does nothing"* → `tests/genes-test.mjs` measures the engine before and after
  writing one. If the trait is declared and unread, the unread check catches it.
- *"Add a trait"* → declare it in `TRAITS` with its `floor`, `better` and `applied`, give it a
  reader, and add a `concrete()` case in the tab or it shows a multiplier and nothing else.
- *"Add a subject kind"* → `SUBJECT_KINDS` and `geneSubjects`. The tab needs nothing.

### One builder per kind of subject

Both halves of the subject layer used to be the drone loop written out: `geneSubjects`
built every subject, and `subjectOf` built the whole list and threw all but one away.
That is why `trait()` cost 1.2 µs a call with half of it in `subjectOf` — the engine asks
for a trait per drone type per tick, and every one of those calls ran `unlock(state)` and
rebuilt the genome for *every* type to answer about one. It is 430 ns now, built directly
from the key.

It also meant that buildings — declared and empty in `definitions/genes.js` — would have
had to be added to the list and to the lookup, separately, and the lookup is the one you
forget: it fails as "genes silently do nothing to buildings", not as an error. There is a
builder per kind now, keyed by the kind name the subject key carries, and a load-time check
that no builder exists for a kind the definitions do not declare.

### Shorthands that nothing reads

`organisms.js` declares a two-letter constant per biome so a `biomes` map reads as a map
rather than a paragraph. Three of them — the deep sea — are referenced by nothing, because
the hunt loop has no diver yet, and the table is kept complete on purpose: the next
organism added to one of those biomes should need no new line, and a half-table is the kind
of thing somebody tidies by deleting the wrong half.

An unused constant is one nothing verifies, though, and a typo in an unused shorthand shows
up as nothing at all until the day it is used. So all twenty-six are listed in `SHORTHANDS`
and checked at load against `BIOMES`. Listing them reads them; the check proves what they
claim.
