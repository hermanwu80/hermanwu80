// Recipe card: used both when choosing between three options and when viewing the chosen recipe.
import { h, cap } from '../ui.js';
import { fmtQty } from '../units.js';
import { units } from '../state.js';

const STATUS_ICON = { have: '✓', partial: '◐', buy: '🛒', staple: '·' };

function itemLine(it) {
  let note = '';
  if (it.status === 'have') note = `have it (${fmtQty(it.have_amount, it.unit, units())} left over)`;
  else if (it.status === 'partial') note = `have ${fmtQty(it.have_amount, it.unit, units())}, buy ${it.buy_packs} × ${it.pack_label}`;
  else if (it.status === 'buy') note = `buy ${it.buy_packs} × ${it.pack_label}`;
  return h('li', { class: `item ${it.status}` },
    h('span', { class: 'item-mark', 'aria-hidden': 'true' }, STATUS_ICON[it.status]),
    h('span', { class: 'item-main' }, h('span', { class: 'item-name' }, it.display || cap(it.name)), note && h('span', { class: 'item-note' }, note)));
}

/** option: a recipe annotated by the server (items, uses_up). actions: array of nodes shown under the card. */
export function recipeCard(option, { actions = [], chosen = false, servings } = {}) {
  const buy = option.items.filter((i) => i.status === 'buy' || i.status === 'partial');
  const have = option.items.filter((i) => i.status === 'have');
  const staples = option.items.filter((i) => i.status === 'staple');
  return h('article', { class: `recipe${chosen ? ' chosen' : ''}` },
    h('header', null,
      h('h3', option.title),
      h('p', { class: 'meta' }, [option.minutes ? `${option.minutes} min` : null, servings ? `serves ${servings}` : null].filter(Boolean).join(' · '))),
    option.description && h('p', { class: 'desc' }, option.description),
    option.uses_up.length > 0 && h('p', { class: 'badge use-up' }, `♻️ Uses up: ${option.uses_up.map(cap).join(', ')}`),
    h('section', { class: 'groceries' },
      h('h4', 'Grocery list'),
      buy.length ? h('ul', { class: 'items' }, buy.map(itemLine)) : h('p', { class: 'muted small' }, 'Nothing to buy. You have it all.'),
      have.length > 0 && h('details', { class: 'have-list' },
        h('summary', `Already covered (${have.length})`),
        h('ul', { class: 'items' }, have.map(itemLine))),
      staples.length > 0 && h('p', { class: 'muted small staples' }, `Check your pantry: ${staples.map((s) => s.name).join(', ')}`)),
    h('details', { class: 'steps-wrap' },
      h('summary', 'Ingredients & instructions'),
      h('h4', 'Ingredients'),
      h('ul', { class: 'plain' }, option.ingredients.map((i) => h('li', i.display))),
      h('h4', 'Instructions'),
      h('ol', { class: 'steps' }, option.steps.map((s) => h('li', s)))),
    actions.length > 0 && h('footer', { class: 'actions' }, actions));
}
