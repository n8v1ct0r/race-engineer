"""Reference analysis: stdlib only, plain Python floats, no numpy.

This file is the spec for lib/analysis/*.ts. Every loop, comparison and arithmetic order here is
mirrored 1:1 in TypeScript; each function names its twin. Parity is checked on JSON output
(fixtures/parity/expected.json). Constants come only from analysis-config.json (passed in as config).

Direction: every time value is from driver A's view. delta(s) = tB(s) - tA(s) in ms, so a value
above 0 means A gained up to s.
"""

import math

from .format import (
    delta_display,
    direction_word,
    format_brake_point,
    format_distance,
    format_lap_time,
    format_speed,
    format_time,
    format_time_delta,
    higher_lower,
    later_earlier,
    round_half_away,
)

COMPARISON_SCHEMA = "race-engineer.comparison/v1"


# ---------------------------------------------------------------- interp (twin: lib/analysis/interp.ts)


def interp(x, xp, fp):
    """Linear interpolation, xp strictly increasing, clamped outside. Twin: interp.ts interp()."""
    n = len(xp)
    if x <= xp[0]:
        return fp[0]
    if x >= xp[n - 1]:
        return fp[n - 1]
    lo, hi = 0, n - 1  # binary search: xp[lo] <= x < xp[hi]
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if xp[mid] <= x:
            lo = mid
        else:
            hi = mid
    if x == xp[lo]:
        return fp[lo]
    return fp[lo] + (fp[hi] - fp[lo]) * ((x - xp[lo]) / (xp[hi] - xp[lo]))


def interp_nullable(x, xp, fp):
    """interp() for channels that may hold None: None when either neighbor is None.

    Twin: interp.ts interpNullable().
    """
    n = len(xp)
    if x <= xp[0]:
        return fp[0]
    if x >= xp[n - 1]:
        return fp[n - 1]
    lo, hi = 0, n - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if xp[mid] <= x:
            lo = mid
        else:
            hi = mid
    if x == xp[lo]:
        return fp[lo]
    a = fp[lo]
    b = fp[hi]
    if a is None or b is None:
        return None
    return a + (b - a) * ((x - xp[lo]) / (xp[hi] - xp[lo]))


def step_prev(x, xp, fp):
    """Previous-value lookup: value of the last sample with xp <= x. Twin: interp.ts stepPrev()."""
    n = len(xp)
    if x < xp[0]:
        return fp[0]
    lo, hi = 0, n
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if xp[mid] <= x:
            lo = mid
        else:
            hi = mid
    return fp[lo]


def project(px, py, X, Y, D, lo, hi):
    """Nearest point on the polyline segments whose D range overlaps [lo, hi].

    Returns (distance along D, squared lateral error). Ties keep the first segment (strict <).
    Squared distances only: hypot differs between languages. Twin: interp.ts project().
    """
    n = len(X)
    k0 = 0
    while k0 < n - 2 and D[k0 + 1] < lo:
        k0 += 1
    k1 = k0
    while k1 < n - 2 and D[k1 + 1] <= hi:
        k1 += 1
    best_e2 = math.inf
    best_d = D[k0]
    for k in range(k0, k1 + 1):
        ex = X[k + 1] - X[k]
        ey = Y[k + 1] - Y[k]
        l2 = ex * ex + ey * ey
        u = 0.0 if l2 == 0.0 else ((px - X[k]) * ex + (py - Y[k]) * ey) / l2
        if u < 0.0:
            u = 0.0
        if u > 1.0:
            u = 1.0
        qx = X[k] + u * ex
        qy = Y[k] + u * ey
        e2 = (qx - px) * (qx - px) + (qy - py) * (qy - py)
        if e2 < best_e2:
            best_e2 = e2
            best_d = D[k] + u * (D[k + 1] - D[k])
    return best_d, best_e2


def grid(L, step):
    """Equal-step grid on [0, L], always ending exactly at L. Twin: interp.ts grid()."""
    g = []
    i = 0
    while i * step < L:
        g.append(i * step)
        i += 1
    g.append(L)
    return g


# ---------------------------------------------------------------- align (twin: lib/analysis/align.ts)


def _floats(values):
    return [float(v) for v in values]


def strictly_increasing(s, arrays):
    """Drop samples whose s does not increase (keeps the first). Twin: align.ts strictlyIncreasing()."""
    keep = [0]
    for i in range(1, len(s)):
        if s[i] > s[keep[len(keep) - 1]]:
            keep.append(i)
    return [s[i] for i in keep], [[a[i] for i in keep] for a in arrays]


def reference_path(lap_a, track):
    """The common axis. From track.path when a track is given, else from lap A's own samples.

    Twin: align.ts referencePath().
    """
    if track is not None:
        p = track["path"]
        return {
            "s": _floats(p["s_m"]),
            "x": _floats(p["x"]),
            "y": _floats(p["y"]),
            "speed": _floats(p["speed_kph"]),
            "L": float(track["L_m"]),
        }
    smp = lap_a["samples"]
    d = _floats(smp["dist_m"])
    d0 = d[0]
    s_raw = [v - d0 for v in d]
    s, (x, y, speed) = strictly_increasing(
        s_raw, [_floats(smp["x"]), _floats(smp["y"]), _floats(smp["speed_kph"])]
    )
    return {"s": s, "x": x, "y": y, "speed": speed, "L": s[len(s) - 1]}


def align(lap, path, cfg):
    """Map each sample of a lap onto the reference axis [0, L]. Twin: align.ts align().

    1) proportional guess g = own distance from its start, scaled to L;
    2) project each interior sample's XY onto the reference path, offset r = projected - g;
    3) average r within +-smooth_half_m of knots every knot_step_m;
    4) piecewise-linear warp g -> g + mean r, pinned at 0 and L.
    """
    a = cfg["align"]
    knot_step = float(a["knot_step_m"])
    smooth_half = float(a["smooth_half_m"])
    window = float(a["search_window_m"])
    min_gap = float(a["min_knot_gap_m"])
    smp = lap["samples"]
    d = _floats(smp["dist_m"])
    px = _floats(smp["x"])
    py = _floats(smp["y"])
    n = len(d)
    d0 = [v - d[0] for v in d]
    L = path["L"]
    scale = d0[n - 1] / L
    g = [v / scale for v in d0]
    gs = []
    rs = []
    for i in range(1, n - 1):
        p, _ = project(
            px[i], py[i], path["x"], path["y"], path["s"], g[i] - window, g[i] + window
        )
        gs.append(g[i])
        rs.append(p - g[i])
    kg = [0.0]
    ks = [0.0]
    j = 1
    while knot_step * j < L - knot_step / 2.0:
        c = knot_step * j
        acc = 0.0
        cnt = 0
        for q in range(len(gs)):
            if gs[q] >= c - smooth_half and gs[q] <= c + smooth_half:
                acc += rs[q]
                cnt += 1
        if cnt > 0:
            sk = c + acc / cnt
            if sk > ks[len(ks) - 1] + min_gap and sk < L - min_gap:
                kg.append(c)
                ks.append(sk)
        j += 1
    kg.append(L)
    ks.append(L)
    return [interp(v, kg, ks) for v in g]


# ---------------------------------------------------------------- delta (twin: lib/analysis/delta.ts)


def has_sectors(lap):
    """Twin: delta.ts hasSectors()."""
    st = lap.get("sector_ms")
    return st is not None and len(st) == 3 and st[0] is not None and st[1] is not None


def prepare(lap, path, cfg):
    """Aligned, strictly increasing samples of one lap. Time starts at 0. Twin: delta.ts prepare()."""
    s0 = align(lap, path, cfg)
    smp = lap["samples"]
    t_raw = smp["t_ms"]
    t0 = t_raw[0]
    t = [float(v - t0) for v in t_raw]
    s, (t, v, brake, thr, gear, x, y) = strictly_increasing(
        s0,
        [
            t,
            _floats(smp["speed_kph"]),
            smp["brake"],
            smp["throttle_pct"],
            smp["gear"],
            _floats(smp["x"]),
            _floats(smp["y"]),
        ],
    )
    return {
        "s": s,
        "t": t,
        "v": v,
        "brake": brake,
        "thr": thr,
        "gear": gear,
        "x": x,
        "y": y,
        "anchor": None,
    }


def anchor_ramp(P, sector_ms, lines, L):
    """Linear time correction through (0, 0), (line 1, c1), (line 2, c2), (L, 0) so t hits the
    official splits at the sector lines. Twin: delta.ts anchorRamp()."""
    c1 = sector_ms[0] - interp(lines[0], P["s"], P["t"])
    c2 = (sector_ms[0] + sector_ms[1]) - interp(lines[1], P["s"], P["t"])
    return [0.0, lines[0], lines[1], L], [0.0, c1, c2, 0.0]


def time_at(P, x):
    """Twin: delta.ts timeAt()."""
    t = interp(x, P["s"], P["t"])
    if P["anchor"] is not None:
        t = t + interp(x, P["anchor"][0], P["anchor"][1])
    return t


def delta_at(A, B, x):
    """delta(x) = tB(x) - tA(x) in ms; above 0 means A gained up to x. Twin: delta.ts deltaAt()."""
    return time_at(B, x) - time_at(A, x)


# ---------------------------------------------------------------- detect (twin: lib/analysis/detect.ts)


def moving_average(v, half):
    """Centered moving average, window shrinking at the edges. Twin: detect.ts movingAverage()."""
    out = []
    n = len(v)
    for i in range(n):
        lo = i - half if i - half > 0 else 0
        hi = i + half if i + half < n - 1 else n - 1
        acc = 0.0
        for j in range(lo, hi + 1):
            acc += v[j]
        out.append(acc / (hi - lo + 1))
    return out


def minima_with_prominence(v):
    """Local minima (strict on the left, non-strict on the right) with scipy-style prominence,
    lap edges acting as bases. Twin: detect.ts minimaWithProminence()."""
    res = []
    n = len(v)
    for i in range(1, n - 1):
        if v[i] < v[i - 1] and v[i] <= v[i + 1]:
            lm = v[i]
            j = i - 1
            while j >= 0 and v[j] >= v[i]:
                if v[j] > lm:
                    lm = v[j]
                j -= 1
            rm = v[i]
            j = i + 1
            while j < n and v[j] >= v[i]:
                if v[j] > rm:
                    rm = v[j]
                j += 1
            res.append((i, (lm if lm < rm else rm) - v[i]))
    return res


def detect_corners(s, speed, cfg):
    """Fallback corner detector: speed minima on the reference path. Twin: detect.ts detectCorners()."""
    det = cfg["detector"]
    step = float(cfg["grid_step_m"])
    smooth_m = float(det["smooth_window_m"])
    prominence_kph = float(det["prominence_kph"])
    min_spacing_m = float(det["min_spacing_m"])
    g = grid(s[len(s) - 1], step)
    v = [interp(x, s, speed) for x in g]
    half = round_half_away(smooth_m / step / 2.0)
    vs = moving_average(v, half) if half > 0 else v
    cands = [ip for ip in minima_with_prominence(vs) if ip[1] >= prominence_kph]
    cands.sort(key=lambda ip: (vs[ip[0]], ip[0]))  # lowest speed first, then earliest
    kept = []
    for i, p in cands:
        ok = True
        for k, _ in kept:
            if not (abs(g[i] - g[k]) >= min_spacing_m):
                ok = False
                break
        if ok:
            kept.append((i, p))
    kept.sort(key=lambda ip: ip[0])
    return [{"s_m": g[i], "v_smooth_kph": vs[i], "prominence_kph": p} for i, p in kept]


# ---------------------------------------------------------------- corners (twin: lib/analysis/corners.ts)


def corner_markers(track, path, cfg):
    """Official markers from the track file, else detected speed minima labeled 1..n.

    Returns (markers, source, prefix). Twin: corners.ts cornerMarkers().
    """
    if track is not None and len(track["corners"]) > 0:
        markers = [
            {"label": c["label"], "s_m": float(c["s_m"])} for c in track["corners"]
        ]
        return markers, "official", "T"
    det = detect_corners(path["s"], path["speed"], cfg)
    markers = [{"label": str(k + 1), "s_m": det[k]["s_m"]} for k in range(len(det))]
    return markers, "detected", "C"


def group_corners(markers, group_m, prefix):
    """Consecutive markers closer than group_m become one row: T6-7. Twin: corners.ts groupCorners()."""
    groups = []
    for c in markers:
        if len(groups) > 0 and c["s_m"] - groups[len(groups) - 1]["s_last"] < group_m:
            groups[len(groups) - 1]["s_last"] = c["s_m"]
            groups[len(groups) - 1]["labels"].append(c["label"])
        else:
            groups.append(
                {"s_first": c["s_m"], "s_last": c["s_m"], "labels": [c["label"]]}
            )
    for g in groups:
        labels = g["labels"]
        if len(labels) == 1:
            g["label"] = prefix + labels[0]
        else:
            g["label"] = prefix + labels[0] + "-" + labels[len(labels) - 1]
    return groups


def boundaries(groups, L):
    """Segment edges: 0, midpoints between rows, L. Twin: corners.ts boundaries()."""
    b = [0.0]
    for k in range(len(groups) - 1):
        b.append((groups[k]["s_last"] + groups[k + 1]["s_first"]) / 2.0)
    b.append(L)
    return b


def corner_metrics(P, lo, hi, s_exit):
    """Raw per-driver corner metrics inside [lo, hi]. None when no sample falls inside.

    Twin: corners.ts cornerMetrics().
    """
    s = P["s"]
    idx = []
    for i in range(len(s)):
        if s[i] >= lo and s[i] <= hi:
            idx.append(i)
    if len(idx) == 0:
        return None
    first = idx[0]
    last = idx[len(idx) - 1]
    imin = first
    for i in idx:
        if P["v"][i] < P["v"][imin]:  # first minimum on ties
            imin = i
    j = imin
    brake_i = None
    while j >= first:  # last brake-on sample at or before the minimum
        if P["brake"][j] is True:
            break
        j -= 1
    if j >= first:  # back to the first sample of that brake-on run
        while j - 1 >= first and P["brake"][j - 1] is True:
            j -= 1
        brake_i = j
    return {
        "min_speed_kph": P["v"][imin],
        "min_speed_s_m": s[imin],
        "min_edge": imin == first or imin == last,
        "brake_s_m": None if brake_i is None else s[brake_i],
        "brake_gap_m": None
        if (brake_i is None or brake_i == 0)
        else s[brake_i] - s[brake_i - 1],
        "brake_at_segment_start": brake_i is not None and brake_i == first,
        "exit_speed_kph": interp(s_exit, s, P["v"]),
    }


def driver_corner(m, marker_s):
    """Integers and display strings for one driver's corner metrics. Twin: corners.ts driverCorner()."""
    if m is None:
        return None
    min_int = round_half_away(m["min_speed_kph"])
    exit_int = round_half_away(m["exit_speed_kph"])
    before = (
        None if m["brake_s_m"] is None else round_half_away(marker_s - m["brake_s_m"])
    )
    gap = None if m["brake_gap_m"] is None else round_half_away(m["brake_gap_m"])
    return {
        "min_speed_kph": min_int,
        "min_speed_kph_float": m["min_speed_kph"],
        "min_speed_s_m": m["min_speed_s_m"],
        "min_edge": m["min_edge"],
        "brake_s_m": m["brake_s_m"],
        "brake_before_m": before,
        "brake_gap_m": gap,
        "brake_gap_m_float": m["brake_gap_m"],
        "brake_at_segment_start": m["brake_at_segment_start"],
        "exit_speed_kph": exit_int,
        "exit_speed_kph_float": m["exit_speed_kph"],
        "display": {
            "min_speed": format_speed(min_int),
            "exit_speed": format_speed(exit_int),
            "brake": None if before is None else format_brake_point(before),
            "brake_gap": None if gap is None else format_distance(gap),
        },
    }


def corner_rows(A, B, groups, b, deltas, cfg):
    """One row per corner group. deltas[k] = delta(b[k]). Twin: corners.ts cornerRows()."""
    exit_offset = float(cfg["corners"]["exit_offset_m"])
    rows = []
    for k in range(len(groups)):
        c = groups[k]
        lo = b[k]
        hi = b[k + 1]
        s_exit = c["s_last"] + exit_offset
        clamped = s_exit > hi
        if clamped:
            s_exit = hi
        dlo = deltas[k]
        dhi = deltas[k + 1]
        d_int = round_half_away(dhi) - round_half_away(
            dlo
        )  # round the cumulative, then subtract
        rows.append(
            {
                "index": k,
                "label": c["label"],
                "s_m": c["s_first"],
                "s_last_m": c["s_last"],
                "seg_start_m": lo,
                "seg_end_m": hi,
                "exit_s_m": s_exit,
                "exit_clamped": clamped,
                "delta_ms": d_int,
                "delta_ms_float": dhi - dlo,
                "a": driver_corner(corner_metrics(A, lo, hi, s_exit), c["s_first"]),
                "b": driver_corner(corner_metrics(B, lo, hi, s_exit), c["s_first"]),
                "display": delta_display(d_int),
            }
        )
    return rows


# ---------------------------------------------------------------- mini-sectors (twin: lib/analysis/minisectors.ts)


def mini_sector_edges(L, count):
    """count equal-distance slices of [0, L]; the last edge is exactly L. Twin: minisectors.ts miniSectorEdges()."""
    edges = []
    for j in range(count):
        edges.append(L * j / count)
    edges.append(L)
    return edges


def mini_sectors(edges, deltas, cfg):
    """deltas[j] = delta(edges[j]). Twin: minisectors.ts miniSectors()."""
    faint_below = cfg["minisectors"]["faint_below_ms"]
    out = []
    for j in range(len(edges) - 1):
        dlo = deltas[j]
        dhi = deltas[j + 1]
        di = round_half_away(dhi) - round_half_away(dlo)
        if di > 0:
            faster = "A"
        elif di < 0:
            faster = "B"
        else:
            faster = "tie"
        out.append(
            {
                "index": j,
                "s_start_m": edges[j],
                "s_end_m": edges[j + 1],
                "delta_ms": di,
                "delta_ms_float": dhi - dlo,
                "faster": faster,
                "faint": abs(di) < faint_below,
                "display": delta_display(di),
            }
        )
    return out


# ---------------------------------------------------------------- findings (twin: lib/analysis/findings.ts)


def finding_checks(row, level_kph):
    """Each supporting fact and whether it passes its own check. Twin: findings.ts findingChecks()."""
    a = row["a"]
    b = row["b"]
    brake_diff = None
    braking = False
    min_diff = None
    min_ok = False
    exit_diff = None
    exit_ok = False
    if a is not None and b is not None:
        if a["brake_before_m"] is not None and b["brake_before_m"] is not None:
            brake_diff = (
                b["brake_before_m"] - a["brake_before_m"]
            )  # above 0: A brakes later
            if (
                a["brake_gap_m"] is not None
                and b["brake_gap_m"] is not None
                and not a["brake_at_segment_start"]
                and not b["brake_at_segment_start"]
            ):
                mag = abs(brake_diff)
                braking = mag > a["brake_gap_m"] and mag > b["brake_gap_m"]
        min_diff = a["min_speed_kph"] - b["min_speed_kph"]
        min_ok = (
            (not a["min_edge"]) and (not b["min_edge"]) and abs(min_diff) > level_kph
        )
        exit_diff = a["exit_speed_kph"] - b["exit_speed_kph"]
        exit_ok = (not row["exit_clamped"]) and abs(exit_diff) > level_kph
    return {
        "braking": braking,
        "min_speed": min_ok,
        "exit_speed": exit_ok,
        "brake_diff_m": brake_diff,
        "min_speed_diff_kph": min_diff,
        "exit_speed_diff_kph": exit_diff,
    }


def finding_display(row, chk):
    """Display strings for one finding: only the fields that pass their checks. Twin: findings.ts findingDisplay()."""
    ms = row["delta_ms"]
    a = row["a"]
    b = row["b"]
    d = {
        "label": row["label"],
        "direction": direction_word(ms),
        "time": format_time(ms),
        "delta": format_time_delta(ms),
    }
    if chk["braking"]:
        d["brake_a"] = format_brake_point(a["brake_before_m"])
        d["brake_b"] = format_brake_point(b["brake_before_m"])
        d["brake_gap_a"] = format_distance(a["brake_gap_m"])
        d["brake_gap_b"] = format_distance(b["brake_gap_m"])
        d["brake_diff"] = format_distance(chk["brake_diff_m"])
        d["brake_word"] = later_earlier(chk["brake_diff_m"])
    if chk["min_speed"]:
        d["min_speed_a"] = format_speed(a["min_speed_kph"])
        d["min_speed_b"] = format_speed(b["min_speed_kph"])
        d["min_speed_diff"] = format_speed(chk["min_speed_diff_kph"])
        d["min_speed_word"] = higher_lower(chk["min_speed_diff_kph"])
    if chk["exit_speed"]:
        d["exit_speed_a"] = format_speed(a["exit_speed_kph"])
        d["exit_speed_b"] = format_speed(b["exit_speed_kph"])
        d["exit_speed_diff"] = format_speed(chk["exit_speed_diff_kph"])
        d["exit_speed_word"] = higher_lower(chk["exit_speed_diff_kph"])
    return d


def make_finding(row, kind, rank, level_kph):
    """Twin: findings.ts makeFinding()."""
    chk = finding_checks(row, level_kph)
    if chk["braking"]:
        cause = "braking"
    elif chk["min_speed"]:
        cause = "min_speed"
    elif chk["exit_speed"]:
        cause = "exit_speed"
    else:
        cause = "time_only"
    return {
        "id": kind + "-" + str(rank),
        "kind": kind,
        "rank": rank,
        "corner_index": row["index"],
        "label": row["label"],
        "delta_ms": row["delta_ms"],
        "cause": cause,
        "checks": {
            "braking": chk["braking"],
            "min_speed": chk["min_speed"],
            "exit_speed": chk["exit_speed"],
        },
        "brake_diff_m": chk["brake_diff_m"],
        "min_speed_diff_kph": chk["min_speed_diff_kph"],
        "exit_speed_diff_kph": chk["exit_speed_diff_kph"],
        "display": finding_display(row, chk),
    }


def findings(rows, cfg):
    """Top gains then top losses at |delta| >= min_abs_ms, A's view; ties go to the earlier row.

    Never padded. Twin: findings.ts findings().
    """
    f = cfg["findings"]
    top_n = f["top_n"]
    min_abs = f["min_abs_ms"]
    level = f["level_speed_kph"]
    idx = list(range(len(rows)))
    gains = [i for i in idx if rows[i]["delta_ms"] >= min_abs]
    gains.sort(key=lambda i: (-rows[i]["delta_ms"], i))
    losses = [i for i in idx if rows[i]["delta_ms"] <= -min_abs]
    losses.sort(key=lambda i: (rows[i]["delta_ms"], i))
    out = []
    for r in range(min(top_n, len(gains))):
        out.append(make_finding(rows[gains[r]], "gain", r + 1, level))
    for r in range(min(top_n, len(losses))):
        out.append(make_finding(rows[losses[r]], "loss", r + 1, level))
    return out


# ---------------------------------------------------------------- entry point (twin: lib/analysis/index.ts)


def lap_meta(lap):
    """Twin: index.ts lapMeta(). Top speed is the highest raw sample, not the grid maximum."""
    st = lap.get("sector_ms")
    top_kph = round_half_away(max(lap["samples"]["speed_kph"]))
    return {
        "driver": lap.get("driver"),
        "lap_no": lap["lap_no"],
        "origin": lap["origin"],
        "duration_ms": lap["duration_ms"],
        "sector_ms": None if st is None else list(st),
        "top_speed_kph": top_kph,
        "display": {
            "lap_time": format_lap_time(lap["duration_ms"]),
            "top_speed": format_speed(top_kph),
        },
    }


def grid_trace(P, g):
    """Per-driver channels on the grid. Twin: index.ts gridTrace()."""
    t = []
    speed = []
    thr = []
    brake = []
    gear = []
    x = []
    y = []
    for v in g:
        t.append(time_at(P, v))
        speed.append(interp(v, P["s"], P["v"]))
        thr.append(interp_nullable(v, P["s"], P["thr"]))
        brake.append(step_prev(v, P["s"], P["brake"]))
        gear.append(step_prev(v, P["s"], P["gear"]))
        x.append(interp(v, P["s"], P["x"]))
        y.append(interp(v, P["s"], P["y"]))
    return {
        "t_ms": t,
        "speed_kph": speed,
        "throttle_pct": thr,
        "brake": brake,
        "gear": gear,
        "x": x,
        "y": y,
    }


def analyze_pair(lap_a, lap_b, track, config):
    """Compare lap A with lap B. Pure and deterministic. Twin: index.ts analyzePair().

    track may be None: the reference path then comes from lap A, corners from the speed-minima
    detector (labels C1..Cn), and there is no sector anchoring.
    """
    path = reference_path(lap_a, track)
    L = path["L"]
    A = prepare(lap_a, path, config)
    B = prepare(lap_b, path, config)
    lines = None if track is None else track.get("sector_lines_m")
    anchored = lines is not None and has_sectors(lap_a) and has_sectors(lap_b)
    if anchored:
        A["anchor"] = anchor_ramp(A, lap_a["sector_ms"], lines, L)
        B["anchor"] = anchor_ramp(B, lap_b["sector_ms"], lines, L)

    markers, source, prefix = corner_markers(track, path, config)
    groups = group_corners(markers, float(config["corners"]["group_m"]), prefix)
    b = boundaries(groups, L)
    rows = corner_rows(A, B, groups, b, [delta_at(A, B, x) for x in b], config)

    edges = mini_sector_edges(L, config["minisectors"]["count"])
    minis = mini_sectors(edges, [delta_at(A, B, x) for x in edges], config)

    d0 = delta_at(A, B, 0.0)
    dL = delta_at(A, B, L)
    gap = round_half_away(dL) - round_half_away(d0)

    g = grid(L, float(config["grid_step_m"]))
    meta_a = lap_meta(lap_a)
    meta_b = lap_meta(lap_b)
    return {
        "schema": COMPARISON_SCHEMA,
        "L_m": L,
        "corner_source": source,
        "anchored": anchored,
        "anchor_ms": {
            "a": None
            if A["anchor"] is None
            else [A["anchor"][1][1], A["anchor"][1][2]],
            "b": None
            if B["anchor"] is None
            else [B["anchor"][1][1], B["anchor"][1][2]],
        },
        "lap_a": meta_a,
        "lap_b": meta_b,
        "lap_gap_ms": gap,
        "lap_gap_ms_float": dL - d0,
        "display": {
            "lap_time_a": meta_a["display"]["lap_time"],
            "lap_time_b": meta_b["display"]["lap_time"],
            "gap_direction": direction_word(gap),
            "gap_time": format_time(gap),
            "gap": format_time_delta(gap),
        },
        "corners": rows,
        "mini_sectors": minis,
        "findings": findings(rows, config),
        "grid": {
            "s_m": g,
            "delta_ms": [delta_at(A, B, x) for x in g],
            "a": grid_trace(A, g),
            "b": grid_trace(B, g),
        },
    }
