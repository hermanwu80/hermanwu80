import { h, toast, sheet, actionBtn, cap, mount } from '../ui.js';
import { post } from '../api.js';
import { fmtQty } from '../units.js';
import { S, units, dayOf, dayName, dayInline, dayLong, shortDow, dayNum, MEAL_ICON } from '../state.js';
import { recipeCard } from './recipe.js';

const mealName = (m) => cap(m);

/** Days are planned in order: each day is built from what you picked before it. */
function nextTarget(state) {
  const start = state.days[0].slots.some((s) => s.status !== 'empty') ? 0 : 1;
  for (const d of state.days.slice(start, start + 7)) {
    if (d.complete) continue;
    if (d.slots.some((s) => s.status === 'generating')) return { type: 'wait', day: d };
    return { type: d.has_options ? 'choose' : 'plan', day: d };
  }
  return { type: 'done', day: state.days[start] };
}

const useUpText = (list) => list.slice(0, 4).map((l) => `${cap(l.name)} (${fmtQty(l.remaining, l.unit, units())}${l.days_left != null ? `, ${l.days_left}d` : ''})`).join(' · ');

async function planDay(date) {
  S.selected = date;
  await S.apply(await post(`/api/days/${date}/generate`));
}

export async function renderPlan(view) {
  const st = S.state;
  if (!S.selected || !dayOf(S.selected)) S.selected = nextTarget(st).day.date;
  const day = dayOf(S.selected);
  const target = nextTarget(st);

  const cta = (() => {
    const name = dayName(target.day.date);
    const inline = dayInline(target.day.date);
    if (target.type === 'wait') {
      return h('div', { class: 'card cta' }, h('div', { class: 'spinner' }),
        h('div', null, h('strong', `Planning ${inline}…`), h('p', { class: 'muted small' }, 'Building ideas around what you already have. This takes about 20–40 seconds.')));
    }
    if (target.type === 'plan') {
      const n = target.day.use_up.length;
      return h('div', { class: 'card cta' },
        h('div', { class: 'cta-text' }, h('strong', `Next up: ${name}`),
          h('p', { class: 'muted small' }, n ? `${n} item${n > 1 ? 's' : ''} to use up: ${useUpText(target.day.use_up)}` : 'Three ideas for every meal, then your grocery list builds itself.')),
        actionBtn(`Get ideas for ${inline}`, 'btn primary small-btn', () => planDay(target.day.date)));
    }
    if (target.type === 'choose') {
      return h('div', { class: 'card cta' }, h('div', { class: 'cta-text' }, h('strong', `${name} is waiting for your picks`), h('p', { class: 'muted small' }, 'Choose one of three for each meal.')),
        h('button', { class: 'btn primary small-btn', type: 'button', onclick: () => { S.selected = target.day.date; S.refresh(); } }, 'Choose'));
    }
    return h('div', { class: 'card cta' }, h('div', { class: 'cta-text' }, h('strong', 'You’re set for the next 7 days 🎉'), h('p', { class: 'muted small' }, 'Your grocery list is ready.')),
      h('a', { class: 'btn primary small-btn', href: '#/grocery' }, 'Grocery list'));
  })();

  const strip = h('div', { class: 'day-strip', role: 'tablist', 'aria-label': 'Days' }, st.days.map((d) => {
    const generating = d.slots.some((s) => s.status === 'generating');
    const state = d.complete ? 'done' : generating ? 'busy' : d.has_options ? 'ready' : 'empty';
    return h('button', {
      class: `day-chip ${state}`, type: 'button', role: 'tab', 'aria-selected': String(d.date === S.selected),
      onclick: () => { S.selected = d.date; S.refresh(); },
    }, h('span', { class: 'dow' }, d.date === st.today ? 'Today' : shortDow(d.date)), h('span', { class: 'num' }, dayNum(d.date)), h('span', { class: 'dot', title: state }));
  }));

  const notice = st.notice && h('div', { class: 'card notice' },
    h('span', null, `🔔 ${st.notice.text}`),
    h('span', { class: 'notice-actions' },
      h('button', { class: 'link', type: 'button', onclick: async () => { S.selected = st.notice.date; await post('/api/notice/dismiss'); S.refresh(); } }, 'Open'),
      h('button', { class: 'link muted', type: 'button', onclick: async () => { await post('/api/notice/dismiss'); S.refresh(); } }, 'Dismiss')));

  mount(view,
    h('div', { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Meal plan'),
      st.ai.demo && h('span', { class: 'pill warn', title: 'No ANTHROPIC_API_KEY is set, so recipes come from a small built-in library' }, 'Demo recipes')),
    notice,
    cta,
    strip,
    h('h2', { class: 'day-title' }, dayLong(day.date)),
    day.use_up.length > 0 && h('div', { class: 'card use-up-card' },
      h('strong', '♻️ Use these up'),
      h('div', { class: 'chips' }, [...day.use_up.slice(0, 8).map((l) => h('span', { class: 'chip' }, `${cap(l.name)} · ${fmtQty(l.remaining, l.unit, units())}${l.days_left != null ? ` · ${l.days_left}d left` : ''}`)), day.use_up.length > 8 && h('span', { class: 'chip' }, `+${day.use_up.length - 8} more`)]),
      h('p', { class: 'muted small' }, 'Suggestions for this day are built around these.')),
    h('div', { class: 'slots' }, day.slots.map((s) => slotCard(day, s))),
    !day.has_options && h('div', { class: 'row-actions' }, actionBtn(`Get ideas for ${dayInline(day.date)}`, 'btn small-btn', () => planDay(day.date))));
}

function slotCard(day, slot) {
  const head = h('div', { class: 'slot-head' }, h('span', { class: 'slot-icon' }, MEAL_ICON[slot.meal]), h('h3', mealName(slot.meal)));
  const ask = (label, cls = 'btn small-btn') => actionBtn(label, cls, async () => S.apply(await post(`/api/slots/${day.date}/${slot.meal}/generate`)));

  if (slot.status === 'generating') {
    return h('section', { class: 'card slot generating' }, head, h('div', { class: 'row' }, h('div', { class: 'spinner small' }), h('span', { class: 'muted' }, 'Cooking up ideas…')));
  }
  if (slot.status === 'error') {
    return h('section', { class: 'card slot' }, head, h('p', { class: 'neg small' }, slot.error), ask('Try again', 'btn primary small-btn'));
  }
  if (slot.status === 'empty') {
    return h('section', { class: 'card slot' }, head, h('p', { class: 'muted small' }, 'No ideas yet.'), ask('Get 3 ideas'));
  }
  if (slot.status === 'skipped') {
    return h('section', { class: 'card slot skipped' }, head, h('p', { class: 'muted' }, 'Skipping this meal (eating out, leftovers, or fasting).'),
      actionBtn('Undo', 'btn small-btn', async () => S.apply(await post(`/api/slots/${day.date}/${slot.meal}/choose`, { clear: true }))));
  }
  if (slot.status === 'chosen') {
    const o = slot.options[slot.chosen_idx];
    return h('section', { class: 'card slot chosen-slot' }, head,
      h('h4', { class: 'chosen-title' }, o.title),
      h('p', { class: 'muted small' }, [o.minutes ? `${o.minutes} min` : null, o.items.some((i) => i.status === 'buy' || i.status === 'partial') ? `${o.items.filter((i) => i.status === 'buy' || i.status === 'partial').length} to buy` : 'nothing to buy'].filter(Boolean).join(' · ')),
      o.uses_up.length > 0 && h('p', { class: 'badge use-up' }, `♻️ Uses up: ${o.uses_up.map(cap).join(', ')}`),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small-btn', type: 'button', onclick: () => openRecipe(day, slot) }, 'Recipe'),
        h('button', { class: 'btn small-btn', type: 'button', onclick: () => openChoose(day, slot) }, 'Change')));
  }
  return h('section', { class: 'card slot ready-slot' }, head,
    h('ul', { class: 'plain titles' }, slot.options.map((o) => h('li', o.title))),
    h('button', { class: 'btn primary small-btn', type: 'button', onclick: () => openChoose(day, slot) }, 'Choose one of 3'));
}

function openRecipe(day, slot) {
  const o = slot.options[slot.chosen_idx];
  sheet(`${mealName(slot.meal)} · ${dayName(day.date)}`, (close) => h('div', { class: 'stack' },
    recipeCard(o, { chosen: true, servings: S.state.settings.servings }),
    h('button', { class: 'btn', type: 'button', onclick: () => { close(); setTimeout(() => openChoose(day, slot), 240); } }, 'Pick a different one')));
}

/** The core interaction: three full options side by side (stacked on phones). */
function openChoose(day, slot) {
  const hint = h('input', { type: 'text', placeholder: 'Optional: “something light”, “no oven”…', maxlength: 200, value: slot.hint || '' });
  sheet(`${mealName(slot.meal)} · ${dayName(day.date)}`, (close) => {
    const choose = async (idx) => {
      const next = await post(`/api/slots/${day.date}/${slot.meal}/choose`, { idx });
      close();
      await advance(day.date, next);
    };
    return h('div', { class: 'stack' },
      day.use_up.length > 0 && h('p', { class: 'muted small' }, `♻️ Built around: ${useUpText(day.use_up)}`),
      h('div', { class: 'options' }, slot.options.map((o, i) => recipeCard(o, {
        chosen: slot.chosen_idx === i, servings: S.state.settings.servings,
        actions: [actionBtn(slot.chosen_idx === i ? 'Chosen ✓' : 'Choose this one', `btn ${slot.chosen_idx === i ? '' : 'primary'}`, () => choose(i))],
      }))),
      h('div', { class: 'card more-ideas' },
        h('label', { class: 'field' }, h('span', { class: 'label' }, 'Not feeling these?'), hint),
        h('div', { class: 'row2' },
          actionBtn('Get 3 new ideas', 'btn', async () => { close(); S.apply(await post(`/api/slots/${day.date}/${slot.meal}/generate`, { hint: hint.value })); }),
          actionBtn('Skip this meal', 'btn', async () => { const next = await post(`/api/slots/${day.date}/${slot.meal}/choose`, { skip: true }); close(); await advance(day.date, next); }))));
  }, { wide: true });
}

/** After a pick: if that finished the day, start the next one right away so it's built from the new leftovers. */
async function advance(date, next) {
  await S.apply(next);
  const i = next.days.findIndex((d) => d.date === date);
  const d = next.days[i];
  const following = next.days[i + 1];
  if (!d?.complete || !following || i >= 6) return;
  if (following.has_options || following.slots.some((s) => s.status === 'generating')) {
    S.selected = following.date;
    return S.refresh();
  }
  toast(`${dayName(date)} is done. Planning ${dayInline(following.date)} from your picks…`);
  await planDay(following.date);
}
