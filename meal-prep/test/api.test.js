import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, fakeClient, closeAll } from './helpers.js';

after(closeAll);

const TODAY = '2026-10-07';
const TOMORROW = '2026-10-08';
const DAY3 = '2026-10-09';

const day = (state, date) => state.days.find((d) => d.date === date);
const slot = (state, date, meal) => day(state, date).slots.find((s) => s.meal === meal);

async function planDay(t, date) {
  const r = await t.api.post(`/api/days/${date}/generate`);
  assert.equal(r.status, 202);
  await t.settle();
  return (await t.api.get('/api/state')).json;
}

test('generating a day makes three options for each enabled meal', async () => {
  const t = await boot();
  const state = await planDay(t, TOMORROW);
  assert.deepEqual(day(state, TOMORROW).slots.map((s) => s.meal), ['breakfast', 'lunch', 'dinner']);
  for (const s of day(state, TOMORROW).slots) {
    assert.equal(s.status, 'ready');
    assert.equal(s.options.length, 3);
    for (const o of s.options) {
      assert.ok(o.title && o.steps.length && o.ingredients.length, 'recipe, instructions and ingredients present');
      assert.ok(o.items.length, 'each option carries its own grocery list');
    }
  }
  assert.equal(day(state, TOMORROW).complete, false);
  assert.equal(state.ai.demo, true);
});

test('choosing a recipe builds the grocery list; skipping removes a meal from it', async () => {
  const t = await boot();
  let state = await planDay(t, TOMORROW);
  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    state = (await t.api.post(`/api/slots/${TOMORROW}/${meal}/choose`, { idx: 0 })).json;
  }
  assert.equal(day(state, TOMORROW).complete, true);
  const g = (await t.api.get('/api/grocery')).json;
  assert.ok(g.lines.length > 0);
  assert.ok(g.lines.every((l) => l.packs >= 1 && l.pack_label));
  const before = g.lines.length;
  await t.api.post(`/api/slots/${TOMORROW}/dinner/choose`, { skip: true });
  assert.ok((await t.api.get('/api/grocery')).json.lines.length < before);
  const cleared = (await t.api.post(`/api/slots/${TOMORROW}/dinner/choose`, { clear: true })).json;
  assert.equal(slot(cleared, TOMORROW, 'dinner').status, 'ready');
});

test('cascade: what you pick today shapes tomorrow’s suggestions', async () => {
  const t = await boot();
  let state = await planDay(t, TOMORROW);
  assert.equal(day(state, DAY3).use_up.length, 0, 'nothing to use up before anything is chosen');
  // pick the first option of each meal for tomorrow
  for (const meal of ['breakfast', 'lunch', 'dinner']) state = (await t.api.post(`/api/slots/${TOMORROW}/${meal}/choose`, { idx: 0 })).json;
  const picked = new Set(['breakfast', 'lunch', 'dinner'].flatMap((m) => slot(state, TOMORROW, m).options[0].ingredients.filter((i) => !i.staple).map((i) => i.name)));
  const leftovers = day(state, DAY3).use_up;
  assert.ok(leftovers.length > 0, 'leftovers from tomorrow now feed the next day');
  assert.ok(leftovers.every((l) => picked.has(l.name) && l.remaining > 0));

  state = await planDay(t, DAY3);
  const leftoverNames = new Set(leftovers.map((l) => l.name));
  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    const opts = slot(state, DAY3, meal).options;
    const usesLeftovers = opts.some((o) => o.uses_up.length > 0);
    const couldUse = opts.some((o) => o.ingredients.some((i) => leftoverNames.has(i.name)));
    assert.equal(usesLeftovers, couldUse);
  }
  const anyUse = ['breakfast', 'lunch', 'dinner'].some((m) => slot(state, DAY3, m).options.some((o) => o.uses_up.length > 0));
  assert.ok(anyUse, 'at least one suggestion uses up leftovers');
});

test('the day endpoint never overwrites a decision', async () => {
  const t = await boot();
  await planDay(t, TOMORROW);
  await t.api.post(`/api/slots/${TOMORROW}/dinner/choose`, { idx: 1 });
  const before = slot((await t.api.get('/api/state')).json, TOMORROW, 'dinner').options[1].id;
  await planDay(t, TOMORROW);
  const after = slot((await t.api.get('/api/state')).json, TOMORROW, 'dinner');
  assert.equal(after.chosen_idx, 1);
  assert.equal(after.options[1].id, before);
});

test('regenerating one slot replaces its options and clears the choice', async () => {
  const t = await boot();
  await planDay(t, TOMORROW);
  await t.api.post(`/api/slots/${TOMORROW}/lunch/choose`, { idx: 0 });
  const oldTitles = slot((await t.api.get('/api/state')).json, TOMORROW, 'lunch').options.map((o) => o.title);
  await t.api.post(`/api/slots/${TOMORROW}/lunch/generate`, { hint: 'something light' });
  await t.settle();
  const s = slot((await t.api.get('/api/state')).json, TOMORROW, 'lunch');
  assert.equal(s.status, 'ready');
  assert.equal(s.chosen_idx, null);
  assert.equal(s.hint, 'something light');
  assert.notDeepEqual(s.options.map((o) => o.title), oldTitles, 'new ideas, not the same three');
});

test('input validation', async () => {
  const t = await boot();
  assert.equal((await t.api.post('/api/days/nope/generate')).status, 400);
  assert.equal((await t.api.post('/api/days/2030-01-01/generate')).status, 400);
  assert.equal((await t.api.post(`/api/slots/${TOMORROW}/brunch/generate`)).status, 400);
  assert.equal((await t.api.post(`/api/slots/${TOMORROW}/dinner/choose`, { idx: 0 })).status, 400, 'nothing generated yet');
  assert.equal((await t.api.post('/api/pantry', { name: '', amount: 1, unit: 'count' })).status, 400);
  assert.equal((await t.api.post('/api/pantry', { name: 'rice', amount: -1, unit: 'g' })).status, 400);
  assert.equal((await t.api.post('/api/pantry', { name: 'rice', amount: 1, unit: 'cups' })).status, 400);
  assert.equal((await t.api.get('/api/nothing')).status, 404);
});

test('settings are validated and merged', async () => {
  const t = await boot();
  let s = (await t.api.put('/api/settings', { servings: 4, units: 'metric', meals: ['dinner', 'breakfast'], diet: ' vegetarian ' })).json.settings;
  assert.equal(s.servings, 4);
  assert.equal(s.units, 'metric');
  assert.deepEqual(s.meals, ['breakfast', 'dinner'], 'kept in meal order');
  assert.equal(s.diet, 'vegetarian');
  s = (await t.api.put('/api/settings', { servings: 99, units: 'furlongs', meals: [], tz: 'Mars/Base', auto: { mode: 'hourly', time: '25:00', lead_days: 9 } })).json.settings;
  assert.equal(s.servings, 4);
  assert.equal(s.units, 'metric');
  assert.deepEqual(s.meals, ['breakfast', 'dinner']);
  assert.equal(s.tz, 'UTC');
  assert.equal(s.auto.mode, 'off');
  assert.equal(s.auto.lead_days, 1);
  s = (await t.api.put('/api/settings', { auto: { mode: 'weekly', time: '18:30', dow: 0, lead_days: 3 } })).json.settings;
  assert.deepEqual(s.auto, { mode: 'weekly', time: '18:30', dow: 0, lead_days: 3 });
});

test('servings change the demo recipe quantities', async () => {
  const t = await boot();
  await t.api.put('/api/settings', { servings: 4 });
  const s4 = await planDay(t, TOMORROW);
  const eggs4 = slot(s4, TOMORROW, 'breakfast').options.flatMap((o) => o.ingredients).filter((i) => i.name === 'egg').map((i) => i.amount);
  await t.api.put('/api/settings', { servings: 2 });
  await t.api.post(`/api/slots/${TOMORROW}/breakfast/generate`);
  await t.settle();
  const s2 = (await t.api.get('/api/state')).json;
  const eggs2 = slot(s2, TOMORROW, 'breakfast').options.flatMap((o) => o.ingredients).filter((i) => i.name === 'egg').map((i) => i.amount);
  assert.ok(Math.max(...eggs4) > Math.max(...eggs2));
});

test('on-hand items feed the cascade as use-it-up', async () => {
  const t = await boot();
  const r = await t.api.post('/api/pantry', { name: 'Baby Spinach', amount: 100, unit: 'g', expires_on: '2026-10-09' });
  assert.equal(r.status, 201);
  assert.equal(r.json[0].name, 'baby spinach');
  const state = (await t.api.get('/api/state')).json;
  assert.deepEqual(day(state, TOMORROW).use_up.map((l) => [l.name, l.remaining, l.days_left]), [['baby spinach', 100, 1]]);
  const del = await t.api.del(`/api/pantry/${r.json[0].id}`);
  assert.deepEqual(del.json, []);
});

test('a failing recipe source shows an error on the slot and can be retried', async () => {
  let fail = true;
  const good = JSON.stringify({ options: [1, 2, 3].map((n) => ({
    title: `Dish ${n}`, description: 'd', minutes: 10, steps: ['Cook'],
    ingredients: [{ name: 'egg', display: '2 eggs', amount: 2, unit: 'count', aisle: 'dairy & eggs', staple: false, pack: { size: 12, label: 'dozen eggs', shelf_life_days: 21 } }],
  })) });
  const t = await boot({ recipes: fakeClient(async () => {
    if (fail) throw Object.assign(new Error('boom'), { status: 500 });
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: good }] };
  }) });
  await t.api.post(`/api/slots/${TOMORROW}/dinner/generate`);
  await t.settle();
  let s = slot((await t.api.get('/api/state')).json, TOMORROW, 'dinner');
  assert.equal(s.status, 'error');
  assert.match(s.error, /boom/);
  fail = false;
  await t.api.post(`/api/slots/${TOMORROW}/dinner/generate`);
  await t.settle();
  s = slot((await t.api.get('/api/state')).json, TOMORROW, 'dinner');
  assert.equal(s.status, 'ready');
  assert.equal(s.options.length, 3);
});

test('password gate protects the API when APP_PASSWORD is set', async () => {
  const t = await boot({ password: 'sesame' });
  assert.equal((await t.api.get('/api/state')).status, 401);
  const me = (await t.api.get('/api/me')).json;
  assert.equal(me.auth_required, true);
  assert.equal(me.authed, false);
  assert.equal((await t.api.post('/api/login', { password: 'wrong' })).status, 401);
  assert.equal((await t.api.post('/api/login', { password: 'sesame' })).status, 200);
  assert.equal((await t.api.get('/api/state')).status, 200);
  await t.api.post('/api/logout');
  assert.equal((await t.api.get('/api/state')).status, 401);
});
