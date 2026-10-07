// Quantity formatting shared by the server (demo recipes) and the browser.
// All recipe math is done in g / ml / count; this only turns numbers into something readable.

const trim = (n) => {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace(/(\.\d)0$/, '$1');
};

const FRACTIONS = [[0.25, '¼'], [0.33, '⅓'], [0.5, '½'], [0.67, '⅔'], [0.75, '¾']];

/** 1.5 -> "1½", 0.25 -> "¼", 3 -> "3" */
export function niceNumber(n) {
  if (n >= 10) return String(Math.round(n));
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.12) return String(whole || 0);
  if (frac > 0.88) return String(whole + 1);
  const hit = FRACTIONS.reduce((best, f) => (Math.abs(f[0] - frac) < Math.abs(best[0] - frac) ? f : best));
  return `${whole || ''}${hit[1]}`;
}

/** Format an amount in g / ml / count for a unit system ('us' | 'metric'). */
export function fmtQty(amount, unit, system = 'us') {
  const a = Number(amount) || 0;
  if (unit === 'count') return niceNumber(a);
  if (unit === 'g') {
    if (system === 'metric') return a >= 1000 ? `${trim(a / 1000)} kg` : `${Math.round(a)} g`;
    const oz = a / 28.3495;
    if (oz >= 15.5) return `${niceNumber(Math.round((oz / 16) * 4) / 4)} lb`;
    return `${oz < 8 ? trim(Math.round(oz * 2) / 2) : Math.round(oz)} oz`;
  }
  if (unit === 'ml') {
    if (system === 'metric') return a >= 1000 ? `${trim(a / 1000)} L` : `${Math.round(a)} ml`;
    if (a < 15) return `${niceNumber(a / 4.929)} tsp`;
    if (a < 60) return `${niceNumber(a / 14.787)} tbsp`;
    if (a < 950) return `${niceNumber(a / 236.588)} cup${a / 236.588 > 1.12 ? 's' : ''}`;
    return `${trim(Math.round((a / 946.353) * 4) / 4)} qt`;
  }
  return trim(a);
}
