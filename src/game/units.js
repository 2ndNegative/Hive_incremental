// SI-aware formatting.
//
// The hive thinks in joules and grams. Both span an absurd range — a vitamin
// trace is micrograms, a continental biomass reserve is megatonnes — so every
// quantity is stored in one canonical unit and only given a prefix at the
// moment it is printed.
//
//   energy  stored in joules (J)
//   mass    stored in grams (g)
//   power   stored in watts (W)

const SI = [
  { exp: -24, prefix: 'y' },
  { exp: -21, prefix: 'z' },
  { exp: -18, prefix: 'a' },
  { exp: -15, prefix: 'f' },
  { exp: -12, prefix: 'p' },
  { exp: -9, prefix: 'n' },
  { exp: -6, prefix: 'µ' },
  { exp: -3, prefix: 'm' },
  { exp: 0, prefix: '' },
  { exp: 3, prefix: 'k' },
  { exp: 6, prefix: 'M' },
  { exp: 9, prefix: 'G' },
  { exp: 12, prefix: 'T' },
  { exp: 15, prefix: 'P' },
  { exp: 18, prefix: 'E' },
  { exp: 21, prefix: 'Z' },
  { exp: 24, prefix: 'Y' },
];

const ZERO_INDEX = SI.findIndex((s) => s.exp === 0);

/** "1.50" -> "1.5", "100" -> "100" (never strips zeros that carry magnitude). */
function trimZeros(text) {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/**
 * Format `value` (in the base unit) with the SI prefix that keeps the mantissa
 * in [1, 1000).
 *
 * @param {number} value
 * @param {string} unit base unit symbol, e.g. 'J', 'g', 'W'
 * @param {object} [opts]
 * @param {number} [opts.digits] significant decimals (default: scaled by size)
 * @param {number} [opts.minExp] never go below this prefix exponent
 * @param {number} [opts.maxExp] never go above this prefix exponent
 */
export function formatSI(value, unit, opts = {}) {
  const { digits, minExp = -6, maxExp = 24 } = opts;
  if (!Number.isFinite(value)) return `∞ ${unit}`;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs === 0) return `0 ${unit}`;

  // Snap to the engineering tier (a multiple of 3) at or below the magnitude,
  // then clamp to the prefixes this caller allows.
  const magnitude = Math.floor(Math.log10(abs));
  let exp = Math.floor(magnitude / 3) * 3;
  exp = Math.max(minExp, Math.min(maxExp, exp));
  const tier = SI[SI.findIndex((s) => s.exp === exp)] ?? SI[ZERO_INDEX];

  const scaled = abs / 10 ** tier.exp;
  const decimals = digits ?? (scaled < 10 ? 2 : scaled < 100 ? 1 : 0);
  const mantissa = trimZeros(scaled.toFixed(decimals));
  return `${sign}${mantissa} ${tier.prefix}${unit}`;
}

/** Joules, auto-prefixed: 450 J, 12.4 kJ, 3.08 MJ, 1.2 GJ ... */
export function formatEnergy(joules, opts) {
  return formatSI(joules, 'J', { minExp: 0, ...opts });
}

/**
 * Grams, auto-prefixed. Above a kilogram the hive talks in tonnes, so the
 * sequence runs µg, mg, g, kg, t, kt, Mt, Gt rather than g, kg, Mg, Gg.
 */
export function formatMass(grams, opts = {}) {
  if (!Number.isFinite(grams)) return '∞ g';
  const abs = Math.abs(grams);
  if (abs >= 1e6) {
    // 1 t = 1e6 g. Re-enter the SI ladder with tonnes as the base unit.
    return formatSI(grams / 1e6, 't', { minExp: 0, ...opts });
  }
  return formatSI(grams, 'g', { minExp: -6, maxExp: 3, ...opts });
}

/**
 * Cogits, auto-prefixed: 420 Cg, 4.2 kCg, 1.1 MCg.
 *
 * Never goes below the base unit — a third of a cogit is not a thing the hive
 * can hold a thought in, so millicogits would be noise.
 */
export function formatCogits(cogits, opts) {
  return formatSI(cogits, 'Cg', { minExp: 0, ...opts });
}

/** Watts, auto-prefixed. */
export function formatPower(watts, opts) {
  return formatSI(watts, 'W', { minExp: -3, ...opts });
}

/** A signed per-second flow of some already-formatted quantity. */
export function formatFlow(value, formatter, opts) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatter(Math.abs(value), opts)}/s`;
}

export function formatMassFlow(gramsPerSecond, opts) {
  return formatFlow(gramsPerSecond, formatMass, opts);
}

/**
 * Energy per second IS power, so this prints watts with no "/s" suffix —
 * writing "kW/s" would claim an acceleration nobody meant.
 */
export function formatEnergyFlow(joulesPerSecond, opts) {
  const sign = joulesPerSecond > 0 ? '+' : joulesPerSecond < 0 ? '−' : '';
  return `${sign}${formatPower(Math.abs(joulesPerSecond), opts)}`;
}

/**
 * Larvae, counted. One larva, two larvae — the singular is the whole reason
 * this is a function rather than a template string.
 */
export function formatLarvae(count) {
  const n = Math.floor(count || 0);
  return `${n} ${n === 1 ? 'larva' : 'larvae'}`;
}

/**
 * Square metres of ground.
 *
 * Holdings used to be whole numbers, so everything printed them with no
 * decimals — and then expeditions started finding 3.2 m² patches, a claim made
 * a hive 39.2 m², and the screen said 39. The ground was there; the display was
 * throwing it away, which reads exactly like a bug that eats your territory.
 *
 * So: a figure that IS whole prints whole, and one that is not keeps a decimal.
 * The tolerance stops floating-point dust (39.000000001) printing as 39.0.
 */
export function formatArea(squareMetres) {
  const area = Number(squareMetres) || 0;
  const rounded = Math.round(area);
  return Math.abs(area - rounded) < 0.05 ? `${rounded}` : area.toFixed(1);
}
