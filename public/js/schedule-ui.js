import { ordinal, short, parse } from './dates.js';
import { h, field, select } from './ui.js';

const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dayLabel = (d) => (d === 31 ? 'last day' : ordinal(d));

/** Human description of a schedule spec, e.g. "Monthly on the 15th". */
export function describeSchedule(s) {
  if (!s) return '';
  if (s.type === 'once') return `Once on ${short(s.date)}`;
  if (s.type === 'weekly') {
    if ((s.every || 1) === 1) return `Every ${DOW_LONG[s.weekday]}`;
    return `Every ${s.every === 2 ? 'other' : s.every} ${DOW_LONG[parse(s.anchor).getUTCDay()]}`;
  }
  if (s.type === 'monthly') {
    const days = s.days.map(dayLabel);
    const list = days.length > 1 ? `${days.slice(0, -1).join(', ')} & ${days.at(-1)}` : days[0];
    if ((s.every || 1) === 1) return `Monthly on the ${list}`;
    if (s.every === 3) return `Every 3 months on the ${list}`;
    if (s.every === 12) return `Yearly on ${short(s.anchor)}`;
    return `Every ${s.every} months on the ${list}`;
  }
  return '';
}

const FREQS = [
  ['monthly', 'Monthly'], ['semimonthly', 'Twice a month'], ['weekly', 'Every week'], ['biweekly', 'Every other week'],
  ['quarterly', 'Every 3 months'], ['yearly', 'Once a year'], ['once', 'One time'],
];

function freqOf(s) {
  if (!s) return 'monthly';
  if (s.type === 'once') return 'once';
  if (s.type === 'weekly') return (s.every || 1) === 1 ? 'weekly' : 'biweekly';
  if (s.every === 3) return 'quarterly';
  if (s.every === 12) return 'yearly';
  return s.days.length > 1 ? 'semimonthly' : 'monthly';
}

/** Form control for choosing a schedule. `get()` returns the spec (or throws with a friendly message). */
export function scheduleEditor(initial, today) {
  const freq = freqOf(initial);
  const days = Array.from({ length: 31 }, (_, i) => [i + 1, i + 1 === 31 ? 'Last day' : ordinal(i + 1)]);
  const anchorDefault = initial?.anchor || initial?.date || today;
  const dayInit = initial?.days?.[0] ?? parse(today).getUTCDate();

  const fSel = select(FREQS, freq);
  const wd = select(DOW_LONG.map((n, i) => [i, n]), initial?.type === 'weekly' && (initial.every || 1) === 1 ? initial.weekday : parse(today).getUTCDay());
  const d1 = select(days, dayInit);
  const d2 = select(days, initial?.days?.[1] ?? 15);
  const date = h('input', { type: 'date', value: anchorDefault });

  const rows = {
    weekday: field('Day of week', wd),
    day1: field('Day of the month', d1, 'Choose "Last day" for bills due at month end'),
    day2: field('Second day', d2),
    date: field('', date),
  };
  const wrap = h('div', { class: 'stack' }, field('Repeats', fSel), rows.weekday, rows.day1, rows.day2, rows.date);

  const sync = () => {
    const f = fSel.value;
    rows.weekday.hidden = f !== 'weekly';
    rows.day1.hidden = !['monthly', 'semimonthly'].includes(f);
    rows.day2.hidden = f !== 'semimonthly';
    rows.date.hidden = !['biweekly', 'quarterly', 'yearly', 'once'].includes(f);
    rows.date.querySelector('.label').textContent =
      f === 'once' ? 'Date' : f === 'biweekly' ? 'Next date it happens' : f === 'quarterly' ? 'Next date (repeats every 3 months)' : 'Next date (repeats yearly)';
  };
  fSel.addEventListener('change', sync);
  sync();

  return {
    el: wrap,
    get() {
      const f = fSel.value;
      const need = () => { if (!date.value) throw new Error('Pick a date'); return date.value; };
      if (f === 'weekly') return { type: 'weekly', weekday: Number(wd.value), every: 1 };
      if (f === 'monthly') return { type: 'monthly', days: [Number(d1.value)], every: 1 };
      if (f === 'semimonthly') {
        if (d1.value === d2.value) throw new Error('Pick two different days');
        return { type: 'monthly', days: [Number(d1.value), Number(d2.value)], every: 1 };
      }
      if (f === 'biweekly') return { type: 'weekly', every: 2, anchor: need() };
      if (f === 'quarterly') return { type: 'monthly', days: [parse(need()).getUTCDate()], every: 3, anchor: date.value };
      if (f === 'yearly') return { type: 'monthly', days: [parse(need()).getUTCDate()], every: 12, anchor: date.value };
      return { type: 'once', date: need() };
    },
  };
}
