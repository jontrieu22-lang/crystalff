# Crystal FF 🔮

A small collaborative site for a friends' tournament: each day, everyone picks YES/NO on
[Kalshi](https://kalshi.com) markets, and the site scores who monitors the situation best.

## Run

```
ADMIN_KEY=secret JOIN_CODE=friends npm start   # Node >= 22.13, no dependencies
```

- `ADMIN_KEY` – needed to create days / manually settle (required for hosting).
- `JOIN_CODE` – optional shared code players must enter to join.
- `PORT`, `DB_FILE` (SQLite, default `crystalff.db`), `KALSHI_BASE` (default public Kalshi API).

## How it works

- The host opens the site → **Host tools** → creates a day with an optional lock time.
- Players join by name, paste a Kalshi market URL/ticker, and pick YES or NO. Entry price is
  snapshotted from Kalshi at pick time (buy YES at the ask, NO at 100 − yes bid).
- Other players' picks stay hidden until the lock time, so nobody copies.
- Settlement is automatic from Kalshi's market `result` whenever the day is viewed.
  `POST /api/settle {ticker, result}` with `x-admin-key` overrides it.
- **Score** = paper P&L on a $1 contract: right = `100 − entry`, wrong = `−entry`.
  Long shots that hit are worth more than favorites.

## Test

`npm test` runs an end-to-end smoke test against a mock Kalshi server.

Note: the Kalshi API integration (`kalshi.js`) was written from memory of the public
`GET /trade-api/v2/markets/{ticker}` endpoint; verify it against a real ticker once deployed.
