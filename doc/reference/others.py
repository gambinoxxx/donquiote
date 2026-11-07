"""Rebuilds, rules fixed before running. Same costs as prov1.py (pair spreads applied to entry),
same-candle stop+target = loss, gaps through stop at the open, 288-candle timeout.

Gemini dg-v2: SELL only if the 15m close is below EMA50 of closed 4H candles (BUY above).
  Liquidity = PDH/PDL or Asian high/low (00:00-07:00 UTC). Sweeps only in 07-11 or 13-17 UTC.
  Within 8 candles after the sweep, a displacement candle in the trade direction (body > 1.5x ATR14) that leaves
  a fair value gap (bearish: high[i+1] < low[i-1]). Limit entry at the near edge of the gap (sell: high[i+1];
  buy: low[i+1]), valid 16 candles. Stop 2 pips beyond the sweep extreme. Target 3R.
ChatGPT trend: on 15m, EMA50 > EMA200 and close > EMA50 (bull); low touched EMA20 within the last 5 candles;
  close above the previous 3 candles' high -> buy at next open. Stop 1 pip below the lowest low of the last 8 candles.
  Target 3R. 07:00-16:59 UTC. Mirror for sells. One open trade per pair at a time."""
import bisect
from datetime import datetime, timedelta, timezone
from dg import load, PAIRS, M15
from prov1 import SPREAD, ema, report

def resolve(M, tr, from_k):
    for j in range(from_k, min(len(M), from_k + 288)):
        _, o, h, l, c = M[j]
        if tr["dir"] == "SELL":
            if o >= tr["stop"]: return -(o - tr["entry"]) / tr["risk"], j
            hs, ht = h >= tr["stop"], l <= tr["tgt"]
        else:
            if o <= tr["stop"]: return -(tr["entry"] - o) / tr["risk"], j
            hs, ht = l <= tr["stop"], h >= tr["tgt"]
        if hs: return -1.0, j
        if ht: return 3.0, j
    j = min(len(M) - 1, from_k + 287); c = M[j][4]
    return ((tr["entry"] - c) if tr["dir"] == "SELL" else (c - tr["entry"])) / tr["risk"], j

def gemini(pair):
    pip = 0.01 if "JPY" in pair else 0.0001; sp = SPREAD[pair] * pip
    D = load(pair, "D"); H4 = load(pair, "H4"); M = load(pair, "M15")
    d_open = [x[0] for x in D]; h4c = [x[0] + timedelta(hours=4) for x in H4]; e50 = ema([x[4] for x in H4], 50)
    m_t = [x[0] for x in M]
    tr_ = [0.0] + [max(M[i][2], M[i - 1][4]) - min(M[i][3], M[i - 1][4]) for i in range(1, len(M))]
    atr = []; a = tr_[0]
    for v in tr_: a = a + (v - a) / 14; atr.append(a)
    trades = []; busy_until = -1; used = set()
    k = 20
    while k < len(M) - 2:
        t0, o, h, l, c = M[k]
        if k <= busy_until or not (7 <= t0.hour < 11 or 13 <= t0.hour < 17): k += 1; continue
        hi = bisect.bisect_right(h4c, t0) - 1; di = bisect.bisect_right(d_open, t0) - 1
        if hi < 50 or di < 1: k += 1; continue
        d = "SELL" if c < e50[hi] else "BUY"
        a0 = t0.replace(hour=0, minute=0); a1 = t0.replace(hour=7, minute=0)
        s0 = bisect.bisect_left(m_t, a0); s1 = bisect.bisect_left(m_t, a1); seg = M[s0:s1]
        lv = [D[di - 1][2]] if d == "SELL" else [D[di - 1][3]]
        if len(seg) > 8: lv.append(max(x[2] for x in seg) if d == "SELL" else min(x[3] for x in seg))
        swept = None
        for L in lv:
            key = (d, round(L / pip), di)
            if key in used: continue
            if (d == "SELL" and h > L) or (d == "BUY" and l < L): swept = L; used.add(key); break
        if swept is None: k += 1; continue
        ext = h if d == "SELL" else l; entry_set = None
        for i in range(k + 1, min(len(M) - 1, k + 9)):
            ext = max(ext, M[i][2]) if d == "SELL" else min(ext, M[i][3])
            body = abs(M[i][4] - M[i][1])
            if body <= 1.5 * atr[i - 1]: continue
            if d == "SELL" and M[i][4] < M[i][1] and M[i + 1][2] < M[i - 1][3]: entry_set = (i + 1, M[i + 1][2]); break
            if d == "BUY" and M[i][4] > M[i][1] and M[i + 1][3] > M[i - 1][2]: entry_set = (i + 1, M[i + 1][3]); break
        if not entry_set: k += 1; continue
        ib, lim = entry_set; stop = ext + 2 * pip if d == "SELL" else ext - 2 * pip
        for j in range(ib + 1, min(len(M), ib + 17)):
            if (d == "SELL" and M[j][2] >= lim) or (d == "BUY" and M[j][3] <= lim):
                e = lim - sp if d == "SELL" else lim + sp; risk = abs(stop - e)
                if risk <= 0: break
                tr = dict(t=M[j][0], dir=d, entry=e, stop=stop, risk=risk, tgt=e - 3 * risk if d == "SELL" else e + 3 * risk, pair=pair)
                if (d == "SELL" and M[j][2] >= stop) or (d == "BUY" and M[j][3] <= stop): tr["R"] = -1.0; jj = j
                else: tr["R"], jj = resolve(M, tr, j + 1)
                trades.append(tr); busy_until = jj; break
        k += 1
    return trades

def chatgpt(pair):
    pip = 0.01 if "JPY" in pair else 0.0001; sp = SPREAD[pair] * pip
    M = load(pair, "M15"); cl = [x[4] for x in M]
    e20, e50, e200 = ema(cl, 20), ema(cl, 50), ema(cl, 200)
    trades = []; busy = -1
    for k in range(210, len(M) - 1):
        t0, o, h, l, c = M[k]
        if k <= busy or not (7 <= t0.hour < 17): continue
        bull = e50[k] > e200[k] and c > e50[k] and any(M[j][3] <= e20[j] for j in range(k - 5, k + 1)) and c > max(M[j][2] for j in range(k - 3, k))
        bear = e50[k] < e200[k] and c < e50[k] and any(M[j][2] >= e20[j] for j in range(k - 5, k + 1)) and c < min(M[j][3] for j in range(k - 3, k))
        if not (bull or bear): continue
        d = "BUY" if bull else "SELL"; nxt = M[k + 1][1]
        e = nxt + sp if d == "BUY" else nxt - sp
        stop = min(M[j][3] for j in range(k - 7, k + 1)) - pip if d == "BUY" else max(M[j][2] for j in range(k - 7, k + 1)) + pip
        risk = abs(e - stop)
        if risk <= 0 or (d == "BUY" and stop >= e) or (d == "SELL" and stop <= e): continue
        tr = dict(t=M[k + 1][0], dir=d, entry=e, stop=stop, risk=risk, tgt=e + 3 * risk if d == "BUY" else e - 3 * risk, pair=pair)
        tr["R"], busy = resolve(M, tr, k + 1)
        trades.append(tr)
    return trades

if __name__ == "__main__":
    A = datetime(2025, 10, 1, tzinfo=timezone.utc); B = datetime(2026, 4, 1, tzinfo=timezone.utc)
    C = datetime(2026, 8, 1, tzinfo=timezone.utc); E = datetime(2026, 11, 5, tzinfo=timezone.utc)
    for name, fn in [("Gemini dg-v2 (FVG retest)", gemini), ("ChatGPT EMA trend pullback", chatgpt)]:
        T = []
        for p in PAIRS: T += fn(p)
        print("==", name)
        report(T, "ALL")
        report([t for t in T if A <= t["t"] < B], "Oct-Mar"); report([t for t in T if B <= t["t"] < C], "Apr-Jul"); report([t for t in T if C <= t["t"] < E], "Aug-Nov")
        if "Gemini" in name: report([t for t in T if t["pair"] in ("EUR_USD", "GBP_USD", "USD_CAD")], "3 pairs*")
        for p in PAIRS: report([t for t in T if t["pair"] == p], p)
