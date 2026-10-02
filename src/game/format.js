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
  if (!Number.isFinite(value)) return '∞';
  const sign = value < 0 ? '-' : '';
  let n = Math.abs(value);

  if (n < 1000) {
    // Avoid printing "0.0" for a tiny but non-zero trickle.
    if (n > 0 && n < 0.1 && decimals > 0) return `${sign}${n.toFixed(2)}`;
    const rounded = n % 1 === 0 ? n.toFixed(0) : n.toFixed(decimals);
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

/** Format a per-second rate, always signed. */
export function formatRate(value, opts = {}) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatNumber(Math.abs(value), { decimals: 2, ...opts })}/s`;
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
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d`;
}
