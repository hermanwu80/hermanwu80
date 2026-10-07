import test from 'node:test';
import assert from 'node:assert/strict';
import { occurrences, validateSchedule } from '../server/schedule.js';
import { weekStart, addDays, weekday } from '../public/js/dates.js';

test('weekStart honours the configured first day', () => {
  assert.equal(weekStart('2025-09-17', 0), '2025-09-14'); // Wed -> Sunday
  assert.equal(weekStart('2025-09-14', 0), '2025-09-14');
  assert.equal(weekStart('2025-09-17', 1), '2025-09-15');
  assert.equal(weekStart('2025-09-14', 1), '2025-09-08');
});

test('monthly: day 31 clamps to the last day, including leap February', () => {
  const s = { type: 'monthly', days: [31], every: 1 };
  assert.deepEqual(occurrences(s, '2024-01-01', '2024-04-30'), ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
  assert.deepEqual(occurrences(s, '2025-02-01', '2025-02-28'), ['2025-02-28']);
});

test('monthly: twice a month and range edges are inclusive', () => {
  const s = { type: 'monthly', days: [11, 25], every: 1 };
  assert.deepEqual(occurrences(s, '2025-09-11', '2025-09-25'), ['2025-09-11', '2025-09-25']);
  assert.deepEqual(occurrences(s, '2025-12-20', '2026-01-12'), ['2025-12-25', '2026-01-11']);
});

test('monthly: days 30 and 31 do not duplicate in February', () => {
  assert.deepEqual(occurrences({ type: 'monthly', days: [30, 31], every: 1 }, '2025-02-01', '2025-02-28'), ['2025-02-28']);
});

test('monthly every 3 months uses the anchor month', () => {
  const s = { type: 'monthly', days: [24], every: 3, anchor: '2025-09-24' };
  assert.deepEqual(occurrences(s, '2025-01-01', '2026-03-31'), ['2025-03-24', '2025-06-24', '2025-09-24', '2025-12-24', '2026-03-24']);
});

test('weekly every week and every other week', () => {
  assert.deepEqual(occurrences({ type: 'weekly', weekday: 5, every: 1 }, '2025-09-14', '2025-09-27'), ['2025-09-19', '2025-09-26']);
  const biweekly = { type: 'weekly', every: 2, anchor: '2025-09-06' }; // Saturdays
  assert.deepEqual(occurrences(biweekly, '2025-09-01', '2025-10-15'), ['2025-09-06', '2025-09-20', '2025-10-04']);
  assert.deepEqual(occurrences(biweekly, '2025-08-01', '2025-08-31'), ['2025-08-09', '2025-08-23']); // before the anchor too
  for (const d of occurrences(biweekly, '2025-01-01', '2026-12-31')) assert.equal(weekday(d), 6);
});

test('once', () => {
  assert.deepEqual(occurrences({ type: 'once', date: '2025-09-10' }, '2025-09-01', '2025-09-30'), ['2025-09-10']);
  assert.deepEqual(occurrences({ type: 'once', date: '2025-10-10' }, '2025-09-01', '2025-09-30'), []);
});

test('every date in a week appears exactly once across consecutive weeks', () => {
  const s = { type: 'monthly', days: [1, 15, 31], every: 1 };
  const all = [];
  for (let w = '2025-01-05'; w < '2025-12-31'; w = addDays(w, 7)) all.push(...occurrences(s, w, addDays(w, 6)));
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(all.slice(0, 4), ['2025-01-15', '2025-01-31', '2025-02-01', '2025-02-15']);
});

test('validateSchedule rejects bad input', () => {
  assert.throws(() => validateSchedule({ type: 'monthly', days: [0] }));
  assert.throws(() => validateSchedule({ type: 'monthly', days: [32] }));
  assert.throws(() => validateSchedule({ type: 'weekly', weekday: 9 }));
  assert.throws(() => validateSchedule({ type: 'weekly', every: 2 }));
  assert.throws(() => validateSchedule({ type: 'nope' }));
  assert.deepEqual(validateSchedule({ type: 'monthly', days: ['15', 1, 1] }), { type: 'monthly', days: [1, 15], every: 1 });
});
