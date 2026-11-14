# Backtest · London Breakout (`london-break`, LDN)

Generated 2026-11-14T11:27:37.287Z by `npm run backtest:report -- --strategy london-break` in 86.7 s.

- **Data:** OANDA mid prices (CSV in `scripts/backtest/data/`), M15 candles from 2025-10-01T00:00:00.000Z to 2026-11-13T21:45:00.000Z (UTC); D and 4H from the same start. Candles before 2026-01-01 are warm-up only.
- **Periods** (by the time a trade became Ready): in-sample 2026-01-01 → 2026-07-01; out-of-sample 2026-07-01 → 2026-11-13T22:00:00.000Z (latest data).
- **Costs:** none — mid prices, no spread, commission or slippage (same as the dg-v1 report). Real results would be worse.
- **Settings** (database, read-only): account $10000 fixed (no compounding), risk 0.5% ($50 = 1R), paper time limit 288 M15 candles. Strategy numbers are constants in `lib/strategy/london-break/`.
- **Reward ratio:** 1.5R, so the break-even win rate is 40.0% (1 ÷ (1 + R)).
- **Time exit:** a trade still open at 16:00 UTC on its day closes at that candle's close as Unresolved, with its R.
- **News rule not applied:** the live rule skips a breakout with red calendar news within 30 min, but there is no stored news history for the backtest period, so this backtest takes every breakout. Live results may have fewer trades.
- **Counting:** Trades = Ready alerts whose entry was filled (market entries always are). Win rate = W ÷ (W + L); Unresolved (time limit) is not in the win rate but its R is in net R; Not filled (limit entry never reached) is not a trade: 0R, not in win rate, R or streaks. Avg R = net R ÷ closed trades. Worst streak = longest run of losses in close order.

Sample results from historical data. Not a promise of future results, and not a judgement of the strategy.

## In-sample

| | Trades | W / L | Win rate | Net R | Avg R | Worst streak | Max DD | Unresolved | Not filled | Open at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **All 5 pairs** | 125 | 45 / 74 | 37.8% | −4.35R | −0.03R | 9 | 19.05R | 6 | 0 | 0 |
| EUR_USD | 38 | 13 / 24 | 35.1% | −4.63R | −0.12R | 8 | 10.64R | 1 | 0 | 0 |
| GBP_USD | 35 | 14 / 18 | 43.8% | +4.49R | +0.13R | 4 | 6.05R | 3 | 0 | 0 |
| USD_JPY | 17 | 3 / 12 | 20.0% | −6.71R | −0.39R | 4 | 8.21R | 2 | 0 | 0 |
| USD_CAD | 20 | 7 / 13 | 35.0% | −2.51R | −0.13R | 5 | 5.51R | 0 | 0 | 0 |
| USD_CHF | 15 | 8 / 7 | 53.3% | +5.01R | +0.33R | 3 | 3.00R | 0 | 0 | 0 |

Setups (sweeps): 147 · confirmed (Ready) 125 · expired 0 · skipped (invalid) 22.

Break-even win rate at 1.5R: 40.0%. Win rate 37.8% is **below** it.

## Out-of-sample

| | Trades | W / L | Win rate | Net R | Avg R | Worst streak | Max DD | Unresolved | Not filled | Open at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **All 5 pairs** | 90 | 41 / 47 | 46.6% | +14.29R | +0.16R | 7 | 7.74R | 2 | 0 | 0 |
| EUR_USD | 20 | 10 / 9 | 52.6% | +6.04R | +0.30R | 3 | 3.00R | 1 | 0 | 0 |
| GBP_USD | 29 | 11 / 17 | 39.3% | −0.78R | −0.03R | 5 | 5.50R | 1 | 0 | 0 |
| USD_JPY | 11 | 6 / 5 | 54.5% | +4.01R | +0.36R | 3 | 3.00R | 0 | 0 | 0 |
| USD_CAD | 16 | 8 / 8 | 50.0% | +4.03R | +0.25R | 2 | 2.51R | 0 | 0 | 0 |
| USD_CHF | 14 | 6 / 8 | 42.9% | +0.99R | +0.07R | 2 | 2.50R | 0 | 0 | 0 |

Setups (sweeps): 116 · confirmed (Ready) 90 · expired 0 · skipped (invalid) 26.

Break-even win rate at 1.5R: 40.0%. Win rate 46.6% is **above** it.

## Comparison (all 5 pairs, same periods, same settings)

| Strategy | Period | Trades | Win rate | Break-even | Net R | Avg R | Worst streak | Max DD | Unresolved |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| London Breakout (`london-break`) | In-sample | 125 | 37.8% | 40.0% | −4.35R | −0.03R | 9 | 19.05R | 6 |
| DG v1 · Original (`dg-v1`) | In-sample | 33 | 26.7% | 25.0% | +5.01R | +0.15R | 6 | 6.00R | 3 |
| FVG Retest (`gemini-fvg`) | In-sample | 45 | 21.4% | 25.0% | −2.79R | −0.06R | 14 | 15.00R | 3 |
| London Breakout (`london-break`) | Out-of-sample | 90 | 46.6% | 40.0% | +14.29R | +0.16R | 7 | 7.74R | 2 |
| DG v1 · Original (`dg-v1`) | Out-of-sample | 18 | 22.2% | 25.0% | −2.22R | −0.12R | 13 | 13.22R | 0 |
| FVG Retest (`gemini-fvg`) | Out-of-sample | 30 | 41.7% | 25.0% | +21.20R | +0.73R | 4 | 4.06R | 5 |

