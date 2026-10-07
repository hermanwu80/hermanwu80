import test from 'node:test';
import assert from 'node:assert/strict';
import { normName, simulate, contextAt, annotateRecipe, groceryList } from '../server/cascade.js';
import { recipe } from './helpers.js';

const TODAY = '2026-10-07';
const apples = (n) => ['apple', n, 'count', 6, 28];

test('normName treats plurals and case as the same ingredient', () => {
  assert.equal(normName('Apples'), normName('apple'));
  assert.equal(normName('tomatoes'), normName('Tomato'));
  assert.equal(normName('berries'), normName('berry'));
  assert.equal(normName('hummus'), normName('hummus'));
  assert.notEqual(normName('bell pepper'), normName('pepper'));
});

test('two recipes using apples buy one bag, not two', () => {
  const meals = [
    { date: '2026-10-08', meal: 'breakfast', recipe: recipe('Oats', [apples(1)]) },
    { date: '2026-10-09', meal: 'snack', recipe: recipe('Apple slices', [apples(2)]) },
  ];
  const { lots } = simulate({ meals });
  assert.equal(lots.length, 1);
  assert.equal(lots[0].packs, 1);
  assert.equal(lots[0].remaining, 3);
  assert.equal(lots[0].uses.length, 2);
});

test('needing more than a pack holds buys a second pack', () => {
  const meals = [{ date: '2026-10-08', meal: 'dinner', recipe: recipe('Apple feast', [apples(7)]) }];
  const { lots } = simulate({ meals });
  assert.equal(lots[0].packs, 2);
  assert.equal(lots[0].remaining, 5);
});

test('perishable stock expires and is re-bought fresh', () => {
  const spinach = ['spinach', 50, 'g', 142, 5];
  const meals = [
    { date: '2026-10-08', meal: 'lunch', recipe: recipe('Salad', [spinach]) },
    { date: '2026-10-10', meal: 'lunch', recipe: recipe('Salad 2', [spinach]) },
    { date: '2026-10-16', meal: 'lunch', recipe: recipe('Salad 3', [spinach]) },
  ];
  const buys = simulate({ meals }).lots.filter((l) => l.source === 'buy');
  assert.equal(buys.length, 2, 'the first bag (expires Oct 13) cannot serve Oct 16');
  assert.equal(buys[1].bought_on, '2026-10-16');
});

test('what is already on hand is used before buying', () => {
  const stock = [{ id: 1, name: 'apples', amount: 3, unit: 'count', expires_on: null }];
  const meals = [{ date: '2026-10-08', meal: 'breakfast', recipe: recipe('Oats', [apples(2)]) }];
  const { lots } = simulate({ meals, stock });
  assert.equal(lots.filter((l) => l.source === 'buy').length, 0);
  assert.equal(lots[0].remaining, 1);
});

test('contextAt offers leftovers from earlier meals, soonest expiry first', () => {
  const meals = [
    { date: '2026-10-07', meal: 'dinner', recipe: recipe('Chicken', [['chicken breast', 340, 'g', 454, 3], apples(1)]) },
  ];
  const ctx = contextAt({ meals, stock: [], today: TODAY }, { date: '2026-10-08', meal: 'lunch' });
  assert.deepEqual(ctx.priority.map((l) => l.name), ['chicken breast', 'apple']);
  assert.equal(ctx.priority[0].remaining, 114);
  assert.equal(ctx.priority[0].days_left, 2);
  assert.equal(ctx.priority[1].remaining, 5);
});

test('contextAt does not offer a leftover once a later chosen meal has claimed it', () => {
  const meals = [
    { date: '2026-10-07', meal: 'dinner', recipe: recipe('A', [apples(1)]) },
    { date: '2026-10-10', meal: 'dinner', recipe: recipe('B', [apples(5)]) },
  ];
  const ctx = contextAt({ meals, stock: [], today: TODAY }, { date: '2026-10-08', meal: 'lunch' });
  assert.equal(ctx.priority.length, 0, '5 of the 5 leftover apples are already claimed by Oct 10');
});

test('contextAt ignores the slot being regenerated and long-life goods are not "use it up"', () => {
  const meals = [
    { date: '2026-10-07', meal: 'dinner', recipe: recipe('Rice dish', [['rice', 150, 'g', 907, 365]]) },
    { date: '2026-10-08', meal: 'lunch', recipe: recipe('Self', [apples(1)]) },
  ];
  const ctx = contextAt({ meals, stock: [], today: TODAY }, { date: '2026-10-08', meal: 'lunch' });
  assert.equal(ctx.priority.length, 0);
  assert.deepEqual(ctx.longlife.map((l) => l.name), ['rice']);
});

test('annotateRecipe marks covered, partial and to-buy ingredients', () => {
  const lots = [{ key: 'apple|count', name: 'apple', unit: 'count', remaining: 1, perishable: true }];
  const r = recipe('Mix', [apples(2), ['spinach', 100, 'g', 142, 5], ['salt', 'staple']]);
  const { items, uses_up } = annotateRecipe(r, lots);
  assert.deepEqual(items.map((i) => i.status), ['partial', 'buy', 'staple']);
  assert.equal(items[0].buy_packs, 1);
  assert.deepEqual(uses_up, ['apple']);
});

test('groceryList consolidates into packs and skips purchases already in the past', () => {
  const meals = [
    { date: '2026-10-06', meal: 'dinner', recipe: recipe('Yesterday', [['spinach', 100, 'g', 142, 5]]) },
    { date: '2026-10-08', meal: 'dinner', recipe: recipe('Tomorrow', [apples(1), ['salt', 'staple']]) },
    { date: '2026-10-09', meal: 'dinner', recipe: recipe('Next', [apples(2), ['spinach', 30, 'g', 142, 5], ['salt', 'staple']]) },
  ];
  const g = groceryList({ meals, stock: [], today: TODAY }, { from: TODAY, to: '2026-10-20' });
  const names = g.lines.map((l) => l.name);
  assert.deepEqual(names, ['apple'], 'yesterday’s spinach was bought yesterday and still covers Oct 9');
  assert.equal(g.lines[0].packs, 1);
  assert.equal(g.lines[0].used, 3);
  assert.equal(g.lines[0].leftover, 3);
  assert.equal(g.staples.length, 1);
  assert.equal(g.staples[0].uses.length, 2);
});

test('groceryList respects the date range', () => {
  const meals = [
    { date: '2026-10-08', meal: 'dinner', recipe: recipe('A', [apples(1)]) },
    { date: '2026-10-14', meal: 'dinner', recipe: recipe('B', [['spinach', 100, 'g', 142, 5]]) },
  ];
  const g = groceryList({ meals, stock: [], today: TODAY }, { from: TODAY, to: '2026-10-10' });
  assert.deepEqual(g.lines.map((l) => l.name), ['apple']);
});
