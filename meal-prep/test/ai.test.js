import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, fakeClient, closeAll, recipe } from './helpers.js';
import { createRecipeAi, sanitizeRecipe, sanitizeOptions } from '../server/recipes.js';

after(closeAll);

const ing = (over = {}) => ({
  name: 'Apple', display: '2 apples', amount: 2, unit: 'count', aisle: 'produce', staple: false,
  pack: { size: 6, label: 'bag of apples', shelf_life_days: 28 }, ...over,
});
const raw = (title, over = {}) => ({ title, description: 'Tasty', minutes: 15, steps: ['Do it'], ingredients: [ing()], ...over });
const reply = (options) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ options }) }] });
const ctx = { meal: 'dinner', date: '2026-10-08', settings: { servings: 2, units: 'us', diet: 'no nuts', dislikes: 'olives' }, priority: [], longlife: [], recent: [], sameDay: [], hint: '' };

test('sanitizeRecipe clamps and normalises model output', () => {
  const r = sanitizeRecipe(raw('  Apple   Bowl ', {
    minutes: 99999,
    ingredients: [
      ing(),
      ing({ name: 'SALT', staple: true, pack: null, amount: 0 }),
      ing({ name: 'mystery', unit: 'cups' }),                         // unusable unit -> treated as a staple to check for
      ing({ name: 'flour', pack: { size: -3, label: 'x', shelf_life_days: 5 } }), // bad pack -> buy exactly what's needed
      ing({ name: '', display: 'nothing' }),                            // dropped
    ],
  }));
  assert.equal(r.title, 'Apple Bowl');
  assert.equal(r.minutes, 720);
  assert.deepEqual(r.ingredients.map((i) => i.name), ['apple', 'salt', 'mystery', 'flour']);
  assert.equal(r.ingredients[2].staple, true);
  assert.equal(r.ingredients[3].pack.size, 2);
  assert.equal(r.ingredients[1].pack, null);
});

test('sanitizeRecipe rejects recipes without steps or ingredients', () => {
  assert.equal(sanitizeRecipe(raw('No steps', { steps: [] })), null);
  assert.equal(sanitizeRecipe(raw('Nothing', { ingredients: [] })), null);
  assert.equal(sanitizeRecipe(null), null);
  assert.equal(sanitizeOptions([raw('A'), raw('a'), raw('B'), raw('C'), raw('D')]).length, 3, 'dedupes titles and caps at three');
});

test('suggest sends context to Claude and returns sanitized options', async () => {
  let seen;
  const ai = createRecipeAi({ client: fakeClient(async (params) => { seen = params; return reply([raw('A'), raw('B'), raw('C')]); }) });
  const out = await ai.suggest({ ...ctx, priority: [{ name: 'apple', remaining: 4, unit: 'count', days_left: 3 }], recent: ['Old dish'], hint: 'quick' });
  assert.equal(out.length, 3);
  assert.equal(seen.output_config.format.type, 'json_schema');
  assert.equal(seen.output_config.effort, 'low');
  const prompt = seen.messages[0].content;
  assert.match(prompt, /"name": "apple"/);
  assert.match(prompt, /"days_until_expiry": 3/);
  assert.match(prompt, /no nuts/);
  assert.match(prompt, /Old dish/);
  assert.match(prompt, /quick/);
  assert.match(seen.system, /At least one of the three options/);
});

test('suggest asks again when fewer than three usable options come back', async () => {
  let calls = 0;
  const ai = createRecipeAi({ client: fakeClient(async () => (++calls === 1 ? reply([raw('A'), raw('Broken', { steps: [] })]) : reply([raw('A'), raw('B'), raw('C')]))) });
  const out = await ai.suggest(ctx);
  assert.equal(calls, 2);
  assert.deepEqual(out.map((o) => o.title), ['A', 'B', 'C']);
});

test('suggest surfaces refusals, truncation, bad JSON and missing keys as friendly errors', async () => {
  const run = (res) => createRecipeAi({ client: fakeClient(async () => res) }).suggest(ctx);
  await assert.rejects(run({ stop_reason: 'refusal', content: [] }), /declined/);
  await assert.rejects(run({ stop_reason: 'max_tokens', content: [] }), /cut off/);
  await assert.rejects(run({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }), /understand/);
  await assert.rejects(createRecipeAi({ client: null, apiKey: '' }).suggest(ctx), /not configured/);
});

test('end to end with the AI source: choosing a recipe feeds its leftovers into the next prompt', async () => {
  const prompts = [];
  const t = await boot({
    recipes: fakeClient(async (params) => {
      prompts.push(params.messages[0].content);
      return reply([raw('Apple A'), raw('Apple B'), raw('Apple C')].map((r, i) => ({ ...r, title: `${r.title} ${'xyz'[i]}` })));
    }),
  });
  t.planner.saveSettings({ meals: ['dinner'] });
  await t.api.post('/api/slots/2026-10-08/dinner/generate');
  await t.settle();
  assert.match(prompts[0], /"use_up": \[\]/);
  await t.api.post('/api/slots/2026-10-08/dinner/choose', { idx: 0 });
  await t.api.post('/api/slots/2026-10-09/dinner/generate');
  await t.settle();
  const second = prompts[1];
  assert.match(second, /"name": "apple"/, 'the 4 leftover apples are now offered as use-it-up');
  assert.match(second, /"left": 4/);
  assert.match(second, /"days_until_expiry": 27/);
  assert.match(second, /Apple A x/, 'and the dish already cooked is not repeated');
});

test('helper recipe() builds valid cascade input', () => {
  assert.equal(recipe('X', [['apple', 1, 'count', 6, 28]]).ingredients[0].pack.size, 6);
});
