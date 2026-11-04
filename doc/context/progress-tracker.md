# Progress Tracker

## Current Status

Units 1–4 are done. Next unit: **Unit 5 — Strategy engine**.

## Build Units

Work top to bottom. Each unit must pass the checks in
`ai-workflow-rules.md` before the next starts.

| #  | Unit                    | What "done" means                                                                                          | Status  |
| -- | ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| 1  | Project scaffold        | Next.js + TS strict + Tailwind + shadcn, tokens and fonts from `ui-context.md`, folders from `code-standards.md`, app shell with bottom tab bar and empty pages, `npm run build` passes | Done |
| 2  | Database                | Prisma schema (Settings, WatchlistPair, Alert, JournalEntry, Candle, PushSubscription, WorkerHeartbeat) migrated to Neon; seed with 5 pairs + gold (off) and default settings | Done |
| 3  | Auth                    | Clerk email-code sign-in; middleware blocks every email not in `ALLOWED_EMAILS`                            | Done |
| 4  | OANDA client            | Worker script fetches closed D, H4 and M15 candles for enabled pairs and prints them; Zod-validated         | Done |
| 5  | Strategy engine         | Pure functions for swings, trend, liquidity, sweep, BOS, trade ticket; Vitest tests incl. JPY and wick-only cases | Not started |
| 6  | Backtest runner         | Replays historical candles through the engine; outputs setups, win rate, net R, worst losing streak per pair | Not started |
| 7  | Worker scan loop        | Runs after each 15m close while market is open; saves recent candles; creates/updates alerts idempotently; heartbeat | Not started |
| 8  | Notifications           | Web push (long vibration, stays until tapped) + Resend email on Ready, to every subscribed device          | Not started |
| 9  | Dashboard: alerts       | Overview, Alerts list, Alert detail with mini chart, trade ticket, Ask Claude, Taken/Skip                  | Not started |
| 10 | Chart page              | Lightweight Charts from the Candle table; D/4H/15m; pair switch; level overlays from `lib/strategy/`; Ask Claude | Not started |
| 11 | Watchlist and settings  | Watchlist toggles and Settings page writing to the database                                                 | Not started |
| 12 | Journal and risk guard  | Journal results; daily/overall drawdown; warnings at agreed levels; overtrading and USD exposure warnings  | Not started |
| 13 | PWA and deploy          | Installable on Android; dashboard on Vercel; worker on Railway or VPS                                      | Not started |

## Decisions Made

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
- Alerts: web push + email. SMS paused.
- Price data: OANDA practice API (worker way, not TradingView webhooks).
- Full chart page: worker saves recent candles to Neon; the app never calls
  OANDA directly.
- "Ask Claude" button: copies an alert summary and opens the Claude app.
  A custom Claude connector may come later.
- Bottom tabs: Home, Alerts, Chart, Watchlist, Journal. Settings from Home.

## Open Questions

Defaults are used until DG confirms. Keep each one as a named constant or
setting.

| Question                                                        | Default for now            | Owner |
| --------------------------------------------------------------- | -------------------------- | ----- |
| Final strategy: SMC or support and resistance?                  | Rules above                | DG (sending chart screenshots) |
| Stop buffer beyond the sweep extreme                            | 3 pips                     | DG |
| How long a Watching alert waits for the 15m close before expiring | 2 hours                  | DG |
| Which swing counts as structure for the BOS                     | Last 15m swing before the sweep | DG |
| Swing detection: candles on each side of a swing point          | 2                          | DG |
| Tolerance for "equal" highs/lows                                | 2 pips                     | DG |
| Max trades per day before the overtrading warning               | 2                          | DG |
| Trading sessions to scan (London, New York, all)                | All while market is open   | DG |
| Avoid or allow setups around high-impact news                   | Allow (no news filter yet) | DG |
| Should Watching alerts also send a push, or only Ready?          | Ready only; Watching push is an off-by-default setting | DG |
| Account size                                                    | $10,000                    | DG |
| Gold pip size: the Unit 4 spec uses 0.1 (2 decimals); OANDA itself quotes XAU_USD to 3 decimals with a 0.01 pip. Which should lot sizing use when gold is switched on? | 0.1 pip, 2 decimals | DG |
| Newer context files (paper trades, settings history, strategy switch) mentioned in the Unit 4 prompt are not in `doc/context/`; the only `dg-signals-context.zip` on this machine is the original | Built Unit 4 from its own spec | Gambino |
| The two emails for `ALLOWED_EMAILS`                             | —                          | Gambino (goes in `.env`) |
| App icons (`favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `icon-192/512.png`, `icon-maskable-512.png`, `site.webmanifest`) are not in `public/` yet; the root layout already links to them | Links 404 until the files are added | Gambino |
| Overview eyebrow in the design is "Wed, 4 Nov · London session open". Which session names and hours (Lagos time) should drive the label? | Placeholder text "Today · market session" until Unit 9 | DG |

## Completed Work

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
