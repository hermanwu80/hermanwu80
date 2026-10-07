import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashPassword, verifyPassword, newInviteCode, createSession, destroySession, userForToken, parseCookies, createLimiter,
} from './auth.js';
import { validateSchedule, occurrences } from './schedule.js';
import { weekSummary, insights } from './summary.js';
import { seedHousehold, seedMinimal } from './seed.js';
import { addDays, isValidDate, todayIn, weekStart, dowName } from '../public/js/dates.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIMES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = () => new HttpError(404, 'Not found');

const str = (v, max = 100) => String(v ?? '').trim().slice(0, max);
const cents = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1e10) throw bad('Invalid amount');
  return n;
};
const optId = (v) => (v == null || v === '' ? null : Number(v));
const optDate = (v) => (v == null || v === '' ? null : isValidDate(v) ? v : (() => { throw bad('Invalid date'); })());

export const merchantKey = (m) => String(m || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();

export function createApp({ db, ai, dataDir, secureCookies = false, trustProxy = false }) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  const receiptDir = dataDir ? path.join(dataDir, 'receipts') : null;
  if (receiptDir) fs.mkdirSync(receiptDir, { recursive: true });
  const limiter = createLimiter();

  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    next();
  });
  app.use(express.json({ limit: '25mb' }));

  // ---- helpers -------------------------------------------------------------
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const hhOf = (id) => db.get('SELECT * FROM households WHERE id = ?', id);
  const todayFor = (hh) => todayIn(hh.tz);
  const owned = (table, id, hhId) => {
    if (id == null) return null;
    const row = db.get(`SELECT * FROM ${table} WHERE id = ? AND household_id = ?`, id, hhId);
    if (!row) throw bad(`Unknown ${table.replace(/s$/, '')}`);
    return row;
  };
  const setCookie = (res, token, maxAgeMs) =>
    res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: secureCookies || undefined, maxAge: maxAgeMs, path: '/' });

  function auth(req, _res, next) {
    const user = userForToken(db, parseCookies(req.headers.cookie).sid);
    if (!user) return next(new HttpError(401, 'Please sign in'));
    req.user = user;
    req.hh = hhOf(user.household_id);
    next();
  }
  const api = express.Router();
  const secured = express.Router();
  secured.use(auth);

  // State-changing requests must be JSON (blocks plain cross-site form posts).
  api.use((req, _res, next) => {
    const hasBody = (req.headers['content-length'] && req.headers['content-length'] !== '0') || req.headers['transfer-encoding'];
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && hasBody && !req.is('json')) {
      return next(new HttpError(415, 'JSON required'));
    }
    next();
  });

  // ---- auth ----------------------------------------------------------------
  const memberList = (hhId) => db.all('SELECT id, name FROM users WHERE household_id = ? ORDER BY id', hhId);

  api.get('/me', (req, res) => {
    const user = userForToken(db, parseCookies(req.headers.cookie).sid);
    if (!user) {
      const hasHousehold = !!db.get('SELECT id FROM households LIMIT 1');
      return res.json({ user: null, needs_setup: !hasHousehold });
    }
    const hh = hhOf(user.household_id);
    res.json({ user: { id: user.id, name: user.name }, household: publicHousehold(hh), ai: { enabled: ai.enabled, model: ai.model } });
  });

  const publicHousehold = (hh) => ({
    id: hh.id, name: hh.name, week_start: hh.week_start, tz: hh.tz, invite_code: hh.invite_code,
    members: memberList(hh.id), today: todayFor(hh),
  });

  api.post('/setup', wrap(async (req, res) => {
    if (db.get('SELECT id FROM households LIMIT 1')) throw new HttpError(403, 'This app is already set up. Ask for an invite code to join.');
    if (!limiter(`setup:${req.ip}`)) throw new HttpError(429, 'Too many attempts');
    const { household, name, password, tz, starter } = req.body || {};
    if (str(name).length < 1) throw bad('Enter your name');
    if (String(password || '').length < 8) throw bad('Password must be at least 8 characters');
    const zone = (() => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'America/New_York'; } })();
    const { salt, hash } = await hashPassword(password);
    const userId = db.tx(() => {
      const hhId = db.insert('INSERT INTO households (name, invite_code, tz) VALUES (?,?,?)', str(household, 60) || 'Our household', newInviteCode(), zone);
      const hh = hhOf(hhId);
      if (starter === false) seedMinimal(db, hh); else seedHousehold(db, hh, todayFor(hh));
      return db.insert('INSERT INTO users (household_id, name, pw_salt, pw_hash) VALUES (?,?,?,?)', hhId, str(name, 40), salt, hash);
    });
    const s = createSession(db, userId);
    setCookie(res, s.token, s.maxAgeMs);
    res.status(201).json({ ok: true });
  }));

  api.post('/join', wrap(async (req, res) => {
    if (!limiter(`join:${req.ip}`)) throw new HttpError(429, 'Too many attempts. Try again later.');
    const { invite_code, name, password } = req.body || {};
    const hh = db.get('SELECT * FROM households WHERE invite_code = ?', str(invite_code, 20).toUpperCase());
    if (!hh) throw bad('That invite code is not valid');
    if (str(name).length < 1) throw bad('Enter your name');
    if (String(password || '').length < 8) throw bad('Password must be at least 8 characters');
    if (db.get('SELECT id FROM users WHERE household_id = ? AND name = ?', hh.id, str(name, 40))) throw bad('That name is taken');
    if (memberList(hh.id).length >= 4) throw bad('This household is full');
    const { salt, hash } = await hashPassword(password);
    const userId = db.insert('INSERT INTO users (household_id, name, pw_salt, pw_hash) VALUES (?,?,?,?)', hh.id, str(name, 40), salt, hash);
    const s = createSession(db, userId);
    setCookie(res, s.token, s.maxAgeMs);
    res.status(201).json({ ok: true });
  }));

  api.post('/login', wrap(async (req, res) => {
    if (!limiter(`login:${req.ip}`)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    const { name, password } = req.body || {};
    const user = db.get('SELECT * FROM users WHERE name = ?', str(name, 40));
    // Always burn one scrypt so a wrong name costs the same as a wrong password.
    const ok = user ? await verifyPassword(String(password || ''), user.pw_salt, user.pw_hash) : (await hashPassword('x'), false);
    if (!ok) throw new HttpError(401, 'Wrong name or password');
    const s = createSession(db, user.id);
    setCookie(res, s.token, s.maxAgeMs);
    res.json({ ok: true });
  }));

  api.post('/logout', (req, res) => {
    destroySession(db, parseCookies(req.headers.cookie).sid);
    res.clearCookie('sid', { path: '/' });
    res.json({ ok: true });
  });

  // ---- household -----------------------------------------------------------
  secured.get('/household', (req, res) => res.json(publicHousehold(req.hh)));

  secured.patch('/household', (req, res) => {
    const b = req.body || {};
    const name = b.name != null ? str(b.name, 60) || req.hh.name : req.hh.name;
    const ws = b.week_start != null ? Number(b.week_start) : req.hh.week_start;
    if (![0, 1, 6].includes(ws)) throw bad('Weeks can start on Sunday, Monday or Saturday');
    let tz = req.hh.tz;
    if (b.tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: b.tz }); tz = b.tz; } catch { throw bad('Unknown timezone'); } }
    db.run('UPDATE households SET name = ?, week_start = ?, tz = ? WHERE id = ?', name, ws, tz, req.hh.id);
    res.json(publicHousehold(hhOf(req.hh.id)));
  });

  secured.post('/household/invite', (req, res) => {
    db.run('UPDATE households SET invite_code = ? WHERE id = ?', newInviteCode(), req.hh.id);
    res.json(publicHousehold(hhOf(req.hh.id)));
  });

  // ---- categories & accounts ----------------------------------------------
  const listActive = (table) => (req, res) =>
    res.json(db.all(`SELECT * FROM ${table} WHERE household_id = ? AND archived = 0 ORDER BY sort, id`, req.hh.id));

  secured.get('/categories', listActive('categories'));
  secured.post('/categories', (req, res) => {
    const b = req.body || {};
    if (!str(b.name)) throw bad('Name is required');
    const sort = (db.get('SELECT COALESCE(MAX(sort),0)+1 AS n FROM categories WHERE household_id = ?', req.hh.id)).n;
    const id = db.insert('INSERT INTO categories (household_id, name, emoji, weekly_budget_cents, sort) VALUES (?,?,?,?,?)',
      req.hh.id, str(b.name, 40), str(b.emoji, 8) || '🏷️', cents(b.weekly_budget_cents ?? 0), sort);
    res.status(201).json(db.get('SELECT * FROM categories WHERE id = ?', id));
  });
  secured.patch('/categories/:id', (req, res) => {
    const cur = owned('categories', Number(req.params.id), req.hh.id);
    const b = req.body || {};
    db.run('UPDATE categories SET name = ?, emoji = ?, weekly_budget_cents = ? WHERE id = ?',
      str(b.name ?? cur.name, 40) || cur.name, str(b.emoji ?? cur.emoji, 8) || cur.emoji, b.weekly_budget_cents != null ? cents(b.weekly_budget_cents) : cur.weekly_budget_cents, cur.id);
    res.json(db.get('SELECT * FROM categories WHERE id = ?', cur.id));
  });
  secured.delete('/categories/:id', (req, res) => {
    const cur = owned('categories', Number(req.params.id), req.hh.id);
    const used = db.get('SELECT (SELECT COUNT(*) FROM transactions WHERE category_id = ?) + (SELECT COUNT(*) FROM bills WHERE category_id = ?) AS n', cur.id, cur.id).n;
    if (used) db.run('UPDATE categories SET archived = 1 WHERE id = ?', cur.id);
    else db.run('DELETE FROM categories WHERE id = ?', cur.id);
    db.run('DELETE FROM merchant_rules WHERE category_id = ?', cur.id);
    res.json({ ok: true });
  });

  secured.get('/accounts', listActive('accounts'));
  secured.post('/accounts', (req, res) => {
    const b = req.body || {};
    if (!str(b.name)) throw bad('Name is required');
    const kind = ['checking', 'credit', 'cash'].includes(b.kind) ? b.kind : 'checking';
    const sort = (db.get('SELECT COALESCE(MAX(sort),0)+1 AS n FROM accounts WHERE household_id = ?', req.hh.id)).n;
    const id = db.insert('INSERT INTO accounts (household_id, name, kind, sort) VALUES (?,?,?,?)', req.hh.id, str(b.name, 40), kind, sort);
    res.status(201).json(db.get('SELECT * FROM accounts WHERE id = ?', id));
  });
  secured.patch('/accounts/:id', (req, res) => {
    const cur = owned('accounts', Number(req.params.id), req.hh.id);
    const b = req.body || {};
    const kind = ['checking', 'credit', 'cash'].includes(b.kind) ? b.kind : cur.kind;
    db.run('UPDATE accounts SET name = ?, kind = ? WHERE id = ?', str(b.name ?? cur.name, 40) || cur.name, kind, cur.id);
    res.json(db.get('SELECT * FROM accounts WHERE id = ?', cur.id));
  });
  secured.delete('/accounts/:id', (req, res) => {
    const cur = owned('accounts', Number(req.params.id), req.hh.id);
    db.run('UPDATE accounts SET archived = 1 WHERE id = ?', cur.id);
    res.json({ ok: true });
  });

  // ---- recurring bills & income -------------------------------------------
  const parsePlan = (r) => ({ ...r, schedule: JSON.parse(r.schedule) });
  const planRoutes = (table, extra) => {
    const read = (hhId) => db.all(`SELECT * FROM ${table} WHERE household_id = ? ORDER BY name`, hhId).map(parsePlan);
    secured.get(`/${table === 'bills' ? 'bills' : 'income'}`, (req, res) => {
      const today = todayFor(req.hh);
      const rows = read(req.hh.id).filter((r) => !r.ends_on || r.ends_on >= today);
      res.json(rows.map((r) => ({ ...r, next: occurrences(r.schedule, today < (r.starts_on || '') ? r.starts_on : today, addDays(today, 400))[0] || null })));
    });
    const path_ = `/${table === 'bills' ? 'bills' : 'income'}`;
    const fields = (b, cur = {}) => {
      if (!str(b.name ?? cur.name)) throw bad('Name is required');
      return {
        name: str(b.name ?? cur.name, 60),
        amount_cents: b.amount_cents != null ? cents(b.amount_cents) : cur.amount_cents ?? 0,
        schedule: JSON.stringify(b.schedule ? validateSchedule(b.schedule) : cur.schedule ? cur.schedule : (() => { throw bad('Schedule is required'); })()),
        starts_on: b.starts_on !== undefined ? optDate(b.starts_on) : cur.starts_on ?? null,
        ends_on: b.ends_on !== undefined ? optDate(b.ends_on) : cur.ends_on ?? null,
        account_id: b.account_id !== undefined ? optId(b.account_id) : cur.account_id ?? null,
        ...extra.fields(b, cur),
      };
    };
    secured.post(path_, (req, res) => {
      const f = fields(req.body || {});
      if (f.account_id) owned('accounts', f.account_id, req.hh.id);
      extra.check(f, req.hh.id);
      const cols = Object.keys(f);
      const id = db.insert(`INSERT INTO ${table} (household_id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`, req.hh.id, ...cols.map((c) => f[c]));
      res.status(201).json(parsePlan(db.get(`SELECT * FROM ${table} WHERE id = ?`, id)));
    });
    secured.patch(`${path_}/:id`, (req, res) => {
      const cur = parsePlan(owned(table, Number(req.params.id), req.hh.id));
      const f = fields(req.body || {}, cur);
      if (f.account_id) owned('accounts', f.account_id, req.hh.id);
      extra.check(f, req.hh.id);
      const cols = Object.keys(f);
      db.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => f[c]), cur.id);
      res.json(parsePlan(db.get(`SELECT * FROM ${table} WHERE id = ?`, cur.id)));
    });
    // "Delete" stops the plan from today on but keeps history intact.
    secured.delete(`${path_}/:id`, (req, res) => {
      const cur = owned(table, Number(req.params.id), req.hh.id);
      const hasHistory = db.get(`SELECT COUNT(*) AS n FROM transactions WHERE ${table === 'bills' ? 'bill_id' : 'income_source_id'} = ?`, cur.id).n;
      if (hasHistory) db.run(`UPDATE ${table} SET ends_on = ? WHERE id = ?`, addDays(todayFor(req.hh), -1), cur.id);
      else { db.run(`DELETE FROM ${table} WHERE id = ?`, cur.id); db.run('DELETE FROM bill_skips WHERE bill_id = ?', cur.id); }
      res.json({ ok: true });
    });
  };
  planRoutes('bills', {
    fields: (b, cur) => ({ category_id: b.category_id !== undefined ? optId(b.category_id) : cur.category_id ?? null }),
    check: (f, hhId) => { if (f.category_id) owned('categories', f.category_id, hhId); },
  });
  planRoutes('income_sources', {
    fields: (b, cur) => ({ user_id: b.user_id !== undefined ? optId(b.user_id) : cur.user_id ?? null }),
    check: (f, hhId) => { if (f.user_id) owned('users', f.user_id, hhId); },
  });

  secured.post('/bills/:id/skip', (req, res) => {
    const bill = owned('bills', Number(req.params.id), req.hh.id);
    if (!isValidDate(req.body?.due)) throw bad('Invalid date');
    db.run('INSERT OR IGNORE INTO bill_skips (bill_id, due_date) VALUES (?,?)', bill.id, req.body.due);
    res.json({ ok: true });
  });
  secured.delete('/bills/:id/skip', (req, res) => {
    const bill = owned('bills', Number(req.params.id), req.hh.id);
    db.run('DELETE FROM bill_skips WHERE bill_id = ? AND due_date = ?', bill.id, String(req.query.due));
    res.json({ ok: true });
  });

  // ---- transactions ----------------------------------------------------------
  const TXN_COLS = ['kind', 'date', 'amount_cents', 'merchant', 'note', 'category_id', 'account_id', 'bill_id', 'income_source_id', 'plan_date', 'source'];

  function txnFields(b, hh, cur = null) {
    const f = {
      kind: b.kind !== undefined ? (b.kind === 'income' ? 'income' : 'expense') : cur?.kind ?? 'expense',
      date: b.date !== undefined ? (isValidDate(b.date) ? b.date : (() => { throw bad('Invalid date'); })()) : cur?.date ?? todayFor(hh),
      amount_cents: b.amount_cents !== undefined ? cents(b.amount_cents) : cur?.amount_cents,
      merchant: b.merchant !== undefined ? str(b.merchant, 80) : cur?.merchant ?? '',
      note: b.note !== undefined ? str(b.note, 300) : cur?.note ?? '',
      category_id: b.category_id !== undefined ? optId(b.category_id) : cur?.category_id ?? null,
      account_id: b.account_id !== undefined ? optId(b.account_id) : cur?.account_id ?? null,
      bill_id: b.bill_id !== undefined ? optId(b.bill_id) : cur?.bill_id ?? null,
      income_source_id: b.income_source_id !== undefined ? optId(b.income_source_id) : cur?.income_source_id ?? null,
      plan_date: b.plan_date !== undefined ? optDate(b.plan_date) : cur?.plan_date ?? null,
      source: ['manual', 'scan', 'text', 'plan'].includes(b.source) ? b.source : cur?.source ?? 'manual',
    };
    if (f.amount_cents == null) throw bad('Amount is required');
    if (f.category_id) owned('categories', f.category_id, hh.id);
    if (f.account_id) owned('accounts', f.account_id, hh.id);
    if (f.bill_id) owned('bills', f.bill_id, hh.id);
    if (f.income_source_id) owned('income_sources', f.income_source_id, hh.id);
    if ((f.bill_id || f.income_source_id) && !f.plan_date) f.plan_date = f.date;
    return f;
  }

  function learnMerchant(hhId, f) {
    const key = merchantKey(f.merchant);
    if (!key || !f.category_id || f.kind !== 'expense' || f.bill_id) return;
    db.run(`INSERT INTO merchant_rules (household_id, merchant_key, category_id, account_id) VALUES (?,?,?,?)
            ON CONFLICT (household_id, merchant_key) DO UPDATE SET category_id = excluded.category_id, account_id = excluded.account_id`,
      hhId, key, f.category_id, f.account_id);
  }

  function attachReceipt(hhId, receiptId, txnId) {
    if (!receiptId) return null;
    const r = db.get('SELECT id FROM receipts WHERE id = ? AND household_id = ?', String(receiptId), hhId);
    if (!r) return null;
    db.run('UPDATE receipts SET txn_id = ? WHERE id = ?', txnId, r.id);
    db.run('UPDATE transactions SET receipt_id = ? WHERE id = ?', r.id, txnId);
    return r.id;
  }

  secured.get('/transactions', (req, res) => {
    const from = isValidDate(req.query.from) ? req.query.from : '0000-01-01';
    const to = isValidDate(req.query.to) ? req.query.to : '9999-12-31';
    const rows = db.all('SELECT * FROM transactions WHERE household_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC, id DESC LIMIT 1000', req.hh.id, from, to);
    res.json(rows);
  });

  secured.post('/transactions', (req, res) => {
    const f = txnFields(req.body || {}, req.hh);
    if (f.bill_id && db.get('SELECT 1 AS x FROM transactions WHERE bill_id = ? AND plan_date = ?', f.bill_id, f.plan_date)) throw bad('That bill is already marked paid');
    if (f.income_source_id && db.get('SELECT 1 AS x FROM transactions WHERE income_source_id = ? AND plan_date = ?', f.income_source_id, f.plan_date)) throw bad('That payday is already recorded');
    const id = db.tx(() => {
      const cols = TXN_COLS;
      const id = db.insert(`INSERT INTO transactions (household_id, user_id, ${cols.join(',')}) VALUES (?, ?, ${cols.map(() => '?').join(',')})`,
        req.hh.id, req.user.id, ...cols.map((c) => f[c]));
      attachReceipt(req.hh.id, req.body.receipt_id, id);
      learnMerchant(req.hh.id, f);
      return id;
    });
    res.status(201).json(db.get('SELECT * FROM transactions WHERE id = ?', id));
  });

  secured.patch('/transactions/:id', (req, res) => {
    const cur = owned('transactions', Number(req.params.id), req.hh.id);
    const f = txnFields(req.body || {}, req.hh, cur);
    const cols = TXN_COLS;
    db.tx(() => {
      db.run(`UPDATE transactions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => f[c]), cur.id);
      learnMerchant(req.hh.id, f);
    });
    res.json(db.get('SELECT * FROM transactions WHERE id = ?', cur.id));
  });

  secured.delete('/transactions/:id', (req, res) => {
    const cur = owned('transactions', Number(req.params.id), req.hh.id);
    db.tx(() => {
      db.run('DELETE FROM transactions WHERE id = ?', cur.id);
      if (cur.receipt_id) { removeReceiptFile(cur.receipt_id); db.run('DELETE FROM receipts WHERE id = ?', cur.receipt_id); }
    });
    res.json({ ok: true });
  });

  // ---- receipts -------------------------------------------------------------
  const receiptPath = (id, mime) => path.join(receiptDir, `${id}.${MIMES[mime]}`);
  function removeReceiptFile(id) {
    const r = db.get('SELECT mime FROM receipts WHERE id = ?', id);
    if (r && receiptDir) fs.rmSync(receiptPath(id, r.mime), { force: true });
  }
  function saveReceipt(hhId, mime, buf) {
    if (!receiptDir) return null;
    const id = crypto.randomUUID();
    fs.writeFileSync(receiptPath(id, mime), buf);
    db.run('INSERT INTO receipts (id, household_id, mime, created_at) VALUES (?,?,?,?)', id, hhId, mime, Date.now());
    return id;
  }
  // Drop uploads that never got attached to a transaction.
  const pruneReceipts = () => {
    for (const r of db.all('SELECT id FROM receipts WHERE txn_id IS NULL AND created_at < ?', Date.now() - 86400000)) {
      removeReceiptFile(r.id);
      db.run('DELETE FROM receipts WHERE id = ?', r.id);
    }
  };
  pruneReceipts();

  secured.get('/receipts/:id', (req, res) => {
    const r = db.get('SELECT * FROM receipts WHERE id = ? AND household_id = ?', req.params.id, req.hh.id);
    if (!r || !receiptDir) throw notFound();
    res.set('Cache-Control', 'private, max-age=86400').type(r.mime).sendFile(receiptPath(r.id, r.mime));
  });

  // ---- week view, insights, export ----------------------------------------
  secured.get('/week', (req, res) => {
    const today = todayFor(req.hh);
    const date = isValidDate(req.query.date) ? req.query.date : today;
    res.json(weekSummary(db, req.hh, date, today));
  });

  secured.get('/insights', (req, res) => res.json(insights(db, req.hh, todayFor(req.hh))));

  secured.post('/income/:id/receive', (req, res) => {
    const src = owned('income_sources', Number(req.params.id), req.hh.id);
    const b = req.body || {};
    if (!isValidDate(b.plan_date)) throw bad('Invalid date');
    if (db.get('SELECT 1 AS x FROM transactions WHERE income_source_id = ? AND plan_date = ?', src.id, b.plan_date)) throw bad('Already recorded');
    const id = db.insert(
      `INSERT INTO transactions (household_id, user_id, kind, date, amount_cents, merchant, account_id, income_source_id, plan_date, source)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      req.hh.id, req.user.id, 'income', isValidDate(b.date) ? b.date : todayFor(req.hh), cents(b.amount_cents ?? src.amount_cents), src.name,
      src.account_id, src.id, b.plan_date, 'plan');
    res.status(201).json(db.get('SELECT * FROM transactions WHERE id = ?', id));
  });

  secured.post('/bills/:id/pay', (req, res) => {
    const bill = owned('bills', Number(req.params.id), req.hh.id);
    const b = req.body || {};
    if (!isValidDate(b.due)) throw bad('Invalid date');
    if (db.get('SELECT 1 AS x FROM transactions WHERE bill_id = ? AND plan_date = ?', bill.id, b.due)) throw bad('Already marked paid');
    const account = b.account_id !== undefined ? optId(b.account_id) : bill.account_id;
    if (account) owned('accounts', account, req.hh.id);
    db.run('DELETE FROM bill_skips WHERE bill_id = ? AND due_date = ?', bill.id, b.due);
    const id = db.insert(
      `INSERT INTO transactions (household_id, user_id, kind, date, amount_cents, merchant, category_id, account_id, bill_id, plan_date, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      req.hh.id, req.user.id, 'expense', isValidDate(b.date) ? b.date : todayFor(req.hh), cents(b.amount_cents ?? bill.amount_cents), bill.name,
      bill.category_id, account, bill.id, b.due, 'plan');
    res.status(201).json(db.get('SELECT * FROM transactions WHERE id = ?', id));
  });

  secured.get('/export.csv', (req, res) => {
    const rows = db.all(
      `SELECT t.date, t.kind, t.amount_cents, t.merchant, t.note, c.name AS category, a.name AS account, u.name AS who
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN users u ON u.id = t.user_id
       WHERE t.household_id = ? ORDER BY t.date, t.id`, req.hh.id);
    const esc = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = ['date,type,amount,merchant,note,category,account,entered_by'];
    for (const r of rows) lines.push([r.date, r.kind, (r.amount_cents / 100).toFixed(2), r.merchant, r.note, r.category, r.account, r.who].map(esc).join(','));
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="budget.csv"').send(lines.join('\n'));
  });

  // ---- AI --------------------------------------------------------------------
  secured.post('/ai/parse', wrap(async (req, res) => {
    const { images = [], text = '' } = req.body || {};
    if (!Array.isArray(images) || images.length > 6) throw bad('Up to 6 images at a time');
    if (!images.length && !str(text, 20000)) throw bad('Add a photo, PDF or some text');
    const files = [];
    let receipt_id = null;
    for (const [i, img] of images.entries()) {
      const mime = String(img?.mime || '');
      if (!MIMES[mime]) throw bad('Unsupported file type. Use JPG, PNG, WebP or PDF.');
      const b64 = String(img.base64 || '');
      if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length > 14e6) throw bad('That file is too large or corrupted');
      files.push({ mime, base64: b64 });
      if (i === 0) receipt_id = saveReceipt(req.hh.id, mime, Buffer.from(b64, 'base64'));
    }
    const ctx = {
      today: todayFor(req.hh),
      categories: db.all('SELECT id, name FROM categories WHERE household_id = ? AND archived = 0 ORDER BY sort', req.hh.id),
      accounts: db.all('SELECT id, name, kind FROM accounts WHERE household_id = ? AND archived = 0 ORDER BY sort', req.hh.id),
      bills: db.all('SELECT id, name, amount_cents, category_id, schedule, starts_on, ends_on FROM bills WHERE household_id = ?', req.hh.id)
        .filter((b) => !b.ends_on || b.ends_on >= todayFor(req.hh)),
      rules: db.all(
        `SELECT r.merchant_key AS merchant, c.name AS category FROM merchant_rules r JOIN categories c ON c.id = r.category_id
         WHERE r.household_id = ? ORDER BY r.rowid DESC LIMIT 150`, req.hh.id),
    };
    const draft = await ai.parseReceipt({ files, text: str(text, 20000), ctx });
    // A rule the household taught us beats the model's guess.
    const rule = db.get('SELECT category_id, account_id FROM merchant_rules WHERE household_id = ? AND merchant_key = ?', req.hh.id, merchantKey(draft.merchant));
    if (rule && !draft.bill_id) {
      draft.category_id = rule.category_id;
      if (!draft.account_id && rule.account_id) draft.account_id = rule.account_id;
      draft.from_rule = true;
    }
    if (draft.bill_id) {
      const bill = ctx.bills.find((b) => b.id === draft.bill_id);
      const date = draft.date || ctx.today;
      const due = nearestDue(bill, date);
      if (due) draft.plan_date = due;
    }
    draft.date = draft.date || ctx.today;
    draft.receipt_id = receipt_id;
    draft.source = files.length ? 'scan' : 'text';
    res.json(draft);
  }));

  /** The occurrence of a bill closest to `date` (within 20 days) that isn't already paid. */
  function nearestDue(bill, date) {
    const spec = JSON.parse(bill.schedule);
    const cands = occurrences(spec, addDays(date, -20), addDays(date, 20))
      .filter((d) => !db.get('SELECT 1 AS x FROM transactions WHERE bill_id = ? AND plan_date = ?', bill.id, d))
      .filter((d) => (!bill.starts_on || d >= bill.starts_on) && (!bill.ends_on || d <= bill.ends_on));
    cands.sort((a, b) => Math.abs(Date.parse(a) - Date.parse(date)) - Math.abs(Date.parse(b) - Date.parse(date)));
    return cands[0] || null;
  }

  secured.post('/ai/ask', wrap(async (req, res) => {
    const question = str(req.body?.question, 1000);
    if (!question) throw bad('Ask a question');
    const hh = req.hh;
    const today = todayFor(hh);
    const ins = insights(db, hh, today);
    const week = weekSummary(db, hh, today, today);
    const data = {
      today,
      week_start_name: dowName(hh.week_start),
      week_end_name: dowName((hh.week_start + 6) % 7),
      this_week: {
        start: week.start, end: week.end, totals: week.totals,
        categories: week.categories.map(({ name, planned_cents, spent_cents, projected_cents }) => ({ name, planned_cents, spent_cents, projected_cents })),
        bills: week.bills.map(({ name, due, expected_cents, status }) => ({ name, due, expected_cents, status })),
        paydays: week.income.map(({ name, date, expected_cents, status }) => ({ name, date, expected_cents, status })),
      },
      last_8_weeks: ins.weeks,
      last_4_weeks_by_category: ins.categories.map(({ name, spent_cents, planned_cents }) => ({ name, spent_cents, planned_cents })),
      recent_transactions: db.all(
        `SELECT t.date, t.merchant, t.amount_cents, t.kind, c.name AS category FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.household_id = ? ORDER BY t.date DESC, t.id DESC LIMIT 60`, hh.id),
    };
    const answer = await ai.answer({ question, history: Array.isArray(req.body?.history) ? req.body.history : [], data });
    res.json({ answer });
  }));

  api.use(secured);
  api.use((_req, _res, next) => next(notFound()));
  app.use('/api', api);

  // ---- static PWA ------------------------------------------------------------
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], setHeaders: (res, p) => { if (p.endsWith('sw.js')) res.set('Cache-Control', 'no-cache'); } }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') err = new HttpError(413, 'That upload is too large');
    if (err instanceof SyntaxError && 'body' in err) err = bad('Invalid JSON');
    const status = err.status && err.status < 600 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong' : err.message });
  });

  return app;
}
