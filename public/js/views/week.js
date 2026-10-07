import { h, money, bar, badge } from '../ui.js';
import { get } from '../api.js';
import { S, memberById, catById } from '../state.js';
import { addDays, rangeLabel, short, weekStart, dowName, parse } from '../dates.js';
import { transactionForm, billSheet, incomeSheet } from '../forms.js';
import { post } from '../api.js';
import { toast } from '../ui.js';

const dayHeading = (d, today) => (d === today ? 'Today' : d === addDays(today, -1) ? 'Yesterday' : `${dowName(parse(d).getUTCDay())}, ${short(d)}`);

export async function renderWeek(root) {
  const date = S.weekDate || S.hh.today;
  const w = await get(`/api/week?date=${date}`);
  S.weekDate = w.start;
  const t = w.totals;
  const today = w.today;

  const nav = h('div', { class: 'week-nav' },
    h('button', { class: 'icon-btn', 'aria-label': 'Previous week', onclick: () => go(addDays(w.start, -7)) }, '‹'),
    h('div', { class: 'week-title' },
      h('h1', rangeLabel(w.start, w.end)),
      w.is_current ? h('span', { class: 'pill' }, 'This week')
        : h('button', { class: 'link', onclick: () => go(S.hh.today) }, 'Jump to this week')),
    h('button', { class: 'icon-btn', 'aria-label': 'Next week', onclick: () => go(addDays(w.start, 7)) }, '›'));

  const left = t.left_cents;
  const hero = h('section', { class: 'hero' },
    h('div', { class: 'hero-label' }, w.is_current ? 'Projected left this week' : 'Left over that week'),
    h('div', { class: `hero-amount ${left < 0 ? 'neg' : ''}` }, money(left)),
    bar(t.spent_cents, t.planned_cents, { height: '10px' }),
    h('div', { class: 'hero-sub' },
      h('span', `${money(t.spent_cents)} spent`), h('span', `of ${money(t.planned_cents)} planned`)),
    h('div', { class: 'stats' },
      stat('Income', money(t.income_expected_cents), t.income_received_cents < t.income_expected_cents ? `${money(t.income_received_cents)} received` : 'received'),
      stat('Going out', money(t.projected_cents), 'spent + still to come'),
      stat('Charged', money(w.accounts.reduce((s, a) => s + a.spent_cents, 0)), w.accounts.length ? w.accounts.map((a) => `${a.name} ${money(a.spent_cents)}`).join(' · ') : 'nothing yet')));

  const timeline = [
    ...w.income.map((i) => ({ kind: 'income', date: i.date, item: i })),
    ...w.bills.map((b) => ({ kind: 'bill', date: b.due, item: b })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'income' ? -1 : 1));

  const planned = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', 'Bills & paydays'), h('span', { class: 'muted small' },
      `${w.bills.filter((b) => b.status === 'paid').length}/${w.bills.filter((b) => b.status !== 'skipped').length} paid`)),
    timeline.length ? timeline.map(({ kind, item }) => (kind === 'income' ? incomeRow(item) : billRow(item, today)))
      : h('p', { class: 'empty' }, 'No bills or paydays this week. Add them in the Plan tab.'));

  const cats = w.categories.filter((c) => c.planned_cents > 0 || c.spent_cents > 0);
  const budgets = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', 'Budgets')),
    cats.length ? cats.map((c) => catRow(c)) : h('p', { class: 'empty' }, 'Set weekly budgets for groceries, gas and eating out in Plan → Categories.'));

  const byDay = new Map();
  for (const x of w.transactions) { if (!byDay.has(x.date)) byDay.set(x.date, []); byDay.get(x.date).push(x); }
  const spending = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', 'Transactions'),
      h('button', { class: 'link', onclick: () => transactionForm({ date: w.is_current ? today : w.start }) }, '+ Add')),
    byDay.size ? [...byDay].map(([d, list]) => h('div', {},
      h('div', { class: 'day-head' }, dayHeading(d, today)),
      list.map(txnRow)))
      : h('p', { class: 'empty' }, 'Nothing logged yet. Tap + to scan a receipt.'));

  root.replaceChildren(...[nav, hero, planned, budgets, spending].filter(Boolean));
}

function go(date) { S.weekDate = date; S.refresh(); }

const stat = (label, value, sub) => h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-sub' }, sub));

function billRow(b, today) {
  const done = b.status === 'paid';
  const skipped = b.status === 'skipped';
  const cat = catById(b.category_id);
  const check = h('button', {
    class: `check-btn ${done ? 'done' : ''}`, 'aria-label': done ? `${b.name} paid` : `Mark ${b.name} paid`,
    disabled: skipped,
    onclick: async (e) => {
      e.stopPropagation();
      if (done || b.expected_cents === 0) return billSheet(b);
      try { await post(`/api/bills/${b.bill_id}/pay`, { due: b.due, amount_cents: b.expected_cents }); toast(`${b.name} paid`); await S.refresh(); }
      catch (err) { toast(err.message, 'error'); }
    },
  }, done ? '✓' : '');
  return h('div', { class: `row ${skipped ? 'skipped' : ''}`, onclick: () => billSheet(b), role: 'button', tabindex: 0 },
    check,
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, `${cat?.emoji || '🧾'} ${b.name}`),
      h('div', { class: `row-sub ${b.status === 'overdue' ? 'neg' : ''}` },
        skipped ? 'Skipped' : b.status === 'overdue' ? `Overdue · was due ${short(b.due)}` : done ? `Paid ${short(b.paid_on)}${b.paid_on > b.due ? ` · was due ${short(b.due)}` : ''}` : `Due ${short(b.due)}`)),
    h('div', { class: 'amount' }, b.expected_cents === 0 && !done ? h('span', { class: 'muted' }, 'Set $') : money(done ? b.paid_cents : b.expected_cents)));
}

function incomeRow(i) {
  const got = i.status === 'received';
  return h('div', { class: 'row income', onclick: () => incomeSheet(i), role: 'button', tabindex: 0 },
    h('div', { class: `check-btn pay ${got ? 'done' : ''}` }, got ? '✓' : '$'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, `💰 ${i.name}`),
      h('div', { class: 'row-sub' }, `${got ? 'Received' : 'Payday'} ${short(i.date)}`)),
    h('div', { class: 'amount pos' }, money(got ? i.received_cents : i.expected_cents, { plus: true })));
}

function catRow(c) {
  const left = c.planned_cents - c.spent_cents;
  return h('div', { class: 'cat-row' },
    h('div', { class: 'cat-top' },
      h('span', `${c.emoji} ${c.name}`),
      h('span', { class: left < 0 ? 'neg' : 'muted' }, left < 0 ? `${money(-left)} over` : `${money(left)} left`)),
    bar(c.spent_cents, c.planned_cents),
    h('div', { class: 'cat-sub muted small' }, `${money(c.spent_cents)} of ${money(c.planned_cents)}`));
}

function txnRow(x) {
  const cat = catById(x.category_id);
  const member = memberById(x.user_id);
  return h('div', { class: 'row', onclick: () => transactionForm(x), role: 'button', tabindex: 0 },
    h('div', { class: 'emoji' }, x.kind === 'income' ? '💰' : cat?.emoji || '❔'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, x.merchant || cat?.name || 'Transaction'),
      h('div', { class: 'row-sub' }, `${cat?.name || 'Uncategorized'}${x.receipt_id ? ' · 📎' : ''}`)),
    badge(member),
    h('div', { class: `amount ${x.kind === 'income' ? 'pos' : ''}` }, x.kind === 'income' ? money(x.amount_cents, { plus: true }) : money(x.amount_cents)));
}
