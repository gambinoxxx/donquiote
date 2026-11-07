"""Candidate dg-v2 filters, defined BEFORE testing (no tuning):
A liquidity : only PDH/PDL, Asian-session high/low (forex day open -> 07:00 UTC), and 1H equal highs/lows. No M15 equal highs/lows.
B location  : H4 dealing range = high/low of last 30 closed H4 candles. Sell only if the sweep extreme is in the top half (premium), buy only in the bottom half (discount).
C displacement: the BOS candle's body >= 1.5x the average body of the previous 20 M15 candles, and body >= 50% of its range.
D pullback  : after BOS, a limit entry at 50% of the BOS candle body, valid 8 candles (2h); stop unchanged, target 3R from the fill.
Everything else as dg-v1: D+H4 trend agree, untouched level, BOS = last M15 swing before sweep, 2h expiry, 3-pip buffer, 1:3, 288-candle timeout.
"""
import sys, bisect
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from dg import load, swings, trend_at, summarize, PAIRS, M15

def run(pair, P, start, end):
    pip = 0.01 if "JPY" in pair else 0.0001
    spread = P.get("spread", 0) * pip
    D = load(pair, "D"); H4 = load(pair, "H4"); M = load(pair, "M15")
    d_close = [D[i + 1][0] if i + 1 < len(D) else D[i][0] + timedelta(days=1) for i in range(len(D))]
    d_open = [x[0] for x in D]
    dhs, dls = swings(D, 2, None, d_close); hhs, hls = swings(H4, 2, timedelta(hours=4))
    mhs, mls = swings(M, 2, M15)
    Dc = ([x[2] for x in dhs], [x[2] for x in dls]); Hc = ([x[2] for x in hhs], [x[2] for x in hls])
    mls_ct = [x[2] for x in mls]; mhs_ct = [x[2] for x in mhs]
    h4_close = [x[0] + timedelta(hours=4) for x in H4]
    m_times = [x[0] for x in M]
    # 1H candles + swings
    H1 = []; cur = None
    for t, o, h, l, c in M:
        k = t.replace(minute=0)
        if cur and cur[0] == k: cur = (k, cur[1], max(cur[2], h), min(cur[3], l), c)
        else:
            if cur: H1.append(cur)
            cur = (k, o, h, l, c)
    H1.append(cur)
    e_hs, e_ls = swings(H1, 2, timedelta(hours=1)) if P["A"] else swings(M, 2, M15)
    E = H1 if P["A"] else M
    ehs_ct = [x[2] for x in e_hs]; els_ct = [x[2] for x in e_ls]
    tol = 2 * pip
    bodies = [abs(x[4] - x[1]) for x in M]

    setups = {}; pend = {}; trades = []; used = set(); st = defaultdict(int)
    for k in range(len(M)):
        t0, o, h, l, c = M[k]; t = t0 + M15
        if t0 < start or t0 >= end: continue
        # pending limit orders (D)
        for dirn in list(pend):
            pz = pend[dirn]
            if k > pz["k_until"]: st["unfilled"] += 1; del pend[dirn]; continue
            filled = (h >= pz["lim"]) if dirn == "SELL" else (l <= pz["lim"])
            if filled:
                e = pz["lim"]; risk = abs(pz["stop"] - e)
                tgt = e - 3 * risk if dirn == "SELL" else e + 3 * risk
                # same-candle stop -> loss (conservative)
                tr = dict(pair=pair, dir=dirn, k=k, t=t, entry=e, stop=pz["stop"], tgt=tgt, risk=risk, stype=pz["type"])
                tr["fill_bar_stop"] = (h >= pz["stop"]) if dirn == "SELL" else (l <= pz["stop"])
                trades.append(tr); st["confirmed"] += 1; del pend[dirn]
        for dirn in list(setups):
            s = setups[dirn]
            if t > s["exp"]: st["expired"] += 1; del setups[dirn]; continue
            if k > s["k"]:
                conf = (c < s["bos"]) if dirn == "SELL" else (c > s["bos"])
                if conf and P["C"]:
                    avg = sum(bodies[k - 20:k]) / 20; rng = h - l
                    if not (bodies[k] >= 1.5 * avg and rng > 0 and bodies[k] >= 0.5 * rng):
                        conf = False  # weak break: keep waiting
                if conf:
                    stop = s["ext"] + 3 * pip if dirn == "SELL" else s["ext"] - 3 * pip
                    if P["D"]:
                        lim = (o + c) / 2
                        pend[dirn] = dict(lim=lim, stop=stop, k_until=k + 8, type=s["type"])
                        del setups[dirn]; continue
                    risk = abs(c - stop); tgt = c - 3 * risk if dirn == "SELL" else c + 3 * risk
                    trades.append(dict(pair=pair, dir=dirn, k=k, t=t, entry=c, stop=stop, tgt=tgt, risk=risk, stype=s["type"], fill_bar_stop=False))
                    st["confirmed"] += 1; del setups[dirn]; continue
                if dirn == "SELL" and h > s["ext"]: s["ext"] = h
                if dirn == "BUY" and l < s["ext"]: s["ext"] = l
        tD = trend_at(dhs, dls, Dc[0], Dc[1], t); tH = trend_at(hhs, hls, Hc[0], Hc[1], t)
        dirn = "SELL" if tD == tH == "DOWN" else "BUY" if tD == tH == "UP" else None
        if not dirn or dirn in setups or dirn in pend: continue
        di = bisect.bisect_right(d_open, t0) - 1
        if di < 1: continue
        day_start = d_open[di]; prev_start = d_open[di - 1]
        levels = [("PDH", D[di - 1][2], day_start)] if dirn == "SELL" else [("PDL", D[di - 1][3], day_start)]
        if P["A"]:
            asia_end = t0.replace(hour=7, minute=0, second=0, microsecond=0)
            if asia_end <= day_start: asia_end += timedelta(days=1)
            if t0 >= asia_end:
                a0 = bisect.bisect_left(m_times, day_start); a1 = bisect.bisect_left(m_times, asia_end)
                if a1 > a0:
                    seg = M[a0:a1]
                    if dirn == "SELL": levels.append(("ASH", max(x[2] for x in seg), asia_end))
                    else: levels.append(("ASL", min(x[3] for x in seg), asia_end))
        src, sct = (e_hs, ehs_ct) if dirn == "SELL" else (e_ls, els_ct)
        a = bisect.bisect_right(sct, t0)
        cand = [x for x in src[:a] if E[x[0]][0] >= prev_start][-12:]
        for i in range(len(cand)):
            for j in range(i + 1, len(cand)):
                if abs(cand[i][1] - cand[j][1]) <= tol:
                    lv = max(cand[i][1], cand[j][1]) if dirn == "SELL" else min(cand[i][1], cand[j][1])
                    levels.append(("EQH" if dirn == "SELL" else "EQL", lv, E[cand[j][0]][0]))
        for name, lv, since in levels:
            key = (name, round(lv / pip), since)
            if key in used: continue
            hit = (h > lv) if dirn == "SELL" else (l < lv)
            if not hit: continue
            used.add(key)
            i0 = bisect.bisect_left(m_times, since)
            if dirn == "SELL" and any(M[j][2] > lv for j in range(max(i0, k - 400), k)): continue
            if dirn == "BUY" and any(M[j][3] < lv for j in range(max(i0, k - 400), k)): continue
            ext = h if dirn == "SELL" else l
            if P["B"]:
                n4 = bisect.bisect_right(h4_close, t)
                win = H4[max(0, n4 - 30):n4]
                if len(win) < 10: continue
                hi = max(x[2] for x in win); lo = min(x[3] for x in win); mid = (hi + lo) / 2
                if dirn == "SELL" and ext < mid: st["not_premium"] += 1; continue
                if dirn == "BUY" and ext > mid: st["not_discount"] += 1; continue
            s2, sc2 = (mls, mls_ct) if dirn == "SELL" else (mhs, mhs_ct)
            aa = bisect.bisect_right(sc2, t)
            prior = [x for x in s2[:aa] if x[0] < k]
            if not prior: continue
            bos = prior[-1][1]
            if dirn == "SELL" and c < bos: continue
            if dirn == "BUY" and c > bos: continue
            setups[dirn] = dict(k=k, type=name, ext=ext, bos=bos, exp=t + timedelta(minutes=120))
            st["sweeps"] += 1
            break
    # resolve
    for tr in trades:
        s = tr["dir"] == "SELL"
        # spread: entry worse by spread
        if spread:
            tr["entry"] = tr["entry"] - spread if s else tr["entry"] + spread  # sell gets bid lower; buy pays ask
        risk = abs(tr["stop"] - tr["entry"])
        if tr["fill_bar_stop"]: tr["res"], tr["R"] = "LOSS", -1.0; continue
        res, R = "OPEN", 0.0; n = 0
        for j in range(tr["k"] + 1, len(M)):
            _, o, h, l, c = M[j]; n += 1
            if s:
                if o >= tr["stop"]: res, R = "LOSS", -(o - tr["entry"]) / risk; break
                hs_, ht = h >= tr["stop"], l <= tr["tgt"]
            else:
                if o <= tr["stop"]: res, R = "LOSS", -(tr["entry"] - o) / risk; break
                hs_, ht = l <= tr["stop"], h >= tr["tgt"]
            if hs_: res, R = "LOSS", -1.0; break
            if ht: res, R = "WIN", abs(tr["tgt"] - tr["entry"]) / risk; break
            if n >= 288: res, R = "UNRES", ((tr["entry"] - c) if s else (c - tr["entry"])) / risk; break
        tr["res"], tr["R"] = res, R
    return trades, st

def test(P, start, end):
    T = []; S = defaultdict(int)
    for p in PAIRS:
        t, s = run(p, P, start, end); T += t
        for k, v in s.items(): S[k] += v
    return summarize(T), S, T

if __name__ == "__main__":
    IS = (datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 7, 1, tzinfo=timezone.utc))
    OS = (datetime(2026, 7, 1, tzinfo=timezone.utc), datetime(2026, 11, 5, tzinfo=timezone.utc))
    ALL = (IS[0], OS[1])
    V = [("dg-v1 (as now)", dict(A=0, B=0, C=0, D=0)),
         ("A better liquidity", dict(A=1, B=0, C=0, D=0)),
         ("B premium/discount", dict(A=0, B=1, C=0, D=0)),
         ("C displacement", dict(A=0, B=0, C=1, D=0)),
         ("D pullback entry", dict(A=0, B=0, C=0, D=1)),
         ("A+B", dict(A=1, B=1, C=0, D=0)),
         ("A+B+C", dict(A=1, B=1, C=1, D=0)),
         ("A+B+C+D (all four)", dict(A=1, B=1, C=1, D=1)),
         ("all four + 1-pip spread", dict(A=1, B=1, C=1, D=1, spread=1.0)),
         ("dg-v1 + 1-pip spread", dict(A=0, B=0, C=0, D=0, spread=1.0))]
    print(f"{'version':26}| {'Jan-Jun n':>9} {'WR':>5} {'R':>6} | {'Jul-Nov n':>9} {'WR':>5} {'R':>6} | {'ALL n':>5} {'WR':>5} {'R':>6} {'$':>7} {'strk':>4} {'DD R':>5}")
    for name, P in V:
        a, _, _ = test(P, *IS); b, _, _ = test(P, *OS); c, s, _ = test(P, *ALL)
        print(f"{name:26}| {a['n']:9} {a['wr']:5.1f} {a['R']:6.1f} | {b['n']:9} {b['wr']:5.1f} {b['R']:6.1f} | {c['n']:5} {c['wr']:5.1f} {c['R']:6.1f} {c['R']*50:7.0f} {c['streak']:4} {c['dd']:5.1f}")
