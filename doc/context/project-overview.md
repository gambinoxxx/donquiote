# DG Signals

## Overview

DG Signals is a private web app (two users: DG and Gambino) that watches DG's forex pairs
around the clock and tells him when his own trading setup appears. It does
not trade. It spots the setup, works out the full trade ticket (entry,
stop, target, lot size) and grabs DG's attention with a strong phone
notification and an email, so he can place the trade himself on his prop
firm's MetaTrader. It also acts as his rule-keeper: it tracks his daily and
overall drawdown against his prop firm limits and warns him before he
breaks them, so he trades by rules instead of emotion.

## Goals

1. Catch every valid instance of DG's setup on his watchlist within one
   minute of the confirming 15-minute candle closing.
2. Deliver each "Ready" alert to DG's Android phone as a high-priority push
   notification (long vibration, stays until tapped) plus an email backup.
3. Give every alert a complete, correct trade ticket at a fixed 1:3
   risk-to-reward and his chosen risk per trade.
4. Warn DG before he gets close to his prop firm's 3% daily or 10% overall
   loss limits.
5. Make it possible to backtest the strategy on historical data, so DG can
   see its real win rate before trusting it with money.
6. Forward-test every signal automatically: record a paper trade for each
   Ready alert, whether DG takes it or not, and show what it would have
   made or lost. Run this for a few weeks before trading real money.
7. Let DG change his numbers in the app, undo any change, and try a new
   strategy next to the old one without losing it.

## Core User Flow

1. DG signs in on his Android phone with an email code and installs the app
   to his home screen.
2. He sets his account size, risk per trade and watchlist in Settings.
3. The worker scans his enabled pairs after every 15-minute candle closes.
4. When price sweeps liquidity against the higher-timeframe trend, an alert
   appears as "Watching".
5. When a 15-minute candle body closes past structure, the alert becomes
   "Ready", and DG gets a push notification and an email.
6. DG opens the alert, checks the chart and the trade ticket. If he wants
   a second opinion, he taps "Ask Claude", which copies the full setup and
   opens the Claude app, where he pastes it and talks it through.
7. He either places the trade manually on MetaTrader or skips it.
8. He marks the alert as Taken or Skipped, and later as Win, Loss or
   Break-even.
9. Whether he took it or not, the system follows the signal as a paper
   trade until it hits the target or the stop, and records the result in
   R and dollars.
10. At any time he can open the Chart tab to see any pair with his levels
   drawn on it.
11. The Overview shows his risk guard status, today's trade count, the
   system's paper-trade score and the latest alerts.

## Strategy (current version)

This is DG's stated setup, registered as strategy **`dg-v1`** ("DG v1 ·
sweep + 15m BOS"). The final version may change after we review his chart
screenshots (SMC vs support and resistance is still open), so every
strategy lives behind one `Strategy` interface and a registry, and new
versions are added next to old ones, never written over them (see Strategy
switch below).

1. **Trend:** daily and 4H must agree. Bullish = higher highs and higher
   lows; bearish = lower highs and lower lows. If they disagree, no trade.
   DG never trades against the trend.
2. **Liquidity:** equal highs/lows, and the previous day's high/low.
3. **Sweep:** price trades through a liquidity level against the trend
   (above a high in a downtrend, below a low in an uptrend). Alert becomes
   "Watching".
4. **Confirmation (break of structure):** a 15-minute candle **body closes**
   past the last 15-minute swing point, back in the trend direction. A wick
   does not count. Alert becomes "Ready".
5. **Trade ticket:**
   - Entry: close of the confirming 15m candle.
   - Stop: beyond the sweep extreme plus a buffer.
   - Target: exactly 3× the stop distance (1:3), regardless of where
     liquidity sits.
   - Lot size: risks the chosen percentage of the account (default 0.5%,
     option 1%).

## Features

### Scanning and alerts

- Worker scans EUR/USD, GBP/USD, USD/JPY, USD/CAD and USD/CHF (gold can be
  added later as a switch)
- Two-stage alerts: Watching (sweep happened) → Ready (structure broken)
- Alerts expire if no confirmation comes within the expiry window
- Full trade ticket on every Ready alert
- Warning on an alert when a USD trade is already open, since all five
  pairs move with the dollar

### Notifications

- Web push to the installed app on Android: long vibration pattern,
  `requireInteraction` so it stays until tapped
- Email backup through Resend
- SMS is paused (not in scope for now)

### Dashboard (mobile-first PWA)

The visual reference is the `doc/design/` folder (static HTML for every
screen). Bottom tabs: Home, Alerts, Chart, Watchlist, Journal. Settings
opens from the gear on Home.

- Sign in (email code; two allowed emails)
- Overview: risk guard status, today's trades, system score card (paper
  trades, last 14 days), latest alerts, scanner online/offline
- Alerts list with filters (All, Ready, Watching, Expired); each Ready
  alert shows its paper result once decided
- Alert detail: mini chart with sweep, entry, stop and target; rule
  checklist; trade ticket; paper-trade result; "Ask Claude"; Taken/Skip
  buttons
- Chart: full candlestick chart for any watchlist pair; switch daily, 4H
  and 15m; pinch to zoom and scroll back; toggles to draw previous day
  high/low, equal highs/lows and active trade levels
- Watchlist: switch each pair on or off, see its current daily/4H bias,
  tap to open its chart
- Journal with two tabs:
  - **My trades:** only trades DG took, with his logged results (feeds
    the risk guard)
  - **All signals:** every Ready alert with its paper result, plus totals
    (signals, wins, losses, win rate, net R, net $)
- Settings: strategy (active and test), account size, risk %, prop firm
  limits, risk guard levels, strategy numbers (stop buffer, expiry,
  equal-highs tolerance), notification toggles, link to Change history
- Settings › Change history (`/settings/history`): every saved change with
  date, who changed it and what changed; "Restore" on any entry

### Ask Claude (second opinion)

- Button on the alert detail and chart pages
- Copies a plain-text summary to the clipboard: pair, direction, status,
  time, daily/4H trend, liquidity swept, break-of-structure close, entry,
  stop, target, risk, lot size, risk guard status and DG's rules
- Then opens `https://claude.ai/new`, where DG pastes it and talks it
  through by text or voice
- The summary asks Claude to check the setup against DG's rules (and for
  news or USD exposure), not to predict whether it wins
- Later option (not now): a custom Claude connector (MCP server) so DG can
  just say "check my latest alert" with no copy and paste

### Paper trades (forward testing)

- Every alert that reaches **Ready** opens a paper trade automatically, as
  if DG entered at the alert's entry price with the alert's stop, target
  and lot size. It does not matter whether he took it.
- Each worker cycle checks newly closed 15m candles for every open paper
  trade:
  - target reached first → **Win**, +3R (+ `riskUsd` × 3)
  - stop reached first → **Loss**, −1R (− `riskUsd`)
  - both inside the same 15m candle → counted as a **Loss** (we can't tell
    which came first, so assume the worse case)
  - neither within the time limit (`paperTimeoutHours`, default 72 hours
    of market time) → **Unresolved**, closed at the last price, result in
    R recorded but shown separately
- Dollar results use the trade ticket saved on the alert (its lot size and
  `riskUsd` at the time), not today's settings.
- Results show on the alert, in Journal › All signals, and as the system
  score card on Home.
- Limits, shown in the app as a note: entry assumed at the alert price; no
  spread, commission or slippage, so real results will be a little worse.
- Paper trades never send notifications and never affect the risk guard.

### Settings history (undo)

- Every save on the Settings or Watchlist page stores a full snapshot of
  settings + watchlist, with time, the signed-in email and a list of what
  changed.
- Change history page lists them newest first. "Restore" puts that
  snapshot back (and itself is saved as a new history entry, so a restore
  can be undone too).
- The worker always reads the current settings, so a restore takes effect
  on the next scan.

### Strategy switch

- Strategies are code modules registered by id (e.g. `dg-v1`, later
  `dg-v2-smc`). A new idea = a new module next to the old one; old ones are
  never edited or deleted once they have alerts.
- On the Strategies screen (`/strategies`), each registered strategy has a
  mode:
  - **Live** — sends notifications and appears in Alerts. At least one
    strategy is Live; more than one is allowed (their alerts on the same
    pair + direction within 30 min merge into one alert).
  - **Test** — runs on every scan and records alerts and paper trades,
    but sends no notifications and is hidden from the main Alerts list
    (visible in Journal › All signals with a strategy filter).
  - **Off** — not run.
- Every alert and paper trade stores the strategy id it came from, so
  results can be compared per strategy.
- Switching which strategy is Live is a settings change, so it is in the
  history and can be undone.
- Before a new strategy goes Live: backtest it (Unit 6 runner takes a
  strategy id), then run it in Test for a while. Results are labelled
  "early" until 30 paper trades; switching to Live needs a confirm sheet
  that warns when under 30.

### Registered strategies

| Id | Name in app | Code | Default mode | Rules |
| --- | --- | --- | --- | --- |
| `dg-v1` | DG v1 · Original | V1 | **Live** | Strategy (current version) above |
| `dg-v2-candidate` | DG v2 · Strong liquidity | V2 | Test | dg-v1, but liquidity = previous day high/low, Asian session high/low (forex-day open → 07:00 UTC), and 1H equal highs/lows (2 confirmed 1H swings within the tolerance, current + previous forex day). No 15m equal highs/lows. |
| `gemini-fvg` | FVG Retest | FVG | Test | Direction from the 15m close vs EMA50 of closed 4H candles. Liquidity = previous day or Asian high/low; sweeps only 07–11 or 13–17 UTC. Within 8 candles after the sweep, a 15m displacement candle in the trade direction (body > 1.5× ATR14) leaving a fair value gap (bearish: next candle's high < previous candle's low). Limit entry at the gap's near edge, valid 16 candles; stop 2 pips beyond the sweep extreme; target 3R. |
| `pro-v1-swing` | Pro Sweep | PRO | Test | D + 4H swing trend agree. Liquidity = previous day high/low and the last closed 4H high/low. Sweep candle trades through the level and closes back inside (within 1 pip); within 8 candles a 15m close ≥ 0.5 pip beyond the level in the trend direction → entry at that close. Stop = sweep extreme ± 3 pips, must be 6–35 pips; target 3R; 07–16 UTC; max 1 trade per pair per forex day. |

Backtests in our own engine come first; numbers quoted by outside AIs are
not trusted until reproduced.

### News

Two layers, both in the **News** tab (which replaces Watchlist in the tab
bar; Watchlist moves to Settings):

1. **Calendar** — scheduled high-impact ("red") events only (CPI, NFP,
   FOMC, central bank decisions…) for USD, EUR, GBP, JPY, CAD, CHF.
   Countdown, forecast/previous, actual vs forecast after release.
2. **Headlines** — unscheduled market-moving news: Trump posts and
   statements, White House actions (e.g. tariffs, executive orders), Fed
   and other central bank statements. Pulled from a financial news
   headline feed (which reports Trump's Truth Social posts within minutes)
   plus official White House and Federal Reserve feeds where available.
   Each headline is classified (keywords first, then an AI model) as High
   or Normal impact with the affected currencies; **only High is shown in
   red and can notify**.

Behaviour:
- Red banner on Home when red calendar news is within 30 min, or a High
  headline arrived in the last 15 min.
- Alerts within ±30 min of red calendar news, or within 15 min after a
  High headline, on an affected currency get a **news warning** (warn
  only; DG decides).
- Optional push: 15 min before red calendar news; immediately for High
  headlines (separate toggles, both default on).
- Honest limit: a headline reaches the app 1–5 min after it happens, after
  fast algorithms have already moved price. The point is to **warn and
  avoid**, not to trade the headline.
- Out of scope for now: the official Truth Social "Truth API" (institutional,
  reportedly up to $100k/month) and scraping Truth Social directly.

### Risk guard

- Prop firm limits: 3% daily loss, 10% max drawdown
- Warn at −1.5% today; "done for the day" at −2% today
- Warn at −5% overall
- Overtrading warning after a set number of trades per day
- Source of P&L: DG's journal entries (the app is not connected to his
  broker, so it only knows what he logs)

### Backtesting

- Replay historical candles through the same strategy engine and the same
  paper-trade resolver used live
- Takes a strategy id, so any registered strategy can be tested
- Output: number of setups, win rate, net R, worst losing streak, per pair

## Scope

### In Scope

- Forex pairs only, two users (DG and Gambino) sharing one account's data
- Alerts, trade tickets, chart page, Ask Claude button, journal, risk
  guard, backtesting, paper trades, settings history, strategy switch,
  four registered strategies, News (calendar + headlines)
- OANDA v20 API (practice account) as the price source

### Out of Scope

- Placing, modifying or closing trades automatically (DG's prop firm
  forbids expert advisors; this app must never place orders)
- Connecting to DG's MetaTrader or broker account
- SMS alerts (paused)
- Crypto order-flow features, news sentiment and multi-user accounts
  (possible later)
- TradingView webhooks (possible later if DG gets a paid plan)
- An AI assistant built into the app, and the Claude connector (MCP
  server); "Ask Claude" hands off to the Claude app instead
- Drawing tools on the chart

## Success Criteria

1. DG and Gambino can each sign in on an Android phone and install the
   app to the home screen; any other email is refused.
2. The worker runs continuously and creates Watching and Ready alerts that
   match the strategy rules on live price data.
3. A Ready alert produces a vibrating push notification and an email within
   one minute of the 15m candle close.
4. Every trade ticket shows the correct stop, 1:3 target and lot size for
   the account size and risk setting, for all five pairs including JPY.
5. The risk guard shows the right status from journal entries and warns at
   the agreed levels.
6. The Chart page shows real candles for every watchlist pair on
   daily, 4H and 15m, with the level overlays matching the strategy engine.
7. "Ask Claude" copies a complete, correct summary and opens Claude.
8. A backtest over January 2026 to now on EUR/USD and GBP/USD produces
   win rate, net R and worst losing streak.
9. Every Ready alert gets a paper trade that resolves to Win, Loss or
   Unresolved by the rules above, and Journal › All signals totals match
   the individual results.
10. Changing a setting creates a history entry; restoring an older entry
   brings those values back and the next scan uses them.
11. A second strategy can run in Test mode next to the Live one without
   sending notifications, and its results show separately.
