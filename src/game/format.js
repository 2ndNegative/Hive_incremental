// Number formatting helpers.
//
// Incrementals live and die by readable numbers. Everything the UI prints goes
// through here so that switching notation later is a one-file change.

const SUFFIXES = [
  '',
  'K',
  'M',
  'B',
  'T',
  'Qa',
  'Qi',
  'Sx',
  'Sp',
  'Oc',
  'No',
  'Dc',
];

/**
 * Format a quantity for display.
 * @param {number} value
 * @param {object} [opts]
 * @param {number} [opts.decimals] decimals to show below 1000
 * @param {'suffix'|'scientific'|'plain'} [opts.notation]
 */
export function formatNumber(value, opts = {}) {
  const { decimals = 1, notation = 'suffix' } = opts;
  // Told apart rather than lumped together — see formatSI. A NaN printed as
  // "∞" is a bug wearing a success's clothes.
  if (Number.isNaN(value) || value === undefined || value === null) return '?';
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '-∞';
  if (!Number.isFinite(value)) return '?';
  const sign = value < 0 ? '-' : '';
  let n = Math.abs(value);

  if (n < 1000) {
    // Avoid printing "0.0" for a tiny but non-zero trickle.
    if (n > 0 && n < 0.1 && decimals > 0) return `${sign}${n.toFixed(2)}`;
    const rounded = n % 1 === 0 ? n.toFixed(0) : n.toFixed(decimals);
    // 999.96 rounds to "1000.0", which is a thousand written the long way.
    // Promote it rather than print it.
    if (Number(rounded) >= 1000) return formatNumber(Number(rounded) * (value < 0 ? -1 : 1), opts);
    return `${sign}${rounded}`;
  }

  if (notation === 'plain') {
    return sign + Math.floor(n).toLocaleString('en-US');
  }

  if (notation === 'scientific') {
    return `${sign}${n.toExponential(2).replace('e+', 'e')}`;
  }

  let tier = 0;
  while (n >= 1000 && tier < SUFFIXES.length - 1) {
    n /= 1000;
    tier += 1;
  }
  if (n >= 1000) {
    // Past the named tiers, fall back to scientific notation.
    return `${sign}${(n * 1000 ** tier).toExponential(2).replace('e+', 'e')}`;
  }
  const digits = n < 10 ? 2 : n < 100 ? 1 : 0;
  return `${sign}${n.toFixed(digits)}${SUFFIXES[tier]}`;
}

/** Seconds -> "1d 04:12:31" */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (v) => String(v).padStart(2, '0');
  const clock = `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

/** "in 2m 30s" style estimate, or null when unreachable. */
export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 1) return '<1s';

  /*
   * ROUNDED ONCE, UP FRONT, BEFORE IT IS SPLIT.
   *
   * This floored the minutes and ceilinged the seconds, which are two
   * different roundings of the same number: 119.5 s came out as "1m 60s", and
   * 59.5 s as "60s". Rounding to whole seconds first and then dividing means
   * the parts can only ever add back up to the whole.
   */
  const whole = Math.ceil(seconds - 1e-9);
  if (whole < 60) return `${whole}s`;
  if (whole < 3600) return `${Math.floor(whole / 60)}m ${whole % 60}s`;

  // Minutes, at this scale, round rather than truncate: "2h 0m" for something
  // 119 minutes away is a worse answer than "2h 0m" being impossible.
  const hours = Math.floor(whole / 3600);
  const minutes = Math.round((whole % 3600) / 60);
  if (whole < 86400) {
    if (minutes < 60) return `${hours}h ${minutes}m`;
    // The carry can reach a whole day, and "24h 0m" is a day written the long
    // way round.
    return hours + 1 >= 24 ? '1d' : `${hours + 1}h 0m`;
  }
  return `${Math.floor(whole / 86400)}d`;
}
