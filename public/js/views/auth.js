import { h, field, busy, toast } from '../ui.js';
import { post } from '../api.js';

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'America/New_York'; } };

export function renderAuth(root, { needsSetup, onDone }) {
  let mode = needsSetup ? 'setup' : 'login';
  const draw = () => {
    const name = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'words', required: true, maxlength: 40 });
    const pw = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true, minlength: mode === 'login' ? 1 : 8 });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, { setup: 'Create household', login: 'Sign in', join: 'Join household' }[mode]);
    const hhName = h('input', { type: 'text', value: 'Our household', maxlength: 60 });
    const starter = h('input', { type: 'checkbox', checked: true });
    const code = h('input', { type: 'text', autocapitalize: 'characters', autocomplete: 'off', maxlength: 12, placeholder: 'ABCD2345' });

    const submit = busy(btn, async () => {
      if (mode === 'setup') await post('/api/setup', { household: hhName.value, name: name.value, password: pw.value, tz: tz(), starter: starter.checked });
      else if (mode === 'join') await post('/api/join', { invite_code: code.value, name: name.value, password: pw.value });
      else await post('/api/login', { name: name.value, password: pw.value });
      await onDone();
    });

    root.replaceChildren(h('div', { class: 'auth' },
      h('div', { class: 'logo' }, '💸'),
      h('h1', 'Weekly Budget'),
      h('p', { class: 'muted' }, { setup: 'Set up your household. You\'ll invite your spouse next.', login: 'Welcome back.', join: 'Enter the invite code from your spouse\'s phone.' }[mode]),
      h('form', { class: 'stack', onsubmit: submit },
        mode === 'setup' && field('Household name', hhName),
        mode === 'join' && field('Invite code', code),
        field(mode === 'setup' ? 'Your name' : 'Name', name),
        field('Password', pw, mode === 'login' ? null : 'At least 8 characters'),
        mode === 'setup' && h('label', { class: 'check' }, starter, h('span', 'Start with the bills from our paper list (you can edit everything)')),
        btn),
      !needsSetup && h('div', { class: 'auth-links' },
        mode !== 'login' && h('button', { class: 'link', onclick: () => { mode = 'login'; draw(); } }, 'Sign in'),
        mode !== 'join' && h('button', { class: 'link', onclick: () => { mode = 'join'; draw(); } }, 'I have an invite code'))));
    setTimeout(() => (mode === 'join' ? code : name).focus(), 50);
  };
  draw();
}
