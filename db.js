import { DatabaseSync } from 'node:sqlite';

export function openDb(file = process.env.DB_FILE || 'crystalff.db') {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      token TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS days (
      id INTEGER PRIMARY KEY, date TEXT NOT NULL UNIQUE, title TEXT,
      locks_at TEXT,  -- ISO time; picks rejected afterwards
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS picks (
      id INTEGER PRIMARY KEY,
      day_id INTEGER NOT NULL REFERENCES days(id),
      player_id INTEGER NOT NULL REFERENCES players(id),
      ticker TEXT NOT NULL, title TEXT, side TEXT NOT NULL CHECK (side IN ('yes','no')),
      entry_price INTEGER NOT NULL,     -- cents paid for the chosen side
      note TEXT, result TEXT,           -- 'yes' | 'no' once settled
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (day_id, player_id, ticker)
    );
  `);
  return db;
}

// Paper P&L in points: a $1 contract bought at `entry` cents pays 100 if right.
export function pickScore(p) {
  if (!p.result) return null;
  return p.result === p.side ? 100 - p.entry_price : -p.entry_price;
}
