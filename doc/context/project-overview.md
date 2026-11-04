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
9. At any time he can open the Chart tab to see any pair with his levels
   drawn on it.
10. The Overview shows his risk guard status, today's trade count and the
   latest alerts.

## Strategy (current version)

This is DG's stated setup. The final version may change after we review
his chart screenshots (SMC vs support and resistance is still open), so the
strategy must live behind one swappable module.

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

The visual reference is the `design/` folder (static HTML for every
screen). Bottom tabs: Home, Alerts, Chart, Watchlist, Journal. Settings
opens from the gear on Home.

- Sign in (email code; two allowed emails)
- Overview: risk guard status, today's trades, latest alerts, scanner
  online/offline
- Alerts list with filters (All, Ready, Watching, Expired)
- Alert detail: mini chart with sweep, entry, stop and target; rule
  checklist; trade ticket; "Ask Claude"; Taken/Skip buttons
- Chart: full candlestick chart for any watchlist pair; switch daily, 4H
  and 15m; pinch to zoom and scroll back; toggles to draw previous day
  high/low, equal highs/lows and active trade levels
- Watchlist: switch each pair on or off, see its current daily/4H bias,
  tap to open its chart
- Journal: Taken/Skipped/Win/Loss log with win rate and net R
- Settings: account size, risk %, prop firm limits, risk guard levels,
  notification toggles

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

### Risk guard

- Prop firm limits: 3% daily loss, 10% max drawdown
- Warn at −1.5% today; "done for the day" at −2% today
- Warn at −5% overall
- Overtrading warning after a set number of trades per day
- Source of P&L: DG's journal entries (the app is not connected to his
  broker, so it only knows what he logs)

### Backtesting

- Replay historical candles through the same strategy engine
- Output: number of setups, win rate, net R, worst losing streak, per pair

## Scope

### In Scope

- Forex pairs only, two users (DG and Gambino) sharing one account's data
- Alerts, trade tickets, chart page, Ask Claude button, journal, risk
  guard, backtesting
- OANDA practice account API as the price source

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
   match the strategy rules on live OANDA data.
3. A Ready alert produces a vibrating push notification and an email within
   one minute of the 15m candle close.
4. Every trade ticket shows the correct stop, 1:3 target and lot size for
   the account size and risk setting, for all five pairs including JPY.
5. The risk guard shows the right status from journal entries and warns at
   the agreed levels.
6. The Chart page shows real OANDA candles for every watchlist pair on
   daily, 4H and 15m, with the level overlays matching the strategy engine.
7. "Ask Claude" copies a complete, correct summary and opens Claude.
8. A backtest over January 2026 to now on EUR/USD and GBP/USD produces
   win rate, net R and worst losing streak.
