/*
 * NUMBER FORMATTING, which is pure arithmetic and so gets a pure-node suite.
 *
 * None of these are exotic inputs. They are the ordinary ones that happen to
 * land on a boundary, and every one of them was reachable from the live game:
 * an ETA two minutes out, a store a shade under a kilogram, a rate that had
 * gone wrong upstream. A readout that is wrong at the boundary is wrong at
 * exactly the moment somebody is watching it change.
 */
import { formatNumber, formatEta, formatDuration } from '../src/game/format.js';
import { formatSI, formatMass, formatEnergy, formatPower } from '../src/game/units.js';
import { checker, finish } from './harness.mjs';

const { check: ck, fail } = checker();
const eq = (label, got, want) => ck(label, got === want, `got "${got}", wanted "${want}"`);

/* ===================================== 1. a broken number must look broken */

/*
 * NaN and -Infinity both printed as "∞". A rate that had become NaN somewhere
 * upstream therefore displayed as the best possible outcome — unbounded — and
 * a hive quietly running on garbage looked like a hive doing magnificently.
 */
eq('NaN is not infinity', formatMass(NaN), '? g');
eq('and neither is minus infinity', formatMass(-Infinity), '-∞ g');
eq('infinity still is', formatMass(Infinity), '∞ g');
eq('a missing number reads as missing', formatMass(undefined), '? g');
eq('the same in plain numbers', formatNumber(NaN), '?');
eq('and in energy', formatEnergy(NaN), '? J');

/* =============================== 2. rounding must not invent a bigger unit */

/*
 * The tier is chosen from the magnitude and the mantissa is rounded after, so
 * a value just under a boundary picked the lower tier and then rounded its
 * mantissa into the next one: "1000 g", which is the one thing a unit ladder
 * exists to stop you printing.
 */
eq('999.6 g is a kilogram, not a thousand grams', formatMass(999.6), '1 kg');
eq('and 999,999.6 g is a tonne', formatMass(999999.6), '1 t');
eq('a hair under still is not', formatMass(999499), '999 kg');
eq('the same in the SI helper', formatSI(999.6, 'g'), '1 kg');
eq('and in plain numbers', formatNumber(999.96), '1.00K');
ck('ordinary values are untouched',
  formatMass(1500) === '1.5 kg' && formatMass(0.0004) === '400 µg' && formatMass(12) === '12 g',
  `${formatMass(1500)} / ${formatMass(0.0004)} / ${formatMass(12)}`);

/* ===================================== 3. the parts must add up to the whole */

/*
 * `formatEta` floored the minutes and ceilinged the seconds — two different
 * roundings of one number — so 119.5 s came out as "1m 60s". Rounding once,
 * up front, and then splitting makes that unrepresentable.
 */
eq('119.5s is two minutes, not one minute and sixty seconds', formatEta(119.5), '2m 0s');
eq('59.5s is a minute', formatEta(59.5), '1m 0s');
eq('659.5s is eleven minutes', formatEta(659.5), '11m 0s');
eq('3599.5s is an hour', formatEta(3599.5), '1h 0m');
eq('86399s is a day, not twenty-four hours', formatEta(86399), '1d');
eq('and an ordinary one is unchanged', formatEta(7140), '1h 59m');
ck('nothing ever prints sixty of a unit',
  Array.from({ length: 4000 }, (_, i) => formatEta(i * 0.37 + 0.5))
    .every((t) => t === null || !/\b60[sm]\b/.test(t)),
  'swept four thousand durations');

/* ============================================= 4. and the obvious cases hold */

ck('a short wait is still a short wait', formatEta(0.4) === '<1s' && formatEta(0) === null,
  `${formatEta(0.4)} / ${formatEta(0)}`);
ck('power and duration agree with themselves',
  formatPower(50_000) === '50 kW' && typeof formatDuration(90) === 'string',
  `${formatPower(50_000)} / ${formatDuration(90)}`);

await finish({ name: 'number formatting', fail });
