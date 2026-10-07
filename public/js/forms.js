import { h, sheet, field, select, segmented, money, parseMoney, centsToInput, busy, toast, confirmSheet, badge } from './ui.js';
import { post, patch, del } from './api.js';
import { S, catById, memberById } from './state.js';
import { short } from './dates.js';
import { scheduleEditor, describeSchedule } from './schedule-ui.js';

const catOptions = (allowNone = true) => [...(allowNone ? [[null, 'Uncategorized']] : []), ...S.categories.map((c) => [c.id, `${c.emoji} ${c.name}`])];
const acctOptions = () => [[null, 'No account'], ...S.accounts.map((a) => [a.id, a.name])];
const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

function amountInput(cents, attrs = {}) {
  return h('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off', value: centsToInput(cents), ...attrs });
}
const requireAmount = (el, { allowZero = false } = {}) => {
  const c = parseMoney(el.value);
  if (c == null || (!allowZero && c <= 0)) throw new Error('Enter an amount');
  return c;
};

/**
 * Add / edit a transaction. `draft` may come from the AI reader (then `ai` info is shown).
 * Existing transactions have an `id`.
 */
export function transactionForm(draft = {}, { ai = false } = {}) {
  const editing = !!draft.id;
  return sheet(editing ? 'Edit transaction' : ai ? 'Review' : 'New transaction', (close) => {
    const kind = segmented([['expense', 'Expense'], ['income', 'Income']], draft.kind || 'expense');
    const amount = amountInput(draft.amount_cents, { autofocus: !editing && !ai });
    const merchant = h('input', { type: 'text', value: draft.merchant || '', placeholder: 'Where?', maxlength: 80 });
    const date = h('input', { type: 'date', value: draft.date || S.hh.today });
    const cat = select(catOptions(), draft.category_id);
    const acct = select(acctOptions(), draft.account_id);
    const note = h('input', { type: 'text', value: draft.note || '', placeholder: 'Optional', maxlength: 300 });
    const bill = draft.bill_id ? S.bills.find((b) => b.id === draft.bill_id) : null;
    const linkBill = h('input', { type: 'checkbox', checked: !!draft.bill_id && !editing });
    const save = h('button', { class: 'btn primary', type: 'submit' }, editing ? 'Save' : 'Add');

    const notices = [];
    if (ai) {
      const conf = draft.confidence;
      notices.push(h('div', { class: `notice ${conf === 'low' ? 'warn' : ''}` },
        h('strong', draft.from_rule ? '✨ Categorized from your past choice' : '✨ Read by AI'),
        h('span', conf === 'low' ? ' — low confidence, please double-check everything.' : conf === 'medium' ? ' — please check the amount and category.' : ' — check it looks right, then add.')));
    }
    if (draft.receipt_id) {
      notices.push(h('a', { class: 'receipt-link', href: `/api/receipts/${draft.receipt_id}`, target: '_blank', rel: 'noopener' }, '📎 View receipt'));
    }

    const form = h('form', { class: 'stack', onsubmit: busy(save, async () => {
      const body = {
        kind: kind.value, amount_cents: requireAmount(amount), merchant: merchant.value, date: date.value,
        category_id: numOrNull(cat.value), account_id: numOrNull(acct.value), note: note.value, source: draft.source,
      };
      if (!editing) {
        if (draft.receipt_id) body.receipt_id = draft.receipt_id;
        if (bill && linkBill.checked) { body.bill_id = bill.id; body.plan_date = draft.plan_date; }
      }
      if (editing) await patch(`/api/transactions/${draft.id}`, body); else await post('/api/transactions', body);
      close();
      toast(editing ? 'Saved' : 'Added');
      await S.refresh();
    }) },
      ...notices,
      kind.el,
      field('Amount', amount),
      field('Merchant', merchant),
      field('Category', cat),
      bill && !editing && h('label', { class: 'check' }, linkBill, h('span', `This pays ${bill.name}${draft.plan_date ? ` (due ${short(draft.plan_date)})` : ''}`)),
      h('div', { class: 'row2' }, field('Date', date), field('Paid with', acct)),
      field('Note', note),
      editing && h('p', { class: 'muted small' }, `Entered by ${memberById(draft.user_id)?.name || 'someone'}${draft.bill_id ? ' · counts toward a bill' : ''}`),
      save,
      editing && h('a', { class: 'receipt-link', hidden: !draft.receipt_id, href: `/api/receipts/${draft.receipt_id}`, target: '_blank', rel: 'noopener' }, '📎 View receipt'),
      editing && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!(await confirmSheet('Delete this?', `${draft.merchant || 'This transaction'} · ${money(draft.amount_cents)}`, 'Delete'))) return;
        try { await del(`/api/transactions/${draft.id}`); close(); toast('Deleted'); await S.refresh(); } catch (e) { toast(e.message, 'error'); }
      } }, 'Delete'));
    return form;
  });
}

/** Mark a bill occurrence paid (or skip / undo it). */
export function billSheet(item) {
  return sheet(item.name, (close) => {
    const amount = amountInput(item.status === 'paid' ? item.paid_cents : item.expected_cents);
    const date = h('input', { type: 'date', value: S.hh.today });
    const acct = select(acctOptions(), item.account_id);
    const act = (fn, msg) => async () => { try { await fn(); close(); toast(msg); await S.refresh(); } catch (e) { toast(e.message, 'error'); } };
    const info = h('p', { class: 'muted' }, `Due ${short(item.due)} · expected ${money(item.expected_cents)}`);

    if (item.status === 'paid') {
      return h('div', { class: 'stack' }, info, h('p', {}, `✅ Paid ${money(item.paid_cents)}`),
        h('button', { class: 'btn', type: 'button', onclick: act(() => del(`/api/transactions/${item.txn_id}`), 'Marked unpaid') }, 'Undo — mark unpaid'));
    }
    if (item.status === 'skipped') {
      return h('div', { class: 'stack' }, info, h('p', {}, 'Skipped this time'),
        h('button', { class: 'btn', type: 'button', onclick: act(() => del(`/api/bills/${item.bill_id}/skip?due=${item.due}`), 'Restored') }, 'Put it back'));
    }
    const pay = h('button', { class: 'btn primary', type: 'submit' }, 'Mark paid');
    return h('form', { class: 'stack', onsubmit: busy(pay, async () => {
      await post(`/api/bills/${item.bill_id}/pay`, { due: item.due, amount_cents: requireAmount(amount, { allowZero: true }), date: date.value, account_id: numOrNull(acct.value) });
      close(); toast('Marked paid'); await S.refresh();
    }) },
      info,
      field('Amount paid', amount, item.expected_cents === 0 ? 'No amount set yet — enter what you paid, then set the usual amount in Plan.' : null),
      h('div', { class: 'row2' }, field('Date paid', date), field('Paid with', acct)),
      pay,
      h('button', { class: 'btn', type: 'button', onclick: act(() => post(`/api/bills/${item.bill_id}/skip`, { due: item.due }), 'Skipped') }, 'Skip this time'));
  });
}

export function incomeSheet(item) {
  return sheet(item.name, (close) => {
    const received = item.status === 'received';
    const amount = amountInput(received ? item.received_cents : item.expected_cents);
    const date = h('input', { type: 'date', value: received ? item.date : (item.date <= S.hh.today ? item.date : S.hh.today) });
    if (received) {
      return h('div', { class: 'stack' }, h('p', {}, `💰 Received ${money(item.received_cents)}`),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          try { await del(`/api/transactions/${item.txn_id}`); close(); toast('Marked not received'); await S.refresh(); } catch (e) { toast(e.message, 'error'); }
        } }, 'Undo'));
    }
    const go = h('button', { class: 'btn primary', type: 'submit' }, 'Mark received');
    return h('form', { class: 'stack', onsubmit: busy(go, async () => {
      await post(`/api/income/${item.source_id}/receive`, { plan_date: item.date, amount_cents: requireAmount(amount), date: date.value });
      close(); toast('Payday recorded'); await S.refresh();
    }) }, h('p', { class: 'muted' }, `Expected ${short(item.date)} · ${money(item.expected_cents)}`),
    field('Amount that hit the account', amount), field('Date', date), go);
  });
}

/** Create / edit a recurring bill or income source. */
export function planForm(kind, existing = null) {
  const isBill = kind === 'bill';
  const base = isBill ? '/api/bills' : '/api/income';
  return sheet(existing ? `Edit ${isBill ? 'bill' : 'payday'}` : `New ${isBill ? 'bill' : 'payday'}`, (close) => {
    const name = h('input', { type: 'text', value: existing?.name || '', placeholder: isBill ? 'e.g. Phone' : 'e.g. Herman paycheck', maxlength: 60, autofocus: !existing });
    const amount = amountInput(existing?.amount_cents);
    const sched = scheduleEditor(existing?.schedule, S.hh.today);
    const cat = select(catOptions(), existing?.category_id);
    const acct = select(acctOptions(), existing?.account_id);
    const who = select([[null, 'Household'], ...S.hh.members.map((m) => [m.id, m.name])], existing?.user_id);
    const save = h('button', { class: 'btn primary', type: 'submit' }, existing ? 'Save' : 'Add');
    return h('form', { class: 'stack', onsubmit: busy(save, async () => {
      if (!name.value.trim()) throw new Error('Enter a name');
      const body = { name: name.value, amount_cents: requireAmount(amount, { allowZero: isBill }), schedule: sched.get(), account_id: numOrNull(acct.value) };
      if (isBill) body.category_id = numOrNull(cat.value); else body.user_id = numOrNull(who.value);
      if (!existing) body.starts_on = S.hh.today;
      if (existing) await patch(`${base}/${existing.id}`, body); else await post(base, body);
      close(); toast('Saved'); await S.refresh();
    }) },
      field('Name', name),
      field(isBill ? 'Usual amount' : 'Usual take-home', amount, isBill && existing?.amount_cents === 0 ? 'Leave at 0 if it varies — you enter it when you pay.' : null),
      sched.el,
      isBill ? field('Category', cat) : field('Whose', who),
      field(isBill ? 'Usually paid with' : 'Deposited to', acct),
      save,
      existing && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!(await confirmSheet(`Stop ${existing.name}?`, 'It will no longer appear in future weeks. Past weeks keep their history.', 'Stop and remove'))) return;
        try { await del(`${base}/${existing.id}`); close(); toast('Removed'); await S.refresh(); } catch (e) { toast(e.message, 'error'); }
      } }, 'Remove'));
  });
}

export function categoryForm(existing = null) {
  return sheet(existing ? 'Edit category' : 'New category', (close) => {
    const emoji = h('input', { type: 'text', value: existing?.emoji || '🏷️', maxlength: 8, class: 'emoji-input', 'aria-label': 'Emoji' });
    const name = h('input', { type: 'text', value: existing?.name || '', maxlength: 40, placeholder: 'e.g. Groceries', autofocus: !existing });
    const budget = amountInput(existing?.weekly_budget_cents);
    const save = h('button', { class: 'btn primary', type: 'submit' }, existing ? 'Save' : 'Add');
    return h('form', { class: 'stack', onsubmit: busy(save, async () => {
      const b = parseMoney(budget.value || '0');
      if (b == null) throw new Error('Enter a valid budget');
      const body = { name: name.value, emoji: emoji.value, weekly_budget_cents: b };
      if (existing) await patch(`/api/categories/${existing.id}`, body); else await post('/api/categories', body);
      close(); toast('Saved'); await S.refresh();
    }) },
      h('div', { class: 'row2 narrow-first' }, field('Icon', emoji), field('Name', name)),
      field('Weekly budget', budget, 'For day-to-day spending like groceries or gas. Leave empty for categories that only hold bills — those are budgeted by the bills themselves.'),
      save,
      existing && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!(await confirmSheet(`Delete ${existing.name}?`, 'Anything in it becomes uncategorized.', 'Delete'))) return;
        try { await del(`/api/categories/${existing.id}`); close(); toast('Deleted'); await S.refresh(); } catch (e) { toast(e.message, 'error'); }
      } }, 'Delete'));
  });
}

export function accountForm(existing = null) {
  return sheet(existing ? 'Edit account' : 'New account', (close) => {
    const name = h('input', { type: 'text', value: existing?.name || '', maxlength: 40, placeholder: 'e.g. Chase Sapphire', autofocus: !existing });
    const kind = select([['checking', 'Checking / debit'], ['credit', 'Credit card'], ['cash', 'Cash']], existing?.kind || 'checking');
    const save = h('button', { class: 'btn primary', type: 'submit' }, existing ? 'Save' : 'Add');
    return h('form', { class: 'stack', onsubmit: busy(save, async () => {
      const body = { name: name.value, kind: kind.value };
      if (existing) await patch(`/api/accounts/${existing.id}`, body); else await post('/api/accounts', body);
      close(); toast('Saved'); await S.refresh();
    }) }, field('Name', name), field('Type', kind), save,
    existing && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (!(await confirmSheet(`Remove ${existing.name}?`, 'Past transactions keep their label.', 'Remove'))) return;
      try { await del(`/api/accounts/${existing.id}`); close(); toast('Removed'); await S.refresh(); } catch (e) { toast(e.message, 'error'); }
    } }, 'Remove'));
  });
}

export { describeSchedule, catById, badge };
