import { h, field, select, toast, busy, confirmSheet } from '../ui.js';
import { api, patch, post } from '../api.js';
import { S } from '../state.js';

export async function renderMore(root, { onLogout }) {
  const hh = S.hh;
  const code = h('code', { class: 'invite' }, hh.invite_code);
  const ws = select([[0, 'Sunday'], [1, 'Monday'], [6, 'Saturday']], hh.week_start);
  const name = h('input', { type: 'text', value: hh.name, maxlength: 60 });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save');

  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  root.replaceChildren(
    h('h1', { class: 'page-title' }, 'More'),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Household')),
      h('form', { class: 'stack', onsubmit: busy(save, async () => {
        const next = await patch('/api/household', { name: name.value, week_start: Number(ws.value) });
        S.hh = { ...S.hh, ...next };
        toast('Saved'); await S.refresh();
      }) },
        field('Name', name),
        field('Weeks start on', ws, 'Changing this shifts which week each day belongs to.'),
        save),
      h('div', { class: 'members' }, S.hh.members.map((m) => h('span', { class: 'pill' }, m.name + (m.id === S.me.id ? ' (you)' : ''))))),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Invite your spouse')),
      h('p', { class: 'muted' }, 'On their phone, open this app, tap "I have an invite code", and enter:'),
      code,
      h('div', { class: 'row2' },
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(hh.invite_code); toast('Copied'); } catch { toast('Copy failed', 'error'); } } }, 'Copy code'),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          if (!(await confirmSheet('Make a new code?', 'The old code will stop working. People already in the household are not affected.', 'New code', { danger: false }))) return;
          try { const next = await post('/api/household/invite'); S.hh = { ...S.hh, ...next }; await S.refresh(); } catch (e) { toast(e.message, 'error'); }
        } }, 'New code'))),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'AI receipt reader')),
      h('p', {}, S.ai.enabled ? `✅ On · ${S.ai.model}` : '⚠️ Off — the server has no ANTHROPIC_API_KEY. You can still add transactions by hand.'),
      h('p', { class: 'muted small' }, 'Photos and pasted text are sent to Claude only when you tap Read. Receipt images stay on your server.')),
    !standalone && h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Install on iPhone')),
      h('ol', { class: 'steps' },
        h('li', 'Open this page in Safari.'),
        h('li', 'Tap the Share button.'),
        h('li', 'Choose "Add to Home Screen".'))),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Your data')),
      h('a', { class: 'btn', href: '/api/export.csv', download: 'budget.csv' }, 'Download all transactions (CSV)'),
      h('button', { class: 'btn', type: 'button', onclick: async () => { await api('POST', '/api/logout'); onLogout(); } }, `Sign out ${S.me.name}`)));
}
