// The "cascade": turn the meals you've chosen into stock, leftovers and a grocery list, and work out
// which leftovers the next meal's suggestions should be built around. Pure functions, no I/O.
//
// Model: walking the chosen meals in date order, each ingredient is taken from stock first (oldest lot first).
// Whatever stock can't cover is "bought" as whole packages (apples come in a bag of 6, not 2), which creates a
// new lot with an expiry date. Lots that are left over, and not claimed by a later chosen meal, are what the
// next suggestions are asked to use up.
import { addDays, diffDays } from '../public/js/dates.js';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const UNITS = ['g', 'ml', 'count'];
export const AISLES = ['produce', 'meat & seafood', 'dairy & eggs', 'bakery', 'pantry', 'frozen', 'other'];
export const mealRank = (m) => MEALS.indexOf(m);

const EPS = 1e-6;
/** Perishables shorter than this are "use it up" candidates; long-life goods are only mentioned. */
export const PERISHABLE_DAYS = 30;
/** How many days of past meals still feed leftovers into today. */
export const HISTORY_DAYS = 14;

/** Canonical key text for an ingredient name: lowercase, letters only, crude singular. */
export function normName(name) {
  let n = String(name || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.split(' ').map((w) => {
    if (w.length > 3 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
    if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
    return w;
  }).join(' ');
  return n;
}
export const keyOf = (name, unit) => `${normName(name)}|${unit}`;

const before = (a, b) => a.date < b.date || (a.date === b.date && mealRank(a.meal) < mealRank(b.meal));
export const sortMeals = (meals) => [...meals].sort((a, b) => (a.date === b.date ? mealRank(a.meal) - mealRank(b.meal) : a.date < b.date ? -1 : 1));

/**
 * Simulate the chosen meals.
 *  meals: [{ date, meal, recipe }]   recipe.ingredients: [{ name, display, amount, unit, aisle, staple, pack }]
 *  stock: [{ id, name, amount, unit, expires_on }]  what's already at home
 * Returns { lots, staples } where lots[] = { key, name, unit, aisle, source: 'pantry' | 'buy', seq, bought_on, expires_on,
 *   perishable, pack, packs, total, remaining, expired, uses: [{ date, meal, title, amount, display }] }.
 */
export function simulate({ meals, stock = [] }) {
  const lots = [];
  const byKey = new Map();
  const staples = new Map();
  const addLot = (lot) => { lots.push(lot); const l = byKey.get(lot.key) || []; l.push(lot); byKey.set(lot.key, l); return lot; };

  for (const s of stock) {
    if (!UNITS.includes(s.unit) || !(s.amount > 0)) continue;
    addLot({
      key: keyOf(s.name, s.unit), name: s.name, unit: s.unit, aisle: 'other', source: 'pantry', seq: -1, pantry_id: s.id ?? null,
      bought_on: null, expires_on: s.expires_on || null, perishable: true, pack: null, packs: 0,
      total: s.amount, remaining: s.amount, expired: false, uses: [],
    });
  }

  const ordered = sortMeals(meals);
  ordered.forEach((m, seq) => {
    for (const ing of m.recipe?.ingredients || []) {
      const use = { date: m.date, meal: m.meal, title: m.recipe.title, display: ing.display };
      if (ing.staple || !ing.pack || !UNITS.includes(ing.unit) || !(ing.amount > 0)) {
        const k = normName(ing.name);
        const s = staples.get(k) || { name: ing.name, aisle: ing.aisle || 'pantry', uses: [] };
        s.uses.push(use);
        staples.set(k, s);
        continue;
      }
      const key = keyOf(ing.name, ing.unit);
      let need = ing.amount;
      for (const lot of byKey.get(key) || []) {
        if (lot.expired || lot.remaining <= EPS) continue;
        if (lot.expires_on && lot.expires_on < m.date) { lot.expired = true; continue; }
        const take = Math.min(lot.remaining, need);
        lot.remaining -= take;
        need -= take;
        lot.uses.push({ ...use, amount: take });
        if (need <= EPS) break;
      }
      if (need > EPS) {
        const packs = Math.max(1, Math.ceil(need / ing.pack.size - EPS));
        const total = packs * ing.pack.size;
        const shelf = ing.pack.shelf_life_days;
        addLot({
          key, name: ing.name, unit: ing.unit, aisle: ing.aisle || 'other', source: 'buy', seq,
          bought_on: m.date, expires_on: shelf ? addDays(m.date, shelf) : null, perishable: !shelf || shelf <= PERISHABLE_DAYS,
          pack: ing.pack, packs, total, remaining: total - need, expired: false, uses: [{ ...use, amount: need }],
        });
      }
    }
  });
  return { lots, staples: [...staples.values()] };
}

/** Meals that feed the simulation: chosen meals from HISTORY_DAYS ago onward. */
export const relevantMeals = (meals, today) => meals.filter((m) => m.date >= addDays(today, -HISTORY_DAYS));

/**
 * What's left over and unclaimed when `slot` is about to be cooked: simulates every other chosen meal, then keeps
 * lots that already existed before the slot, haven't expired by its date, and still have something left after
 * all the other planned meals have taken their share.
 */
export function contextAt({ meals, stock = [], today }, slot) {
  const others = relevantMeals(meals, today).filter((m) => !(m.date === slot.date && m.meal === slot.meal));
  const { lots } = simulate({ meals: others, stock });
  const pos = sortMeals(others).filter((m) => before(m, slot)).length;
  const available = lots.filter((l) => l.seq < pos && !l.expired && l.remaining > EPS && (!l.expires_on || l.expires_on >= slot.date));
  const lotsOut = available.map((l) => ({
    key: l.key, name: l.name, unit: l.unit, remaining: Math.round(l.remaining * 100) / 100,
    expires_on: l.expires_on, days_left: l.expires_on ? diffDays(slot.date, l.expires_on) : null,
    perishable: l.perishable, source: l.source,
  }));
  // Use-it-up first: soonest expiry, then anything the household listed as on hand.
  const rank = (l) => (l.days_left == null ? (l.source === 'pantry' ? 5 : 1000) : l.days_left);
  lotsOut.sort((a, b) => rank(a) - rank(b));
  return {
    priority: lotsOut.filter((l) => l.perishable).slice(0, 10),
    longlife: lotsOut.filter((l) => !l.perishable).slice(0, 10),
    lots: lotsOut,
  };
}

/** Which of this recipe's tracked ingredients are covered by unclaimed lots, and what would need buying. */
export function annotateRecipe(recipe, lots) {
  const left = new Map();
  for (const l of lots) left.set(l.key, (left.get(l.key) || 0) + l.remaining);
  const items = [];
  const usesUp = [];
  const priorityKeys = new Set(lots.filter((l) => l.perishable).map((l) => l.key));
  for (const ing of recipe.ingredients || []) {
    if (ing.staple || !ing.pack) { items.push({ name: ing.name, display: ing.display, status: 'staple' }); continue; }
    const key = keyOf(ing.name, ing.unit);
    const have = Math.min(left.get(key) || 0, ing.amount);
    left.set(key, (left.get(key) || 0) - have);
    const short = ing.amount - have;
    const status = have >= ing.amount - EPS ? 'have' : have > EPS ? 'partial' : 'buy';
    if (have > EPS && priorityKeys.has(key)) usesUp.push(ing.name);
    items.push({
      name: ing.name, display: ing.display, status, have_amount: Math.round(have * 100) / 100, unit: ing.unit,
      buy_packs: short > EPS ? Math.ceil(short / ing.pack.size - EPS) : 0, pack_label: ing.pack.label,
    });
  }
  return { items, uses_up: [...new Set(usesUp)] };
}

/**
 * The consolidated grocery list for packages that need buying between `from` and `to` (inclusive).
 * Purchases dated before today are treated as already bought.
 */
export function groceryList({ meals, stock = [], today }, { from, to }) {
  const { lots, staples } = simulate({ meals: relevantMeals(meals, today), stock });
  const lo = from < today ? today : from;
  const lines = lots
    .filter((l) => l.source === 'buy' && l.bought_on >= lo && l.bought_on <= to)
    .map((l) => ({
      key: `${l.key}|${l.bought_on}`, name: l.name, unit: l.unit, aisle: AISLES.includes(l.aisle) ? l.aisle : 'other',
      packs: l.packs, pack_label: l.pack.label, pack_size: l.pack.size, total: l.total, needed_by: l.bought_on,
      expires_on: l.expires_on, perishable: l.perishable,
      used: Math.round((l.total - l.remaining) * 100) / 100, leftover: Math.round(l.remaining * 100) / 100,
      uses: l.uses.map((u) => ({ date: u.date, meal: u.meal, title: u.title, amount: Math.round(u.amount * 100) / 100 })),
    }))
    .sort((a, b) => (a.needed_by === b.needed_by ? a.name.localeCompare(b.name) : a.needed_by < b.needed_by ? -1 : 1));
  const needed = staples
    .map((s) => ({ ...s, uses: s.uses.filter((u) => u.date >= lo && u.date <= to) }))
    .filter((s) => s.uses.length);
  return { lines, staples: needed };
}
