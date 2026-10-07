import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, diffDays, isValidDate } from '../public/js/dates.js';
import { MEALS, UNITS, normName } from './cascade.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SESSION_DAYS = 90;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createLimiter(max = 10, windowMs = 15 * 60 * 1000) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || rec.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    rec.n += 1;
    return rec.n <= max;
  };
}

/**
 * planner: from planner.js. db: for sessions/pantry. password: optional access password (APP_PASSWORD).
 */
export function createApp({ db, planner, recipes, password = '', secureCookies = false, trustProxy = false }) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  const limiter = createLimiter();

  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const api = express.Router();

  // State-changing requests must be JSON (blocks plain cross-site form posts).
  api.use((req, _res, next) => {
    const hasBody = (req.headers['content-length'] && req.headers['content-length'] !== '0') || req.headers['transfer-encoding'];
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && hasBody && !req.is('json')) return next(new HttpError(415, 'JSON required'));
    next();
  });

  // ---- optional password gate ---------------------------------------------
  const authed = (req) => {
    if (!password) return true;
    const token = parseCookies(req.headers.cookie).sid;
    if (!token) return false;
    db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    return !!db.get('SELECT 1 AS ok FROM sessions WHERE token_hash = ? AND expires_at >= ?', sha(token), Date.now());
  };
  const aiInfo = () => ({ enabled: recipes.enabled, demo: !!recipes.demo, model: recipes.model });

  api.get('/me', (req, res) => res.json({ auth_required: !!password, authed: authed(req), ai: aiInfo() }));

  api.post('/login', (req, res) => {
    if (!password) return res.json({ ok: true });
    if (!limiter(req.ip || 'x')) throw new HttpError(429, 'Too many attempts. Try again later.');
    const given = Buffer.from(sha(String(req.body?.password ?? '')));
    const want = Buffer.from(sha(password));
    if (!crypto.timingSafeEqual(given, want)) throw new HttpError(401, 'Wrong password');
    const token = crypto.randomBytes(32).toString('base64url');
    db.run('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)', sha(token), Date.now() + SESSION_DAYS * 86400000);
    res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: secureCookies || undefined, maxAge: SESSION_DAYS * 86400000, path: '/' });
    res.json({ ok: true });
  });

  api.post('/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie).sid;
    if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
    res.clearCookie('sid', { path: '/' });
    res.json({ ok: true });
  });

  api.use((req, _res, next) => (authed(req) ? next() : next(new HttpError(401, 'Please sign in'))));

  // ---- validation helpers --------------------------------------------------
  const dateParam = (v) => {
    if (!isValidDate(v)) throw bad('Invalid date');
    const t = planner.today();
    if (diffDays(t, v) < -14 || diffDays(t, v) > 30) throw bad('That date is outside the planning window');
    return v;
  };
  const mealParam = (v) => {
    if (!MEALS.includes(v)) throw bad('Unknown meal');
    return v;
  };
  const hintOf = (b) => String(b?.hint ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

  // ---- plan ---------------------------------------------------------------
  api.get('/state', (_req, res) => res.json(planner.buildState()));

  api.put('/settings', (req, res) => {
    planner.saveSettings(req.body || {});
    res.json(planner.buildState());
  });

  // Generation is a background job: respond right away, the UI polls /state until slots stop "generating".
  api.post('/days/:date/generate', (req, res) => {
    const date = dateParam(req.params.date);
    const hint = hintOf(req.body);
    for (const meal of planner.settings().meals) {
      const row = planner.slotRow(date, meal);
      if (row?.chosen_idx != null || row?.skipped) continue; // never overwrite a decision from here
      planner.clearError(date, meal);
      planner.generate(date, meal, { hint });
    }
    res.status(202).json(planner.buildState());
  });

  api.post('/slots/:date/:meal/generate', (req, res) => {
    const date = dateParam(req.params.date);
    const meal = mealParam(req.params.meal);
    planner.clearError(date, meal);
    planner.generate(date, meal, { hint: hintOf(req.body) });
    res.status(202).json(planner.buildState());
  });

  api.post('/slots/:date/:meal/choose', (req, res) => {
    const date = dateParam(req.params.date);
    const meal = mealParam(req.params.meal);
    const b = req.body || {};
    planner.choose(date, meal, { idx: b.idx, skip: b.skip === true, clear: b.clear === true });
    res.json(planner.buildState());
  });

  api.post('/notice/dismiss', (_req, res) => { planner.kvDel('notice'); res.json({ ok: true }); });

  // ---- groceries ------------------------------------------------------------
  api.get('/grocery', (req, res) => {
    const t = planner.today();
    const from = req.query.from ? dateParam(String(req.query.from)) : t;
    const to = req.query.to ? dateParam(String(req.query.to)) : addDays(t, 30);
    res.json({ today: t, ...planner.grocery(from, to) });
  });

  // ---- on hand ----------------------------------------------------------------
  api.get('/pantry', (_req, res) => res.json(planner.pantry()));

  api.post('/pantry', (req, res) => {
    const b = req.body || {};
    const name = String(b.name ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
    const amount = Number(b.amount);
    if (!name || !normName(name)) throw bad('Give the item a name');
    if (!UNITS.includes(b.unit)) throw bad('Unit must be g, ml or count');
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e7) throw bad('Enter an amount greater than zero');
    const expires = b.expires_on == null || b.expires_on === '' ? null : b.expires_on;
    if (expires && !isValidDate(expires)) throw bad('Invalid expiry date');
    db.insert('INSERT INTO pantry (name, amount, unit, expires_on, added_on) VALUES (?,?,?,?,?)', name, amount, b.unit, expires, planner.today());
    res.status(201).json(planner.pantry());
  });

  api.delete('/pantry/:id', (req, res) => {
    db.run('DELETE FROM pantry WHERE id = ?', Number(req.params.id));
    res.json(planner.pantry());
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  // ---- static app ------------------------------------------------------------
  app.use(express.static(PUBLIC_DIR, { etag: true, setHeaders: (res, file) => { if (file.endsWith('sw.js')) res.set('Cache-Control', 'no-cache'); } }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong' : err.message });
  });

  return app;
}
