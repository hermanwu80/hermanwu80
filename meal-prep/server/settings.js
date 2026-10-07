import { MEALS } from './cascade.js';

export const DEFAULT_SETTINGS = {
  servings: 2,
  units: 'us',
  diet: '',
  dislikes: '',
  meals: ['breakfast', 'lunch', 'dinner'],
  tz: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
  tz_confirmed: false,
  // mode: 'off' | 'daily' (every day at `time`, prepare the day `lead_days` ahead)
  //       | 'weekly' (on weekday `dow` at `time`, start a 7-day plan beginning `lead_days` ahead)
  auto: { mode: 'off', time: '19:00', dow: 0, lead_days: 1 },
};

const validTz = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Merge a partial update into current settings, ignoring anything invalid. */
export function cleanSettings(input = {}, current = DEFAULT_SETTINGS) {
  const out = { ...current, auto: { ...current.auto } };
  if (input.servings !== undefined) {
    const n = Number(input.servings);
    if (Number.isInteger(n) && n >= 1 && n <= 12) out.servings = n;
  }
  if (input.units === 'us' || input.units === 'metric') out.units = input.units;
  if (input.diet !== undefined) out.diet = str(input.diet, 400);
  if (input.dislikes !== undefined) out.dislikes = str(input.dislikes, 400);
  if (Array.isArray(input.meals)) {
    const meals = MEALS.filter((m) => input.meals.includes(m));
    if (meals.length) out.meals = meals;
  }
  if (typeof input.tz === 'string' && validTz(input.tz)) { out.tz = input.tz; out.tz_confirmed = true; }
  const a = input.auto;
  if (a && typeof a === 'object') {
    if (['off', 'daily', 'weekly'].includes(a.mode)) out.auto.mode = a.mode;
    if (typeof a.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)) out.auto.time = a.time;
    if (Number.isInteger(a.dow) && a.dow >= 0 && a.dow <= 6) out.auto.dow = a.dow;
    if (Number.isInteger(a.lead_days) && a.lead_days >= 1 && a.lead_days <= 7) out.auto.lead_days = a.lead_days;
  }
  return out;
}
