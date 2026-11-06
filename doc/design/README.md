# DG Signals — design reference

Static HTML for every screen of the app. Open `index.html` in a browser
(phone width, about 390px) and tap through. This folder is a **visual
reference** for the build: the real app rebuilds these screens as Next.js
pages and components. Do not copy this HTML into the app as-is.

## Pages

| File                | App route            | Notes                                                        |
| ------------------- | -------------------- | ------------------------------------------------------------ |
| `index.html`        | `/sign-in`           | Clerk email code; only emails in `ALLOWED_EMAILS` get in     |
| `overview.html`     | `/`                  | Red-news banner, risk guard, strategy scoreboard (paper results per strategy), latest alerts with strategy tags, scanner heartbeat |
| `alerts.html`       | `/alerts`            | Filters; strategy tags; "Show test signals" toggle (test signals muted, off by default); paper badges |
| `alert-detail.html` | `/alerts/[id]`       | "Seen by" strategy tags, news warning, mini chart, rules, trade ticket, paper trade, Ask Claude, Taken/Skip |
| `chart.html`        | `/chart?pair=EURUSD` | Full candlestick chart, D / 4H / 15m, DG's levels drawn      |
| `watchlist.html`    | `/watchlist`         | Switch pairs on/off; tap a pair to open its chart            |
| `journal.html`      | `/journal`           | Tabs: My trades (feeds risk guard) / All signals (strategy comparison table + filter); `#signals` opens the second tab |
| `settings.html`     | `/settings`          | Links to Change history, Strategies and Watchlist; account, prop firm limits, risk guard, DG v1 numbers, notifications |
| `settings-history.html` | `/settings/history` | Every saved change; Restore on older entries             |
| `strategies.html`   | `/strategies`        | Strategy cards (Live/Test/Off), confirm-to-Live sheet, 30-trade progress, rules |
| `news.html`         | `/news`              | Calendar (red events) and Headlines (High-impact posts/statements) tabs; news settings |
| `loading.html`      | —                    | Loading states: branded splash (cold start / after sign-in), then the Overview skeleton. "Replay splash" is demo only |

Bottom tabs: Home, Alerts, Chart, News, Journal. Settings opens from the
gear on Home; Watchlist and Strategies open from Settings.

## Shared files

- `styles.css` — design tokens (same as `context/ui-context.md`) and
  shared component styles. In the app, the tokens go in `globals.css`
  and Tailwind config.
- `app.js` — only makes the mockup clickable (tab bar, switches, chips,
  toasts).

## Things that are stand-ins

- **Strategy modes in the design:** DG v1 Live; DG v2, FVG Retest and Pro
  Sweep in Test.
- **Change history, strategy results, news events and headlines** are
  sample data. Headline rows marked [Example] are placeholders, not real
  statements.

- **All prices, alerts and journal entries are sample data.** In the app,
  every price comes from the price API (OANDA) through the worker.
- **The chart** is drawn with a small SVG script. The app uses
  TradingView Lightweight Charts (pinch to zoom, drag back in time) and
  reads candles from the `Candle` table the worker fills.
- **Ask Claude** copies a summary of the alert (pair, trend, sweep, break of
  structure, trade ticket, risk guard status and DG's rules) to the
  clipboard and opens `https://claude.ai/new`. DG pastes it and talks it
  through by text or voice. The real summary text is built from the alert,
  settings and risk state.
