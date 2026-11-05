# UI Context

## Theme

Dark only, no light mode. A calm trading-terminal look: near-black
background, layered dark surfaces, one warm amber accent for anything that
needs action, and monospace numbers for prices. Built mobile-first for
DG's Android phone and installed as a PWA. The visual reference is the
`doc/design/` folder: static HTML for all eight screens, with the same tokens
in `doc/design/styles.css`. Rebuild the screens in Next.js to match it; do not
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
| Skeleton block      | `--skeleton`         | `#1E232B` |

Buy is blue and sell is orange (not green and red) so they stay clear for
colour-blind users.

## Typography

| Role               | Font           | Variable      |
| ------------------ | -------------- | ------------- |
| UI text            | Inter          | `--font-sans` |
| Prices and numbers | JetBrains Mono | `--font-mono` |
| Brand wordmark (splash only) | Sora 700 | `--font-brand` |

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
- Paper result badges: Win = buy-blue on buy-bg ("+3R · +$150"); Loss =
  sell-orange on sell-bg ("−1R · −$50"); Open = outlined grey "Tracking";
  Unresolved = muted text. Always show R and dollars together, R first.
- Paper result on alert detail: a card under the trade ticket titled
  "Paper trade", with the badge, how it ended ("Target hit after 3h 15m")
  and a one-line muted note: "Assumes entry at alert price. No spread or
  slippage."
- System score card on Home: section label "System score · last 14
  days", big net dollars and net R, then a row "12 signals · 5 W · 6 L · 1
  open", and a "See all" link to Journal › All signals.
- Journal tabs: a 2-option segmented control at the top ("My trades" /
  "All signals"), full width, same style as the timeframe control. All
  signals has a strategy filter chip row when more than one strategy has
  alerts.
- Strategy in Settings: one row per registered strategy with its name, a
  one-line description, and a 3-option segmented control Live / Test /
  Off. Switching Live asks for a confirm ("Make DG v2 live? DG v1 goes to
  Test.").
- Change history: list rows with date/time, who, and up to two changed
  fields ("Risk per trade 0.5% → 1%"), "+N more" if longer, and a
  "Restore" button (outlined). The newest row is marked "Current" and has
  no Restore button.

## Loading States

Reference: `doc/design/loading.html` (splash, then the Overview skeleton).

- **Splash (brand loader)** — only on a cold start (opening the installed
  app) and straight after sign-in, while the first screen has nothing to
  show. Full screen `--bg-base`; centred 96px amber rounded-square mark
  (the Donquixote lance-and-ring icon) that draws in (ring, then lance,
  then tip) and then breathes gently; below it "Donquixote" (Sora 700,
  26px) with "FX" in mono amber; a muted status line ("Checking your
  setups…"). It fades out as soon as data is ready. **No artificial
  minimum time.** Never shown on tab switches or in-app navigation.
- **Skeletons** — every page's `loading.tsx` (and any client section that
  fetches) shows grey blocks in the exact layout of the real page: same
  cards, rows and sizes, so nothing jumps when data arrives. Block colour
  `#1E232B`, radius 6px (cards keep their own radius), a subtle shimmer
  sweep. The tab bar and page title stay real, not skeletons.
- **Buttons that save** (Save changes, Restore, Taken/Skip) show an inline
  spinner and are disabled while saving; no full-page loader.
- **Reduced motion** — with `prefers-reduced-motion`, no drawing,
  breathing or shimmer; show the static mark and static grey blocks.
- **Accessibility** — splash has `role="status"` and an `aria-label`;
  skeleton containers set `aria-busy="true"`.

## Icons

Lucide React. Stroke icons only. Sizes: `h-4 w-4` inline, `h-5 w-5` in
buttons, `h-6 w-6` in the tab bar. Icon-only buttons need an `aria-label`.
