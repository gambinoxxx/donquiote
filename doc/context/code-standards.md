# Code Standards

## General

- Keep modules small and single-purpose.
- Fix root causes; do not layer workarounds.
- Do not mix unrelated concerns in one component, route or worker step.
- Name things in DG's trading terms: `sweep`, `bos`, `swingHigh`,
  `tradeTicket`, `riskGuard`.
- Every number with trading meaning (buffers, tolerances, limits) is a
  named constant or a setting, never a magic number inline.

## TypeScript

- Strict mode is required throughout the project.
- No `any`. Use explicit interfaces or narrowly scoped types.
- Validate all external input with Zod at the boundary: env vars, request
  bodies, price API responses.
- Prices are `number` in the strategy engine, but always rounded to the
  pair's precision (5 decimals, 3 for JPY) before display or storage.
- Shared types (`Candle`, `Pair`, `Direction`, `AlertStatus`,
  `TradeTicket`) live in `lib/types.ts`.

## Next.js

- Default to server components.
- Add `"use client"` only when browser interactivity requires it
  (toggles, charts, push subscription).
- Use server actions or route handlers for mutations, one responsibility
  each.
- Pages read through `lib/db/` helpers, never raw Prisma calls scattered
  in components.

## Strategy Engine (`lib/strategy/`)

- Pure functions only: no `fetch`, no Prisma, no `Date.now()`. Time is
  passed in.
- Input is arrays of closed candles, oldest first.
- Each rule is its own function with its own tests: `findSwings`,
  `getTrend`, `getLiquidityLevels`, `detectSweep`, `detectBos`,
  `buildTradeTicket`.
- Every rule has Vitest tests with hand-built candle fixtures, including
  JPY pairs and wick-only (no body close) cases.
- Every strategy implements one `Strategy` interface: `id`, `name`,
  `description`, and `evaluate(input) → SetupEvent[]`, where `input` holds
  closed candles per timeframe, settings, the open (Watching) setups and
  the strategy's recent alerts on that pair (read-only).
  The worker and backtester only know this interface.
- Register each strategy in `lib/strategy/registry.ts` with its app name,
  code, description and rules list. Adding a strategy = new folder + one
  registry entry. Never edit a registered strategy that has produced
  alerts; copy it to a new id instead.
- dg-v1 and dg-v2-candidate take their numbers (stop buffer, expiry, swing
  strength, equal tolerance) from the settings passed in. Other
  strategies' rule numbers (sessions, ATR multiplier, windows, pip
  buffers, stop range) are named constants in their own folder, not user
  settings. Account size and risk % always come from settings.

## Paper Trades (`lib/paper/`)

- One pure function: `resolvePaperTrade(trade, candles) → result`, with
  the rules in `project-overview.md` (stop and target in the same candle =
  Loss; time limit = Unresolved).
- Tests cover: target first, stop first, both in one candle, gap through
  the stop, time limit, BUY and SELL, a JPY pair.
- The same function is used live and in the backtest.

## Settings History (`lib/settings/`)

- Snapshot, diff and restore helpers are pure and tested.
- Every write to settings, watchlist or strategy modes goes through one
  server action `saveSettings(next, userEmail)`, which validates with Zod,
  writes the values and a `SettingsVersion` in one transaction.
- Restore calls the same `saveSettings` with the old snapshot, so a restore
  is itself undoable.

## Worker (`worker/`)

- One scan cycle = read settings → fetch candles → run each Live/Test
  strategy → write alerts → resolve open paper trades → notify (Live only).
  Each step is a separate function.
- Scan ~10 seconds after each 15m candle closes.
- One failing pair must not stop the others: catch and log per pair.
- Retry price API requests with backoff; pace requests under the plan's
  per-minute limit.
- Write a heartbeat row each cycle so the dashboard can show "worker
  offline".
- Log with structured JSON lines (pair, step, outcome).

## Styling

- Use the CSS custom property tokens in `ui-context.md`. No hardcoded hex
  values in components.
- Follow the border radius scale in `ui-context.md`.
- Mobile-first: design at 390px width first. Touch targets at least 44px.
- Buy/sell use blue/orange, never red/green alone.

## API Routes

- Validate and parse request input with Zod before any logic runs.
- Check Clerk auth and the allowed email before any read or mutation.
- Return consistent shapes: `{ ok: true, data }` or
  `{ ok: false, error }`.

## Data and Storage

- All app data lives in Neon through Prisma.
- Money and percentages are stored as numbers with a clear unit in the
  field name (`riskPct`, `accountSizeUsd`, `resultR`).
- Never store secrets in the database.
- Backtest CSVs stay local and git-ignored.

## File Organization

- `app/` — routes, pages and layouts
- `components/` — app components; `components/ui/` holds shadcn components
- `lib/strategy/` — pure strategy engine and its tests
- `lib/risk/` — pure risk guard maths and tests
- `lib/db/` — Prisma client and query helpers
- `lib/notify/` — push and email senders
- `lib/summary/` — "Ask Claude" summary builder and tests
- `lib/paper/` — paper-trade resolver and tests
- `lib/settings/` — settings snapshot, diff and restore helpers and tests
- `lib/types.ts` — shared domain types
- `worker/` — scanner entry point and price client (`worker/prices/`)
- `lib/market/` — pure market-time and pip helpers
- `scripts/backtest/` — backtest runner
- `prisma/` — schema and migrations
- `doc/context/` — these context files and `progress-tracker.md`
- `doc/design/` — static HTML design reference (read-only)
