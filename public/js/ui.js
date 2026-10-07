// Tiny DOM + UI toolkit (no framework). Everything user-supplied goes through textContent, never innerHTML.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (kid) => {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(add);
    else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function money(cents, { plus = false } = {}) {
  const n = (cents || 0) / 100;
  const abs = Math.abs(n);
  const body = abs.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(abs) ? 0 : 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '−' : plus && n > 0 ? '+' : ''}$${body}`;
}

/** "12.5", "$1,200" -> cents, or null if not a valid amount. */
export function parseMoney(s) {
  const t = String(s ?? '').replace(/[$,\s]/g, '');
  if (!/^\d*\.?\d{0,2}$/.test(t) || t === '' || t === '.') return null;
  return Math.round(parseFloat(t) * 100);
}

export const centsToInput = (c) => (c ? (c / 100).toFixed(c % 100 ? 2 : 0) : '');

let toastTimer;
export function toast(msg, kind = '') {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

/**
 * Bottom sheet. `build(close)` returns the body node(s). Returns { close, el }.
 */
export function sheet(title, build, { onClose } = {}) {
  const scrim = h('div', { class: 'scrim' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    panel.classList.remove('open');
    scrim.classList.remove('open');
    setTimeout(() => { scrim.remove(); panel.remove(); onClose?.(); }, 220);
  };
  panel.append(
    h('div', { class: 'sheet-head' },
      h('button', { class: 'link', type: 'button', onclick: close }, 'Close'),
      h('h2', title),
      h('span', { class: 'sheet-spacer' })),
    h('div', { class: 'sheet-body' }, build(close)));
  scrim.addEventListener('click', close);
  document.body.append(scrim, panel);
  requestAnimationFrame(() => { scrim.classList.add('open'); panel.classList.add('open'); });
  return { close, el: panel };
}

export function confirmSheet(title, message, action, { danger = true } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    sheet(title, (close) => h('div', { class: 'stack' },
      h('p', { class: 'muted' }, message),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => { answered = true; close(); resolve(true); } }, action),
      h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel')),
    { onClose: () => { if (!answered) resolve(false); } });
  });
}

/** Wrap an async handler: disables the button, shows errors as toasts. */
export function busy(btn, fn) {
  return async (e) => {
    e?.preventDefault?.();
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(); } catch (err) { toast(err.message || 'Something went wrong', 'error'); } finally { btn.disabled = false; }
  };
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, hint && h('span', { class: 'hint' }, hint));
}

export function select(options, value, attrs = {}) {
  const el = h('select', attrs, options.map(([v, text]) => h('option', { value: v ?? '' }, text)));
  el.value = value == null ? '' : String(value);
  return el;
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'segmented', role: 'tablist' });
  const render = () => {
    wrap.replaceChildren(...options.map(([v, text]) =>
      h('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => { value = v; render(); onChange?.(v); } }, text)));
  };
  render();
  return { el: wrap, get value() { return value; } };
}

export const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
export const userColor = (id) => ['#5b8def', '#e0709a', '#e5a336', '#8a6fd8'][(id || 0) % 4];

export function badge(user) {
  return h('span', { class: 'who', title: user?.name || '', style: { background: userColor(user?.id) } }, initial(user?.name));
}

export function bar(spent, planned, { height, plain = false } = {}) {
  const pct = planned > 0 ? Math.min(100, (spent / planned) * 100) : spent > 0 ? 100 : 0;
  const over = !plain && spent > planned;
  const near = !plain && !over && planned > 0 && spent / planned >= 0.85;
  return h('div', { class: `bar ${over ? 'over' : near ? 'near' : ''}`, style: height ? { height } : null },
    h('div', { style: { width: `${pct}%` } }));
}
