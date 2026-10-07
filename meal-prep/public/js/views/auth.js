import { h, field, busy } from '../ui.js';
import { post } from '../api.js';

export function renderAuth(root, { onDone }) {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true, placeholder: 'Password' });
  const err = h('p', { class: 'neg', hidden: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Unlock');
  const form = h('form', { class: 'stack' }, field('Access password', pw), err, btn);
  form.addEventListener('submit', busy(btn, async () => {
    err.hidden = true;
    try { await post('/api/login', { password: pw.value }); await onDone(); } catch (e) { err.textContent = e.message; err.hidden = false; throw e; }
  }));
  root.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'logo' }, '🌿'), h('h1', 'Meal Prep'), h('p', { class: 'muted' }, 'Enter the access password to continue.'), form));
  pw.focus();
}
