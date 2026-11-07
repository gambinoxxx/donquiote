# Backtest · Pro Sweep (`pro-v1-swing`, PRO)

Generated 2026-11-07T08:56:42.831Z by `npm run backtest:report -- --strategy pro-v1-swing` in 14.7 s.

- **Data:** OANDA mid prices (CSV in `scripts/backtest/data/`), M15 candles from 2025-10-01T00:00:00.000Z to 2026-11-04T23:45:00.000Z (UTC); D and 4H from the same start. Candles before 2026-01-01 are warm-up only.
- **Periods** (by the time a trade became Ready): in-sample 2026-01-01 → 2026-07-01; out-of-sample 2026-07-01 → 2026-11-05T00:00:00.000Z (latest data).
- **Costs:** none — mid prices, no spread, commission or slippage (same as the dg-v1 report). Real results would be worse.
- **Settings** (database, read-only): account $10000 fixed (no compounding), risk 0.5% ($50 = 1R), paper time limit 288 M15 candles. Strategy numbers are constants in `lib/strategy/pro-v1-swing/`.
- **Counting:** Trades = Ready alerts whose entry was filled (market entries always are). Win rate = W ÷ (W + L); Unresolved (time limit) is not in the win rate but its R is in net R; Not filled (limit entry never reached) is not a trade: 0R, not in win rate, R or streaks. Avg R = net R ÷ closed trades. Worst streak = longest run of losses in close order.

Sample results from historical data. Not a promise of future results, and not a judgement of the strategy.

## In-sample

| | Trades | W / L | Win rate | Net R | Avg R | Worst streak | Max DD | Unresolved | Not filled | Open at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **All 5 pairs** | 89 | 25 / 63 | 28.4% | +11.46R | +0.13R | 10 | 12.00R | 1 | 0 | 0 |
| EUR_USD | 15 | 4 / 11 | 26.7% | +1.00R | +0.07R | 4 | 4.00R | 0 | 0 | 0 |
| GBP_USD | 16 | 2 / 14 | 12.5% | −8.00R | −0.50R | 7 | 10.00R | 0 | 0 | 0 |
| USD_JPY | 27 | 11 / 16 | 40.7% | +17.00R | +0.63R | 5 | 5.00R | 0 | 0 | 0 |
| USD_CAD | 22 | 8 / 13 | 38.1% | +10.46R | +0.48R | 4 | 4.00R | 1 | 0 | 0 |
| USD_CHF | 9 | 0 / 9 | 0.0% | −9.00R | −1.00R | 9 | 9.00R | 0 | 0 | 0 |

Setups (sweeps): 114 · confirmed (Ready) 89 · expired 14 · skipped (invalid) 11.

## Out-of-sample

| | Trades | W / L | Win rate | Net R | Avg R | Worst streak | Max DD | Unresolved | Not filled | Open at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **All 5 pairs** | 56 | 13 / 42 | 23.6% | −3.05R | −0.05R | 17 | 18.05R | 1 | 0 | 0 |
| EUR_USD | 5 | 1 / 4 | 20.0% | −1.00R | −0.20R | 3 | 3.00R | 0 | 0 | 0 |
| GBP_USD | 10 | 3 / 7 | 30.0% | +2.00R | +0.20R | 5 | 5.00R | 0 | 0 | 0 |
| USD_JPY | 10 | 2 / 8 | 20.0% | −2.00R | −0.20R | 7 | 7.00R | 0 | 0 | 0 |
| USD_CAD | 13 | 5 / 7 | 41.7% | +7.95R | +0.61R | 4 | 4.00R | 1 | 0 | 0 |
| USD_CHF | 18 | 2 / 16 | 11.1% | −10.00R | −0.56R | 10 | 11.00R | 0 | 0 | 0 |

Setups (sweeps): 71 · confirmed (Ready) 56 · expired 12 · skipped (invalid) 3.

## Trade count vs the reference script

| Pair | In-sample app | In-sample ref | Out-of-sample app | Out-of-sample ref |
| --- | ---: | ---: | ---: | ---: |
| EUR_USD | 15 | 15 | 5 | 5 |
| GBP_USD | 16 | 16 | 10 | 10 |
| USD_JPY | 27 | 27 | 10 | 10 |
| USD_CAD | 22 | 22 | 13 | 13 |
| USD_CHF | 9 | 9 | 18 | 18 |
| **All 5** | **89** | **89** (+0%) | **56** | **56** (+0%) |

### Comparison (written by hand, 2026-11-07)

The reference is `prov1.py` → `run(pair, bias_mode="swing", spread_on=False)` (no spread, like this report), counted by the close time of the break candle. The trade counts are **identical on every pair in both periods** (89 / 56). With `spread_on=True` the reference has a few more trades (90 / 58): the spread is added to the stop distance, so some stops just under 6 pips move into the 6–35 range. This report uses no spread, like the dg-v1 report, so the no-spread reference is the right comparison.
