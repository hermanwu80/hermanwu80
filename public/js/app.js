import { h } from './ui.js';
import { get, onUnauthorized } from './api.js';
import { S, loadLookups } from './state.js';
import { renderAuth } from './views/auth.js';
import { renderWeek } from './views/week.js';
import { renderPlan } from './views/plan.js';
import { renderInsights } from './views/insights.js';
import { renderMore } from './views/more.js';
import { openAdd } from './capture.js';

const TABS = [
  ['week', '📅', 'Week', renderWeek],
  ['plan', '🗓️', 'Plan', renderPlan],
  ['add', '+', 'Add', null],
  ['insights', '📊', 'Insights', renderInsights],
  ['more', '⚙️', 'More', renderMore],
];

const root = document.getElementById('app');
let view, tabbar;

const current = () => (location.hash.replace('#/', '') || 'week').split('?')[0];

async function paint() {
  const name = TABS.some(([k]) => k === current()) && current() !== 'add' ? current() : 'week';
  const scroll = view.scrollTop;
  tabbar.querySelectorAll('button[data-tab]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === name)));
  const render = TABS.find(([k]) => k === name)[3];
  try {
    await render(view, { onLogout: boot });
  } catch (e) {
    if (e.status !== 401) view.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'neg' }, e.message), h('button', { class: 'btn', onclick: paint }, 'Try again')));
  }
  view.scrollTop = scroll;
}

async function refresh() {
  try { await loadLookups(); } catch { /* the view will surface the error */ }
  await paint();
}
S.refresh = refresh;

function shell() {
  view = h('main', { id: 'view', tabindex: -1 });
  tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' }, TABS.map(([key, icon, label]) =>
    key === 'add'
      ? h('button', { class: 'tab-add', 'aria-label': 'Add transaction', onclick: () => openAdd() }, '+')
      : h('button', { class: 'tab', 'data-tab': key, onclick: () => { if (current() === key) paint(); else location.hash = `#/${key}`; } },
        h('span', { class: 'tab-icon' }, icon), h('span', { class: 'tab-label' }, label))));
  root.replaceChildren(view, tabbar);
}

async function boot() {
  const me = await get('/api/me');
  if (!me.user) {
    document.querySelectorAll('.sheet, .scrim').forEach((n) => n.remove());
    return renderAuth(root, { needsSetup: me.needs_setup, onDone: boot });
  }
  S.me = me.user; S.hh = me.household; S.ai = me.ai; S.weekDate = null;
  await loadLookups();
  shell();
  await paint();
}

window.addEventListener('hashchange', () => view && paint());
window.addEventListener('pageshow', (e) => { if (e.persisted && view) refresh(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && view && !document.querySelector('.sheet')) refresh(); });
onUnauthorized(() => boot());

boot().catch((e) => { root.replaceChildren(h('div', { class: 'auth' }, h('p', { class: 'neg' }, e.message), h('button', { class: 'btn', onclick: () => location.reload() }, 'Reload'))); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
