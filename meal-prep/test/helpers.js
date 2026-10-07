import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createPlanner } from '../server/planner.js';
import { createScheduler } from '../server/scheduler.js';
import { createRecipeAi } from '../server/recipes.js';
import { createDemoRecipes } from '../server/demo.js';

/** A recipe in the shape the planner stores. ings: [name, amount, unit, packSize, shelfDays] or [name, 'staple']. */
export function recipe(title, ings) {
  return {
    id: title, title, description: '', minutes: 20, steps: ['Cook it.'],
    ingredients: ings.map(([name, amount, unit, size, shelf]) => (amount === 'staple'
      ? { name, display: name, amount: 0, unit: 'count', aisle: 'pantry', staple: true, pack: null }
      : { name, display: `${amount} ${name}`, amount, unit, aisle: 'produce', staple: false, pack: { size, label: `pack of ${name}`, shelf_life_days: shelf } })),
  };
}

/**
 * Boots the app on a random port against an in-memory db with a controllable clock.
 * recipes: 'demo' (built-in library) or a fake Anthropic client.
 */
const open = [];
/** Close every app booted so far (call from an `after` hook so failed assertions can't leave servers running). */
export function closeAll() { while (open.length) open.pop()(); }

export async function boot({ recipes = 'demo', password = '', now = new Date('2026-10-07T12:00:00Z'), tz = 'UTC' } = {}) {
  const db = openDb(':memory:');
  const source = recipes === 'demo' ? createDemoRecipes() : createRecipeAi({ client: recipes });
  const clock = { now };
  const planner = createPlanner({ db, recipes: source, now: () => clock.now });
  planner.saveSettings({ tz });
  const scheduler = createScheduler({ planner, now: () => clock.now });
  const app = createApp({ db, planner, recipes: source, password });
  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text };
  };
  const client = { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u) };
  /** Wait until no generation job is running. */
  const settle = async () => { for (let i = 0; i < 200 && planner.anyRunning(); i++) await new Promise((r) => setTimeout(r, 5)); };
  const close = () => { server.closeAllConnections(); server.close(); db.close(); };
  open.push(close);
  return { db, planner, scheduler, clock, api: client, settle, close };
}

export const fakeClient = (handler) => ({ messages: { create: async (params) => handler(params) } });
