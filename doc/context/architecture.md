# Architecture Context

## Stack

| Layer          | Technology                              | Role                                                                  |
| -------------- | --------------------------------------- | --------------------------------------------------------------------- |
| Framework      | Next.js (App Router) + TypeScript       | Dashboard, API routes, PWA shell                                      |
| UI             | Tailwind CSS + shadcn/ui                | Styling and base components                                           |
| Auth           | Clerk (email code)                      | Sign-in; access limited to the emails in `ALLOWED_EMAILS`             |
| Database       | Prisma + Neon Postgres                  | Settings, watchlist, alerts, journal, recent candles, push subscriptions |
| Worker         | Node.js + TypeScript (run with `tsx`)   | Long-running scanner: fetches candles, runs strategy, sends alerts    |
| Market data    | OANDA v20 REST API (practice account)   | Daily, 4H and 15m candles for the watchlist                           |
| Push           | Web Push (`web-push`, VAPID keys)       | High-priority Android notifications                                   |
| Email          | Resend                                  | Backup alert emails                                                   |
| Charts         | TradingView Lightweight Charts          | Full chart page and alert detail chart                                |
| Validation     | Zod                                     | Validate env vars, API input and OANDA responses                      |
| Tests          | Vitest                                  | Strategy engine unit tests                                            |
| Hosting (later)| Vercel (dashboard) + Railway or VPS (worker) | Production; local laptop during development                      |

## System Boundaries

- `app/` — Next.js routes and pages. Reads data from the database
  (including candles for the chart) and writes user actions (settings,
  watchlist, journal). Never calls OANDA and never runs the scan.
- `worker/` — The only long-running process. Owns the scan loop, the OANDA
  client, saving recent candles, alert state changes and sending
  notifications. Runs with `tsx` (not Next.js) and loads `.env` itself via
  `worker/load-env.ts`; env is Zod-validated in `worker/env.ts`. ESLint
  blocks `app/`, `components/` and `lib/` from importing `worker/`.
  `scripts/` may import it (the history downloader uses the OANDA client).
- `lib/market/` — Pure market helpers: pip size, price decimals, market
  open/closed and last-closed-candle times (17:00 New York alignment,
  DST-safe via `Intl`). Used by the worker, scripts and later the strategy.
- `lib/strategy/` — Pure strategy engine: swing detection, trend, liquidity
  levels, sweep, break of structure, trade ticket maths. No I/O, no
  database, no network. Used by both the worker and the backtester.
- `lib/risk/` — Pure risk guard maths: daily and overall drawdown from
  journal entries, guard status.
- `lib/summary/` — Pure function that builds the "Ask Claude" text from an
  alert, settings and risk state. Runs in the browser; no network.
- `lib/db/` — Prisma client and typed query helpers shared by `app/` and
  `worker/`.
- `lib/notify/` — Push and email senders. Called by the worker only.
- `scripts/backtest/` — Replays historical candles through `lib/strategy/`
  and writes results.
- `prisma/` — Schema and migrations.
- `design/` — Static HTML reference for every screen. Read-only; never
  imported by the app.

## Data Flow

1. DG changes settings or the watchlist in the dashboard → saved to Neon.
2. After each 15m candle closes, the worker reads settings and enabled
   pairs from Neon.
3. The worker fetches daily, 4H and 15m candles from OANDA for those pairs.
4. The worker passes candles to `lib/strategy/`, which returns setup
   events (new sweep, confirmation, expiry).
5. The worker upserts the latest closed candles into the `Candle` table,
   upserts alerts in Neon, and sends push + email on Ready.
6. The dashboard reads alerts, journal entries and candles from Neon and
   shows them. The chart draws level overlays using `lib/strategy/`
   functions on the stored candles, so the chart and the scanner always
   agree.
7. "Ask Claude" builds a text summary in the browser with `lib/summary/`,
   copies it to the clipboard and opens `https://claude.ai/new`. Nothing is
   sent to Anthropic by the app itself.

## Storage Model

Schema: `prisma/schema.prisma` (Prisma 7, `prisma-client` generator,
output `lib/db/generated/`, git-ignored and rebuilt on `postinstall`).
The app and worker connect through the Neon driver adapter on the
**pooled** `DATABASE_URL`; the Prisma CLI (migrate, studio) uses the
**direct** `DIRECT_URL` via `prisma.config.ts`. All `DateTime` values are
UTC; prices are `Float`, rounded only at display.

- **Database (Neon)**, 7 tables:
  - `Settings`: single row (`id = 1`). Account size, starting balance
    (basis for overall drawdown), risk %, reward ratio, prop firm limits,
    risk guard levels, max trades per day, the open trading parameters
    (stop buffer, watch expiry, swing strength, equal tolerance) with the
    defaults from `progress-tracker.md`, and notification toggles.
  - `WatchlistPair`: one row per `Pair` with `enabled` and `sortOrder`.
  - `Alert`: pair, direction, status, `dedupeKey` (unique), sweep (type
    PDH/PDL/EQH/EQL, level, extreme, time), BOS level, trade ticket
    (nullable until READY), timestamps (`createdAt`, `readyAt`,
    `expiresAt`, `expiredAt`, `decidedAt`, `notifiedAt`).
  - `JournalEntry`: optional one-to-one link to an `Alert` (DG may log a
    trade by hand), pair, direction, `takenAt`, result
    (OPEN/WIN/LOSS/BREAKEVEN), `resultR`, `resultPct`, `closedAt`, note.
    Only taken trades are journal entries; a skipped alert is recorded as
    `Alert.status = SKIPPED`.
  - `PushSubscription`: one row per device (`endpoint` unique) with the
    signed-in user's email.
  - `WorkerHeartbeat`: single row (`id = 1`), last scan / last OK time,
    status, message.
- **Candle table (Neon)**: recent closed candles per pair and timeframe,
  written by the worker for the chart page. Primary key
  (pair, timeframe, time), `time` = candle open time in UTC. Keep about
  500 candles per pair and timeframe and delete older ones each cycle.
- **Seed** (`prisma/seed.ts`, idempotent): the Settings row, the six
  watchlist pairs (five majors on, XAU_USD off) and the heartbeat row.
  Re-running never overwrites existing rows.
- **No file storage needed.** Long history for backtesting is kept as local
  CSV files under `scripts/backtest/data/` (git-ignored), not in the
  database.

## Auth and Access Model

- DG signs in with Clerk using an email code.
- Only the email addresses in `ALLOWED_EMAILS` (comma-separated env var;
  DG and Gambino for now) are allowed. Any other signed-in user is
  rejected by middleware.
- Both allowed users see and edit the same data: one set of settings, one
  watchlist, one journal (DG's trading). No per-user data or roles.
- Push subscriptions are stored per device, so both phones get alerts.
- The worker does not use Clerk. It connects to the database with the
  server connection string and never exposes an HTTP API.

## Time and Market Conventions

- All timestamps are stored in UTC. The dashboard displays Africa/Lagos
  time.
- OANDA candles are requested with `dailyAlignment=17` and
  `alignmentTimezone=America/New_York`, the standard forex day. "Previous
  day high/low" uses that day.
- The worker only scans while the forex market is open (Sunday 17:00 to
  Friday 17:00 New York time).
- Pip size: 0.01 for JPY pairs, 0.1 for XAU/USD, 0.0001 for all others.
  Price decimals: 3 for JPY, 2 for gold, 5 for other FX (`lib/market/pip.ts`).
- OANDA client (`worker/oanda/`): mid prices (`price=M`), RFC3339 times,
  only `complete: true` candles returned, oldest first. History is paged
  with `from` + `count=5000`, then `includeFirst=false` from the last
  candle; OANDA counts the skipped candle, so a full later page holds 4999
  and the end of data is detected by the forming candle (or an empty page),
  never by page size. 10 s timeout; 429/5xx/network errors retried up to 4
  attempts with backoff 0.5 s, 1 s, 2 s; 401/403 never retried.
- Backtest history CSVs: `scripts/backtest/data/<PAIR>_<TF>.csv`
  (`npm run data:download`), header `time,open,high,low,close`, UTC.
- Lot size = risk amount ÷ (stop in pips × pip value per standard lot in
  USD), rounded **down** to 0.01 lots. Pip value per lot: $10 for XXX/USD
  pairs; 10 ÷ price (in USD) for USD/CAD and USD/CHF; 1000 ÷ price for
  USD/JPY.

## Invariants

1. The app never places, modifies or closes trades. No broker or
   MetaTrader connection exists anywhere in the codebase.
2. Only the worker talks to OANDA. The OANDA token, database URL, VAPID
   private key and Resend key never reach the browser.
3. `lib/strategy/` and `lib/risk/` are pure functions: same input, same
   output, no I/O. The backtester and the worker use the exact same code.
4. Every price shown in the app comes from OANDA data. Prices are never
   hardcoded or invented.
5. Request handlers in `app/` never run scans or other long-lived work.
6. An alert is created at most once per setup: each alert has a unique
   `dedupeKey` (pair + direction + sweep candle time), and alert writes are
   idempotent.
7. Alert status only moves forward: Watching → Ready or Expired; Ready →
   Taken or Skipped.
8. The strategy only uses **closed** candles, never the candle still
   forming.
9. The app never sends trade data to any AI service itself. "Ask Claude"
   only copies text to the clipboard and opens the Claude app.
