"""Independent re-implementation of dg-v1 (from the context docs) for diagnosis.
Not the app's code: used to find which rules matter, with an in/out-of-sample split."""
import csv, sys, bisect
from datetime import datetime, timedelta, timezone
from collections import defaultdict

DATA = sys.argv[1] if len(sys.argv) > 1 else "data"
PAIRS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF"]
M15 = timedelta(minutes=15)

def load(pair, tf):
    rows = []
    with open(f"{DATA}/{pair}_{tf}.csv") as f:
        for r in csv.DictReader(f):
            t = datetime.fromisoformat(r["time"].replace("Z", "+00:00"))
            rows.append((t, float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"])))
    return rows

def swings(c, s, dur, close_times=None):
    """Confirmed swings: (index, price, confirm_time). Strict on both sides."""
    hs, ls = [], []
    n = len(c)
    for i in range(s, n - s):
        h = c[i][2]; l = c[i][3]
        if all(h > c[j][2] for j in range(i - s, i)) and all(h > c[j][2] for j in range(i + 1, i + s + 1)):
            ct = close_times[i + s] if close_times else c[i + s][0] + dur
            hs.append((i, h, ct))
        if all(l < c[j][3] for j in range(i - s, i)) and all(l < c[j][3] for j in range(i + 1, i + s + 1)):
            ct = close_times[i + s] if close_times else c[i + s][0] + dur
            ls.append((i, l, ct))
    return hs, ls

def trend_at(hs, ls, hs_ct, ls_ct, t):
    a = bisect.bisect_right(hs_ct, t); b = bisect.bisect_right(ls_ct, t)
    if a < 2 or b < 2: return "RANGE"
    h1, h2 = hs[a - 2][1], hs[a - 1][1]; l1, l2 = ls[b - 2][1], ls[b - 1][1]
    if h2 > h1 and l2 > l1: return "UP"
    if h2 < h1 and l2 < l1: return "DOWN"
    return "RANGE"

def session_ok(t, sessions):
    if sessions == "all": return True
    hr = t.hour  # UTC, rough: London 07-16, New York 12-21
    if sessions == "ldn_ny": return 7 <= hr < 21
    if sessions == "ldn": return 7 <= hr < 16
    return True

def run(pair, P, start, end):
    pip = 0.01 if "JPY" in pair else 0.0001
    D = load(pair, "D"); H4 = load(pair, "H4"); M = load(pair, "M15")
    # D close = next D open (handles weekends); last one +24h
    d_close = [D[i + 1][0] if i + 1 < len(D) else D[i][0] + timedelta(days=1) for i in range(len(D))]
    d_open = [x[0] for x in D]
    dhs, dls = swings(D, P["swing_htf"], None, d_close)
    hhs, hls = swings(H4, P["swing_htf"], timedelta(hours=4))
    mhs, mls = swings(M, P["swing"], M15)
    D_ct = ([x[2] for x in dhs], [x[2] for x in dls])
    H_ct = ([x[2] for x in hhs], [x[2] for x in hls])
    mhs_ct = [x[2] for x in mhs]; mls_ct = [x[2] for x in mls]
    m_times = [x[0] for x in M]
    tol = P["tol"] * pip
    eq_tf = P.get("eq_tf", "M15")
    if eq_tf == "H1":
        # build H1 from M15
        H1 = []; cur = None
        for t, o, h, l, c in M:
            k = t.replace(minute=0)
            if cur and cur[0] == k:
                cur = (k, cur[1], max(cur[2], h), min(cur[3], l), c)
            else:
                if cur: H1.append(cur)
                cur = (k, o, h, l, c)
        H1.append(cur)
        ehs, els = swings(H1, P["swing"], timedelta(hours=1))
    else:
        ehs, els = mhs, mls
    ehs_ct = [x[2] for x in ehs]; els_ct = [x[2] for x in els]
    E = H1 if eq_tf == "H1" else M

    setups = {}  # direction -> dict
    trades = []; stats = defaultdict(int)
    used = set()  # levels already swept (key)
    for k in range(len(M)):
        t0, o, h, l, c = M[k]; t = t0 + M15  # close time
        if t0 < start or t0 >= end: continue
        # --- expire / confirm / extend for open setups
        for dirn in list(setups):
            s = setups[dirn]
            if t > s["exp"]:
                stats["expired"] += 1; del setups[dirn]; continue
            if k > s["k"]:
                conf = (c < s["bos"]) if dirn == "SELL" else (c > s["bos"])
                if P.get("body_full") and conf:
                    conf = (o < s["bos"]) if dirn == "SELL" else (o > s["bos"])
                if conf:
                    stop = s["ext"] + P["buffer"] * pip if dirn == "SELL" else s["ext"] - P["buffer"] * pip
                    risk = abs(c - stop)
                    if risk / pip < P.get("min_stop", 0):
                        stats["too_tight"] += 1; del setups[dirn]; continue
                    tgt = c - P["rr"] * risk if dirn == "SELL" else c + P["rr"] * risk
                    trades.append(dict(pair=pair, dir=dirn, k=k, t=t, entry=c, stop=stop, tgt=tgt, risk=risk, stype=s["type"]))
                    stats["confirmed"] += 1; del setups[dirn]; continue
                if dirn == "SELL" and h > s["ext"]: s["ext"] = h
                if dirn == "BUY" and l < s["ext"]: s["ext"] = l
        # --- new sweeps
        if not session_ok(t0, P["sessions"]): continue
        tD = trend_at(dhs, dls, D_ct[0], D_ct[1], t)
        tH = trend_at(hhs, hls, H_ct[0], H_ct[1], t)
        if P.get("trend") == "H4only":
            dirn = "SELL" if tH == "DOWN" else "BUY" if tH == "UP" else None
        else:
            dirn = "SELL" if (tD == tH == "DOWN") else "BUY" if (tD == tH == "UP") else None
        if not dirn or dirn in setups: continue
        di = bisect.bisect_right(d_open, t0) - 1  # current forex day
        if di < 1: continue
        day_start = d_open[di]; prev_start = d_open[di - 1]
        levels = []
        pdh, pdl = D[di - 1][2], D[di - 1][3]
        if dirn == "SELL": levels.append(("PDH", pdh))
        else: levels.append(("PDL", pdl))
        if P.get("eq", True):
            src, src_ct = (ehs, ehs_ct) if dirn == "SELL" else (els, els_ct)
            a = bisect.bisect_right(src_ct, t0)  # confirmed before this candle
            cand = [x for x in src[:a] if E[x[0]][0] >= prev_start][-12:]
            for i in range(len(cand)):
                for j in range(i + 1, len(cand)):
                    if abs(cand[i][1] - cand[j][1]) <= tol:
                        lv = max(cand[i][1], cand[j][1]) if dirn == "SELL" else min(cand[i][1], cand[j][1])
                        levels.append(("EQH" if dirn == "SELL" else "EQL", lv, E[cand[j][0]][0]))
        for lev in levels:
            name, lv = lev[0], lev[1]
            key = (name, round(lv / pip), day_start if name in ("PDH", "PDL") else lev[2])
            if key in used: continue
            # untouched: not breached earlier since it formed (PD: since day start)
            since = day_start if name in ("PDH", "PDL") else lev[2]
            hit = (h > lv) if dirn == "SELL" else (l < lv)
            if not hit: continue
            used.add(key)
            # was it already breached earlier today/since formed?
            i0 = bisect.bisect_left(m_times, since)
            if dirn == "SELL" and any(M[j][2] > lv for j in range(max(i0, k - 400), k)): continue
            if dirn == "BUY" and any(M[j][3] < lv for j in range(max(i0, k - 400), k)): continue
            src, src_ct = (mls, mls_ct) if dirn == "SELL" else (mhs, mhs_ct)
            a = bisect.bisect_right(src_ct, t)
            prior = [x for x in src[:a] if x[0] < k]
            if not prior: continue
            bos = prior[-1][1]
            if dirn == "SELL" and c < bos: continue  # already below: no clean BOS
            if dirn == "BUY" and c > bos: continue
            setups[dirn] = dict(k=k, type=name, ext=h if dirn == "SELL" else l, bos=bos, exp=t + timedelta(minutes=P["expiry"]))
            stats["sweeps"] += 1
            break
    # --- resolve paper trades
    for tr in trades:
        res = "UNRES"; R = None; n = 0
        for j in range(tr["k"] + 1, len(M)):
            _, o, h, l, c = M[j]; n += 1
            if tr["dir"] == "SELL":
                if o >= tr["stop"]: res, R = "LOSS", -(o - tr["entry"]) / tr["risk"]; break
                hs_, ht = h >= tr["stop"], l <= tr["tgt"]
            else:
                if o <= tr["stop"]: res, R = "LOSS", -(tr["entry"] - o) / tr["risk"]; break
                hs_, ht = l <= tr["stop"], h >= tr["tgt"]
            if hs_: res, R = "LOSS", -1.0; break
            if ht: res, R = "WIN", P["rr"]; break
            if n >= 288:
                mv = (tr["entry"] - c) if tr["dir"] == "SELL" else (c - tr["entry"])
                res, R = "UNRES", mv / tr["risk"]; break
        if R is None:
            res, R = "OPEN", 0.0
        tr["res"] = res; tr["R"] = R
    return trades, stats

def summarize(trades):
    w = sum(1 for t in trades if t["res"] == "WIN"); lo = sum(1 for t in trades if t["res"] == "LOSS")
    R = sum(t["R"] for t in trades)
    streak = best = 0
    eq = peak = dd = 0.0
    for t in sorted(trades, key=lambda x: x["t"]):
        if t["res"] == "LOSS": streak += 1; best = max(best, streak)
        elif t["res"] == "WIN": streak = 0
        eq += t["R"]; peak = max(peak, eq); dd = max(dd, peak - eq)
    wr = w / (w + lo) * 100 if (w + lo) else 0
    return dict(n=len(trades), w=w, l=lo, wr=wr, R=R, streak=best, dd=dd)

BASE = dict(swing=2, swing_htf=2, tol=2, buffer=3, expiry=120, rr=3, sessions="all", eq=True)

def test(P, start, end, pairs=PAIRS):
    allt = []; st = defaultdict(int)
    for p in pairs:
        t, s = run(p, P, start, end); allt += t
        for k, v in s.items(): st[k] += v
    return summarize(allt), st, allt

if __name__ == "__main__":
    s = datetime(2026, 1, 1, tzinfo=timezone.utc); e = datetime(2026, 11, 5, tzinfo=timezone.utc)
    r, st, _ = test(BASE, s, e)
    print("BASE", r, dict(st))
