import { get } from './api.js';

/** App-wide state shared by views. `refresh` is installed by app.js and re-renders the current view. */
export const S = {
  me: null, hh: null, ai: { enabled: false },
  categories: [], accounts: [], bills: [], income: [],
  weekDate: null,
  refresh: async () => {},
};

export async function loadLookups() {
  const [categories, accounts, bills, income, hh] = await Promise.all([
    get('/api/categories'), get('/api/accounts'), get('/api/bills'), get('/api/income'), get('/api/household'),
  ]);
  Object.assign(S, { categories, accounts, bills, income, hh });
}

export const catById = (id) => S.categories.find((c) => c.id === id);
export const acctById = (id) => S.accounts.find((a) => a.id === id);
export const memberById = (id) => S.hh?.members.find((m) => m.id === id);
