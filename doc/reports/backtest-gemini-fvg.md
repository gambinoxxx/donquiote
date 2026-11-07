# Backtest · FVG Retest (`gemini-fvg`, FVG)

Generated 2026-11-07T08:56:26.168Z by `npm run backtest:report -- --strategy gemini-fvg` in 24.4 s.

- **Data:** OANDA mid prices (CSV in `scripts/backtest/data/`), M15 candles from 2025-10-01T00:00:00.000Z to 2026-11-04T23:45:00.000Z (UTC); D and 4H from the same start. Candles before 2026-01-01 are warm-up only.
- **Periods** (by the time a trade became Ready): in-sample 2026-01-01 → 2026-07-01; out-of-sample 2026-07-01 → 2026-11-05T00:00:00.000Z (latest data).
- **Costs:** none — mid prices, no spread, commission or slippage (same as the dg-v1 report). Real results would be worse.
- **Settings** (database, read-only): account $10000 fixed (no compounding), risk 0.5% ($50 = 1R), paper time limit 288 M15 candles. Strategy numbers are constants in `lib/strategy/gemini-fvg/`.
- **Counting:** Trades = Ready alerts whose entry was filled (market entries always are). Win rate = W ÷ (W + L); Unresolved (time limit) is not in the win rate but its R is in net R; Not filled (limit entry never reached) is not a trade: 0R, not in win rate, R or streaks. Avg R = net R ÷ closed trades. Worst streak = longest run of losses in close order.

Sample results from historical data. Not a promise of future results, and not a judgement of the strategy.

## In-sample

| | Trades | W / L | Win rate | Net R | Avg R | Worst streak | Max DD | Unresolved | Not filled | Open at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **All 5 pairs** | 45 | 9 / 33 | 21.4% | −2.79R | −0.06R | 14 | 15.00R | 3 | 8 | 0 |
| EUR_USD | 5 | 2 / 3 | 40.0% | +2.93R | +0.59R | 1 | 1.07R | 0 | 4 | 0 |
| GBP_USD | 9 | 1 / 8 | 11.1% | −5.00R | −0.56R | 7 | 7.00R | 0 | 1 | 0 |
| USD_JPY | 5 | 1 / 3 | 25.0% | +1.26R | +0.25R | 3 | 3.00R | 1 | 0 | 0 |
| USD_CAD | 15 | 3 / 10 | 23.1% | +1.02R | +0.07R | 8 | 8.00R | 2 | 0 | 0 |
| USD_CHF | 11 | 2 / 9 | 18.2% | −3.00R | −0.27R | 4 | 4.00R | 0 | 3 | 0 |

Setups (sweeps): 464 · confirmed (Ready) 53 · expired 411 · skipped (invalid) 0.

## Out-of-sample

| | Trades | W / L | Win rate | Net R | Avg R | Worst streak | Max DD | Unresolved | Not filled | Open at end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **All 5 pairs** | 26 | 7 / 14 | 33.3% | +12.20R | +0.47R | 4 | 4.06R | 5 | 8 | 0 |
| EUR_USD | 7 | 2 / 4 | 33.3% | +4.57R | +0.65R | 2 | 2.00R | 1 | 1 | 0 |
| GBP_USD | 7 | 3 / 3 | 50.0% | +6.22R | +0.89R | 2 | 2.00R | 1 | 1 | 0 |
| USD_JPY | 1 | 0 / 0 | — | +1.17R | +1.17R | 0 | 0.00R | 1 | 3 | 0 |
| USD_CAD | 5 | 0 / 4 | 0.0% | −4.48R | −0.90R | 4 | 4.48R | 1 | 2 | 0 |
| USD_CHF | 6 | 2 / 3 | 40.0% | +4.72R | +0.79R | 2 | 2.00R | 1 | 1 | 0 |

Setups (sweeps): 297 · confirmed (Ready) 34 · expired 263 · skipped (invalid) 0.

## Trade count vs the reference script

| Pair | In-sample app | In-sample ref | Out-of-sample app | Out-of-sample ref |
| --- | ---: | ---: | ---: | ---: |
| EUR_USD | 5 | 5 | 7 | 7 |
| GBP_USD | 9 | 9 | 7 | 6 |
| USD_JPY | 5 | 5 | 1 | 1 |
| USD_CAD | 15 | 15 | 5 | 5 |
| USD_CHF | 11 | 11 | 6 | 6 |
| **All 5** | **45** | **45** (+0%) | **26** | **25** (+4%) |

### Why the counts differ (written by hand, 2026-11-07)

The reference is `others.py` → `gemini()`, counted by fill time. Its spread (applied to the entry) does not change which trades happen, only their R, so trade counts are comparable; the app uses mid prices with no spread.

In-sample is identical (45 / 45). Out-of-sample the app has **one extra trade**: GBP_USD BUY, Ready 2026-08-07 11:45 UTC (+3R). On that morning the 07:15 candle swept the previous day low, and the 07:30 candle swept the Asian low while that first setup was still waiting for a fair value gap:

- **Reference:** a new sweep is only blocked once a trade has *filled* (and then, with hindsight, every sweep from the first sweep until that trade closes is skipped). Here the first setup never filled, so the 07:30 sweep counted and used up the Asian low for the day; when price swept the Asian low again at 09:45 it was ignored.
- **App:** a live worker cannot know yet whether a setup will fill, so "one open trade per pair" is read as **one setup or trade in progress per pair**: no new sweep while a setup is Watching, or a trade is waiting for its fill or still open. At 07:30 the first setup was still Watching, so the Asian low was not used up, and the 09:45 sweep became a trade.

This is a live-versus-hindsight difference, not a rule mismatch (1 trade in 71). It is listed as an Open Question in the tracker.
