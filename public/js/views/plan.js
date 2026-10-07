import { h, money } from '../ui.js';
import { S, catById, acctById } from '../state.js';
import { planForm, categoryForm, accountForm, describeSchedule } from '../forms.js';
import { short } from '../dates.js';

export async function renderPlan(root) {
  const bills = [...S.bills].sort((a, b) => (a.next || '9').localeCompare(b.next || '9') || a.name.localeCompare(b.name));
  const monthly = S.bills.reduce((sum, b) => sum + monthlyCents(b), 0);

  root.replaceChildren(
    h('h1', { class: 'page-title' }, 'Plan'),
    h('p', { class: 'muted page-sub' }, 'Your recurring bills, paydays and weekly budgets. The Week tab is built from these.'),

    section('Paydays', () => planForm('income'), S.income.length ? S.income.map((i) =>
      h('div', { class: 'row', role: 'button', tabindex: 0, onclick: () => planForm('income', i) },
        h('div', { class: 'emoji' }, '💰'),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, i.name),
          h('div', { class: 'row-sub' }, `${describeSchedule(i.schedule)}${i.user_id ? ` · ${S.hh.members.find((m) => m.id === i.user_id)?.name || ''}` : ''}`)),
        h('div', { class: 'amount pos' }, money(i.amount_cents)))) : emptyHint('Add each paycheck (e.g. "Herman — 15th" or "Sam — 11th & 25th") so the week view can show what is left.')),

    section(`Bills · about ${money(Math.round(monthly / 100) * 100)}/mo`, () => planForm('bill'), bills.length ? bills.map((b) => {
      const cat = catById(b.category_id);
      return h('div', { class: 'row', role: 'button', tabindex: 0, onclick: () => planForm('bill', b) },
        h('div', { class: 'emoji' }, cat?.emoji || '🧾'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, b.name),
          h('div', { class: 'row-sub' }, `${describeSchedule(b.schedule)}${b.next ? ` · next ${short(b.next)}` : ''}`)),
        h('div', { class: 'amount' }, b.amount_cents ? money(b.amount_cents) : h('span', { class: 'warn-text' }, 'set amount')));
    }) : emptyHint('No bills yet.')),

    section('Weekly budgets', () => categoryForm(), S.categories.map((c) =>
      h('div', { class: 'row', role: 'button', tabindex: 0, onclick: () => categoryForm(c) },
        h('div', { class: 'emoji' }, c.emoji),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, c.name),
          h('div', { class: 'row-sub' }, c.weekly_budget_cents ? 'Weekly spending budget' : 'Bills only')),
        h('div', { class: 'amount' }, c.weekly_budget_cents ? `${money(c.weekly_budget_cents)}/wk` : '—')))),

    section('Accounts & cards', () => accountForm(), S.accounts.map((a) =>
      h('div', { class: 'row', role: 'button', tabindex: 0, onclick: () => accountForm(a) },
        h('div', { class: 'emoji' }, a.kind === 'credit' ? '💳' : a.kind === 'cash' ? '💵' : '🏦'),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, a.name),
          h('div', { class: 'row-sub' }, a.kind === 'credit' ? 'Credit card' : a.kind === 'cash' ? 'Cash' : 'Checking / debit'))))));
}

const emptyHint = (t) => h('p', { class: 'empty' }, t);

function section(title, onAdd, rows) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', title), h('button', { class: 'link', onclick: onAdd }, '+ Add')),
    rows);
}

/** Rough monthly cost of a bill, for the header total. */
function monthlyCents(b) {
  const s = b.schedule;
  const a = b.amount_cents;
  if (s.type === 'once') return 0;
  if (s.type === 'weekly') return Math.round((a * 52) / 12 / (s.every || 1));
  return Math.round((a * s.days.length) / (s.every || 1));
}
