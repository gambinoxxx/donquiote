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
  the closed 15m candles after its entry candle, returns Win / Loss / still
  open / Unresolved (or Not filled for a limit entry that was never
  reached) with R and USD. Used by the worker and the backtester.
- `lib/settings/` — Pure helpers to snapshot settings + watchlist, diff two
  snapshots into a readable change list, and validate a snapshot before
  restore.
- `lib/risk/` — Pure risk guard maths from journal entries and Settings
  only: start of the prop day (time-zone reset, DST-safe), today vs the
  start-of-day balance, overall drawdown (static or trailing), open risk
  and worst case, trades today, USD exposure, the state and its reasons;
  result → USD (`resultToPnl`) and the lot-size suggestion.
- `lib/summary/` — Pure `buildAlertSummary()`: the "Ask Claude" text from an
  alert (pair, direction, status, time, strategy + seen-by, levels, ticket,
  paper status), settings and risk state. No network. Built on the server
  by `getAlert()`; the button copies it and opens claude.ai.
- `lib/db/` — Prisma client and typed query helpers for the worker and
  scripts. Pages and components never import it (Data Access Rule).
- `lib/data/` — The dashboard's only data access (Unit 11). `index.ts`
  (server-only): `getOverview()`, `getAlerts(filter)` (status, includeTest,
  pair, 30 per page with an id cursor, newest first by sweep time),
  `getAlert(id)` (ticket, paper, seen-by, ~60 M15 candles, rule checklist,
  Ask Claude text), plus read-only settings / watchlist views. `actions.ts`
  (server actions, `requireAllowedUser()` + Zod): `loadAlerts`,
  `markSkipped`, `markTaken`; `notification-actions.ts` (Unit 10's
  subscribe / unsubscribe / test). `types.ts`: plain view models. `logic.ts`:
  pure helpers (query shapes, cursor pages, scoreboard, seen-by, heartbeat,
  reason lines, checklist). `decide.ts`: Skip / Taken (guarded
  `status = READY`; Taken also creates the `JournalEntry` in the same
  transaction). `format.ts`: the one Lagos time formatter (relative within
  24 h, else "Wed 4 Nov · 10:42"), prices at pair precision, R and USD.
  `journal.ts`: `getRiskGuard` (Settings + journal only), `getJournal`,
  `getSignals`, `getStrategyComparison`, `exportCsv` (served by the
  `/journal/export` route); `journal-store.ts`: guarded journal writes
  (a result is logged once; deleted entries never change);
  `journal-actions.ts`: `logResult`, `addManualTrade`, `editEntry`,
  `deleteEntry`; `journal-logic.ts`: periods, stats, comparison, CSV.
- `lib/notify/` — Push and email senders. Called by the worker only.
- `lib/news/` — Pure news helpers (Unit 15): Forex Factory parsing, RSS,
  `classify.ts` (keyword rules first; only "unsure" titles go to the AI
  fallback, capped at 200 calls a UTC day with an 8 s timeout, falling
  back to NORMAL), title dedupe, `warnings.ts` (Home banner, alert
  warning windows), `push.ts` (15-min calendar reminders, HIGH headline
  throttle).
- `worker/news/` — The news jobs. `providers.ts`: one `CalendarProvider`
  (Forex Factory: this week's **and** next week's feed, merged, each with
  its own ETag; next week's 404 = no events yet, not an error) and `HeadlineProvider` adapters (Finnhub if
  `FINNHUB_API_KEY`, Fed RSS, White House RSS), plain User-Agent, ETag /
  Last-Modified caching, keys only in headers and never logged. `ai.ts`:
  Claude Haiku 5.5 (Anthropic SDK, structured output, title only, no
  retries), only if `ANTHROPIC_API_KEY`. `jobs.ts`: `NewsRunner.tick()`
  once a minute — calendar every 30 min + after 00:05 UTC, headlines every
  2 min while the market is open and every 5 min otherwise, pushes every
  tick, 30-day retention once a UTC day; never throws.
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
   Ready it opens its paper trade, and — only if its strategy is **Live**
   at that moment — enters the notification outbox (`notifyState =
   PENDING`) in the same transaction. Right after the pair's commit the
   worker sends push + email (or merges / marks it stale, see
   Notifications below).
6. In the same cycle, after the strategy steps for a pair, the worker
   passes every open paper trade on that pair (from every strategy, OFF
   included) and its closed 15m candles to `lib/paper/` and saves any
   results. A pair switched off in the watchlist keeps its 15m candles
   coming until its open paper trades close (no strategy runs on it).
7. The dashboard reads alerts, paper results, journal entries and candles
   from Neon and shows them. The chart draws level overlays using
   `lib/strategy/` functions on the stored candles, so the chart and the
   scanner always agree.
8. "Ask Claude (chart + summary)" takes a PNG of the chart
   (Lightweight Charts `takeScreenshot()`, level lines included, with a
   caption band: pair, timeframe, time in Lagos) and the `lib/summary/`
   text. Phones (`navigator.canShare({ files })`): the share sheet gets
   both. Desktop: the text is copied, the PNG downloaded
   (`donquixote-EURUSD-15m.png`) and `https://claude.ai/new` opened. Any
   failure falls back to text only. The flow lives in
   `lib/summary/share.ts` (browser calls injected, tested);
   `components/ask-claude/` holds the button and the capture registry.
   Nothing is sent to Anthropic by the app itself.

## Storage Model

- **Database (Neon)**: settings (account size, risk %, limits, guard
  levels), watchlist pairs and their on/off state, alerts (pair, direction,
  status, levels, trade ticket, timestamps), journal entries (trades DG
  took or added by hand, with their own ticket, OPEN/CLOSED, result, R and
  USD, soft-deleted with `deletedAt`; a skipped alert is not a journal
  entry, it is stored as `Alert.status = SKIPPED`), push subscriptions, worker
  heartbeat.
- **Prisma**: v7 (pinned). The app and worker connect over the pooled
  `DATABASE_URL`; migrations and Studio use `DIRECT_URL` via
  `prisma.config.ts`. The generated client is git-ignored and built on
  `postinstall`.
- **Added after the `init` migration** (each in the unit that first needs
  it, as its own migration):
  - Unit 5: `StrategyConfig` — `strategyId String @id`, `mode StrategyMode`
    (`LIVE` | `TEST` | `OFF`), `updatedAt`. At least one row must be
    `LIVE`; several may be (invariant 10; `assertSomeLive` in
    `lib/strategy/modes.ts`, tested). Seed (create-only, never overwrites):
    `dg-v1` LIVE; `dg-v2-candidate`, `gemini-fvg`, `pro-v1-swing` TEST
    (added in Unit 9).
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
  - Unit 9 (migration `extra_strategies`): `SweepType` gains `ASH` / `ASL`
    (Asian session high/low) and `H4H` / `H4L` (last closed 4H high/low).
    New enum `EntryType` (`MARKET` | `LIMIT`); on `Alert`, `entryType
    EntryType @default(MARKET)` and `entryValidUntil DateTime?` (LIMIT only:
    the entry may fill on candles that close by then). `PaperStatus` gains
    `NOT_FILLED` (a limit entry never reached: 0R, left out of trades, win
    rate, net R and streaks). For `gemini-fvg`, which has no break of
    structure, `Alert.bosLevel` holds the swept level.
  - Unit 10 (migration `notifications`): enum `NotifyState` (`NONE` |
    `PENDING` | `SENT` | `MERGED` | `STALE` | `FAILED`); on `Alert`,
    `notifyState @default(NONE)`, `notifyGroupId String?` (→
    `NotificationGroup`) and the existing `notifiedAt` (when the step
    finished with it). New `NotificationGroup` (`id`, `pair`, `direction`,
    `firstAlertId`, `strategyIds String[]`, `createdAt`, `pushSent`,
    `pushFailed`, `emailSent`, `emailFailed`; index `(pair, direction,
    createdAt)`). On `PushSubscription` (one row per device, upserted by
    `endpoint`): `lastSuccessAt DateTime?`, `failCount Int @default(0)`.
    `Settings.pushEnabled` / `emailEnabled` already existed (UI in Unit 13).
  - Unit 13 (migration `settings_version`): `SettingsVersion` — `id String
    @id @default(cuid())`, `createdAt DateTime @default(now())`, `createdBy
    String` (email, or `"system"`), `snapshot Json` (settings + watchlist +
    strategy modes, `lib/settings/snapshot.ts`), `changes Json` (list of
    `{ field, from, to }` with screen labels), `restoredFromId String?`.
    Index on `createdAt`. The seed writes one first version (`"system"`,
    no changes) when the table is empty, so there is always something to
    restore to.
  - Unit 15: `NewsEvent` — calendar events (`id`, `source`, `externalId`
    unique, `currency`, `title`, `impact` HIGH/MEDIUM/LOW, `time`,
    `forecast?`, `previous?`, `actual?`, `updatedAt`); `Headline` — (`id`,
    `source`, `externalId` unique, `title`, `url`, `publishedAt`,
    `impact` HIGH/NORMAL, `currencies String[]`, `reason?`, `notifiedAt?`).
    As built: `NewsEvent.notifiedAt` (the 15-min push, sent once) and
    `Headline.classifiedBy` (KEYWORDS | AI); Settings `newsPushCalendar`,
    `newsPushHeadlines`, `newsWarnMinutes`; `WorkerHeartbeat.newsStatus` /
    `newsCheckedAt`. Kept 30 days.
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
9. The app never sends trade data or chart pictures to any AI service
   itself. "Ask Claude" only hands them to the device: the share sheet on
   phones (DG picks the Claude app), or clipboard + a downloaded PNG and
   claude.ai/new on desktop.
10. At least one strategy is `LIVE`; several are allowed. Only Live
    strategies' alerts send notifications, and Live alerts on the same
    pair + direction within 30 min merge into one notification. Test
    strategies record silently. Default: `dg-v1` LIVE, all others TEST.
11. A strategy's code is never changed once it has produced alerts. A
    change in rules is a new strategy id. Bug fixes that change results
    also get a new id (e.g. `dg-v1.1`).
12. Paper trades are worked out only from closed 15m candles after the
    entry candle. If stop and target are both touched in the same candle,
    the result is a Loss. A LIMIT entry fills on the first later candle
    that touches the entry price and closes by `entryValidUntil`; if that
    candle also touches the stop it is a Loss, otherwise the trade resolves
    like a market trade from the next candle; never reached → `NOT_FILLED`
    (0R, not a trade). Paper results never feed the risk guard and never
    send notifications.
13. Settings, the watchlist and strategy modes are only changed through one
    write path (`saveSnapshot` in `lib/data/settings-store.ts`, called by the
    `saveSettings` / `setStrategyMode` / `setPairEnabled` /
    `restoreSettings` server actions) that writes the new values and a
    `SettingsVersion` in one transaction. Nothing else writes to those
    tables (the seed excepted; a test enforces it).

14. News only warns. It never changes strategies, alerts, paper trades or
    the risk guard. News pushes are push only (never email): a red
    calendar event 15 min before its release (once, only for currencies of
    enabled watchlist pairs), and HIGH headlines at most one push per 10
    min (later ones merged, "+N more"), never older than 20 min. Both
    respect their toggles and the master push switch. A failing news
    source never stops the price cycle.

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
  through (dg-v1, dg-v2-candidate; each strategy defines its own levels).
- **`StrategyInput.recentAlerts`** (Unit 9, read-only): the strategy's own
  alerts on the pair (any status, with ticket, `readyAt`, `entryType`,
  `entryValidUntil`) whose sweep candle is inside the M15 window. It covers
  the current forex day (pro-v1-swing: one trade per forex day) and enough
  history to tell whether a trade is still open (gemini-fvg: one at a
  time). `buildInputAt` trims it to the window; the worker loads it from the
  database once per pair and strategy and then carries it in memory with
  `applyEventsToRecent()` (pure, `lib/strategy/apply-events.ts`), exactly as
  the backtester does, so catch-up after downtime gives the same input.
- **Strategies** (Unit 9; rules in project-overview.md, references in
  `doc/reference/`): `dg-v2-candidate` is a copy of dg-v1's evaluate with
  its own liquidity (`levels.ts`: previous day, Asian session from the
  forex-day open to 07:00 UTC, 1H equal highs/lows from 1H candles built
  out of M15 by `shared/hourly.ts`, only once the hour has closed) and uses
  dg-v1's settings. `gemini-fvg` and `pro-v1-swing` keep every rule number
  as a named constant in their folder; account size and risk % still come
  from Settings. gemini-fvg's READY carries `entryType: "LIMIT"` and
  `entryValidUntil` = Ready + 16 × 15 min. Shared changes kept dg-v1's
  output identical: `detectSweep` picks levels by side (`SWEEP_SIDE`),
  `groupEqual` is exported, `forexDayOpen()` in `lib/market/time.ts`. The
  registry (`lib/strategy/registry.ts`) holds each strategy's app name,
  code (V1, V2, FVG, PRO), description and rules list. All three new
  strategies `worker:replay` to MATCH; dg-v1's replay is unchanged.
- **Backtester** (`scripts/backtest/`): a pure engine replays one closed
  M15 candle at a time; `assertNoLookAhead` throws if any candle passed in
  closes after the step time. Rolling windows are D 150 / H4 300 / M15 500.
  Results go to `scripts/backtest/results/` (git-ignored).
  `npm run backtest:report -- --strategy <id>` writes the two-period
  (Jan–Jun / Jul → latest) report to `doc/reports/backtest-<id>.md`.
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

- **Notifications** (Unit 10; `lib/notify/`, `worker/notify.ts`):
  - **Outbox.** `withNotifyOutbox()` adds `notifyState: PENDING` to a READY
    update of a LIVE strategy, so READY and PENDING commit together; the
    mode at that moment decides (TEST / OFF alerts stay `NONE`). After the
    pair's commit, `notifyPending()` loads PENDING alerts and runs the pure
    `planNotifications()` (`lib/notify/plan.ts`):
    - READY more than **20 min** ago → `STALE`, never sent (catch-up after
      downtime: an old signal is worse than none).
    - A `NotificationGroup` for the same pair + direction created in the last
      **30 min** → the alert joins it: `MERGED`, its strategy added to
      `strategyIds`, no new push or email. Opposite directions never merge.
    - Otherwise a new group: the alert is **claimed** in a transaction (still
      PENDING and unclaimed → group created, `notifyGroupId` set), push and
      email go out in parallel, then `SENT` (anything delivered) or `FAILED`
      with the group's counts.
    A crash before the claim leaves PENDING → retried next cycle (unless
    stale). A crash after the claim leaves it claimed → `FAILED` next cycle,
    never resent. Losing a claim race returns null and sends nothing. The
    step also runs once at the end of each cycle for leftovers. It never
    throws; failures are logged and the cycle carries on.
  - **Push** (`web-push`): `urgency: high`, `TTL: 1800`, 10 s timeout; payload
    `{ title, body, url: /alerts/<id>, tag: <group id> }`, e.g. "EUR/USD SELL ·
    Ready" / "Entry 1.11800 · SL 1.11950 · TP 1.11350 · 0.25 lots · V1"
    ("Limit 1.11800 (valid 4h) · …" for LIMIT entries); prices at the pair's
    precision. 404/410 → subscription deleted; other errors → `failCount`
    + 1, deleted at 5 in a row; success resets it and sets `lastSuccessAt`.
  - **Email** (Resend): one message per `ALLOWED_EMAILS` address from
    `EMAIL_FROM`; subject = push title; HTML + text with pair, direction,
    strategy names, entry / stop / target / lots / risk, swept and break
    levels, an "Open the alert" button (`APP_URL`) and "This app never places
    trades. Check the chart before entering." Respects `emailEnabled`.
  - **Config** (`lib/notify/config.ts`): `VAPID_PUBLIC_KEY`,
    `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
    `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`. A channel with missing keys is
    off (logged by variable name, never values); the worker keeps scanning.
    Logs carry counts only — never keys, endpoints or addresses (Resend
    error texts are redacted).
  - **Service worker** `public/sw.js` (served `no-cache`, see
    `next.config.ts`), registered from the root layout
    (`ServiceWorkerRegister`, only where service workers and push exist): on
    `push` shows the notification with `requireInteraction`, vibration
    `[600, 200, 600, 200, 900]`, `renotify`, `tag`, `/icon-192.png` and
    `/badge-96.png`; on click focuses an app window and navigates it to the
    alert, or opens one. Full PWA work is Unit 16.
  - **Settings › Notifications** (`NotificationsControl`): "Enable
    notifications on this device" switch (On / Off / Blocked in browser
    settings) and "Send test notification". Server actions in
    `app/settings/notification-actions.ts` (`requireAllowedUser()`, Zod):
    save (upsert by endpoint), remove (own devices only), test (the signed-in
    user's devices only).
  - Commands: `npm run notify:test` (one test push per device, one test
    email per allowed address; prints counts), `npm run notify:preview --
    --alert <id>` (prints the payload and email, sends nothing),
    `npm run worker:replay -- … --notify` (fake sender; dg-v1 Jan–Mar 2026:
    6 READY → 6 sent, each 10 s after the candle close).

- **Dashboard** (Unit 11): Home (`/`), Alerts (`/alerts`) and Alert detail
  (`/alerts/[id]`) render real data through `lib/data/` at request time
  (`connection()`, inside each route's `loading.tsx` skeleton).
  - Home: news banner slot (empty until Unit 15), risk guard card (neutral
    until Unit 14's maths), strategy scoreboard (every strategy not OFF; win
    rate leaves out unresolved and not-filled; "early" under 30 closed paper
    trades), the 5 latest Live alerts, and the scanner line from
    `WorkerHeartbeat` (OK; amber "slow" after 20 min; red "stopped" after 45
    min; "Market closed" when `isMarketOpen()` is false).
  - Alerts: status chips (All / Ready (incl. Taken) / Watching / Expired /
    Skipped, kept in `?status=`), "Show test signals" (off by default,
    remembered in `localStorage`; test alerts muted with dashed tags),
    "Load more" via the `loadAlerts` action.
  - Alert detail: seen-by tags (the notification group, plus any alert on
    the same pair + direction within 30 min), news slot (Unit 15), mini
    chart (Lightweight Charts 5, client, ~60 M15 candles shifted to Lagos
    time, entry / stop / target / swept level lines in the token colours,
    TradingView attribution kept), rules checklist (registry `RuleLine`s
    with a `check` kind; ✓ / ✗ from stored fields, never recomputed), trade
    ticket with copy buttons, paper card, Ask Claude (copies, opens
    claude.ai, toast), Skip / "I took this trade" with a confirm sheet —
    **Ready alerts only** (invariant 7; paper trades are unaffected). Unknown
    ids → `not-found.tsx`.
  - Tab bar: Home, Alerts, Chart, News, Journal (Watchlist moved to Settings,
    still at `/watchlist`). Placeholders: Chart, News, Journal, Strategies,
    Settings history.

- **Chart** (Unit 12; `/chart?pair=EUR_USD&tf=M15&alert=<id>`, defaults:
  first enabled pair, M15):
  - Data (`lib/data/chart.ts`, server-only): `getCandles(pair, tf, { before,
    after, limit })` — closed candles only (opened ≤ now − timeframe, and
    filtered again), oldest first, `limit` 500 by default, capped at 1,000;
    `before` (UTC seconds) pages older history, `after` returns new ones.
    `getChartContext(pair, tf, { from, to, alertId })` — the levels, D / 4H
    trend, alerts in the loaded range and the active trade lines;
    `getChartPairs()` (watchlist, enabled first). Server actions in
    `chart-actions.ts`: `loadOlderCandles`, `refreshChart`.
  - Levels (`lib/data/chart-logic.ts` `computeChartLevels`) are computed on
    the server with the scanner's own pure functions on the same stored
    candles (the scanner's windows: D 150, H4 300, M15 500), **as the
    scanner will see them at its next candle**: dg-v1's
    `getLiquidityLevels` (previous day high/low, equal highs/lows),
    dg-v2-candidate's `getV2LiquidityLevels` for the Asian session
    (forex-day open → 07:00 UTC, only once ended) and `getTrend` for D / 4H.
    The header's "today" change is from the forex-day open of the last
    closed candle (Friday's at the weekend).
  - Page: pair chips and D / 4H / 15m switch (URL updated with
    `router.replace`, no full reload), last price, change today, trend
    badges, "Last closed candle hh:mm" (Lagos). The chart is one client
    component (`components/chart/candle-chart.tsx`, Lightweight Charts 5)
    loaded with `next/dynamic` (`ssr: false`): token colours; pinch-zoom and
    horizontal drag on touch (vertical swipes scroll the page); time axis
    and crosshair in Lagos time; prices at the pair's precision; `autoSize`
    (ResizeObserver); disposed on unmount. Near the left edge it loads 500
    older candles (`before`) until "Start of stored history".
  - Overlays, each a switch row remembered in `localStorage`
    (`donquixote.chartLayers`): previous day high/low (amber dashed), Asian
    high/low (soft amber dotted), equal highs/lows (short grey dotted lines
    from the group's first swing, "EQH"/"EQL"), alert markers (circle on the
    sweep candle, arrow on the Ready candle; amber = Live, grey = Test;
    Test only with "Show test signals", the same device setting as Alerts;
    tapping a marker lists the alerts with links), active trade lines
    (entry white, stop orange dashed, target blue dashed) for `?alert=` and
    READY alerts with an open paper trade.
  - Refresh: every 60 s while the market is open and when the tab regains
    focus, new closed candles are appended (`series.update`) without
    resetting zoom or scroll, and the overlays refresh.
  - "Ask Claude about this chart": `buildChartSummary()` (lib/summary) —
    pair, timeframe, last price, trends, levels, active alerts with tickets,
    closed-candles note — copied, then claude.ai opens.
  - Links in: Alert detail "Open full chart" (`&tf=M15&alert=<id>`),
    Watchlist rows. Skeleton in `loading.tsx`; `error.tsx` with Retry; "No
    candles stored yet for this pair" with Retry.

- **Settings, strategies, watchlist and history** (Unit 13):
  - `lib/settings/` (pure): `snapshot()` (fixed key order, sorted lists),
    `diff()` (screen labels and formatted values: "Risk per trade 0.5% →
    1%", "Gold (XAU/USD) off → on", "FVG Retest Test → Live"),
    `validate()` (Zod: risk 0.1–2 %, account > 0, daily limit < max
    drawdown, warn < done-for-the-day < daily limit, overall warn < max
    drawdown, max trades 1–20, DG v1 numbers in sane ranges, expiry a
    multiple of 15 min, paper time limit 24–168 h, at least one pair on, at
    least one LIVE strategy).
  - Write path (`lib/data/settings-store.ts` `saveSnapshot`): one
    interactive transaction — `pg_advisory_xact_lock` (two saves never
    interleave) → refuse unless `baseVersionId` is the latest version
    ("Settings were changed on another device. Reload to see them.") →
    load current → apply the change → validate → diff (no changes → nothing
    written, "No changes") → write only the changed Settings columns,
    WatchlistPair rows and StrategyConfig modes → the `SettingsVersion` last
    (its failure rolls everything back). Only existing pairs and strategies
    can change. Restore = the old snapshot's values for the pairs and
    strategies that still exist, saved as a new version with
    `restoredFromId`.
  - Screens: `/settings` (links to Change history, Strategies, Watchlist;
    trading account, prop firm limits, risk guard numbers, DG v1 numbers,
    paper time limit, push / email toggles plus the device control; one
    sticky Save, disabled until something changes; field errors from the
    same `validate()`; asks before leaving with unsaved changes),
    `/strategies` (cards with Live / Test / Off, paper results and 30-trade
    progress, confirm sheet before Live, the last Live strategy can't be
    switched off, rules sheet), `/watchlist` (switch per pair, link to its
    chart, D / 4H bias, a warning when switching off a pair with open paper
    trades), `/settings/history` (20 per page, CURRENT label, "Restored
    from …", Restore with a preview of what will change, toast with a link
    to the new version). The worker reads current values every cycle, so
    every save applies from the next scan.

- **Unit 15 — News.** The worker runs two loops in one process: the price
  scheduler (unchanged) and `runNewsLoop` (a tick each minute). Both check
  the same advisory lock through one shared `guard()` (one check at a
  time); losing the lock stops both. `npm run news:once` runs every news
  job once now. The alert push / email gets one news line
  (`WorkerStore.loadNewsWarning`, e.g. "⚠ USD CPI m/m in 20 min").
  Windows: Home banner = red news within `newsWarnMinutes` (default 30) or
  released in the last 5 min, else a HIGH headline from the last 15 min;
  alert warning = red news within ±30 min of the alert time on either
  currency of the pair (gold = USD), else a HIGH headline on them in the
  15 min before it. Headline dedupe: word-set similarity ≥ 0.8 against the
  last 24 h. `/news` shows the source status line from the heartbeat.
  (Unit 16 Step 0) The banner and the 15-min reminders use **future events
  only**. `/news` Calendar reads Monday of this week → today + 14 days and
  shows upcoming days first (Today, Tomorrow, later, Lagos), with past days
  collapsed under "Earlier this week" (`buildCalendar` in
  `lib/data/news.ts`); "Actual not available from this feed" shows once
  when no event has an actual figure.

- **PWA** (Unit 16): `app/manifest.ts` (Donquixote FX, standalone, `/`
  scope, #0E1116, icons 192 / 512 / maskable 512 from
  `scripts/icons/generate.mjs`). Public without sign-in: the manifest,
  icons and `/sw.js` (skipped by the proxy matcher) and `/offline`
  (`PUBLIC_PATHS`). `public/sw.js`: push + notification click (unchanged),
  a versioned shell cache (`donquixote-shell-v<N>`; bump `CACHE_VERSION`
  when the shell changes, old caches are deleted on activate) holding only
  the icons and `/offline`, plus next/font files on first use. Navigations
  always go to the network, falling back to `/offline`; nothing else is
  intercepted, so pages, RSC, server actions and data are never cached.
  Settings › Install the app uses `beforeinstallprompt` (captured by
  `INSTALL_PROMPT_SCRIPT` in the root layout's `<head>`); platform hints
  are pure helpers in `lib/pwa.ts`.

## Deployment Notes

- Exactly one worker should run. Lock takeover is allowed (a worker started
  between cycles takes over, the old one exits 0), so **never run a local
  worker while the Railway worker is running**: the laptop would silently
  take over production scanning.
- Phone push needs HTTPS (desktop Chrome accepts `http://localhost`): set
  `APP_URL` to the deployed URL so email links work, and test phone push on
  the Vercel deploy (Unit 16). The worker needs the VAPID and Resend
  variables too, not just the dashboard.

