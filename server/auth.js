import crypto from 'node:crypto';

const SESSION_DAYS = 90;
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? rej(e) : res(k))));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: (await scrypt(pw, salt)).toString('hex') };
}

export async function verifyPassword(pw, salt, hash) {
  const got = await scrypt(pw, salt);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function newInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', sha(token), userId, expires);
  return { token, maxAgeMs: SESSION_DAYS * 86400000 };
}

export function destroySession(db, token) {
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
}

export function userForToken(db, token) {
  if (!token) return null;
  db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  return db.get(
    `SELECT u.id, u.name, u.household_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at >= ?`, sha(token), Date.now()) || null;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Tiny in-memory limiter for login/join attempts. */
export function createLimiter(max = 10, windowMs = 15 * 60 * 1000) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || rec.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    rec.n += 1;
    return rec.n <= max;
  };
}
