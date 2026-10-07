// Recurrence engine for bills and paydays.
//
// A schedule is a small JSON object:
//   { type: 'once',    date: 'YYYY-MM-DD' }
//   { type: 'weekly',  weekday: 0-6 }                        every week
//   { type: 'weekly',  every: 2, anchor: 'YYYY-MM-DD' }      every N weeks, on the anchor's weekday
//   { type: 'monthly', days: [1..31], every?: N, anchor? }   day 31 means "last day of the month";
//                                                            every > 1 needs an anchor to pick the months
import { addDays, diffDays, weekday, parse, fmt, daysInMonth, isValidDate } from '../public/js/dates.js';

export function validateSchedule(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('Schedule is required');
  const every = spec.every == null ? 1 : Number(spec.every);
  if (!Number.isInteger(every) || every < 1 || every > 24) throw new Error('Invalid repeat interval');
  switch (spec.type) {
    case 'once':
      if (!isValidDate(spec.date)) throw new Error('Invalid date');
      return { type: 'once', date: spec.date };
    case 'weekly': {
      if (every === 1) {
        const wd = Number(spec.weekday);
        if (!Number.isInteger(wd) || wd < 0 || wd > 6) throw new Error('Invalid weekday');
        return { type: 'weekly', weekday: wd, every: 1 };
      }
      if (!isValidDate(spec.anchor)) throw new Error('Pick a first date for the repeat');
      return { type: 'weekly', every, anchor: spec.anchor };
    }
    case 'monthly': {
      const days = [...new Set((spec.days || []).map(Number))].sort((a, b) => a - b);
      if (!days.length || days.length > 4 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 31)) throw new Error('Invalid days of month');
      if (every > 1) {
        if (!isValidDate(spec.anchor)) throw new Error('Pick a first date for the repeat');
        return { type: 'monthly', days, every, anchor: spec.anchor };
      }
      return { type: 'monthly', days, every: 1 };
    }
    default:
      throw new Error('Unknown schedule type');
  }
}

const monthIndex = (s) => { const d = parse(s); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };

/** All occurrence dates of `spec` between `from` and `to`, inclusive. */
export function occurrences(spec, from, to) {
  if (from > to) return [];
  const out = [];
  if (spec.type === 'once') {
    if (spec.date >= from && spec.date <= to) out.push(spec.date);
    return out;
  }
  if (spec.type === 'weekly') {
    const every = spec.every || 1;
    const wd = every === 1 ? spec.weekday : weekday(spec.anchor);
    let d = addDays(from, (wd - weekday(from) + 7) % 7);
    for (; d <= to; d = addDays(d, 7)) {
      if (every === 1 || (diffDays(spec.anchor, d) / 7) % every === 0) out.push(d);
    }
    return out;
  }
  if (spec.type === 'monthly') {
    const every = spec.every || 1;
    const a = parse(from), b = parse(to);
    let y = a.getUTCFullYear(), m = a.getUTCMonth() + 1;
    const endKey = b.getUTCFullYear() * 12 + b.getUTCMonth();
    for (; y * 12 + (m - 1) <= endKey; m === 12 ? (y++, m = 1) : m++) {
      if (every > 1 && (((y * 12 + (m - 1) - monthIndex(spec.anchor)) % every) + every) % every !== 0) continue;
      const dim = daysInMonth(y, m);
      const days = new Set(spec.days.map((d) => Math.min(d, dim)));
      for (const day of [...days].sort((x, y2) => x - y2)) {
        const date = fmt(new Date(Date.UTC(y, m - 1, day)));
        if (date >= from && date <= to) out.push(date);
      }
    }
    return out;
  }
  return out;
}
