// Builds the week view: what's planned (bills, paydays, category budgets) vs. what actually happened.
import { addDays, weekStart } from '../public/js/dates.js';
import { occurrences } from './schedule.js';

const parseRow = (r) => ({ ...r, schedule: JSON.parse(r.schedule) });
const within = (row, from, to) => (!row.starts_on || row.starts_on <= to) && (!row.ends_on || row.ends_on >= from);

function planDates(row, from, to) {
  const lo = row.starts_on && row.starts_on > from ? row.starts_on : from;
  const hi = row.ends_on && row.ends_on < to ? row.ends_on : to;
  return occurrences(row.schedule, lo, hi);
}

const CARRY_DAYS = 56;

/**
 * Bills that belong to the week [from, to]. Like the paper budget, every bill occurrence lives in exactly one week:
 *  - unpaid and already past due: it carries forward into the current week (until someone pays or skips it)
 *  - paid on time or early: the week it was due
 *  - paid late: the week it was actually paid
 */
function billItems(db, hh, from, to, today) {
  const lookFrom = addDays(from, -CARRY_DAYS);
  const bills = db.all('SELECT * FROM bills WHERE household_id = ?', hh.id).map(parseRow).filter((b) => within(b, lookFrom, to));
  const paid = new Map(db.all(
    `SELECT id, bill_id, plan_date, date, amount_cents FROM transactions
     WHERE household_id = ? AND bill_id IS NOT NULL AND plan_date BETWEEN ? AND ?`, hh.id, lookFrom, to)
    .map((t) => [`${t.bill_id}|${t.plan_date}`, t]));
  const skipped = new Set(db.all(
    `SELECT s.bill_id, s.due_date FROM bill_skips s JOIN bills b ON b.id = s.bill_id
     WHERE b.household_id = ? AND s.due_date BETWEEN ? AND ?`, hh.id, lookFrom, to).map((s) => `${s.bill_id}|${s.due_date}`));
  const items = [];
  for (const b of bills) {
    for (const due of planDates(b, lookFrom, to)) {
      const key = `${b.id}|${due}`;
      const t = paid.get(key);
      const status = t ? 'paid' : skipped.has(key) ? 'skipped' : due < today ? 'overdue' : 'due';
      const owner = status === 'paid' ? (t.date > due ? t.date : due) : status === 'overdue' ? today : due;
      if (owner < from || owner > to) continue;
      items.push({
        bill_id: b.id, name: b.name, due, expected_cents: b.amount_cents, category_id: b.category_id,
        account_id: b.account_id, status, txn_id: t?.id ?? null, paid_cents: t?.amount_cents ?? null, paid_on: t?.date ?? null,
        carried: due < from,
      });
    }
  }
  return items.sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name));
}

function incomeItems(db, hh, from, to) {
  const sources = db.all('SELECT * FROM income_sources WHERE household_id = ?', hh.id).map(parseRow).filter((s) => within(s, from, to));
  const got = new Map(db.all(
    `SELECT id, income_source_id, plan_date, amount_cents FROM transactions
     WHERE household_id = ? AND income_source_id IS NOT NULL AND plan_date BETWEEN ? AND ?`, hh.id, from, to)
    .map((t) => [`${t.income_source_id}|${t.plan_date}`, t]));
  const items = [];
  for (const s of sources) {
    for (const date of planDates(s, from, to)) {
      const t = got.get(`${s.id}|${date}`);
      items.push({
        source_id: s.id, name: s.name, user_id: s.user_id, date, expected_cents: s.amount_cents,
        account_id: s.account_id, status: t ? 'received' : 'expected', txn_id: t?.id ?? null, received_cents: t?.amount_cents ?? null,
      });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

export function weekSummary(db, hh, anyDate, today) {
  const start = weekStart(anyDate, hh.week_start);
  const end = addDays(start, 6);

  const categories = db.all('SELECT * FROM categories WHERE household_id = ? ORDER BY sort, id', hh.id);
  const accounts = db.all('SELECT id, name FROM accounts WHERE household_id = ?', hh.id);
  const bills = billItems(db, hh, start, end, today);
  const income = incomeItems(db, hh, start, end);
  const txns = db.all(
    `SELECT * FROM transactions WHERE household_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC, id DESC`, hh.id, start, end);
  // Bill payments count in the week that owns the bill (see billItems), everything else by its own date.
  const expenses = txns.filter((t) => t.kind === 'expense' && !t.bill_id);
  for (const b of bills) {
    if (b.txn_id) expenses.push(db.get('SELECT * FROM transactions WHERE id = ?', b.txn_id));
  }

  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) {
      const c = categories.find((x) => x.id === id);
      rows.set(id, {
        id, name: c?.name ?? 'Uncategorized', emoji: c?.emoji ?? '❔', archived: !!c?.archived,
        budget_cents: c?.weekly_budget_cents ?? 0, bills_cents: 0, unpaid_bills_cents: 0, bill_spent_cents: 0, free_spent_cents: 0,
      });
    }
    return rows.get(id);
  };
  for (const c of categories) if (!c.archived) row(c.id);
  for (const b of bills) {
    if (b.status === 'skipped') continue;
    const r = row(b.category_id ?? null);
    r.bills_cents += b.expected_cents;
    if (b.status === 'due' || b.status === 'overdue') r.unpaid_bills_cents += b.expected_cents;
  }
  for (const t of expenses) {
    const r = row(t.category_id ?? null);
    if (t.bill_id) r.bill_spent_cents += t.amount_cents; else r.free_spent_cents += t.amount_cents;
  }

  const cats = [...rows.values()].map((r) => {
    const spent = r.bill_spent_cents + r.free_spent_cents;
    const planned = r.budget_cents + r.bills_cents;
    const projected = spent + r.unpaid_bills_cents + Math.max(0, r.budget_cents - r.free_spent_cents);
    return { id: r.id, name: r.name, emoji: r.emoji, budget_cents: r.budget_cents, bills_cents: r.bills_cents,
      planned_cents: planned, spent_cents: spent, remaining_cents: planned - spent, projected_cents: projected, archived: r.archived };
  }).filter((r) => !r.archived || r.spent_cents || r.planned_cents)
    .filter((r) => r.id !== null || r.spent_cents || r.planned_cents);

  const byAccount = new Map();
  for (const t of expenses) byAccount.set(t.account_id ?? null, (byAccount.get(t.account_id ?? null) || 0) + t.amount_cents);
  const income_expected = income.reduce((s, i) => s + (i.status === 'received' ? i.received_cents : i.expected_cents), 0);
  const income_received = income.reduce((s, i) => s + (i.status === 'received' ? i.received_cents : 0), 0);
  const sum = (k) => cats.reduce((s, c) => s + c[k], 0);

  return {
    start, end, today,
    is_current: today >= start && today <= end,
    income, bills,
    categories: cats,
    accounts: [...byAccount].map(([id, cents]) => ({ id, name: accounts.find((a) => a.id === id)?.name ?? 'No account', spent_cents: cents })),
    transactions: txns,
    totals: {
      income_expected_cents: income_expected,
      income_received_cents: income_received,
      planned_cents: sum('planned_cents'),
      spent_cents: sum('spent_cents'),
      projected_cents: sum('projected_cents'),
      left_cents: income_expected - sum('projected_cents'),
    },
  };
}

export function insights(db, hh, today, weeks = 8) {
  const thisWeek = weekStart(today, hh.week_start);
  const series = [];
  const catTotals = new Map();
  for (let i = weeks - 1; i >= 0; i--) {
    const s = weekSummary(db, hh, addDays(thisWeek, -7 * i), today);
    series.push({ start: s.start, planned_cents: s.totals.planned_cents, spent_cents: s.totals.spent_cents,
      income_cents: s.totals.income_expected_cents, left_cents: s.totals.left_cents });
    if (i < 4) for (const c of s.categories) {
      const cur = catTotals.get(c.id) || { id: c.id, name: c.name, emoji: c.emoji, spent_cents: 0, planned_cents: 0 };
      cur.spent_cents += c.spent_cents; cur.planned_cents += c.planned_cents;
      catTotals.set(c.id, cur);
    }
  }
  return { weeks: series, categories: [...catTotals.values()].filter((c) => c.spent_cents || c.planned_cents).sort((a, b) => b.spent_cents - a.spent_cents) };
}
