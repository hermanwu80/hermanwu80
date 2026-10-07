import { h } from './ui.js';
import { get, put, onUnauthorized } from './api.js';
import { S, loadState } from './state.js';
import { renderAuth } from './views/auth.js';
import { renderPlan } from './views/plan.js';
import { renderGrocery } from './views/grocery.js';
import { renderSettings } from './views/settings.js';

const TABS = [
  ['plan', '🍽️', 'Plan', renderPlan],
  ['grocery', '🛒', 'Groceries', renderGrocery],
  ['settings', '⚙️', 'Settings', renderSettings],
];

const root = document.getElementById('app');
let view, tabbar, pollTimer;

const current = () => (location.hash.replace('#/', '') || 'plan').split('?')[0];

async function paint() {
  const name = TABS.some(([k]) => k === current()) ? current() : 'plan';
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

/** While any meal is being generated, keep checking so the result appears on its own (also survives a sleeping phone). */
function schedulePoll() {
  clearTimeout(pollTimer);
  if (!S.state?.days.some((d) => d.slots.some((s) => s.status === 'generating'))) return;
  pollTimer = setTimeout(refresh, 2500);
}

async function refresh() {
  try { await loadState(); } catch (e) { if (e.status === 401) return; }
  await paint();
  schedulePoll();
}

S.apply = async (state) => { S.state = state; await paint(); schedulePoll(); };
S.refresh = refresh;

function shell() {
  view = h('main', { id: 'view', tabindex: -1 });
  tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' },
    h('span', { class: 'brand' }, '🌿 Meal Prep'),
    TABS.map(([key, icon, label]) =>
      h('button', { class: 'tab', 'data-tab': key, onclick: () => { if (current() === key) paint(); else location.hash = `#/${key}`; } },
        h('span', { class: 'tab-icon' }, icon), h('span', { class: 'tab-label' }, label))));
  root.replaceChildren(tabbar, view);
}

async function boot() {
  const me = await get('/api/me');
  S.me = me;
  if (me.auth_required && !me.authed) {
    document.querySelectorAll('.sheet, .scrim').forEach((n) => n.remove());
    return renderAuth(root, { onDone: boot });
  }
  await loadState();
  // Remember the device's timezone the first time so "plan at 7pm" means 7pm where you live.
  if (!S.state.settings.tz_confirmed) {
    try { S.state = await put('/api/settings', { tz: Intl.DateTimeFormat().resolvedOptions().timeZone }); } catch { /* keeps the server default */ }
  }
  S.selected = null;
  shell();
  await paint();
  schedulePoll();
}

window.addEventListener('hashchange', () => view && paint());
window.addEventListener('pageshow', (e) => { if (e.persisted && view) refresh(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && view && !document.querySelector('.sheet')) refresh(); });
onUnauthorized(() => boot());

boot().catch((e) => { root.replaceChildren(h('div', { class: 'auth' }, h('p', { class: 'neg' }, e.message), h('button', { class: 'btn', onclick: () => location.reload() }, 'Reload'))); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
