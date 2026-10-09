# HiveIdle

An idle/incremental game in the style of [Evolve](https://pmotschmann.github.io/Evolve/).
An alien hivemind lands on Earth and eats its way up the food chain.

**[Play it](https://2ndnegative.github.io/Hive_incremental/)**

Work in progress.

## Built with generative AI

This game was made with the help of generative AI. Most of the code here, and a
good deal of the prose in it, was written by a large language model working from
my direction — design decisions, mechanics, balance and review are mine; a lot of
the typing is not.

The food and nutrient database is compiled from published nutritional data rather
than invented — chiefly the USDA FoodData Central SR Legacy set, which is where
about three quarters of the 497 items come from, with the rest from published
analyses of things SR Legacy does not cover. Every item carries its source and a
confidence rating, and the Codex shows both, so a measured figure and a deliberate
game abstraction are never presented as the same thing.

I would rather say this plainly up front than have you work it out from the
commit history.

## Running it locally

Needs Node 20 or newer.

```bash
npm install
npm run dev        # dev server with hot reload, http://localhost:4400
npm run build      # production bundle into dist/
npm run check      # lint, item database, then all 32 browser suites
```

The suites drive a real Chromium, which Playwright fetches once with
`npx playwright install chromium`. `npm test` builds and serves the game itself,
so nothing needs to be running first.

On Windows, `Play HiveIdle.bat` does the whole thing — Node check, install,
rebuild if needed, serve, open a browser — and `Check HiveIdle.bat` runs
`npm run check` with the first-run installs done for you. The launchers are
local-only and are not in the repository.

Design notes are in [docs/DESIGN.md](docs/DESIGN.md).
