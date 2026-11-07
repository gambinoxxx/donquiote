"""Independent rebuild of Grok's "Pro-v1" from its written rules. Only CLOSED higher-timeframe candles are used.
Ambiguous bias wording is tested two ways (decided before running):
  bias=ma    : Daily close > SMA20 of daily closes and SMA20 higher than 5 days ago; 4H close > EMA20(4H). Mirror for down.
  bias=swing : dg-v1 swing structure on D and 4H (HH+HL / LH+LL).
Levels: PDH/PDL and previous (last closed) 4H high/low.
Sweep (down bias): 15m high > level and 15m close < level + 1 pip. Mirror for up.
BOS: within the next 8 candles (2h), a 15m close beyond the level by >= 0.5 pip in the bias direction. Entry = that close.
Stop = sweep extreme +/- 3 pips. Stop must be 6-35 pips. Target 3R. 07:00-16:00 UTC. Max 1 trade per pair per forex day.
Spread (pips) applied to entry: EUR 1.2, GBP 1.5, JPY 1.4, CAD 1.8, CHF 1.8. Same-candle stop+target = loss. 288-candle timeout."""
import bisect, sys
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from dg import load, swings, trend_at, PAIRS, M15

SPREAD = {"EUR_USD": 1.2, "GBP_USD": 1.5, "USD_JPY": 1.4, "USD_CAD": 1.8, "USD_CHF": 1.8}

def ema(vals, n):
    a = 2 / (n + 1); out = []; m = vals[0]
    for v in vals: m = a * v + (1 - a) * m; out.append(m)
    return out

def run(pair, bias_mode="ma", spread_on=True, session=(7, 16), stop_rng=(6, 35)):
    pip = 0.01 if "JPY" in pair else 0.0001
    sp = SPREAD[pair] * pip if spread_on else 0
    D = load(pair, "D"); H4 = load(pair, "H4"); M = load(pair, "M15")
    d_open = [x[0] for x in D]
    d_close_t = [D[i + 1][0] if i + 1 < len(D) else D[i][0] + timedelta(days=1) for i in range(len(D))]
    h4_close_t = [x[0] + timedelta(hours=4) for x in H4]
    dc = [x[4] for x in D]; sma20 = [sum(dc[max(0, i - 19):i + 1]) / min(20, i + 1) for i in range(len(dc))]
    h4e = ema([x[4] for x in H4], 20)
    if bias_mode == "swing":
        dhs, dls = swings(D, 2, None, d_close_t); hhs, hls = swings(H4, 2, timedelta(hours=4))
        Dc = ([x[2] for x in dhs], [x[2] for x in dls]); Hc = ([x[2] for x in hhs], [x[2] for x in hls])

    def bias(t):
        di = bisect.bisect_right(d_close_t, t) - 1  # last CLOSED daily
        hi = bisect.bisect_right(h4_close_t, t) - 1  # last CLOSED 4H
        if di < 25 or hi < 25: return None
        if bias_mode == "ma":
            up_d = dc[di] > sma20[di] and sma20[di] > sma20[di - 5]
            dn_d = dc[di] < sma20[di] and sma20[di] < sma20[di - 5]
            up_h = H4[hi][4] > h4e[hi]; dn_h = H4[hi][4] < h4e[hi]
            return "BUY" if up_d and up_h else "SELL" if dn_d and dn_h else None
        tD = trend_at(dhs, dls, Dc[0], Dc[1], t); tH = trend_at(hhs, hls, Hc[0], Hc[1], t)
        return "BUY" if tD == tH == "UP" else "SELL" if tD == tH == "DOWN" else None

    trades = []; pending = None; traded_days = set()
    for k in range(len(M)):
        t0, o, h, l, c = M[k]; t = t0 + M15
        di_cur = bisect.bisect_right(d_open, t0) - 1
        if pending:
            d, lvl, ext, kmax = pending
            if k > kmax: pending = None
            else:
                if d == "SELL": ext = max(ext, h)
                else: ext = min(ext, l)
                pending = (d, lvl, ext, kmax)
                broke = (c <= lvl - 0.5 * pip) if d == "SELL" else (c >= lvl + 0.5 * pip)
                if broke and session[0] <= t0.hour < session[1] and di_cur not in traded_days:
                    e = c - sp if d == "SELL" else c + sp
                    stop = ext + 3 * pip if d == "SELL" else ext - 3 * pip
                    risk = abs(stop - e)
                    if stop_rng[0] * pip <= risk <= stop_rng[1] * pip:
                        tgt = e - 3 * risk if d == "SELL" else e + 3 * risk
                        trades.append(dict(k=k, t=t, dir=d, entry=e, stop=stop, tgt=tgt, risk=risk))
                        traded_days.add(di_cur)
                    pending = None
                    continue
        if pending or not (session[0] <= t0.hour < session[1]) or di_cur in traded_days or di_cur < 1: continue
        b = bias(t)
        if not b: continue
        hi = bisect.bisect_right(h4_close_t, t0) - 1  # previous closed 4H before this candle
        lv = [D[di_cur - 1][2], H4[hi][2]] if b == "SELL" else [D[di_cur - 1][3], H4[hi][3]]
        for lvl in lv:
            if b == "SELL" and h > lvl and c < lvl + 1 * pip:
                pending = ("SELL", lvl, h, k + 8); break
            if b == "BUY" and l < lvl and c > lvl - 1 * pip:
                pending = ("BUY", lvl, l, k + 8); break
    for tr in trades:
        res = None
        for j in range(tr["k"] + 1, min(len(M), tr["k"] + 289)):
            _, o, h, l, c = M[j]
            if tr["dir"] == "SELL":
                if o >= tr["stop"]: res = -(o - tr["entry"]) / tr["risk"]; break
                hs, ht = h >= tr["stop"], l <= tr["tgt"]
            else:
                if o <= tr["stop"]: res = -(tr["entry"] - o) / tr["risk"]; break
                hs, ht = l <= tr["stop"], h >= tr["tgt"]
            if hs: res = -1.0; break
            if ht: res = 3.0; break
        if res is None:
            j = min(len(M) - 1, tr["k"] + 288); c = M[j][4]
            res = ((tr["entry"] - c) if tr["dir"] == "SELL" else (c - tr["entry"])) / tr["risk"]
        tr["R"] = res; tr["pair"] = pair
    return trades

def report(T, label):
    n = len(T)
    if not n: print(f"   {label}: no trades"); return
    w = sum(1 for t in T if t["R"] > 0); R = sum(t["R"] for t in T)
    gw = sum(t["R"] for t in T if t["R"] > 0); gl = -sum(t["R"] for t in T if t["R"] <= 0)
    eq = pk = dd = 0; st = bs = 0
    for t in sorted(T, key=lambda x: x["t"]):
        eq += t["R"]; pk = max(pk, eq); dd = max(dd, pk - eq)
        st = st + 1 if t["R"] <= 0 else 0; bs = max(bs, st)
    print(f"   {label:9}: trades {n:4}  win {w/n*100:5.1f}%  net {R:7.1f}R  exp {R/n:+.3f}R  PF {gw/max(gl,1e-9):4.2f}  maxDD {dd:5.1f}R  streak {bs}")

if __name__ == "__main__":
    A = datetime(2025, 10, 1, tzinfo=timezone.utc); B = datetime(2026, 4, 1, tzinfo=timezone.utc)
    C = datetime(2026, 8, 1, tzinfo=timezone.utc); E = datetime(2026, 11, 5, tzinfo=timezone.utc)
    for mode in ("ma", "swing"):
        for spread_on in (False, True):
            T = []
            for p in PAIRS: T += run(p, mode, spread_on)
            print(f"== Pro-v1 bias={mode} spread={'on' if spread_on else 'off'}")
            report([t for t in T if A <= t["t"] < E], "ALL")
            report([t for t in T if A <= t["t"] < B], "Oct-Mar")
            report([t for t in T if B <= t["t"] < C], "Apr-Jul")
            report([t for t in T if C <= t["t"] < E], "Aug-Nov")
            if spread_on and mode == "ma":
                for p in PAIRS: report([t for t in T if t["pair"] == p], p)
