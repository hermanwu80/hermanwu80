// Date helpers shared by the server and the browser.
// All dates are plain 'YYYY-MM-DD' strings (no timezone); math is done in UTC.

export const pad = (n) => String(n).padStart(2, '0');

export function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fmt(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fmt(parse(s)) === s;
}

export const addDays = (s, n) => fmt(new Date(parse(s).getTime() + n * 86400000));
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
export const weekday = (s) => parse(s).getUTCDay();
export const daysInMonth = (y, m /* 1-12 */) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** First day of the week containing `s`; startDay 0 = Sunday ... 6 = Saturday. */
export function weekStart(s, startDay = 0) {
  return addDays(s, -((weekday(s) - startDay + 7) % 7));
}

/** Today's date in a given IANA timezone. */
export function todayIn(tz, now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return fmt(now);
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const monthName = (m) => MONTHS[m - 1];
export const dowName = (i) => DOWS[i];

/** "Sep 14" */
export function short(s) {
  const d = parse(s);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Sep 14 – 20" or "Sep 28 – Oct 4" */
export function rangeLabel(a, b) {
  const x = parse(a), y = parse(b);
  if (x.getUTCMonth() === y.getUTCMonth()) return `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()} – ${y.getUTCDate()}`;
  return `${short(a)} – ${short(b)}`;
}

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}
