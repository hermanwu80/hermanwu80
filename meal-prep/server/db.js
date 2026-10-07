import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- One row per (day, meal): the three generated options, and which one was picked.
CREATE TABLE IF NOT EXISTS slots (
  date TEXT NOT NULL,
  meal TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  chosen_idx INTEGER,
  skipped INTEGER NOT NULL DEFAULT 0,
  hint TEXT NOT NULL DEFAULT '',
  generated_at TEXT,
  PRIMARY KEY (date, meal)
);
-- What's already at home. Seed for the future pantry/fridge feature (expiry reminders, auto-decrement).
CREATE TABLE IF NOT EXISTS pantry (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  unit TEXT NOT NULL,
  expires_on TEXT,
  added_on TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
`;

/** Thin wrapper over node:sqlite with the handful of helpers the app needs. */
export function openDb(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  raw.exec(SCHEMA);
  const stmts = new Map();
  const prep = (sql) => {
    let s = stmts.get(sql);
    if (!s) stmts.set(sql, (s = raw.prepare(sql)));
    return s;
  };
  return {
    raw,
    all: (sql, ...p) => prep(sql).all(...p),
    get: (sql, ...p) => prep(sql).get(...p),
    run: (sql, ...p) => prep(sql).run(...p),
    insert: (sql, ...p) => Number(prep(sql).run(...p).lastInsertRowid),
    close: () => raw.close(),
  };
}
