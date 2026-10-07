import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, closeAll } from './helpers.js';

after(closeAll);

// 2026-10-07 is a Wednesday.
const at = (iso) => new Date(iso);

test('daily mode prepares the day N ahead once the time has passed, once per day', async () => {
  const t = await boot({ now: at('2026-10-07T18:00:00Z') });
  t.planner.saveSettings({ auto: { mode: 'daily', time: '19:00', lead_days: 2 } });
  assert.equal(await t.scheduler.tick(), null, 'too early');
  t.clock.now = at('2026-10-07T19:05:00Z');
  assert.deepEqual(await t.scheduler.tick(), { prepared: '2026-10-09' });
  const state = t.planner.buildState();
  assert.equal(state.days.find((d) => d.date === '2026-10-09').slots.every((s) => s.status === 'ready'), true);
  assert.equal(state.notice.date, '2026-10-09');
  assert.equal(await t.scheduler.tick(), null, 'already ran today');
  t.clock.now = at('2026-10-08T19:01:00Z');
  assert.deepEqual(await t.scheduler.tick(), { prepared: '2026-10-10' });
});

test('weekly mode only fires on its weekday and starts the plan lead_days ahead', async () => {
  const t = await boot({ now: at('2026-10-07T20:00:00Z') }); // Wednesday
  t.planner.saveSettings({ auto: { mode: 'weekly', time: '19:00', dow: 0, lead_days: 1 } }); // Sundays
  assert.equal(await t.scheduler.tick(), null, 'Wednesday is not the planning day');
  t.clock.now = at('2026-10-11T19:30:00Z'); // Sunday
  assert.deepEqual(await t.scheduler.tick(), { prepared: '2026-10-12' });
});

test('weekly mode moves on to the first day of the window that still has no ideas', async () => {
  const t = await boot({ now: at('2026-10-11T19:30:00Z') });
  t.planner.saveSettings({ auto: { mode: 'weekly', time: '19:00', dow: 0, lead_days: 1 } });
  await t.planner.generateDay('2026-10-12');
  assert.deepEqual(await t.scheduler.tick(), { prepared: '2026-10-13' });
});

test('uses the household timezone, and does nothing when off', async () => {
  const t = await boot({ now: at('2026-10-07T23:30:00Z'), tz: 'America/New_York' }); // 19:30 in New York
  assert.equal(await t.scheduler.tick(), null, 'off by default');
  t.planner.saveSettings({ auto: { mode: 'daily', time: '19:00', lead_days: 1 } });
  assert.deepEqual(await t.scheduler.tick(), { prepared: '2026-10-08' });
});

test('a failed generation is reported on the notice, not retried in a loop', async () => {
  const t = await boot({
    now: at('2026-10-07T19:30:00Z'),
    recipes: { messages: { create: async () => { throw new Error('offline'); } } },
  });
  t.planner.saveSettings({ auto: { mode: 'daily', time: '19:00', lead_days: 1 } });
  assert.deepEqual(await t.scheduler.tick(), { prepared: null, failed: true });
  assert.match(t.planner.kvGet('notice').text, /problem/);
  assert.equal(await t.scheduler.tick(), null);
});
