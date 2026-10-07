// "Plan for me at 7pm": prepares the first day that still needs options, so they're ready when you open the app.
// Later days in a weekly plan are prepared as you finish each one, because each day is built from your earlier picks.
import { addDays, weekday } from '../public/js/dates.js';

function localNow(tz, now) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return { date, time };
}

export function createScheduler({ planner, now = () => new Date(), intervalMs = 60_000, log = () => {} }) {
  let timer = null;

  /** One check. Returns what it did, or null if nothing was due. Safe to call as often as you like. */
  async function tick() {
    const s = planner.settings();
    const auto = s.auto;
    if (auto.mode === 'off') return null;
    const { date, time } = localNow(s.tz, now());
    if (time < auto.time) return null;
    if (auto.mode === 'weekly' && weekday(date) !== auto.dow) return null;
    if (planner.kvGet('last_auto_run') === date) return null;
    planner.kvSet('last_auto_run', date); // once per day even if the AI call fails, so errors can't loop and burn credit

    const start = addDays(date, auto.lead_days);
    const span = auto.mode === 'weekly' ? 7 : 1;
    for (let i = 0; i < span; i++) {
      const day = addDays(start, i);
      const p = planner.dayProgress(day);
      if (p.has_options) continue;
      await planner.generateDay(day);
      const ok = planner.dayProgress(day).has_options;
      planner.kvSet('notice', {
        date: day,
        text: ok ? 'Ideas are ready. Pick your meals.' : 'Automatic planning hit a problem. Open the day to try again.',
        created: now().toISOString(),
      });
      log(`auto-plan ${ok ? 'prepared' : 'failed for'} ${day}`);
      return ok ? { prepared: day } : { prepared: null, failed: true };
    }
    return { prepared: null };
  }

  return {
    tick,
    start() {
      tick().catch((e) => log(`auto-plan failed: ${e.message}`));
      timer = setInterval(() => tick().catch((e) => log(`auto-plan failed: ${e.message}`)), intervalMs);
      timer.unref();
    },
    stop() { clearInterval(timer); },
  };
}
