# Progress Tracker

## Current Status

Units 1–6 are done (the repo's own tracker has the details and backtest
results). The plan now adds **multiple strategies** (two Live, two Test)
and a **News** page; their database changes come as new migrations in the
units below.

Unit 7 is done. Next unit: **Unit 8 — Paper trades**.

## Build Units

Work top to bottom. Each unit must pass the checks in
`ai-workflow-rules.md` before the next starts.

### Phase 1 — Foundation

| #  | Unit                    | What "done" means                                                                                          | Status  |
| -- | ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| 1  | Project scaffold        | Next.js + TS strict + Tailwind + shadcn, tokens and fonts, folders, app shell with tab bar and empty pages, icons wired, build passes | Done |
| 2  | Database                | Prisma schema (Settings, WatchlistPair, Alert, JournalEntry, Candle, PushSubscription, WorkerHeartbeat) migrated to Neon; seed defaults | Done |
| 3  | Auth                    | Clerk email-code sign-in; middleware blocks every email not in `ALLOWED_EMAILS`                            | Done |

### Phase 2 — The brain

| #  | Unit                    | What "done" means                                                                                          | Status  |
| -- | ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| 4  | OANDA client            | Fetch closed D, H4 and M15 candles, market-time helpers, check script, history download; Zod-validated | Done |
| 5  | Strategy engine + registry | `Strategy` interface, registry, `dg-v1` built from shared pure rule functions (swings, trend, liquidity, sweep, BOS, trade ticket); `StrategyConfig` migration with `dg-v1` LIVE; Vitest tests incl. JPY and wick-only cases | Done |
| 6  | Backtest runner         | Takes a strategy id; replays historical candles through it and through `lib/paper/` (build the pure resolver here, with tests); outputs setups, win rate, net R, worst losing streak per pair | Done |

### Phase 3 — Live alerts

| #  | Unit                    | What "done" means                                                                                          | Status  |
| -- | ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| 7  | Worker scan loop        | Runs after each 15m close while market is open; runs every LIVE and TEST strategy; `Alert.strategyId` migration; saves candles; creates/updates alerts idempotently; heartbeat | Done |
| 8  | Paper trades            | Paper fields migration on `Alert`; opens a paper trade when an alert becomes Ready; resolves open ones every cycle with `lib/paper/`; time limit from settings | Not started |
| 9  | Extra strategies        | Register `dg-v2-candidate`, `gemini-fvg`, `pro-v1-swing` (rules in `project-overview.md`), each with tests and a backtest report; seed modes: `dg-v1` LIVE, the other three TEST; `StrategyConfig` allows several LIVE (at least one) | Not started |
| 10 | Notifications           | Web push (long vibration, stays until tapped) + Resend email on Ready, **LIVE strategies only**; same pair + direction from several Live strategies within 30 min = **one merged alert**; to every subscribed device | Not started |

### Phase 4 — The app screens

| #  | Unit                    | What "done" means                                                                                          | Status  |
| -- | ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| 11 | Dashboard: alerts       | Overview (red-news banner, strategy scoreboard), Alerts list (strategy tags, "show test signals" toggle, paper badges), Alert detail (seen-by tags, news warning, paper card, Ask Claude, Taken/Skip) | Not started |
| 12 | Chart page              | Lightweight Charts from the Candle table; D/4H/15m; pair switch; level overlays from `lib/strategy/`; Ask Claude | Not started |
| 13 | Strategies, settings and history | `/strategies` (cards, Live/Test/Off, confirm-to-Live sheet, 30-trade progress, rules sheet); `SettingsVersion` migration; `saveSettings`; Settings (links to Strategies + Watchlist); `/settings/history` with Restore | Not started |
| 14 | Journal and risk guard  | My trades (feeds risk guard) and All signals (comparison table, strategy filter); daily/overall drawdown; warnings; trades-per-day and USD exposure across all Live strategies | Not started |
| 15 | News                    | `NewsEvent` + `Headline` tables filled by the worker (calendar every 30 min, headlines every 1–2 min, High/Normal classification); `/news` with Calendar and Headlines tabs; red banner on Home; news warning on alerts; pushes for red news (15 min before) and High headlines | Not started |

### Phase 5 — Go live

| #  | Unit                    | What "done" means                                                                                          | Status  |
| -- | ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| 16 | PWA and deploy          | Installable on Android; dashboard on Vercel; worker on Railway or VPS                                      | Not started |

**Before real money:** run all four strategies on paper for 2–3 months
after Unit 16. Move money only to a strategy that is positive after spread
in its backtest **and** in at least 30 forward paper trades. Review with DG.

## Decisions Made

- App name: Donquixote (repo folder `donquiote`). Icons in `public/`.
- Two users: DG and Gambino (`ALLOWED_EMAILS`), sharing one set of data.
  Forex only, Android phones.
- Pairs: EUR/USD, GBP/USD, USD/JPY, USD/CAD, USD/CHF. Gold later.
- Timeframes: daily + 4H for trend, 15m for entry.
- Liquidity: equal highs/lows and previous day high/low.
- Break of structure needs a full 15m candle body close, not a wick.
- Fixed 1:3 risk-to-reward. Risk 0.5% per trade (option 1%).
- Prop firm limits: 3% daily, 10% max drawdown.
- Risk guard: warn at −1.5% today, stop at −2% today, warn at −5% overall.
- No automated trading (prop firm forbids EAs). Alerts + manual entry only.
  Leverage is set at the broker; the app controls risk through risk % and
  lot size only.
- Alerts: web push + email. SMS paused.
- Price data: **OANDA v20** via a US-division (hub.oanda.com) demo
  account. The OANDA Global Markets route didn't offer the API; the hub
  demo does. Twelve Data is the fallback if OANDA access is ever lost.
- Full chart page: worker saves recent candles to Neon; the app never calls
  the price API directly.
- "Ask Claude" button: copies an alert summary and opens the Claude app.
  A custom Claude connector may come later.
- Bottom tabs: Home, Alerts, Chart, Watchlist, Journal. Settings from Home.
- Loading: branded splash (Donquixote mark + "Donquixote FX") only on cold
  start and after sign-in; skeletons matching each page's layout everywhere
  else (see `ui-context.md` → Loading States). Built by the loading-states
  prompt; every later page unit adds its own `loading.tsx` skeleton.
- **Paper trades:** every Ready alert is tracked as if taken, until target
  or stop. Same-candle stop and target = Loss. Shown on the alert, in
  Journal › All signals and as a Home card. Never affects the risk guard.
- **Settings history:** every save stores a full snapshot; any entry can
  be restored, and a restore is itself undoable.
- **Strategy switch:** strategies are registered by id; each is Live, Test
  or Off; **one or more Live** (at least one); Test runs silently with paper
  trades. New rules = new strategy id, never an edit of an old one.
- **Four strategies:** `dg-v1` (Live), `dg-v2-candidate` (Test, Claude's
  refinement: strong liquidity only; review with DG), `gemini-fvg` (Test),
  `pro-v1-swing` (Test). ChatGPT's EMA trend idea rejected (drawdown too large).
- **Merged alerts:** Live strategies that see the same pair + direction
  within 30 min send one alert tagged with all of them. Risk guard limits
  apply across all Live strategies combined.
- **Results are "early" until 30 paper trades**; making a strategy Live
  needs a confirm sheet and warns if under 30.
- **News:** high-impact (red) calendar events for USD, EUR, GBP, JPY, CAD,
  CHF, plus High-impact headlines (Trump posts/statements, White House
  actions, Fed and central banks) from a headline feed. Not the official
  Truth Social API (institutional pricing). News replaces Watchlist in the tab bar; Watchlist moves to
  Settings.

## Open Questions

Defaults are used until DG confirms. Keep each one as a named constant or
setting.

| Question                                                        | Default for now            | Owner |
| --------------------------------------------------------------- | -------------------------- | ----- |
| Final strategy: SMC or support and resistance?                  | `dg-v1` rules              | DG (sending chart screenshots) |
| Stop buffer beyond the sweep extreme                            | 3 pips                     | DG |
| How long a Watching alert waits for the 15m close before expiring | 2 hours                  | DG |
| Which swing counts as structure for the BOS                     | Last confirmed M15 swing before the sweep candle (swing low for SELL, swing high for BUY) | DG |
| Swing detection: candles on each side of a swing point          | 2                          | DG |
| Tolerance for "equal" highs/lows                                | 2 pips                     | DG |
| Max trades per day before the overtrading warning               | 2                          | DG |
| Trading sessions to scan (London, New York, all)                | All while market is open   | DG |
| Avoid or allow setups around high-impact news                   | Allow (no news filter yet) | DG |
| Should Watching alerts also send a push, or only Ready?          | Ready only; Watching push is an off-by-default setting | DG |
| Account size                                                    | $10,000                    | DG |
| Paper trade time limit before "Unresolved"                      | 72 hours of market time (setting `paperTimeoutHours`) | DG |
| Should paper P&L use the lot size at alert time, or current settings? | Alert-time ticket (what he'd actually have traded) | Gambino |
| Economic calendar source (free, reliable, allowed for this use) | Forex Factory weekly JSON feed, verified in Unit 15; fallback a free calendar API | Agent (Unit 15) |
| Headline source (fast, affordable, allowed for this use) | A financial news API with a free/low tier + White House and Fed official feeds; compare 2–3 options in Unit 15 | Agent (Unit 15) + Gambino (budget) |
| Block or only warn on alerts near red news? | Warn only (DG decides) | DG |
| Should DG v2 stay Live if it trails DG v1 after 30 trades? | Review together | DG + Gambino |
| Equal highs/lows: which timeframe and how far back?             | M15 swings, current + previous forex day | DG |
| "Full body close": is a close beyond the BOS level enough, or must the candle's open also be beyond? | Close beyond is enough | DG |
| Must the sweep candle close back inside the level it swept?     | No | DG |
| Can a level be swept again after it was already traded through earlier in the day? | No: only the first candle to trade through an untouched level (PDH/PDL since the previous day's open, EQH/EQL since the group's first swing) | DG |
| If the confirming candle itself reaches beyond the sweep extreme, where does the stop go? | Beyond the furthest point, including the confirming candle | DG |
| 84% of backtest setups (270 of 320) expired before a 15m body close. Is the 2-hour watch window too short? | 120 min (unchanged) | DG |
| At 2 pips, live EUR_USD showed 4 EQH and 3 EQL levels in two days: is the tolerance too loose? | 2 pips (unchanged) | DG |
| Gold pip size: the Unit 4 spec uses 0.1 (2 decimals); OANDA itself quotes XAU_USD to 3 decimals with a 0.01 pip. Which should lot sizing use when gold is switched on? | 0.1 pip, 2 decimals | DG |
| App icon files (`favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) are not in `public/`; the layout and `site.webmanifest` already link to them | Links 404 until the files are added | Gambino |
| Overview eyebrow in the design is "Wed, 4 Nov · London session open". Which session names and hours (Lagos time) should drive the label? | Placeholder text "Today · market session" until Unit 9 | DG |
| `code-standards.md` now names the price client `worker/prices/`; the built client is `worker/oanda/`. Rename in Unit 7, or keep? | Keep `worker/oanda/` | Gambino |
| OANDA practice randomly answers a valid token with 401 (3 of 8 requests on 2026-11-05). Unit 4 said never retry 401/403; the client now retries them like 5xx and only reports "token rejected" if every attempt fails. Keep? | Retry 401/403 (4 attempts) | Gambino |
| Worker lock strictness: Neon drops idle connections (~5 min), so the advisory lock is re-taken before each cycle. Cycles never overlap, but a second worker started during an idle gap takes over (the old one stops) instead of being refused. Need strict "always refuse"? Then use a lease row renewed each cycle | Re-take before each cycle (newest worker wins) | Gambino |
| The two emails for `ALLOWED_EMAILS`                             | —                          | Gambino (goes in `.env`) |

## Backtest results

dg-v1, 2026-01-01 → 2026-11-05 (UTC), OANDA mid prices, history from
2025-10-01 as warm-up. Settings (from the database): account $10,000
fixed (no compounding), risk 0.5% ($50 = 1R), reward 1:3, stop buffer 3
pips, watch expiry 120 min, swing strength 2, equal tolerance 2 pips,
paper timeout 288 M15 candles. Sample results from historical data, not a
promise of future results.

| Pair | Setups | Trades | W / L / unres. | Win rate | Net R | Net $ | Worst streak | Max DD |
| ---- | -----: | -----: | -------------- | -------: | ----: | ----: | -----------: | -----: |
| EUR_USD | 43 | 4 | 0 / 4 / 0 | 0.0% | −4.22R | −$211.00 | 4 | 4.22R |
| GBP_USD | 60 | 10 | 3 / 6 / 1 | 33.3% | +3.68R | +$184.00 | 3 | 3.00R |
| USD_JPY | 73 | 13 | 2 / 11 / 0 | 15.4% | −5.00R | −$250.00 | 8 | 8.00R |
| USD_CAD | 76 | 13 | 5 / 7 / 1 | 41.7% | +9.14R | +$457.00 | 3 | 3.00R |
| USD_CHF | 68 | 10 | 1 / 8 / 1 | 11.1% | −3.81R | −$190.50 | 8 | 8.00R |
| **All 5** | **320** | **50** | **11 / 36 / 3** | **23.4%** | **−0.21R** | **−$10.50** | **13** | **13.22R** |

EUR_USD + GBP_USD only: 103 setups, 14 trades, 3 / 10 / 1, 23.1%, −0.54R,
−$27.00, worst streak 6, max drawdown 6.22R.

Readout: at 1:3 the break-even win rate is 25%; dg-v1 sits just under it
over 50 trades — roughly break-even, with long losing streaks. 84% of
setups expire unconfirmed. Too few trades per pair to judge pairs
separately. Worth reviewing with DG before going live (see Open Questions).

## Completed Work

- **Unit 7 — Worker scan loop** (2026-11-06):
  - Migration `worker_scan`: `Alert.strategyId` (default `dg-v1`),
    `Alert.statusNote`, unique `(strategyId, dedupeKey)`, index
    `(strategyId, createdAt)`; `ScanCursor`; `WorkerHeartbeat.version` and
    `lastCleanupAt`. (`migrate dev` refused to confirm the unique-key
    warning non-interactively; the SQL was generated with `migrate diff`
    and applied with `migrate deploy` — the `Alert` table was empty.)
  - `lib/strategy/replay.ts` (`buildInputAt`, `STRATEGY_WINDOWS`,
    `assertNoLookAhead`) shared by the backtester and the worker — the
    backtest trades CSV is byte-identical after the refactor.
    `planAlertChanges` / `applyAlertChanges` (pure, forward-only,
    idempotent). `assertOneLive` replaced by `assertSomeLive` +
    `activeStrategies` (invariant 10: several LIVE allowed).
  - `worker/index.ts`, `scheduler.ts`, `cycle.ts`, `store.ts` (interface +
    in-memory), `store-prisma.ts`, `prices.ts`, `lock.ts`, `replay.ts`;
    `npm run worker`, `worker:once`, `worker:replay`. 29 new tests (182).
  - **`worker:replay` Jan–Mar 2026: MATCH** — EUR_USD 17 alerts (1 READY),
    GBP_USD 26 (5 READY), every field equal to the backtest, 6,053 cycles.
  - Live: first `worker:once` backfilled 365 d D/H4 and 90 d M15 for 5
    pairs; two runs in a row created no duplicates; a real-DB check over
    48 h of GBP_USD history (throwaway strategy id, deleted after) made 13
    changes then 0, and its READY alert matched the Unit 6 spot-check
    trade. `npm run worker` ran 4 cycles (00:00–00:45 UTC, 5/5 pairs ok,
    daily cleanup at 00:00 deleted 10 old candles); Ctrl+C (SIGINT) and
    SIGTERM finish, release the lock and exit 0; a second copy is refused.
    After the Mac slept ~2 h, the next cycle caught up 8 candles per pair
    in order.
  - Found and fixed while running live:
    - OANDA practice randomly returns 401 for a valid token → 401/403 are
      now retried (see Open Questions).
    - Neon closes every connection when idle (~5 min), which dropped the
      advisory lock → the lock is re-taken before each cycle.
    - Catch-up did DB round trips per candle (~100 s per 48 h per pair) →
      open setups carried in memory with `applyEvents`, quiet candles only
      move the cursor (5–13 s; replay still MATCH).
    - WebSocket errors logged as "[object ErrorEvent]" → readable messages.
  - Testing note: a laptop that sleeps pauses the worker (it catches up on
    wake, up to 48 h). Production runs on a server (Unit 16).

- Context files written and replaced with a newer version after Unit 6 (paper trades, settings history, strategy switch, loading states).
- Static design for all screens in `doc/design/`.

- **Loading states** (2026-11-05):
  - `components/brand/`: `Mark`, `Splash` (mark draws in ring → lance →
    tip then breathes, "Donquixote" in Sora 700 + "FX", status line),
    `SplashGate`. CSS-only animations in `globals.css`; all off under
    `prefers-reduced-motion`.
  - Splash rule: rendered in the root layout's server HTML, so it shows
    immediately on any full page load (cold start; sign-in now does a full
    `window.location.assign("/")` so it shows after sign-in too). It fades
    out (300 ms) once the client has hydrated **and** `document.readyState`
    is `complete` — the streamed response only ends after every server
    Suspense boundary resolved, i.e. the first page's data is ready. No
    minimum time. The root layout never remounts, so client navigation
    (tab switches) never shows it. `app/loading.tsx` was not used for the
    splash because it would also show on every navigation to `/`.
  - `components/ui/skeleton-block.tsx` (`--skeleton` #1E232B, 6px, shimmer),
    `components/spinner.tsx`, `components/pending-button.tsx` (spinner +
    disabled while pending; `useFormStatus` or a `pending` prop). Sign out
    uses it now; Save / Restore / Taken / Skip must use it when built.
  - `loading.tsx` for `/`, `/alerts`, `/alerts/[id]`, `/chart`,
    `/watchlist`, `/journal`, `/settings`, `/settings/history` with
    skeletons in the exact layout of each design file
    (`components/skeletons/`); page titles and tab bar stay real.
    `/settings/history` added as a placeholder page (Unit 12).
  - `public/site.webmanifest` created (`background_color` and
    `theme_color` #0E1116); the icon files it lists are still missing.
  - App title in metadata changed from "DG Signals" to "Donquixote".
  - Note: pages other than Settings/Watchlist are still placeholders, so
    their skeletons match the design, not today's placeholder content.
  - **Every later page unit must add or update its route's `loading.tsx`
    skeleton to match the real page.**

- **Unit 6 — Backtest runner** (2026-11-05):
  - `lib/paper/resolve.ts`: `resolvePaperTrade` + `PaperTrade` /
    `PaperResult`; 19 tests (target/stop first, same candle, gaps both
    ways, timeout, open, BUY/SELL, USD_JPY, R and $).
  - `scripts/backtest/engine.ts` (pure replay, no look-ahead guard),
    `stats.ts`, `report.ts`, `csv.ts`, `run.ts` (`npm run backtest`).
    13 more tests incl. "a later candle cannot change an earlier event" and
    "the strategy never receives a candle that closes after now".
  - Speed: first run took 71 s for two pairs. Profiling showed ~75% in
    `Date.parse` (the look-ahead guard and dg-v1's closed-candle filter);
    both now compare canonical ISO strings, and the M15 window went from
    2000 to 500 (byte-identical trades CSV). Now ~9 s for two pairs, ~20 s
    for five.
  - Spot-checked against raw candles: GBP_USD BUY WIN (6 Feb), EUR_USD
    SELL LOSS (19 Jan), GBP_USD SELL UNRESOLVED +0.68R (2 Mar) — trend,
    level, sweep, BOS, extend, stop/target and exit all match the rules.
  - Data re-downloaded for all 5 enabled pairs from 2025-10-01.
  - Nothing written to the database (one `getSettings()` read).

- **Unit 5 — Strategy engine + registry** (2026-11-04):
  - `lib/strategy/types.ts` (`StrategySettings`, `OpenSetup`,
    `StrategyInput`, `SetupEvent`, `Strategy`); shared rules in
    `lib/strategy/shared/`: `findSwings`, `getTrend`, `getLiquidityLevels`,
    `detectSweep` / `extendsSweep`, `detectBos`, `buildTradeTicket`;
    `applyEvents` (events → next open setups).
  - `dg-v1` (`lib/strategy/dg-v1/`), registry (`getStrategy`,
    `listStrategies`), `assertOneLive` (`lib/strategy/modes.ts`).
  - `StrategyConfig` table + `StrategyMode` enum, migration
    `20261104232258_strategy_config` applied to Neon; seed adds
    `dg-v1 = LIVE` (create-only); `lib/db/strategies.ts`
    `getStrategyModes()`.
  - 57 new Vitest tests (121 total): every shared rule plus the nine
    `dg-v1` scenarios (exact tickets for EUR_USD SELL 0.07 lots, EXTEND
    0.06, USD_JPY EQL BUY 0.19, USD_CAD 0.35, EUR_USD 19-pip 0.26,
    SKIP_INVALID, purity), expiry boundary, re-evaluation no-op,
    forming-candle guard, no re-sweep of a used level.
  - `npm run strategy:check -- --pair X` (`worker/strategy-check.ts`),
    read-only. Live run 2026-11-04 23:25Z: EUR_USD D DOWN / H4 UP → no
    direction; GBP_USD D UP / H4 UP → BUY only; no events.
  - Purity: grep of `lib/strategy/` finds no `Date.now`, `new Date()`,
    `fetch`, Prisma, `process.env` or Node imports; it imports only
    `lib/market`, `lib/types` and itself.
  - Also: `npm run db:migrate` now runs `prisma generate` (Prisma 7's
    `migrate dev` no longer does); `vitest.config.ts` → `.mts`;
    shared console formatting in `worker/format.ts`.
  - Decisions not spelled out in the spec (also in Open Questions):
    `evaluate` handles the latest closed M15 candle per call; expiry is by
    candle close time (a candle closing exactly at `expiresAt` can still
    confirm; EXPIRE carries `expiresAt` as its time); a level only counts
    once; the stop includes the confirming candle's extreme; open setups
    keep being tracked if the D/H4 trend flips (only new sweeps need the
    trend).
  - Invariant "strategy versions are immutable" added to `architecture.md`
    as number 10 (the Unit 5 prompt calls it invariant 11; the newer
    context files with the other invariants are not in this repo).

- **Unit 4 — OANDA client** (2026-11-04):
  - `lib/market/`: `pipSize`, `priceDecimals`, `isMarketOpen`,
    `lastClosedCandleOpen` (pure, `Intl`-based New York time; tests cover
    both 2026 DST changes, Friday close, Sunday open, weekend, every
    timeframe boundary).
  - `worker/env.ts` (Zod: OANDA token, account ID, env, DATABASE_URL),
    `worker/load-env.ts`, `worker/log.ts` (JSON lines, no secrets).
  - `worker/oanda/`: `createOandaClient().fetchCandles(pair, tf,
    { count } | { from, to })`, Zod-parsed, complete candles only, paging,
    timeout, retries. Tests use a saved fixture and a mocked fetch.
  - `npm run oanda:check` (`worker/oanda-check.ts`): last 5 closed D/H4/M15
    per enabled pair in Lagos, UTC and New York time; exit 1 on failure.
    Real run: all 5 pairs OK; daily opens at 17:00 NY on both sides of the
    1 Nov DST change (21:00Z before, 22:00Z after); H4 on 21/01/05/09/13 NY.
  - `npm run data:download` (`scripts/backtest/download.ts`): `--pair`
    (repeatable) or `--all`, `--from`, `--to`, `--timeframes`; overwrites
    cleanly; warns on gaps longer than a weekend.
    Download 2026-01-01 → 2026-11-04 (no duplicates, no gap warnings;
    largest gaps are weekends):
    | File | Rows | First | Last |
    | ---- | ---- | ----- | ---- |
    | EUR_USD_D | 219 | 2026-01-01T22:00Z | 2026-11-03T22:00Z |
    | EUR_USD_H4 | 1,314 | 2026-01-01T22:00Z | 2026-11-04T18:00Z |
    | EUR_USD_M15 | 21,028 | 2026-01-01T22:00Z | 2026-11-04T22:45Z |
    | GBP_USD_D | 219 | 2026-01-01T22:00Z | 2026-11-03T22:00Z |
    | GBP_USD_H4 | 1,314 | 2026-01-01T22:00Z | 2026-11-04T18:00Z |
    | GBP_USD_M15 | 21,028 | 2026-01-01T22:00Z | 2026-11-04T22:45Z |
  - ESLint rule: `app/`, `components/`, `lib/` cannot import `worker/`.
  - Notes: a bug where paging stopped at 9,999 M15 rows (OANDA's
    `includeFirst=false` page holds 4,999) was found on real data and
    fixed; the fake OANDA in the tests now mimics it. One isolated HTTP 401
    from OANDA was seen on a single request (the same token worked for the
    other 14 and on three reruns); per spec, 401 is never retried — worth
    watching once the worker runs every 15 minutes.

- **Unit 3 — Auth** (2026-11-04):
  - `@clerk/nextjs` 7.9.24 (Clerk Core 3). `ClerkProvider` in the root
    layout. Custom email-code flow (`components/sign-in-form.tsx`) on the
    Core 3 `useSignIn()` API: `signIn.create` → `emailCode.sendCode` →
    `emailCode.verifyCode` → `finalize`, then `/`. `/sign-in` matches
    `design/index.html` with the title "Donquixote".
  - `proxy.ts` (Next 16 renamed `middleware.ts` to `proxy.ts`): public
    paths `/sign-in` and `/not-allowed`; signed out → `/sign-in`; email
    claim not on the allowlist → `/not-allowed`; signed in on `/sign-in`
    → `/`. Uses plain path checks: Clerk deprecated `createRouteMatcher`
    in favour of per-resource checks.
  - `lib/auth.ts` `requireAllowedUser()` (Clerk `auth()` + allowlist,
    throws `NotAllowedError`) is the real security line; `/settings` and
    `/watchlist` call it before reading the database.
  - `lib/allowlist.ts` (pure) with 11 Vitest tests: case, spaces, blank
    entries, missing / non-string email, empty list = deny.
  - `lib/env.ts` Zod-validates the Clerk keys, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
    and `ALLOWED_EMAILS`; `instrumentation.ts` runs it at server start so a
    missing var stops the server with a message naming it (never its value).
    This also prevents Clerk's silent "keyless" dev mode.
  - `/not-allowed` page with Sign out; Settings "Access" section (signed in
    as + Sign out). Tab bar hidden on `/sign-in` and `/not-allowed`.
  - Clerk setup notes: the dashboard session token must contain
    `{ "email": "{{user.primary_email_address}}" }` or every user lands on
    `/not-allowed`. The instance still required passwords, so the two users
    were created via the Backend API with `skipPasswordRequirement`; turn
    passwords off in the dashboard.
  - Differences from the Unit 3 prompt: added a "Use a different email"
    link on the code step (not in the design); no pre-send allowlist check
    on the sign-in form (it would reveal which emails are allowed), so a
    non-listed email only learns it on `/not-allowed`.
  - Verified: signed-out redirects for all app routes; sign-in with a code
    landing on `/`; email claim present and allowlisted in the live session.

- **Unit 2 — Database** (2026-11-04):
  - Prisma 7.10.1 (stable; npm's `latest` tag for `prisma` pointed at an
    8.0 RC) with the Neon driver adapter. `prisma.config.ts` gives the CLI
    `DIRECT_URL`; `lib/db/client.ts` connects on the pooled `DATABASE_URL`
    (lazy global singleton, Zod-checked, no Next.js imports). Generated
    client in `lib/db/generated/` (git-ignored, `postinstall` regenerates).
  - `prisma/schema.prisma`: 6 enums, 7 models as specified. Migration
    `20261104151604_init` applied to Neon (eu-central-1).
  - `prisma/seed.ts` (idempotent, create-only upserts): Settings defaults,
    6 watchlist pairs (XAU_USD off), heartbeat row. Ran twice: 1 / 6 / 1
    rows, no duplicates, no sample alerts, journal entries or candles.
  - Helpers `getSettings()` (`lib/db/settings.ts`) and `getWatchlist()`
    (`lib/db/watchlist.ts`). `/settings` and `/watchlist` read them at
    request time (`connection()` inside `<Suspense>`, so the build never
    touches the database) and show $10,000, 0.5% and the 6 pairs.
  - Scripts: `db:migrate`, `db:seed`, `db:studio`, `db:generate`,
    `postinstall`. `DIRECT_URL` added to `.env.example`.
  - `architecture.md` Storage Model updated to match the schema.
  - Note: the first `db:migrate` applied `init` and then hit a P1001
    (Neon compute waking up); `migrate status` confirmed it applied and a
    rerun reported "Already in sync".

- **Unit 1 — Project scaffold** (2026-11-04):
  - Next.js 16 (App Router, Cache Components on), TS `strict` +
    `noUncheckedIndexedAccess`; shadcn/ui (base-nova) with `button`,
    `switch`, `card`.
  - `app/globals.css`: every token from `ui-context.md` as CSS variables
    (dark only, `dark` class on `<html>`); Tailwind utilities `bg-base`,
    `bg-surface`, `bg-nav`, `bg-buy`, `bg-sell`, `bg-warn`, `text-muted`,
    `text-accent`, `text-on-accent`, `text-buy`, `text-sell`,
    `text-error`, `text-success`, `border-default`, `border-input`;
    shadcn variables mapped to the tokens (primary/accent = amber); radius
    scale lg 8px / xl 12px / 2xl 16px. Primary text uses `text-foreground`
    (`text-primary` is shadcn's amber). Inter + JetBrains Mono via
    `next/font`.
  - Root layout: 480px centred column, 16px sides, 24px top, bottom padding
    clears the tab bar; metadata `icons`, `manifest`, viewport
    `themeColor` `#0E1116` (the one hex outside CSS: the meta tag cannot
    read a CSS variable).
  - `components/tab-bar.tsx` (fixed 68px, active tab amber with
    `aria-current="page"`, hidden on `/sign-in`, no tab active on
    `/settings`, Suspense-wrapped for `/alerts/[id]`), plus
    `page-header`, `back-link`, `coming-soon`.
  - Placeholder pages: `/sign-in`, `/`, `/alerts`, `/alerts/[id]`,
    `/chart`, `/watchlist`, `/journal`, `/settings`.
  - Folders with READMEs: `lib/strategy`, `lib/risk`, `lib/summary`,
    `lib/db`, `lib/notify`, `worker`, `scripts/backtest`, `prisma`.
    `lib/types.ts` shared types. `.env.example`; `.env*` (except the
    example) and `scripts/backtest/data/` git-ignored.
  - Vitest (`npm test`) with one test in `lib/utils.test.ts`.
    `@types/node` bumped to ^22 (Vitest 5 peer). ESLint ignores `doc/`.
  - Note: the context files are in `doc/context/` and the design is in
    `doc/design/`; references to `context/` and `design/` in these docs
    mean those folders.

- Context files written (`project-overview.md`, `architecture.md`,
  `code-standards.md`, `ui-context.md`, `ai-workflow-rules.md`).
- Static design for all 8 screens in `design/` (sign in, overview, alerts,
  alert detail, chart, watchlist, journal, settings).
