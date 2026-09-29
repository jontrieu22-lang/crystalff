// Postgres access. Production uses Neon (DATABASE_URL, set by the Vercel
// Marketplace integration); dev.js and tests inject a PGlite adapter instead.
let adapter;
let ready;

export function setAdapter(a) { adapter = a; ready = undefined; }

const ROSTER = ['James', 'Ethan', 'Reilly', 'Josh', 'JT', 'Sam', 'Keane', 'Alex', 'Eric', 'Nicky', 'Partha', 'Aidan'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS legs (
  id SERIAL PRIMARY KEY,
  week INT NOT NULL,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  game TEXT NOT NULL,
  label TEXT NOT NULL,          -- e.g. "Anytime TD: Josh Allen"
  side TEXT NOT NULL CHECK (side IN ('yes','no')),
  price INT NOT NULL,           -- Kalshi cents for the chosen side when picked
  outcome TEXT,                 -- Kalshi result: 'yes' | 'no' | 'void'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (week, player_id),
  UNIQUE (week, ticker)
);
CREATE TABLE IF NOT EXISTS weeks (
  week INT PRIMARY KEY,
  placer TEXT,
  actual_odds TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

async function connect() {
  if (!adapter) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    adapter = { query: (text, params) => sql.query(text, params), exec: (text) => Promise.all(text.split(';').filter((s) => s.trim()).map((s) => sql.query(s))) };
  }
  await adapter.exec(SCHEMA);
  const [{ n }] = await adapter.query('SELECT count(*)::int AS n FROM players', []);
  if (n === 0) for (const name of ROSTER) await adapter.query('INSERT INTO players (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
}

export async function q(text, params = []) {
  ready ??= connect().catch((e) => { ready = undefined; throw e; });
  await ready;
  return adapter.query(text, params);
}

export async function cached(key, ttlSec, load) {
  const [row] = await q(`SELECT value FROM cache WHERE key = $1 AND updated_at > now() - make_interval(secs => $2::int)`, [key, ttlSec]);
  if (row) return row.value;
  const value = await load();
  await q(`INSERT INTO cache (key, value, updated_at) VALUES ($1, $2::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
  return value;
}
