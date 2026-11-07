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
| News           | Economic calendar feed + headline news feed (+ official White House / Fed feeds) | Red calendar events and market-moving headlines; picked and verified in Unit 15 |
| AI (optional)  | Claude API (small model)                | Classify headline impact and affected currencies; worker only        |
| Validation     | Zod                                     | Validate env vars, API input and price API responses                      |
| Tests          | Vitest                                  | Strategy engine unit tests                                            |
| Hosting (later)| Vercel (dashboard) + Railway or VPS (worker) | Production; local laptop during development                      |

## System Boundaries

- `app/` — Next.js routes and pages. Reads data from the database
  (including candles for the chart) and writes user actions (settings,
  watchlist, journal). Never calls the price API and never runs the scan.
- `worker/` — The only long-running process. Owns the scan loop, the price
  client (OANDA v20), saving recent candles, alert state changes and sending
  notifications.
- `lib/strategy/` — Pure strategy engine: swing detection, trend, liquidity
  levels, sweep, break of structure, trade ticket maths. No I/O, no
  database, no network. Used by both the worker and the backtester.
  - `lib/strategy/registry.ts` — maps a strategy id (`dg-v1`, …) to its
    `Strategy` implementation, display name and description.
  - `lib/strategy/<id>/` — one folder per strategy version. Shared rule
    functions live in `lib/strategy/shared/`.
- `lib/paper/` — Pure paper-trade resolver: given an open paper trade and
  newly closed 15m candles, returns Win / Loss / still open / Unresolved
  with R and USD. Used by the worker and the backtester.
- `lib/settings/` — Pure helpers to snapshot settings + watchlist, diff two
  snapshots into a readable change list, and validate a snapshot before
  restore.
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
- `doc/design/` — Static HTML reference for every screen. Read-only; never
  imported by the app.

## Data Flow

1. DG changes settings or the watchlist in the dashboard → saved to Neon,
   and in the same transaction a `SettingsVersion` snapshot is written.
2. After each 15m candle closes, the worker reads settings, enabled pairs
   and strategy modes from Neon.
3. The worker fetches the newest closed daily, 4H and 15m candles from
   OANDA for those pairs.
4. For each strategy in Live or Test mode, the worker passes the candles to
   that strategy from the registry, which returns setup events (new sweep,
   confirmation, expiry).
5. The worker upserts the latest closed candles into the `Candle` table and
   upserts alerts (tagged with the strategy id). When an alert becomes
   Ready it opens its paper trade. Push + email are sent only for alerts
   from the **Live** strategy.
6. In the same cycle, after the strategy steps for a pair, the worker
   passes every open paper trade on that pair (from every strategy, OFF
   included) and its closed 15m candles to `lib/paper/` and saves any
   results. A pair switched off in the watchlist keeps its 15m candles
   coming until its open paper trades close (no strategy runs on it).
7. The dashboard reads alerts, paper results, journal entries and candles
   from Neon and shows them. The chart draws level overlays using
   `lib/strategy/` functions on the stored candles, so the chart and the
   scanner always agree.
8. "Ask Claude" builds a text summary in the browser with `lib/summary/`,
   copies it to the clipboard and opens `https://claude.ai/new`. Nothing is
   sent to Anthropic by the app itself.

## Storage Model

- **Database (Neon)**: settings (account size, risk %, limits, guard
  levels), watchlist pairs and their on/off state, alerts (pair, direction,
  status, levels, trade ticket, timestamps), journal entries (trades DG
  took, with result in R and %; a skipped alert is not a journal entry,
  it is stored as `Alert.status = SKIPPED`), push subscriptions, worker
  heartbeat.
- **Prisma**: v7 (pinned). The app and worker connect over the pooled
  `DATABASE_URL`; migrations and Studio use `DIRECT_URL` via
  `prisma.config.ts`. The generated client is git-ignored and built on
  `postinstall`.
- **Added after the `init` migration** (each in the unit that first needs
  it, as its own migration):
  - Unit 5: `StrategyConfig` — `strategyId String @id`, `mode StrategyMode`
    (`LIVE` | `TEST` | `OFF`), `updatedAt`. Seed `dg-v1` as `LIVE`. Exactly
    one row may be `LIVE` (enforced in code and checked in tests).
  - Unit 7 (migration `worker_scan`): on `Alert`, `strategyId String
    @default("dg-v1")`, `statusNote String?` (why the status changed, e.g.
    "Lot size below 0.01" for SKIP_INVALID), an index on
    `(strategyId, createdAt)`, and the unique key is now
    `(strategyId, dedupeKey)` (two strategies may see the same sweep).
    New `ScanCursor` (`pair`, `strategyId`, `lastCandleTime` = open time of
    the last M15 candle processed; `@@id([pair, strategyId])`). On
    `WorkerHeartbeat`: `version String?`, `lastCleanupAt DateTime?`.
  - Unit 8 (migration `paper_trades`): on `Alert`, the paper trade fields —
    `paperStatus PaperStatus?` (`OPEN` | `WIN` | `LOSS` | `UNRESOLVED`),
    `paperOpenedAt DateTime?` (close of the confirming candle = `readyAt`),
    `paperClosedAt DateTime?`, `paperExitPrice Float?`, `paperResultR Float?`,
    `paperPnlUsd Float?`, `paperNote String?` (e.g. "stop and target in same
    candle"). Indexes on `paperStatus` and `(strategyId, paperStatus)`. One
    alert = at most one paper trade, so these live on `Alert`, not in a
    separate table. On `Settings`, `paperTimeoutHours Int @default(72)`
    (× 4 = M15 candles of market time). `paperStatus` = OPEN and
    `paperOpenedAt` are written in the same update as READY (only with a
    valid ticket: lot size ≥ 0.01 and a stop distance); results are written
    once, guarded by `paperStatus = OPEN`, and never change after.
  - Unit 12: `SettingsVersion` — `id String @id @default(cuid())`,
    `createdAt DateTime @default(now())`, `createdBy String` (email),
    `snapshot Json` (settings + watchlist + strategy modes),
    `changes Json` (list of `{ field, from, to }`), `restoredFromId String?`.
    Index on `createdAt`. On first deploy, write one version with the
    current values so there is always something to restore to.
  - Unit 15: `NewsEvent` — calendar events (`id`, `source`, `externalId`
    unique, `currency`, `title`, `impact` HIGH/MEDIUM/LOW, `time`,
    `forecast?`, `previous?`, `actual?`, `updatedAt`); `Headline` — (`id`,
    `source`, `externalId` unique, `title`, `url`, `publishedAt`,
    `impact` HIGH/NORMAL, `currencies String[]`, `reason?`, `notifiedAt?`).
    The worker polls the calendar every 30 min and headlines every 1–2 min,
    stores only what's needed, and keeps 30 days.
- **Candle table (Neon)**: closed candles per pair and timeframe, written
  by the worker. It is the chart page's source and the worker's recent
  history. Unique
  on (pair, timeframe, time). Keep 90 days of M15 and 365 days of H4 and
  D; delete older rows once a day. On first start (empty table), the
  worker backfills 90 days of M15 and 365 days of H4 and D per enabled
  pair from OANDA.
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
- Price source: OANDA v20 REST (US division practice/demo account).
  Candles are requested with `price=M` (mid), `dailyAlignment=17` and
  `alignmentTimezone=America/New_York`, the standard forex day, so OANDA
  returns H4 and daily candles aligned to it. "Previous day high/low" uses
  that day.
- Only candles with `complete: true` are used; the forming candle is
  always dropped.
- OANDA's rate limits are generous; the client still keeps requests
  modest (about 15 per scan: 5 pairs × 3 timeframes).
- OANDA prices are OANDA's own quotes, not DG's prop firm feed. Levels can
  differ by a pip or two from his MetaTrader chart.
- The worker only scans while the forex market is open (Sunday 17:00 to
  Friday 17:00 New York time).
- Pip size: 0.01 for JPY pairs, 0.0001 for all others.
- Lot size = risk amount ÷ (stop in pips × pip value per standard lot in
  USD), rounded **down** to 0.01 lots. Pip value per lot: $10 for XXX/USD
  pairs; 10 ÷ price (in USD) for USD/CAD and USD/CHF; 1000 ÷ price for
  USD/JPY.

## Invariants

1. The app never places, modifies or closes trades. No broker or
   MetaTrader connection exists anywhere in the codebase.
2. Only the worker talks to the price API. The OANDA token, database URL, VAPID
   private key and Resend key never reach the browser.
3. `lib/strategy/` and `lib/risk/` are pure functions: same input, same
   output, no I/O. The backtester and the worker use the exact same code.
4. Every price shown in the app comes from the price API's data. Prices are never
   hardcoded or invented.
5. Request handlers in `app/` never run scans or other long-lived work.
6. An alert is created at most once per setup and strategy: each alert has
   a `dedupeKey` (pair + direction + sweep candle time), unique together
   with `strategyId`, and alert writes are idempotent.
7. Alert status only moves forward: Watching → Ready or Expired; Ready →
   Taken or Skipped.
8. The strategy only uses **closed** candles, never the candle still
   forming.
9. The app never sends trade data to any AI service itself. "Ask Claude"
   only copies text to the clipboard and opens the Claude app.
10. At least one strategy is `LIVE`; several are allowed. Only Live
    strategies' alerts send notifications, and Live alerts on the same
    pair + direction within 30 min merge into one notification. Test
    strategies record silently. Default: `dg-v1` LIVE, all others TEST.
11. A strategy's code is never changed once it has produced alerts. A
    change in rules is a new strategy id. Bug fixes that change results
    also get a new id (e.g. `dg-v1.1`).
12. Paper trades are worked out only from closed 15m candles after the
    entry candle. If stop and target are both touched in the same candle,
    the result is a Loss. Paper results never feed the risk guard and
    never send notifications.
13. Settings and watchlist are only changed through one server function
    that writes the new values and a `SettingsVersion` in one transaction.
    Nothing else writes to those tables (the seed excepted).

## Implementation Notes (as built)

- **Next.js 16**: `middleware.ts` is now `proxy.ts`. It redirects signed-out
  users to `/sign-in` and non-allowlisted emails to `/not-allowed` (a
  convenience only). The real check is `requireAllowedUser()` in
  `lib/auth.ts` (Clerk `auth()` + `ALLOWED_EMAILS` against the session
  token's `email` claim), called by every page, server action and route
  handler that touches data. Env is Zod-checked in `lib/env.ts` and at
  server start via `instrumentation.ts`.
- **Prisma 7**: `prisma.config.ts` gives the CLI `DIRECT_URL`; the app and
  worker use the Neon adapter on the pooled `DATABASE_URL` through one lazy
  singleton (`lib/db/client.ts`). The generated client lives in
  `lib/db/generated/` (git-ignored, rebuilt on `postinstall`);
  `npm run db:migrate` also runs `prisma generate`.
- **`lib/market/`** (pure): `pipSize`, `priceDecimals`, `isMarketOpen`,
  `lastClosedCandleOpen`; New York time via `Intl`, DST-safe.
- **Price client** is `worker/oanda/` (OANDA v20, mid prices, only
  `complete: true` candles). History paging: `from` + `count=5000`, then
  `includeFirst=false`. OANDA counts the skipped candle, so a full later
  page holds 4999, and the end is detected by the forming candle or an
  empty page, never by page size. 10 s timeout; 429, 5xx and network
  errors are retried (4 attempts, 0.5/1/2 s backoff). **401 is retried at
  most 3 times, after 2, 5 and 10 s** (decision after Unit 7): OANDA's
  practice API intermittently answers a valid token with 401
  "Insufficient authorization" after ~5 s (3 of 8 requests on 2026-11-05).
  A 401 that persists through every retry, or any 403, throws
  `OandaAuthError`: that pair fails for the cycle and the heartbeat is
  `degraded` with "OANDA rejected the token". Other 4xx are never retried.
  The token never appears in logs or errors.
  ESLint blocks `app/`, `components/` and `lib/` from importing `worker/`.
- **Shared replay input** (`lib/strategy/replay.ts`): `buildInputAt()`
  builds the strategy input as of a candle's close (only candles closed by
  then; windows D 150 / H4 300 / M15 500; `assertNoLookAhead`). The
  backtester and the worker both use it, so live = backtest.
- **Strategy engine**: `evaluate()` handles the latest closed M15 candle
  plus that pair's open setups, in the order expire → confirm → extend →
  new sweep. `applyEvents()` turns events into the next open setups, so
  the worker and the backtester replay candles the same way. Expiry is by
  candle close time. A level only counts the first time it is traded
  through.
- **Backtester** (`scripts/backtest/`): a pure engine replays one closed
  M15 candle at a time; `assertNoLookAhead` throws if any candle passed in
  closes after the step time. Rolling windows are D 150 / H4 300 / M15 500.
  Results go to `scripts/backtest/results/` (git-ignored).
- **`Candle.time`** is always canonical `toISOString()` form, so hot loops
  compare times as strings (parsing dominated backtest time).
- **Loading**: the splash is in the root layout's server HTML and hides
  after hydration once `document.readyState === "complete"`; route
  skeletons live in `components/skeletons/` and each route's `loading.tsx`.
- **Worker** (`npm run worker`, `worker:once`, `worker:replay`):
  - `worker/index.ts` takes a Postgres session advisory lock
    (`pg_try_advisory_lock`, key "DONQ") on its own **direct** connection
    (`DIRECT_URL`; the pooled URL is transaction-mode and can't hold session
    locks). Neon closes every connection when it scales an idle database
    to zero (~5 min), so the lock is re-taken before **every cycle**
    (`WorkerLock.ensure`): two workers can never run a cycle at the same
    time. A second copy is refused while the first holds the lock; one
    started during an idle gap takes the lock, and the old worker stops at
    its next cycle — **takeover is accepted** (decision after Unit 7): the
    old worker logs `lock_taken_over` "lock taken by another worker,
    exiting" and exits with code 0. The open connection does not keep
    Neon awake. SIGINT/SIGTERM finish the current cycle, release the lock
    and exit; a second signal forces exit.
  - `worker/scheduler.ts`: a cycle runs 10 s after every quarter-hour
    close whose candle was inside market hours (so Friday 17:00 NY still
    runs, Sunday 17:00 NY doesn't); cycles are strictly sequential.
  - `worker/cycle.ts`: config (LIVE + TEST strategies; OFF and unknown ids
    skipped; "no LIVE" → degraded) → per pair: fetch everything since the
    newest stored candle (or backfill 90 d M15 / 365 d H4 and D when empty)
    and insert new candles → per strategy: process M15 candles after its
    `ScanCursor` one at a time, oldest first (first run: latest candle
    only; catch-up capped at 48 h with a log line). Open setups are loaded
    once and carried forward with `applyEvents`, like the backtester. A
    candle with events commits its alert changes and the cursor in one
    transaction; quiet candles only advance the cursor, written once at
    the end (reprocessing them is idempotent). Then heartbeat
    (`ok`/`degraded`/`error`) and, on the first cycle after 00:00 UTC,
    candle cleanup. Each pair and each strategy is isolated.
  - **Paper trades** (Unit 8): after a pair's strategy steps,
    `resolvePaperTrades` loads that pair's OPEN paper trades from **every**
    strategy (OFF and unregistered ids included) and, per trade, feeds
    `resolvePaperTrade` (unchanged `lib/paper/`) every stored closed M15
    candle that opens at or after `paperOpenedAt`, oldest first, up to
    `paperTimeoutHours × 4` candles. The resolver is deterministic, so the
    whole window is re-fed each cycle and catch-up after downtime needs no
    extra state. Each result is one guarded write (`paperStatus = OPEN`) and
    one log line (`pair`, `strategy`, `alertId`, `status`, `R`, `usd`).
    Pairs switched off with OPEN trades are still synced (M15 only) and
    resolved, until their trades close. Paper trades never notify, never
    touch the risk guard and never write `JournalEntry`.
  - `npm run paper:backfill` opens paper trades for alerts that reached
    READY (or later Taken/Skipped) before Unit 8, with `paperOpenedAt =
    readyAt`; idempotent. `npm run paper:report -- [--strategy id]` is
    read-only: per strategy open / W / L / unresolved, win rate (W ÷ (W+L)),
    net R and $ (unresolved included), worst losing streak.
  - `worker/store.ts` (interface + in-memory) / `store-prisma.ts`. Alert
    creates are upserts on `(strategyId, dedupeKey)`; updates are guarded by
    `status = fromStatus`, so status only moves forward in the database too.
    `planAlertChanges()` (pure, `lib/strategy/apply-events.ts`) turns events
    into creates/updates.
  - `worker:replay` drives the same `runCycle` through the real scheduler
    times with the in-memory store and CSV candles, then compares every
    alert **and every paper trade** (status, exit, close time, R, USD) with
    `runBacktest` for the same range (MATCH for EUR_USD and GBP_USD,
    Jan–Mar 2026). The backtest runner takes its paper time limit from
    `Settings.paperTimeoutHours` too.

## Deployment Notes

- Exactly one worker should run. Lock takeover is allowed (a worker started
  between cycles takes over, the old one exits 0), so **never run a local
  worker while the Railway worker is running**: the laptop would silently
  take over production scanning.

