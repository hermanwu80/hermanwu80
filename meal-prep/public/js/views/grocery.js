import { h, toast, segmented, cap, mount } from '../ui.js';
import { get } from '../api.js';
import { addDays, short, diffDays } from '../dates.js';
import { fmtQty } from '../units.js';
import { S, units, dayInline, longDow } from '../state.js';

const AISLE_ORDER = ['produce', 'meat & seafood', 'dairy & eggs', 'bakery', 'pantry', 'frozen', 'other'];
const RANGES = [['3', 'Next 3 days'], ['7', 'This week'], ['30', 'Everything']];

// Ticked-off items live only on this device; they're a shopping aid, not part of the plan.
const loadChecked = () => { try { return JSON.parse(localStorage.getItem('mealprep.checked') || '{}'); } catch { return {}; } };
const saveChecked = (c) => { try { localStorage.setItem('mealprep.checked', JSON.stringify(c)); } catch { /* private mode */ } };
let range = '7';

export async function renderGrocery(view) {
  const today = S.state.today;
  const data = await get(`/api/grocery?from=${today}&to=${addDays(today, Number(range) - 1)}`);
  const checked = loadChecked();
  const sys = units();

  const byAisle = new Map();
  for (const l of data.lines) byAisle.set(l.aisle, [...(byAisle.get(l.aisle) || []), l]);
  const aisles = AISLE_ORDER.filter((a) => byAisle.has(a));

  const leftoverCount = data.lines.filter((l) => l.leftover > 0 && l.perishable).length;
  const seg = segmented(RANGES, range, (v) => { range = v; S.refresh(); });

  const line = (l) => {
    const box = h('input', { type: 'checkbox', checked: !!checked[l.key], 'aria-label': `Got ${l.name}` });
    const row = h('li', { class: `g-line${checked[l.key] ? ' done' : ''}` },
      h('label', { class: 'g-check' }, box,
        h('span', { class: 'g-main' },
          h('span', { class: 'g-name' }, `${l.packs} × ${cap(l.name)}`),
          h('span', { class: 'g-sub' }, `${l.pack_label} · for ${dayInline(l.needed_by)}`),
          h('span', { class: `g-use${l.leftover > 0 && l.perishable && l.expires_on && diffDays(l.needed_by, l.expires_on) <= 7 ? ' warn-text' : ' muted'}` },
            `Uses ${fmtQty(l.used, l.unit, sys)} of ${fmtQty(l.total, l.unit, sys)}`
            + (l.leftover > 0 ? ` · ${fmtQty(l.leftover, l.unit, sys)} left over${l.perishable && l.expires_on ? `, best by ${short(l.expires_on)}` : ''}` : ' · all used')),
          l.uses.length > 1 && h('span', { class: 'g-sub' }, `Meals: ${l.uses.map((u) => `${longDow(u.date).slice(0, 3)} ${u.meal}`).join(', ')}`))));
    box.addEventListener('change', () => {
      const c = loadChecked();
      if (box.checked) c[l.key] = true; else delete c[l.key];
      saveChecked(c);
      row.classList.toggle('done', box.checked);
    });
    return row;
  };

  const copy = async () => {
    const text = [
      ...aisles.flatMap((a) => [`${cap(a)}`, ...byAisle.get(a).map((l) => `- ${l.packs} × ${l.name} (${l.pack_label})`), '']),
      data.staples.length ? `Check your pantry: ${data.staples.map((s) => s.name).join(', ')}` : '',
    ].join('\n').trim();
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ title: 'Grocery list', text });
      else { await navigator.clipboard.writeText(text); toast('Grocery list copied'); }
    } catch { toast('Could not copy. Select the list and copy it manually.', 'error'); }
  };

  mount(view,
    h('h1', { class: 'page-title' }, 'Groceries'),
    h('p', { class: 'muted page-sub' }, 'Built from the recipes you chose. Items shared between recipes are bought once.'),
    seg.el,
    data.lines.length === 0 && data.staples.length === 0
      ? h('div', { class: 'card empty-card' }, h('p', null, 'Nothing to buy for this range yet.'), h('p', { class: 'muted small' }, 'Choose recipes on the Plan tab and the list appears here.'), h('a', { class: 'btn primary small-btn', href: '#/plan' }, 'Go to plan'))
      : [
        h('div', { class: 'card summary' },
          h('div', null, h('strong', `${data.lines.length} item${data.lines.length === 1 ? '' : 's'} to buy`),
            leftoverCount > 0 && h('p', { class: 'muted small' }, `${leftoverCount} will have leftovers. Upcoming meals will be built to use them up.`)),
          h('button', { class: 'btn small-btn', type: 'button', onclick: copy }, 'Copy list')),
        aisles.map((a) => h('section', { class: 'card' }, h('h3', { class: 'aisle' }, cap(a)), h('ul', { class: 'g-list' }, byAisle.get(a).map(line)))),
        data.staples.length > 0 && h('section', { class: 'card' },
          h('h3', { class: 'aisle' }, 'Check your pantry'),
          h('p', { class: 'muted small' }, 'Staples these recipes assume you have.'),
          h('ul', { class: 'plain staples-list' }, data.staples.map((s) => h('li', null, h('strong', cap(s.name)), h('span', { class: 'muted small' }, ` · ${s.uses.length} meal${s.uses.length > 1 ? 's' : ''}`))))),
      ]);
}
