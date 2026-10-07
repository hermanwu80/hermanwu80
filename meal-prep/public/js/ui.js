// Tiny DOM + UI toolkit (no framework). Everything user- or model-supplied goes through textContent, never innerHTML.

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

/** Replace an element's children, flattening arrays and dropping false/null (replaceChildren would print them as text). */
export function mount(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
}

let toastTimer;
export function toast(msg, kind = '') {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3600);
}

/** Modal sheet (bottom sheet on phones, centred dialog on desktop). `build(close)` returns the body node(s). */
export function sheet(title, build, { onClose, wide = false } = {}) {
  const scrim = h('div', { class: 'scrim' });
  const panel = h('div', { class: `sheet${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  let closed = false;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
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
  document.addEventListener('keydown', onKey);
  document.body.append(scrim, panel);
  requestAnimationFrame(() => { scrim.classList.add('open'); panel.classList.add('open'); });
  return { close, el: panel };
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

/** Button that runs an async action with the busy guard. */
export function actionBtn(label, cls, fn) {
  const b = h('button', { class: cls, type: 'button' }, label);
  b.addEventListener('click', busy(b, fn));
  return b;
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
      h('button', { type: 'button', class: v === value ? 'on' : '', 'aria-pressed': String(v === value), onclick: () => { value = v; render(); onChange?.(v); } }, text)));
  };
  render();
  return { el: wrap, get value() { return value; } };
}

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
