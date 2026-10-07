import { h, toast, field, select, segmented, actionBtn, busy, mount } from '../ui.js';
import { put, post, del } from '../api.js';
import { S } from '../state.js';

const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']];
const DOWS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
// Friendly units for entering what's at home; everything is stored as g / ml / count.
const UNIT_CHOICES = [['count', 'items'], ['oz', 'oz'], ['lb', 'lb'], ['g', 'g'], ['cup', 'cups'], ['ml', 'ml']];
const TO_BASE = { count: ['count', 1], oz: ['g', 28.3495], lb: ['g', 453.592], g: ['g', 1], cup: ['ml', 236.588], ml: ['ml', 1] };
const UNIT_LABEL = { g: 'g', ml: 'ml', count: '' };

export async function renderSettings(view, { onLogout }) {
  const st = S.state;
  const s = st.settings;
  const draft = { ...s, auto: { ...s.auto }, meals: [...s.meals] };

  // ---- household -----------------------------------------------------------
  const servingsVal = h('output', { class: 'stepper-val' }, String(draft.servings));
  const step = (d) => { draft.servings = Math.min(12, Math.max(1, draft.servings + d)); servingsVal.textContent = String(draft.servings); };
  const units = segmented([['us', 'US (oz, cups)'], ['metric', 'Metric (g, ml)']], draft.units, (v) => { draft.units = v; });
  const diet = h('textarea', { rows: 2, maxlength: 400, placeholder: 'e.g. vegetarian, no tree nuts, low sodium' }, draft.diet);
  const dislikes = h('input', { type: 'text', maxlength: 400, placeholder: 'e.g. cilantro, olives, mushrooms', value: draft.dislikes });
  const mealBoxes = MEALS.map(([key, label]) => {
    const box = h('input', { type: 'checkbox', checked: draft.meals.includes(key) });
    box.addEventListener('change', () => { draft.meals = MEALS.map(([k]) => k).filter((k) => (k === key ? box.checked : draft.meals.includes(k))); });
    return h('label', { class: 'check' }, box, h('span', label));
  });

  // ---- schedule ------------------------------------------------------------
  const mode = segmented([['off', 'Manual'], ['daily', 'Every day'], ['weekly', 'Weekly']], draft.auto.mode, (v) => { draft.auto.mode = v; syncAuto(); });
  const time = h('input', { type: 'time', value: draft.auto.time, required: true });
  const dow = select(DOWS.map((d, i) => [i, d]), draft.auto.dow);
  const lead = select([1, 2, 3, 4, 5, 6, 7].map((n) => [n, n === 1 ? '1 day ahead (tomorrow)' : `${n} days ahead`]), draft.auto.lead_days);
  const autoHelp = h('p', { class: 'muted small' });
  const autoFields = h('div', { class: 'stack' });
  function syncAuto() {
    const m = draft.auto.mode;
    autoFields.hidden = m === 'off';
    autoFields.replaceChildren(
      ...(m === 'weekly' ? [field('Plan on', dow)] : []),
      field('At', time),
      field(m === 'weekly' ? 'Week starts' : 'Plan the day', lead));
    autoHelp.textContent = {
      off: 'You choose when to plan. Tap “Get ideas” on the Plan tab.',
      daily: 'Each day at this time, ideas for that day are prepared so they are waiting when you open the app.',
      weekly: 'On this day, the first day of the week is prepared. Each following day is prepared as you finish the one before, so every day builds on your picks and leftovers.',
    }[m];
  }
  syncAuto();

  const save = h('button', { class: 'btn primary', type: 'button' }, 'Save settings');
  save.addEventListener('click', busy(save, async () => {
    draft.diet = diet.value; draft.dislikes = dislikes.value;
    draft.auto.time = time.value || '19:00'; draft.auto.dow = Number(dow.value); draft.auto.lead_days = Number(lead.value);
    if (!draft.meals.length) throw new Error('Pick at least one meal');
    await S.apply(await put('/api/settings', draft));
    toast('Saved');
  }));

  // ---- on hand ------------------------------------------------------------
  const pName = h('input', { type: 'text', placeholder: 'e.g. baby spinach', maxlength: 60, 'aria-label': 'Item' });
  const pAmt = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Amount', 'aria-label': 'Amount' });
  const pUnit = select(UNIT_CHOICES, 'count', { 'aria-label': 'Unit' });
  const pExp = h('input', { type: 'date', 'aria-label': 'Best by' });
  const addBtn = h('button', { class: 'btn', type: 'button' }, 'Add to on hand');
  addBtn.addEventListener('click', busy(addBtn, async () => {
    const n = parseFloat(pAmt.value);
    if (!(n > 0)) throw new Error('Enter an amount');
    const [unit, mult] = TO_BASE[pUnit.value];
    S.state.pantry = await post('/api/pantry', { name: pName.value, amount: Math.round(n * mult * 100) / 100, unit, expires_on: pExp.value || null });
    toast('Added. Suggestions will use it up.');
    await S.refresh();
  }));
  const pantryList = st.pantry.length
    ? h('ul', { class: 'plain pantry-list' }, st.pantry.map((p) => h('li', { class: 'p-row' },
      h('span', null, h('strong', p.name), h('span', { class: 'muted small' }, ` · ${p.amount}${UNIT_LABEL[p.unit] ? ` ${UNIT_LABEL[p.unit]}` : ''}${p.expires_on ? ` · best by ${p.expires_on}` : ''}`)),
      actionBtn('Remove', 'link', async () => { await del(`/api/pantry/${p.id}`); await S.refresh(); }))))
    : h('p', { class: 'muted small' }, 'Nothing listed. Add things you already have (half a bag of spinach, a few apples) and the next ideas will be built to use them.');

  mount(view,
    h('h1', { class: 'page-title' }, 'Settings'),
    h('section', { class: 'card stack' },
      h('h3', 'Your household'),
      field('Servings per meal', h('div', { class: 'stepper' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fewer', onclick: () => step(-1) }, '−'), servingsVal, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'More', onclick: () => step(1) }, '+'))),
      field('Units', units.el),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Meals to plan'), h('div', { class: 'checks' }, mealBoxes)),
      field('Diet & allergies', diet, 'Followed strictly, including allergies.'),
      field('Dislikes', dislikes)),
    h('section', { class: 'card stack' },
      h('h3', 'When do you plan?'),
      mode.el, autoFields, autoHelp,
      h('p', { class: 'muted small' }, `Timezone: ${s.tz}. Automatic planning runs while the app is running on your computer or server.`)),
    save,
    h('section', { class: 'card stack' },
      h('h3', 'What’s on hand'),
      pantryList,
      h('div', { class: 'row2 narrow-first' }, field('Amount', pAmt), field('Item', pName)),
      h('div', { class: 'row2' }, field('Unit', pUnit), field('Best by (optional)', pExp)),
      addBtn),
    h('section', { class: 'card stack' },
      h('h3', 'About'),
      h('p', { class: 'muted small' }, st.ai.demo
        ? 'Demo mode: recipes come from a small built-in library. Set ANTHROPIC_API_KEY on the server for fresh AI-written recipes.'
        : `Recipes are written by ${st.ai.model}.`),
      S.me?.auth_required && h('button', { class: 'btn', type: 'button', onclick: async () => { await post('/api/logout'); await onLogout(); } }, 'Lock app')));
}
