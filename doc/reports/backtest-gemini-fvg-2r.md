# Backtest · FVG Retest · 1:2 (`gemini-fvg-2r`, FVG2)

Generated 2026-11-14T11:27:34.501Z by `npm run backtest:report -- --strategy gemini-fvg-2r` in 83.9 s.

- **Data:** OANDA mid prices (CSV in `scripts/backtest/data/`), M15 candles from 2025-10-01T00:00:00.000Z to 2026-11-13T21:45:00.000Z (UTC); D and 4H from the same start. Candles before 2026-01-01 are warm-up only.
- **Periods** (by the time a trade became Ready): in-sample 2026-01-01 → 2026-07-01; out-of-sample 2026-07-01 → 2026-11-13T22:00:00.000Z (latest data).
- **Costs:** none — mid prices, no spread, commission or slippage (same as the dg-v1 report). Real results would be worse.
- **Settings** (database, read-only): account $10000 fixed (no compounding), risk 0.5% ($50 = 1R), paper time limit 288 M15 candles. Strategy numbers are constants in `lib/strategy/gemini-fvg-2r/`.
- **Reward ratio:** 2R, so the break-even win rate is 33.3% (1 ÷ (1 + R)).
- **Counting:** Trades = Ready alerts whose entry was filled (market entries always are). Win rate = W ÷ (W + L); Unresolved (time limit) is not in the win rate but its R is in net R; Not filled (limit entry never reached) is not a trade: 0R, not in win rate, R or streaks. Avg R = net R ÷ closed trades. Worst streak = longest run of losses in close order.

Sample results from historical data. Not a promise of future results, and not a judgement of the strategy.

## In-sample

| | Trades | W / L | Win rate | Net R | Avg R | Worst streak | Max DD | Unresolved | Not filled | Open at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **All 5 pairs** | 45 | 11 / 31 | 26.2% | −5.79R | −0.13R | 14 | 16.81R | 3 | 8 | 0 |
| EUR_USD | 5 | 2 / 3 | 40.0% | +0.93R | +0.19R | 1 | 1.07R | 0 | 4 | 0 |
| GBP_USD | 9 | 1 / 8 | 11.1% | −6.00R | −0.67R | 7 | 7.00R | 0 | 1 | 0 |
| USD_JPY | 5 | 1 / 3 | 25.0% | +0.26R | +0.05R | 3 | 3.00R | 1 | 0 | 0 |
| USD_CAD | 15 | 4 / 9 | 30.8% | +1.02R | +0.07R | 8 | 8.00R | 2 | 0 | 0 |
| USD_CHF | 11 | 3 / 8 | 27.3% | −2.00R | −0.18R | 3 | 4.00R | 0 | 3 | 0 |

Setups (sweeps): 465 · confirmed (Ready) 53 · expired 412 · skipped (invalid) 0.

Break-even win rate at 2R: 33.3%. Win rate 26.2% is **below** it.

## Out-of-sample

| | Trades | W / L | Win rate | Net R | Avg R | Worst streak | Max DD | Unresolved | Not filled | Open at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **All 5 pairs** | 31 | 14 / 13 | 51.9% | +16.46R | +0.55R | 4 | 4.00R | 3 | 8 | 1 |
| EUR_USD | 9 | 6 / 3 | 66.7% | +9.00R | +1.00R | 2 | 2.00R | 0 | 1 | 0 |
| GBP_USD | 7 | 3 / 3 | 50.0% | +3.22R | +0.46R | 2 | 2.00R | 1 | 1 | 0 |
| USD_JPY | 2 | 2 / 0 | 100.0% | +4.00R | +2.00R | 0 | 0.00R | 0 | 3 | 0 |
| USD_CAD | 6 | 1 / 4 | 20.0% | −2.48R | −0.41R | 4 | 4.48R | 1 | 2 | 0 |
| USD_CHF | 7 | 2 / 3 | 40.0% | +2.72R | +0.45R | 2 | 2.00R | 1 | 1 | 1 |

Setups (sweeps): 324 · confirmed (Ready) 39 · expired 285 · skipped (invalid) 0.

Break-even win rate at 2R: 33.3%. Win rate 51.9% is **above** it.

## Comparison (all 5 pairs, same periods, same settings)

| Strategy | Period | Trades | Win rate | Break-even | Net R | Avg R | Worst streak | Max DD | Unresolved |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| FVG Retest · 1:2 (`gemini-fvg-2r`) | In-sample | 45 | 26.2% | 33.3% | −5.79R | −0.13R | 14 | 16.81R | 3 |
| FVG Retest (`gemini-fvg`) | In-sample | 45 | 21.4% | 25.0% | −2.79R | −0.06R | 14 | 15.00R | 3 |
| FVG Retest · 1:2 (`gemini-fvg-2r`) | Out-of-sample | 31 | 51.9% | 33.3% | +16.46R | +0.55R | 4 | 4.00R | 3 |
| FVG Retest (`gemini-fvg`) | Out-of-sample | 30 | 41.7% | 25.0% | +21.20R | +0.73R | 4 | 4.06R | 5 |

