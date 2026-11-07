# Strategy reference (Python, read-only)

Research scripts used to test the extra strategies before they were added to
the app. They are a **reference for the rules only**: when a rule in
`doc/context/project-overview.md` → Registered strategies is unclear, the
matching function here shows exactly how it was tested.

- `dg.py` — loader, confirmed swings, trend, dg-v1 rebuild (shared helpers)
- `v2.py` — dg-v2 candidate filters; **dg-v2-candidate = option A only**
  (better liquidity), `dict(A=1, B=0, C=0, D=0)`
- `others.py` — `gemini()` = **gemini-fvg**; `chatgpt()` is NOT used
- `prov1.py` — `run(pair, bias_mode="swing")` = **pro-v1-swing**

The app's TypeScript engine is the source of truth. Never import or run
these from the app. Spreads in these scripts are research costs, not rules.
