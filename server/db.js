import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS households (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL,
  week_start INTEGER NOT NULL DEFAULT 0,
  tz TEXT NOT NULL DEFAULT 'America/New_York',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (household_id, name)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'checking',
  archived INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🏷️',
  weekly_budget_cents INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  category_id INTEGER,
  account_id INTEGER,
  schedule TEXT NOT NULL,
  starts_on TEXT,
  ends_on TEXT
);
CREATE TABLE IF NOT EXISTS income_sources (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  user_id INTEGER,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  account_id INTEGER,
  schedule TEXT NOT NULL,
  starts_on TEXT,
  ends_on TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL,
  user_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'expense',
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  merchant TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  category_id INTEGER,
  account_id INTEGER,
  bill_id INTEGER,
  income_source_id INTEGER,
  plan_date TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  receipt_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions (household_id, date);
CREATE INDEX IF NOT EXISTS idx_txn_plan ON transactions (household_id, plan_date);
CREATE TABLE IF NOT EXISTS bill_skips (
  bill_id INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  PRIMARY KEY (bill_id, due_date)
);
CREATE TABLE IF NOT EXISTS merchant_rules (
  household_id INTEGER NOT NULL,
  merchant_key TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  account_id INTEGER,
  PRIMARY KEY (household_id, merchant_key)
);
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  household_id INTEGER NOT NULL,
  mime TEXT NOT NULL,
  txn_id INTEGER,
  created_at INTEGER NOT NULL
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
    tx(fn) {
      raw.exec('BEGIN');
      try {
        const r = fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => raw.close(),
  };
}
