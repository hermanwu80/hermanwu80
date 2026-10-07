import { get } from './api.js';
import { addDays, weekday, parse, short, dowName } from './dates.js';

/** App-wide state shared by views. `apply` and `refresh` are installed by app.js and re-render the current view. */
export const S = {
  me: null,
  state: null,        // last /api/state response
  selected: null,     // date shown on the Plan tab
  apply: async () => {},
  refresh: async () => {},
};

export async function loadState() {
  S.state = await get('/api/state');
  return S.state;
}

export const units = () => S.state?.settings?.units || 'us';
export const dayOf = (date) => S.state.days.find((d) => d.date === date);
export const slotOf = (date, meal) => dayOf(date)?.slots.find((s) => s.meal === meal);

const LONG_DOWS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const longDow = (date) => LONG_DOWS[weekday(date)];
export const shortDow = (date) => dowName(weekday(date));
export const dayNum = (date) => parse(date).getUTCDate();

/** "Today", "Tomorrow" or "Thursday" */
export function dayName(date) {
  const t = S.state.today;
  if (date === t) return 'Today';
  if (date === addDays(t, 1)) return 'Tomorrow';
  return longDow(date);
}
/** Like dayName but safe mid-sentence: "today", "tomorrow", "Friday". */
export const dayInline = (date) => dayName(date).replace(/^(Today|Tomorrow)$/, (m) => m.toLowerCase());
export const dayLong = (date) => `${longDow(date)}, ${short(date)}`;

export const MEAL_ICON = { breakfast: '🍳', lunch: '🥗', dinner: '🍝', snack: '🍎' };
