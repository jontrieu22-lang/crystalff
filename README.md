# Loser of the Week 🏈

The group's weekly parlay, replacing the spreadsheet. Everyone taps their name, picks one leg
from this week's Kalshi NFL markets, and the app tracks odds, results, and who's on the hook.
Kalshi is only read for prices and results. Nobody needs a Kalshi account, and no money moves through the app.

## How it works

- **Weeks** follow the NFL calendar (`SEASON_START` = Thursday of Week 1, default 2026-09-10).
  Picks lock **Saturday 2:00 PM ET**. The app opens on the next week each Tuesday at 4 AM ET.
- **Legs** come only from Kalshi: every open `KXNFL*` series (game lines, spreads, totals,
  player props) for games between the lock and Monday night. Anything over **+120** is greyed out.
  One leg per person, and no two people can take the same market.
- **Odds** are recorded at the Kalshi ask price when you pick. The parlay's estimated odds multiply those together.
- **Results** fill in automatically from Kalshi's market result, checked whenever the page loads and by a daily cron.
- **Rule 2** is automatic: if exactly one leg misses, the app names that person as owing next week's $5.
- **Season tab**: leg hit rate per person (the "best situation monitor"), W-L, average odds, and solo misses.
- **Host tools** (bottom of the week page, needs `ADMIN_KEY`): set who's placing the bet, record the actual
  sportsbook odds, add a note, remove a leg, and add or remove players.

## Deploy on Vercel

1. Import this GitHub repo in Vercel. The Framework Preset is "Other", with no build command.
2. In the project go to **Storage → Marketplace → Neon (Postgres)** and connect it. This sets `DATABASE_URL`.
3. Add environment variables:
   - `ADMIN_KEY`: the host password.
   - `CRON_SECRET`: any random string. Vercel sends it to the daily settle cron.
4. Deploy. Tables are created, and the 2025 roster is seeded, on the first request.

Optional variables: `SEASON_START`, `MAX_ODDS` (120), `STAKE` (5), `NFL_SERIES` (comma-separated
Kalshi series tickers, to pin the list instead of auto-discovering it), `KALSHI_BASE`.

## Local dev

```
npm install
npm run dev      # http://localhost:3000, embedded Postgres in ./.data
npm test         # end-to-end test against a fake Kalshi
```

## Layout

- `public/`: the phone-first page (`index.html`, `app.js`).
- `api/`: Vercel functions (`week`, `catalog`, `leg`, `season`, `admin`, `cron`).
- `lib/`: `kalshi.js` (public market API), `rules.js` (calendar and odds math), `league.js` (scoring), `db.js`.
- `dev.js`: a local stand-in for Vercel.
