// Starter data modelled on the household's paper budget. Everything here is editable in the app.
import { addDays, weekStart } from '../public/js/dates.js';

const CATEGORIES = [
  // name, emoji, weekly budget for day-to-day spending (dollars)
  ['Housing', '🏠', 0], ['Insurance', '🛡️', 0], ['Utilities', '💡', 0], ['Subscriptions', '📺', 0],
  ['Kids & Childcare', '🧒', 0], ['Health', '💊', 0], ['Personal Care', '💇', 0], ['Auto', '🚗', 0],
  ['Groceries', '🛒', 100], ['Gas', '⛽', 90], ['Eating Out', '🍔', 25], ['Fitness', '🏋️', 0], ['Other', '🏷️', 0],
];

const ACCOUNTS = [['H Checking', 'checking'], ['Chase', 'credit'], ['H Amex', 'credit']];

const M = (...days) => ({ type: 'monthly', days, every: 1 });

// name, dollars (0 = fill in), category, schedule
// Items the paper list only gave a rough amount for are marked in the app by amount 0.
const BILLS = [
  ['Rent', 0, 'Housing', M(1)],
  ['Patrick', 0, 'Other', M(1)],
  ['Insurance', 0, 'Insurance', M(1)],
  ['Protection plan', 17, 'Insurance', M(10)],
  ['Disney+', 10, 'Subscriptions', M(10)],
  ['APS (electric)', 538, 'Utilities', M(14)],
  ['Phone', 185, 'Utilities', M(15)],
  ['Internet', 70, 'Utilities', M(15)],
  ['Joint Chiro', 0, 'Health', M(4)],
  ['Netflix', 29, 'Subscriptions', M(25)],
  ['Nina', 173, 'Other', M(22)],
  ['Probiotic', 49, 'Health', M(22)],
  ['Car', 747, 'Auto', M(26)],
  ['SW Gas', 40, 'Utilities', M(25)],
  ['Water', 102, 'Utilities', M(31)],
  ['Experian', 20, 'Subscriptions', M(26)],
  ['Gym', 0, 'Fitness', M(17)],
  ['Haircuts (H + S)', 80, 'Personal Care', M(12)],
  ['Ashley meds', 0, 'Health', M(8)],
  ['Multivitamins', 180, 'Health', null, 'quarterly'],
  ['Cleaner', 100, 'Housing', null, 'biweekly-wed'],
  ['Childcare', 120, 'Kids & Childcare', { type: 'weekly', weekday: 5, every: 1 }],
  ['Childcare at gym', 6, 'Kids & Childcare', null, 'biweekly-sat'],
];

export function seedHousehold(db, hh, today) {
  const wk = weekStart(today, hh.week_start);
  const acct = {};
  ACCOUNTS.forEach(([name, kind], i) => {
    acct[name] = db.insert('INSERT INTO accounts (household_id, name, kind, sort) VALUES (?,?,?,?)', hh.id, name, kind, i);
  });
  const cat = {};
  CATEGORIES.forEach(([name, emoji, budget], i) => {
    cat[name] = db.insert('INSERT INTO categories (household_id, name, emoji, weekly_budget_cents, sort) VALUES (?,?,?,?,?)',
      hh.id, name, emoji, budget * 100, i);
  });
  for (const [name, dollars, catName, schedule, special] of BILLS) {
    let spec = schedule;
    if (special === 'quarterly') spec = { type: 'monthly', days: [24], every: 3, anchor: addDays(wk, 3) };
    if (special === 'biweekly-wed') spec = { type: 'weekly', every: 2, anchor: addDays(wk, 3) };
    if (special === 'biweekly-sat') spec = { type: 'weekly', every: 2, anchor: addDays(wk, 6) };
    db.insert(
      'INSERT INTO bills (household_id, name, amount_cents, category_id, account_id, schedule, starts_on) VALUES (?,?,?,?,?,?,?)',
      hh.id, name, dollars * 100, cat[catName], acct['Chase'], JSON.stringify(spec), wk);
  }
}

/** Categories + accounts only, for households that want to start from a blank slate. */
export function seedMinimal(db, hh) {
  [['Bills', '🧾'], ['Groceries', '🛒'], ['Eating Out', '🍔'], ['Gas', '⛽'], ['Other', '🏷️']].forEach(([n, e], i) =>
    db.insert('INSERT INTO categories (household_id, name, emoji, sort) VALUES (?,?,?,?)', hh.id, n, e, i));
  [['Checking', 'checking'], ['Credit card', 'credit']].forEach(([n, k], i) =>
    db.insert('INSERT INTO accounts (household_id, name, kind, sort) VALUES (?,?,?,?)', hh.id, n, k, i));
}
