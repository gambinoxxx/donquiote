# Backtest · DG v2 · Strong liquidity (`dg-v2-candidate`, V2)

Generated 2026-11-07T08:55:59.558Z by `npm run backtest:report -- --strategy dg-v2-candidate` in 29.1 s.

- **Data:** OANDA mid prices (CSV in `scripts/backtest/data/`), M15 candles from 2025-10-01T00:00:00.000Z to 2026-11-04T23:45:00.000Z (UTC); D and 4H from the same start. Candles before 2026-01-01 are warm-up only.
- **Periods** (by the time a trade became Ready): in-sample 2026-01-01 → 2026-07-01; out-of-sample 2026-07-01 → 2026-11-05T00:00:00.000Z (latest data).
- **Costs:** none — mid prices, no spread, commission or slippage (same as the dg-v1 report). Real results would be worse.
- **Settings** (database, read-only): account $10000 fixed (no compounding), risk 0.5% ($50 = 1R), paper time limit 288 M15 candles. Strategy numbers are constants in `lib/strategy/dg-v2-candidate/` plus dg-v1's settings (stop buffer, expiry, swing strength, equal tolerance).
- **Counting:** Trades = Ready alerts whose entry was filled (market entries always are). Win rate = W ÷ (W + L); Unresolved (time limit) is not in the win rate but its R is in net R; Not filled (limit entry never reached) is not a trade: 0R, not in win rate, R or streaks. Avg R = net R ÷ closed trades. Worst streak = longest run of losses in close order.

Sample results from historical data. Not a promise of future results, and not a judgement of the strategy.

## In-sample

| | Trades | W / L | Win rate | Net R | Avg R | Worst streak | Max DD | Unresolved | Not filled | Open at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **All 5 pairs** | 20 | 5 / 13 | 27.8% | +3.87R | +0.19R | 5 | 5.13R | 2 | 0 | 0 |
| EUR_USD | 3 | 1 / 2 | 33.3% | +1.00R | +0.33R | 1 | 1.00R | 0 | 0 | 0 |
| GBP_USD | 3 | 1 / 1 | 50.0% | +2.68R | +0.89R | 1 | 1.00R | 1 | 0 | 0 |
| USD_JPY | 4 | 2 / 2 | 50.0% | +4.00R | +1.00R | 2 | 2.00R | 0 | 0 | 0 |
| USD_CAD | 7 | 1 / 6 | 14.3% | −3.00R | −0.43R | 4 | 4.00R | 0 | 0 | 0 |
| USD_CHF | 3 | 0 / 2 | 0.0% | −0.81R | −0.27R | 2 | 2.00R | 1 | 0 | 0 |

Setups (sweeps): 112 · confirmed (Ready) 20 · expired 92 · skipped (invalid) 0.

## Out-of-sample

| | Trades | W / L | Win rate | Net R | Avg R | Worst streak | Max DD | Unresolved | Not filled | Open at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **All 5 pairs** | 7 | 3 / 4 | 42.9% | +5.00R | +0.71R | 4 | 4.00R | 0 | 0 | 0 |
| EUR_USD | 0 | 0 / 0 | — | +0.00R | — | 0 | 0.00R | 0 | 0 | 0 |
| GBP_USD | 1 | 0 / 1 | 0.0% | −1.00R | −1.00R | 1 | 1.00R | 0 | 0 | 0 |
| USD_JPY | 0 | 0 / 0 | — | +0.00R | — | 0 | 0.00R | 0 | 0 | 0 |
| USD_CAD | 4 | 3 / 1 | 75.0% | +8.00R | +2.00R | 1 | 1.00R | 0 | 0 | 0 |
| USD_CHF | 2 | 0 / 2 | 0.0% | −2.00R | −1.00R | 2 | 2.00R | 0 | 0 | 0 |

Setups (sweeps): 72 · confirmed (Ready) 7 · expired 65 · skipped (invalid) 0.

## Trade count vs the reference script

| Pair | In-sample app | In-sample ref | Out-of-sample app | Out-of-sample ref |
| --- | ---: | ---: | ---: | ---: |
| EUR_USD | 3 | 3 | 0 | 0 |
| GBP_USD | 3 | 3 | 1 | 2 |
| USD_JPY | 4 | 5 | 0 | 0 |
| USD_CAD | 7 | 8 | 4 | 5 |
| USD_CHF | 3 | 3 | 2 | 3 |
| **All 5** | **20** | **22** (−9%) | **7** | **10** (−30%) |

### Why the counts differ (written by hand, 2026-11-07)

The reference is `doc/reference/v2.py` with `A=1, B=0, C=0, D=0`, no spread, same data, counted by Ready time. It gives 22 / 10 trades; the app gives 20 / 7 (−9% / −30%; small numbers, 3 trades).

The difference is not in the V2 liquidity rules (previous day, Asian session, 1H equal highs/lows): 27 of the 32 reference trades are the same trades in the app. It comes from **two dg-v1 rules that the reference script rebuilt differently from the app's dg-v1**. V2 is "dg-v1 except liquidity", so it uses the app's dg-v1 rules:

1. **Which M15 swing is the BOS level.** The app's dg-v1 uses the last swing confirmed *before* the sweep candle (tracker default, Open Questions). The reference also counts a swing confirmed *by the sweep candle itself*, so it sometimes picks a more recent, closer swing and confirms setups the app lets expire (GBP_USD 9 Sep, USD_CAD 1 Oct, USD_CHF 3 Nov, among others).
2. **Equal highs/lows "untouched since".** The app's dg-v1 requires the level to be untouched since the *first* swing of the group; the reference since the *later* swing.

With only those two lines of the reference changed to the app's dg-v1 rules, the reference gives **20 / 7, the same counts as the app**, and the same trade list except one USD_JPY setup (2026-04-03 EQL in the reference vs 2026-06-18 ASL in the app), which comes from how equal swings are grouped (the reference pairs the last 12 swings; the app groups them as dg-v1 does).

For context: the reference's own rebuild of dg-v1 (`v2.py` with all options off) gives 107 trades from January to November, against 50 for the app's dg-v1 (36 in common). The reference never reproduced the app's dg-v1 exactly, and V2 inherits that difference. Whether dg-v1 (and so V2) should take the reference's reading is an Open Question in the tracker; nothing was changed here.
