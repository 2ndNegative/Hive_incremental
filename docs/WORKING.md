# HiveIdle — Working on it

The dev handles, the cheats behind the access code, how the site is published, and what is deliberately not built yet.

The front door is [DESIGN.md](DESIGN.md).

In this file: [Not built yet](#not-built-yet) · [Developer mode](#developer-mode) · [Debug handle](#debug-handle) · [GitHub Pages](#github-pages) · [Repository hygiene](#repository-hygiene)

## Not built yet

- **Hunting.** The data is in place — organisms, live masses, butchery yields, biome
  weights — and so is the engine path: `forage.js` pools prey with huntable items for a
  `gather: 'hunter'` route, and `engine.js` turns one roll into a carcass and butchers it
  into its cuts. What is missing is a drone that does it. `DRONE_TYPES` has forager,
  scavenger and explorer; the old Hunter caste is parked with the rest of the caste layer,
  so nothing in a live hive ever takes that branch. Also missing: prey populations that
  regenerate and deplete, choosing a target species, and the risk that a hunt costs drones.
- **Genetics**, past the first pass. The layer, the tab and two genes are in — see [Genetics: a genome per kind of body](SYSTEMS.md#genetics-a-genome-per-kind-of-body). What is missing is everything that makes it a decision: genes
  cost nothing, nothing has to be unlocked to use one, there is no way to discover a new one,
  and buildings are a declared-but-empty subject kind.
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

### The two build tools

`npm run needs-build` prints 1 if the built outputs are older than the sources and 0 if
they are current, and `--why` — which the npm script passes — adds a line naming the file
that decided it. The launcher uses it so a normal start is instant.

It watches **both** outputs, which it used to get wrong. There are two builds: `dist/` for
the launcher and `HiveIdle.html` for the portable one-file copy. Looking only at
`dist/index.html` meant a repository with a fresh `dist/` and a six-commit-old portable
build reported "nothing to do", and `tests/single-test.mjs`, which opens that very file,
then tested a version of the game nobody was running. It watches `tools/` too, for the same
reason one step back: `build-single.mjs` *is* the portable build, so a change to it changes
the output while every watched source stays untouched — which is exactly how the
`__APP_VERSION__` fix shipped broken once.

`npm run clean` lists the files in `dist/assets/` that `dist/index.html` no longer points
at, and `--delete` removes them. Every build writes `index-<hash>.js` under a new name and
nothing removes the old one, so six builds in that folder is mostly files nothing can
reach. The rule — a file is live if its name appears in `dist/index.html`, and a sourcemap
is live if the file it belongs to is — used to be written in `cmd`, where it could not be
read without counting exclamation marks and could not run on anything but Windows. The
batch file is still the front door there and calls nothing it did not before; this is the
same rule somewhere it can be read. Nothing in `dist/` is in the repository and Pages
builds from source, so none of it can affect what is live.
