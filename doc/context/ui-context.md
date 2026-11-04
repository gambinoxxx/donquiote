# UI Context

## Theme

Dark only, no light mode. A calm trading-terminal look: near-black
background, layered dark surfaces, one warm amber accent for anything that
needs action, and monospace numbers for prices. Built mobile-first for
DG's Android phone and installed as a PWA. The visual reference is the
`design/` folder: static HTML for all eight screens, with the same tokens
in `design/styles.css`. Rebuild the screens in Next.js to match it; do not
copy the HTML in directly.

## Colors

All components use these tokens. No hardcoded hex values.

| Role                | CSS Variable         | Value     |
| ------------------- | -------------------- | --------- |
| Page background     | `--bg-base`          | `#0E1116` |
| Surface             | `--bg-surface`       | `#171B22` |
| Nav bar             | `--bg-nav`           | `#12161C` |
| Primary text        | `--text-primary`     | `#E8EAED` |
| Muted text          | `--text-muted`       | `#9AA3AE` |
| Primary accent      | `--accent-primary`   | `#F5B544` |
| Text on accent      | `--accent-on`        | `#1A1406` |
| Border              | `--border-default`   | `#262C36` |
| Input border        | `--border-input`     | `#333B47` |
| Buy                 | `--trade-buy`        | `#6AAEFF` |
| Buy background      | `--trade-buy-bg`     | `#16253A` |
| Sell                | `--trade-sell`       | `#FF9A60` |
| Sell background     | `--trade-sell-bg`    | `#3A2416` |
| Error               | `--state-error`      | `#FF6B5B` |
| Success / cleared   | `--state-success`    | `#4C9AFF` |
| Warning background  | `--state-warn-bg`    | `#2A2110` |

Buy is blue and sell is orange (not green and red) so they stay clear for
colour-blind users.

## Typography

| Role               | Font           | Variable      |
| ------------------ | -------------- | ------------- |
| UI text            | Inter          | `--font-sans` |
| Prices and numbers | JetBrains Mono | `--font-mono` |

- Page titles: 28px bold, slight negative letter spacing.
- Section labels: 12–13px, uppercase, muted.
- All prices, lot sizes and percentages use the mono font.

## Border Radius

| Context                      | Class           |
| ---------------------------- | --------------- |
| Badges, chips, small buttons | `rounded-lg`    |
| Inputs, main buttons         | `rounded-xl`    |
| Cards / panels               | `rounded-2xl`   |

## Component Library

shadcn/ui on top of Tailwind. Components live in `components/ui/`. Add new
ones with the shadcn CLI rather than writing from scratch, then theme them
with the tokens above.

## Layout Patterns

- App shell: full-height column, max width 480px centred, scrolling
  content, fixed bottom tab bar (Home, Alerts, Chart, Watchlist, Journal).
  Settings opens from a gear button on Home.
- Chart page: pair chips (scroll sideways), D / 4H / 15m segmented
  control, chart card with price tags on the right axis, level toggles
  below. Level colours: previous day high/low = accent amber dashed; equal
  highs/lows = light grey dotted; entry = white solid; stop = sell orange
  dashed; target = buy blue dashed. Candles: up = buy blue, down = sell
  orange.
- "Ask Claude" button: outlined amber, chat-bubble icon, full width.
- Content padding: 16px sides, 24px top.
- Cards: surface background, 1px border, 14–16px padding.
- Lists: rows inside one card, separated by borders, whole row tappable.
- Alert row: direction badge (BUY/SELL), pair, status badge, one-line
  reason, time.
- Status badges: Ready = solid amber; Watching = outlined; Expired = muted
  text.
- Trade ticket: 3-column grid of label/value cells; lot size highlighted.
- Primary actions sit at the bottom of the screen within thumb reach.

## Icons

Lucide React. Stroke icons only. Sizes: `h-4 w-4` inline, `h-5 w-5` in
buttons, `h-6 w-6` in the tab bar. Icon-only buttons need an `aria-label`.
