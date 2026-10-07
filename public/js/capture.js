// "Add" flow: scan a receipt / upload a PDF or screenshot / paste an email -> AI draft -> review form.
import { h, sheet, toast, busy } from './ui.js';
import { post } from './api.js';
import { S } from './state.js';
import { transactionForm } from './forms.js';

const MAX_EDGE = 1600;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

const readB64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = () => rej(new Error('Could not read that file'));
  r.readAsDataURL(blob);
});

/** Downscale photos before upload: receipts stay legible at 1600px and uploads stay small. */
async function prepare(file) {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) throw new Error('That PDF is over 8 MB. Try a screenshot instead.');
    return { mime: 'application/pdf', base64: await readB64(file) };
  }
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo, screenshot or PDF');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('That image format is not supported. Try a screenshot.'); }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  return { mime: 'image/jpeg', base64: await readB64(blob) };
}

async function readWithAi(payload, closeAdd) {
  const loading = sheet('Reading…', () => h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('p', 'Reading your receipt and picking a category…')));
  try {
    const draft = await post('/api/ai/parse', payload);
    loading.close();
    closeAdd?.();
    if (!draft.is_receipt) {
      toast("Couldn't find a purchase in that. Enter it manually.", 'error');
      return transactionForm({ date: S.hh.today });
    }
    transactionForm(draft, { ai: true });
  } catch (e) {
    loading.close();
    toast(e.message, 'error');
  }
}

export function openAdd() {
  return sheet('Add', (close) => {
    const files = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true });
    files.addEventListener('change', async () => {
      const picked = [...files.files].slice(0, 6);
      files.value = '';
      if (!picked.length) return;
      try {
        const images = await Promise.all(picked.map(prepare));
        await readWithAi({ images }, close);
      } catch (e) { toast(e.message, 'error'); }
    });
    const disabled = !S.ai.enabled;
    const tile = (icon, title, sub, onclick, { off = false } = {}) =>
      h('button', { class: 'tile', type: 'button', onclick, disabled: off }, h('span', { class: 'tile-icon' }, icon), h('span', { class: 'tile-text' }, h('strong', title), h('span', sub)));

    return h('div', { class: 'stack' },
      files,
      tile('📷', 'Scan a receipt', disabled ? 'Needs an API key on the server' : 'Take a photo, or pick a screenshot or PDF', () => files.click(), { off: disabled }),
      tile('✉️', 'Paste an email or text', disabled ? 'Needs an API key on the server' : 'Order confirmations, bills, statements', () => { close(); pasteSheet(); }, { off: disabled }),
      tile('✍️', 'Enter manually', 'Amount, merchant, category', () => { close(); transactionForm({ date: S.hh.today }); }));
  });
}

function pasteSheet() {
  return sheet('Paste email or text', (close) => {
    const ta = h('textarea', { rows: 9, placeholder: 'Paste the receipt, order confirmation or bill email here…', maxlength: 20000, autofocus: true });
    const go = h('button', { class: 'btn primary', type: 'submit' }, '✨ Read it');
    const pasteBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      try { ta.value = await navigator.clipboard.readText(); } catch { toast('Long-press in the box and choose Paste', 'error'); }
    } }, 'Paste from clipboard');
    return h('form', { class: 'stack', onsubmit: busy(go, async () => {
      if (ta.value.trim().length < 5) throw new Error('Paste some text first');
      await readWithAi({ text: ta.value }, close);
    }) }, ta, pasteBtn, go,
    h('p', { class: 'muted small' }, 'Tip: you can also screenshot an email and use Scan a receipt.'));
  });
}
