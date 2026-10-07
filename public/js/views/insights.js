import { h, money, bar, busy, toast } from '../ui.js';
import { get, post } from '../api.js';
import { S } from '../state.js';
import { short } from '../dates.js';

const SUGGESTIONS = ['Where is our money going?', 'Are we on track this week?', 'Which category do we overspend most?', 'What bills are coming up?'];
let history = [];

export async function renderInsights(root) {
  const data = await get('/api/insights');
  const max = Math.max(1, ...data.weeks.flatMap((w) => [w.planned_cents, w.spent_cents]));
  const last = data.weeks.at(-1);

  const W = 340, H = 150, pad = 18, gw = (W - pad * 2) / data.weeks.length;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H + 22}`, class: 'chart', role: 'img', 'aria-label': 'Planned versus spent for the last eight weeks' });
  data.weeks.forEach((wk, i) => {
    const x = pad + i * gw;
    const bw = gw * 0.34;
    const ph = (wk.planned_cents / max) * H, sh = (wk.spent_cents / max) * H;
    svg.append(el('rect', { x: x + gw * 0.1, y: H - ph, width: bw, height: Math.max(ph, 0), rx: 3, class: 'bar-planned' }));
    svg.append(el('rect', { x: x + gw * 0.1 + bw + 2, y: H - sh, width: bw, height: Math.max(sh, 0), rx: 3, class: wk.spent_cents > wk.planned_cents && wk.planned_cents > 0 ? 'bar-over' : 'bar-spent' }));
    const lbl = el('text', { x: x + gw / 2, y: H + 15, 'text-anchor': 'middle', class: 'axis' });
    lbl.textContent = short(wk.start).replace(' ', ' ');
    if (data.weeks.length <= 8 || i % 2 === 0) svg.append(lbl);
  });
  svg.append(el('line', { x1: pad, x2: W - pad, y1: H, y2: H, class: 'axis-line' }));

  const catMax = Math.max(1, ...data.categories.map((c) => c.spent_cents));
  root.replaceChildren(
    h('h1', { class: 'page-title' }, 'Insights'),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Last 8 weeks')),
      svg,
      h('div', { class: 'legend' }, h('span', { class: 'dot planned' }), 'Planned', h('span', { class: 'dot spent' }), 'Spent', h('span', { class: 'dot over' }), 'Over plan'),
      h('p', { class: 'muted small' }, `This week: ${money(last.spent_cents)} spent of ${money(last.planned_cents)} planned.`)),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Where it went'), h('span', { class: 'muted small' }, 'last 4 weeks')),
      data.categories.length ? data.categories.map((c) => h('div', { class: 'cat-row' },
        h('div', { class: 'cat-top' }, h('span', `${c.emoji} ${c.name}`), h('span', money(c.spent_cents))),
        bar(c.spent_cents, catMax, { plain: true })))
        : h('p', { class: 'empty' }, 'Spending will show up here as you add transactions.')),
    askCard());
}

function askCard() {
  const log = h('div', { class: 'chat-log' });
  const input = h('input', { type: 'text', placeholder: S.ai.enabled ? 'Ask about your spending…' : 'Add an API key to enable AI', maxlength: 500, disabled: !S.ai.enabled, enterkeyhint: 'send' });
  const send = h('button', { class: 'btn primary small-btn', type: 'submit', disabled: !S.ai.enabled }, 'Ask');
  const paint = () => {
    log.replaceChildren(...history.map((m) => h('div', { class: `bubble ${m.role}` }, m.text)));
    log.scrollTop = log.scrollHeight;
  };
  const ask = async (q) => {
    history.push({ role: 'user', text: q });
    const pending = { role: 'assistant', text: '…' };
    history.push(pending);
    paint();
    try {
      const { answer } = await post('/api/ai/ask', { question: q, history: history.slice(0, -2) });
      pending.text = answer;
    } catch (e) { history.splice(-2); toast(e.message, 'error'); }
    paint();
  };
  const form = h('form', { class: 'chat-form', onsubmit: busy(send, async () => { const q = input.value.trim(); if (!q) return; input.value = ''; await ask(q); }) }, input, send);
  paint();
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', '✨ Ask your budget')),
    !history.length && h('div', { class: 'chips' }, SUGGESTIONS.map((s) => h('button', { class: 'chip', type: 'button', disabled: !S.ai.enabled, onclick: () => ask(s) }, s))),
    log, form);
}
