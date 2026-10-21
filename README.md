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

Nutrient data from the USDA FoodData Central SR Legacy and Foundation Foods datasets, public domain.

## Running it yourself

Needs Node 20.19+ or 22.12+ (whatever Vite's current release wants — `npm install` will
say so if yours is too old).

```bash
npm install            # once
npm run dev            # development server, hot reload, http://localhost:5173
npm run build          # production build into dist/
npm run play           # serve the built game at http://localhost:4173
npm run single         # one portable .html file: HiveIdle.html
```

Checks, in the order `npm run check` runs them:

```bash
npm run lint           # eslint over src, tools, tests and the configs
npm run validate       # the item database
npm test               # all browser suites (needs `npx playwright install chromium` once)
npm run check          # all three, stopping at the first failure, logged to check-log.txt
```

Running one suite on its own, which is how you read a failure:

```bash
node tests/land-test.mjs            # against a server you already have on :4173
npm test -- land ui                 # or let the runner build and serve for you
HIVE_URL=http://localhost:5173 node tests/land-test.mjs   # against the dev server
```

`docs/DESIGN.md` is the long version: what every system does, why it is shaped that way,
and which dial to turn when it is wrong. It is the front door to five more —
[the systems](docs/SYSTEMS.md), [the economy](docs/ECONOMY.md),
[the interface](docs/INTERFACE.md), [the test suites](docs/TESTING.md) and
[working on it](docs/WORKING.md) — and links to each in turn.
