// Ties the pieces together: loads what's been chosen, asks the recipe source for options using the cascade
// context, stores them, and builds the state the UI renders. Generation runs as background jobs so a phone that
// goes to sleep mid-request doesn't lose the result; the UI polls until slots stop saying "generating".
import { addDays, todayIn } from '../public/js/dates.js';
import { contextAt, annotateRecipe, groceryList, HISTORY_DAYS } from './cascade.js';
import { DEFAULT_SETTINGS, cleanSettings } from './settings.js';

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

export function createPlanner({ db, recipes, now = () => new Date() }) {
  const inflight = new Map();

  const kvGet = (key) => { const r = db.get('SELECT value FROM kv WHERE key = ?', key); return r ? parse(r.value) : null; };
  const kvSet = (key, value) => db.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  const kvDel = (key) => db.run('DELETE FROM kv WHERE key = ?', key);

  const settings = () => {
    const s = kvGet('settings');
    return s ? { ...DEFAULT_SETTINGS, ...s, auto: { ...DEFAULT_SETTINGS.auto, ...(s.auto || {}) } } : { ...DEFAULT_SETTINGS, auto: { ...DEFAULT_SETTINGS.auto } };
  };
  const saveSettings = (input) => { const next = cleanSettings(input, settings()); kvSet('settings', next); return next; };
  const today = () => todayIn(settings().tz, now());

  const slotRow = (date, meal) => db.get('SELECT * FROM slots WHERE date = ? AND meal = ?', date, meal);
  const optionsOf = (row) => (row ? parse(row.options) || [] : []);
  const pantry = () => db.all('SELECT id, name, amount, unit, expires_on FROM pantry ORDER BY name');

  /** Every chosen meal, flattened: [{ date, meal, recipe }]. */
  function chosenMeals() {
    return db.all('SELECT date, meal, options, chosen_idx FROM slots WHERE chosen_idx IS NOT NULL AND skipped = 0')
      .map((r) => ({ date: r.date, meal: r.meal, recipe: optionsOf(r)[r.chosen_idx] }))
      .filter((m) => m.recipe);
  }

  const cascadeInput = () => ({ meals: chosenMeals(), stock: pantry(), today: today() });

  function upsertSlot(date, meal, fields) {
    const row = slotRow(date, meal);
    const next = { options: '[]', chosen_idx: null, skipped: 0, hint: '', generated_at: null, ...(row || {}), ...fields };
    db.run(
      `INSERT INTO slots (date, meal, options, chosen_idx, skipped, hint, generated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(date, meal) DO UPDATE SET options = excluded.options, chosen_idx = excluded.chosen_idx,
         skipped = excluded.skipped, hint = excluded.hint, generated_at = excluded.generated_at`,
      date, meal, next.options, next.chosen_idx, next.skipped, next.hint, next.generated_at);
  }

  /** Start (or join) a background job that writes three fresh options for one meal. Resolves when finished. */
  function generate(date, meal, { hint = '' } = {}) {
    const key = `${date}|${meal}`;
    const existing = inflight.get(key);
    if (existing?.status === 'running') return existing.promise;
    const job = { status: 'running', message: '' };
    inflight.set(key, job);
    job.promise = (async () => {
      try {
        const input = cascadeInput();
        const ctx = contextAt(input, { date, meal });
        const prev = optionsOf(slotRow(date, meal)).map((o) => o.title);
        const near = input.meals.filter((m) => !(m.date === date && m.meal === meal));
        const recent = [...new Set([...near.filter((m) => Math.abs(Date.parse(m.date) - Date.parse(date)) <= HISTORY_DAYS * 86400000).map((m) => m.recipe.title), ...prev])];
        const sameDay = near.filter((m) => m.date === date).map((m) => m.recipe.title);
        const options = await recipes.suggest({
          meal, date, settings: settings(), priority: ctx.priority, longlife: ctx.longlife, recent, sameDay, hint: String(hint || '').slice(0, 200),
        });
        upsertSlot(date, meal, { options: JSON.stringify(options), chosen_idx: null, skipped: 0, hint: String(hint || '').slice(0, 200), generated_at: now().toISOString() });
        inflight.delete(key);
      } catch (e) {
        job.status = 'error';
        job.message = e.message || 'Something went wrong';
      }
    })();
    return job.promise;
  }

  /** Generate every enabled meal for a day in parallel (they all see the same leftovers). */
  const generateDay = (date, opts) => Promise.all(settings().meals.map((meal) => generate(date, meal, opts)));

  function choose(date, meal, { idx, skip, clear }) {
    const row = slotRow(date, meal);
    const opts = optionsOf(row);
    if (clear) return upsertSlot(date, meal, { chosen_idx: null, skipped: 0 });
    if (skip) return upsertSlot(date, meal, { chosen_idx: null, skipped: 1 });
    if (!Number.isInteger(idx) || idx < 0 || idx >= opts.length) throw Object.assign(new Error('Pick one of the options'), { status: 400 });
    upsertSlot(date, meal, { chosen_idx: idx, skipped: 0 });
  }

  function slotStatus(row, job) {
    if (job?.status === 'running') return 'generating';
    if (job?.status === 'error') return 'error';
    if (row?.skipped) return 'skipped';
    if (row?.chosen_idx != null) return 'chosen';
    return optionsOf(row).length ? 'ready' : 'empty';
  }

  /** A day is "complete" once every enabled meal is chosen or skipped. */
  function dayProgress(date) {
    const s = settings();
    const rows = s.meals.map((m) => slotRow(date, m));
    return {
      has_options: rows.every((r) => optionsOf(r).length > 0 || r?.skipped),
      complete: rows.every((r) => r && (r.chosen_idx != null || r.skipped)),
    };
  }

  function buildState() {
    const s = settings();
    const input = cascadeInput();
    const t = input.today;
    const days = [];
    for (let i = 0; i < 8; i++) {
      const date = addDays(t, i);
      const slots = s.meals.map((meal) => {
        const row = slotRow(date, meal);
        const job = inflight.get(`${date}|${meal}`);
        const ctx = contextAt(input, { date, meal });
        return {
          meal,
          status: slotStatus(row, job),
          error: job?.status === 'error' ? job.message : null,
          chosen_idx: row?.chosen_idx ?? null,
          hint: row?.hint || '',
          options: optionsOf(row).map((o) => ({ ...o, ...annotateRecipe(o, ctx.lots) })),
        };
      });
      const first = contextAt(input, { date, meal: s.meals[0] });
      days.push({ date, slots, use_up: first.priority, ...dayProgress(date) });
    }
    const notice = kvGet('notice');
    return {
      today: t,
      settings: s,
      days,
      pantry: input.stock,
      notice: notice && days.some((d) => d.date === notice.date && !d.complete) ? notice : null,
      ai: { enabled: recipes.enabled, demo: !!recipes.demo, model: recipes.model },
    };
  }

  const grocery = (from, to) => groceryList(cascadeInput(), { from, to });

  return {
    settings, saveSettings, today, kvGet, kvSet, kvDel, pantry, slotRow, optionsOf,
    generate, generateDay, choose, dayProgress, buildState, grocery,
    clearError: (date, meal) => { if (inflight.get(`${date}|${meal}`)?.status === 'error') inflight.delete(`${date}|${meal}`); },
    anyRunning: () => [...inflight.values()].some((j) => j.status === 'running'),
  };
}
