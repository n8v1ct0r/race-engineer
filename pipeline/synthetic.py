"""Deterministic synthetic session: one made-up closed track and 3 laps. Stdlib only.

Writes public/demo/ (manifest, track, laps) and fixtures/parity/ (expected.json from the Python
reference, planted.json with the differences planted here). Run: pnpm synthetic.

Nothing here comes from Formula 1 data. The track is not a real circuit.

How a lap is made:
1. Geometry: straights and constant-curvature arcs, heading summed to 360 degrees; two straights
   are resized so the loop closes (within 0.5 m).
2. Speed on a 0.5 m grid of true distance: a per-corner speed limit (V-shaped around the apex),
   then a forward pass (traction limit) and a backward pass (braking limit), over 3 laps so the
   lap wraps cleanly. Brake is on where the braking limit binds.
3. Sampling like F1 car data: about 240 ms steps with jitter, integer km/h, 1 dp XY with noise,
   distance integrated from the sampled speed with a small per-driver scale error.
Planted differences are per-driver changes to steps 2 and 3, listed in PLANTS.
"""

import json
import math
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from pipeline.reference.analysis import analyze_pair, detect_corners, project  # noqa: E402
from pipeline.reference.format import round_half_away  # noqa: E402
from pipeline.lap_qa import unknown_notes  # noqa: E402

SEED = 20260923
SESSION_ID = "synthetic-demo"
TRACK_ID = "synthetic-loop"
DU = 0.5  # m, true-distance step of the speed model

# Track layout. ("S", length_m) or ("C", label, arc_length_m, angle_deg, apex_kph or None).
# Angles are positive to the left. None means no speed limit (a flat kink).
LAYOUT = [
    ("S", 360.0),
    ("C", "1", 90.0, 95.0, 92.0),
    ("S", 220.0),
    ("C", "2", 80.0, -50.0, 150.0),
    ("S", 150.0),
    ("C", "3", 140.0, 14.0, None),
    ("S", 160.0),
    ("C", "4", 75.0, 96.0, 118.0),
    ("S", 260.0),
    ("C", "5", 110.0, -40.0, 195.0),
    ("S", 220.0),
    ("C", "6", 40.0, -48.0, 142.0),
    ("S", 22.0),
    ("C", "7", 40.0, 78.0, 124.0),
    ("S", 300.0),
    ("C", "8", 100.0, 50.0, 172.0),
    ("S", 250.0),
    ("C", "9", 85.0, 80.0, 104.0),
    ("S", 400.0),
    ("C", "10", 90.0, -35.0, 215.0),
    ("S", 200.0),
    ("C", "11", 90.0, 55.0, 158.0),
    ("S", 200.0),
    ("C", "12", 60.0, 40.0, 112.0),
    ("S", 72.0),
    ("C", "12A", 60.0, 25.0, 128.0),
    ("S", 400.0),
]
# The two straights stretched to close the loop (indices into LAYOUT).
CLOSE_WITH = (16, 20)
# Sector lines: (layout index of a straight, fraction along it).
SECTOR_LINES = ((8, 0.5), (18, 0.6))

APEX_SLOPE_KPH_PER_M = 0.05  # V-shaped speed limit inside an arc, lowest at its center
A_TRACTION_0 = 13.0  # m/s^2 at 0 km/h
V_TERMINAL_KPH = 336.0
A_BRAKE_LOW = 30.0  # m/s^2, plus aero term below
A_BRAKE_AERO = 22.0
GEAR_UP_KPH = (0.0, 90.0, 125.0, 160.0, 195.0, 230.0, 265.0, 298.0)

# Planted differences. Keys are driver codes. Every entry here is recorded in planted.json.
#   brake_factor:   braking deceleration factor over the 300 m before a corner's arc (below 1 brakes earlier)
#   apex_dv_kph:    change of the corner's apex speed limit
#   traction:       (from corner label, start offset after arc end m, length m, factor)
#   dropout:        (corner label, samples removed just before that driver's brake-on sample)
PLANTS = {
    "AAA": {},
    "BBB": {
        "brake_factor": {"1": 0.6, "11": 0.6},
        "apex_dv_kph": {"7": 7.0},
        "traction": [("9", 0.0, 120.0, 1.3)],
        "dropout": ("11", 3),
    },
    "CCC": {
        "apex_dv_kph": {"2": -6.0},
        "traction": [("11", 0.0, 120.0, 1.3)],
    },
}
# Per-driver sampling and measurement character.
DRIVER_SIGNAL = {
    "AAA": {"dist_scale": 1.0, "dist_start_m": 0.0, "xy_noise_m": 1.2, "sectors": True},
    "BBB": {
        "dist_scale": 1.0035,
        "dist_start_m": 0.9,
        "xy_noise_m": 1.2,
        "sectors": True,
    },
    "CCC": {
        "dist_scale": 0.9955,
        "dist_start_m": 0.4,
        "xy_noise_m": 1.2,
        "sectors": False,
        # Photoncar-like dropouts, so parity covers null channels. channel: (layout index of a
        # straight, fraction along it, count): the first `count` samples whose dist_m reaches
        # that point read null. Throttle at the T4 exit (45% to 100%), brake after the T7 apex
        # (outside every brake run), gear on the straight after T9. No planted truth moves.
        "unknown": {
            "throttle_pct": (8, 0.0, 2),
            "brake": (14, 0.3, 1),
            "gear": (18, 0.3, 1),
        },
    },
}
DRIVERS = ("AAA", "BBB", "CCC")


# ---------------------------------------------------------------- geometry


def element_directions(layout):
    """Heading at the start of every element, starting at 0 rad."""
    h = 0.0
    out = []
    for el in layout:
        out.append(h)
        if el[0] == "C":
            h += math.radians(el[3])
    return out


def trace(layout):
    """Integrate the layout on the DU grid. Returns true distance u and the x, y of every point."""
    u, xs, ys = [0.0], [0.0], [0.0]
    x = y = h = 0.0
    total = 0.0
    for el in layout:
        length = el[1] if el[0] == "S" else el[2]
        kappa = 0.0 if el[0] == "S" else math.radians(el[3]) / length
        steps = int(round_half_away(length / DU))
        for _ in range(steps):
            hm = h + kappa * DU / 2.0
            x += math.cos(hm) * DU
            y += math.sin(hm) * DU
            h += kappa * DU
            total += DU
            u.append(total)
            xs.append(x)
            ys.append(y)
    return u, xs, ys


def closed_layout():
    """Resize two straights so the loop closes (heading already sums to 360)."""
    layout = [list(el) for el in LAYOUT]
    angle_sum = sum(el[3] for el in layout if el[0] == "C")
    if angle_sum != 360.0:
        raise ValueError(f"corner angles sum to {angle_sum}, not 360")
    _, xs, ys = trace(layout)
    ex, ey = xs[-1], ys[-1]
    heads = element_directions(layout)
    i, j = CLOSE_WITH
    ax, ay = math.cos(heads[i]), math.sin(heads[i])
    bx, by = math.cos(heads[j]), math.sin(heads[j])
    det = ax * by - ay * bx
    # solve a * (ax, ay) + b * (bx, by) = -(ex, ey)
    a = (-ex * by + ey * bx) / det
    b = (-ay * -ex + ax * -ey) / det
    layout[i][1] = float(round_half_away((layout[i][1] + a) / DU)) * DU
    layout[j][1] = float(round_half_away((layout[j][1] + b) / DU)) * DU
    if layout[i][1] < 100.0 or layout[j][1] < 100.0:
        raise ValueError("closing the loop made a straight too short")
    return [tuple(el) for el in layout]


def corner_spans(layout):
    """(label, arc start u, arc end u, apex kph) for every corner, in lap order."""
    spans = []
    u = 0.0
    for el in layout:
        if el[0] == "S":
            u += float(round_half_away(el[1] / DU)) * DU
        else:
            length = float(round_half_away(el[2] / DU)) * DU
            spans.append((el[1], u, u + length, el[4]))
            u += length
    return spans


def straight_point(layout, index, fraction):
    """True distance of a point on straight `index`."""
    u = 0.0
    for k, el in enumerate(layout):
        length = float(round_half_away((el[1] if el[0] == "S" else el[2]) / DU)) * DU
        if k == index:
            return u + length * fraction
        u += length
    raise IndexError(index)


# ---------------------------------------------------------------- speed model


def kph(v_ms):
    return v_ms * 3.6


def ms(v_kph):
    return v_kph / 3.6


def a_traction(v):
    r = v / ms(V_TERMINAL_KPH)
    return A_TRACTION_0 * (1.0 - r * r)


def a_brake(v):
    r = v / ms(V_TERMINAL_KPH)
    return A_BRAKE_LOW + A_BRAKE_AERO * r * r


def speed_profile(n, spans, plants):
    """Speed (m/s), brake flag and throttle on the DU grid for one lap of n + 1 points."""
    inf = float("inf")
    limit = [inf] * (n + 1)
    apex_dv = plants.get("apex_dv_kph", {})
    for label, u0, u1, apex in spans:
        if apex is None:
            continue
        apex_kph = apex + apex_dv.get(label, 0.0)
        uc = (u0 + u1) / 2.0
        i0 = int(round_half_away(u0 / DU))
        i1 = int(round_half_away(u1 / DU))
        for i in range(i0, i1 + 1):
            lim = ms(apex_kph + APEX_SLOPE_KPH_PER_M * abs(i * DU - uc))
            if lim < limit[i]:
                limit[i] = lim
    by_label = {sp[0]: sp for sp in spans}
    bfac = [1.0] * (n + 1)
    for label, f in plants.get("brake_factor", {}).items():
        u0 = by_label[label][1]
        for i in range(
            int(round_half_away((u0 - 300.0) / DU)), int(round_half_away(u0 / DU)) + 1
        ):
            bfac[i % n] = f
    factor = [1.0] * (n + 1)
    for label, start, length, f in plants.get("traction", []):
        u_end = by_label[label][2]
        for i in range(
            int(round_half_away((u_end + start) / DU)),
            int(round_half_away((u_end + start + length) / DU)) + 1,
        ):
            factor[i % n] = f

    # three laps back to back so the start line sees a flying lap
    m = 3 * n + 1
    lim3 = [limit[i % n] for i in range(m)]
    fac3 = [factor[i % n] for i in range(m)]
    bfac3 = [bfac[i % n] for i in range(m)]
    v = [0.0] * m
    mode = ["lim"] * m
    v[0] = min(lim3[0], ms(250.0))
    for i in range(1, m):
        vp = v[i - 1]
        va = math.sqrt(vp * vp + 2.0 * a_traction(vp) * fac3[i] * DU)
        if va < lim3[i]:
            v[i], mode[i] = va, "acc"
        else:
            v[i], mode[i] = lim3[i], "lim"
    for i in range(m - 2, -1, -1):
        vn = v[i + 1]
        vb = math.sqrt(vn * vn + 2.0 * a_brake(vn) * bfac3[i] * DU)
        if vb < v[i]:
            v[i], mode[i] = vb, "brk"
    lap_v = v[n : 2 * n + 1]
    lap_mode = mode[n : 2 * n + 1]
    brake = [md == "brk" for md in lap_mode]
    thr = []
    for md in lap_mode:
        if md == "brk":
            thr.append(0)
        elif md == "acc":
            thr.append(100)
        else:
            thr.append(45)
    return lap_v, brake, thr


def elapsed(v):
    """Time (s) at every DU point, trapezoid on 1/v."""
    t = [0.0]
    for i in range(1, len(v)):
        t.append(t[-1] + DU * 0.5 * (1.0 / v[i - 1] + 1.0 / v[i]))
    return t


def gear_for(v_kph):
    g = 1
    for k, up in enumerate(GEAR_UP_KPH):
        if v_kph >= up:
            g = k + 1
    return g


def rpm_for(v_kph, gear):
    lo = GEAR_UP_KPH[gear - 1]
    hi = GEAR_UP_KPH[gear] if gear < len(GEAR_UP_KPH) else V_TERMINAL_KPH
    frac = (v_kph - lo) / (hi - lo)
    return int(round_half_away(10200.0 + 1600.0 * frac))


# ---------------------------------------------------------------- sampling


def q(value, dp):
    """Fixed-precision value for the lap files (input data, not display)."""
    scale = 10**dp
    return round_half_away(value * scale) / scale


def interp_at(x, xp, fp):
    """Plain linear interpolation for the generator (not the analysis)."""
    lo, hi = 0, len(xp) - 1
    if x <= xp[0]:
        return fp[0]
    if x >= xp[hi]:
        return fp[hi]
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if xp[mid] <= x:
            lo = mid
        else:
            hi = mid
    return fp[lo] + (fp[hi] - fp[lo]) * (x - xp[lo]) / (xp[hi] - xp[lo])


def make_lap(driver, geo, spans, rng):
    u_grid, gx, gy = geo
    n = len(u_grid) - 1
    plants = PLANTS[driver]
    sig = DRIVER_SIGNAL[driver]
    v, brake, thr = speed_profile(n, spans, plants)
    t = elapsed(v)
    duration_ms = int(round_half_away(t[-1] * 1000.0))

    # sample times: about 240 ms with jitter and the odd long step, plus both edge rows
    times = [0]
    while True:
        dt = 240 + rng.randint(-45, 45)
        if rng.random() < 0.06:
            dt += rng.randint(100, 220)
        nxt = times[-1] + dt
        if nxt > duration_ms - 60:
            break
        times.append(nxt)
    times.append(duration_ms)

    # true distance of every sample (invert t(u))
    t_ms_grid = [x * 1000.0 for x in t]
    us = [interp_at(float(tm), t_ms_grid, u_grid) for tm in times]
    us[-1] = u_grid[-1]

    drop = plants.get("dropout")
    if drop is not None:
        label, count = drop
        u0 = [s for s in spans if s[0] == label][0][1]
        first_on = None
        for k in range(1, len(us) - 1):
            i = int(us[k] / DU)
            if us[k] < u0 and brake[i] and (u0 - us[k]) < 400.0:
                first_on = k
                break
        if first_on is None:
            raise ValueError(
                f"no brake sample found before corner {label} for {driver}"
            )
        keep = [k for k in range(len(us)) if not (first_on - count <= k < first_on)]
        times = [times[k] for k in keep]
        us = [us[k] for k in keep]

    samples = {
        k: []
        for k in (
            "t_ms",
            "dist_m",
            "speed_kph",
            "throttle_pct",
            "brake",
            "gear",
            "rpm",
            "x",
            "y",
        )
    }
    dist = sig["dist_start_m"]
    prev_v = None
    prev_t = None
    for k in range(len(us)):
        i = int(us[k] / DU)
        if i >= n:
            i = n - 1
        v_kph = kph(interp_at(us[k], u_grid, v))
        sp = int(round_half_away(v_kph))
        if prev_v is not None:
            dt_s = (times[k] - prev_t) / 1000.0
            dist += sig["dist_scale"] * 0.5 * (ms(prev_v) + ms(sp)) * dt_s
        prev_v, prev_t = sp, times[k]
        gear = gear_for(sp)
        samples["t_ms"].append(times[k])
        samples["dist_m"].append(q(dist, 2))
        samples["speed_kph"].append(sp)
        samples["throttle_pct"].append(thr[i])
        samples["brake"].append(brake[i])
        samples["gear"].append(gear)
        samples["rpm"].append(rpm_for(sp, gear))
        x = interp_at(us[k], u_grid, gx) + rng.gauss(0.0, sig["xy_noise_m"])
        y = interp_at(us[k], u_grid, gy) + rng.gauss(0.0, sig["xy_noise_m"])
        samples["x"].append(q(x, 1))
        samples["y"].append(q(y, 1))
    return {
        "times_s": t,
        "v": v,
        "brake": brake,
        "duration_ms": duration_ms,
        "samples": samples,
    }


def sector_ms(truth, lines_u, u_grid):
    t1 = int(round_half_away(interp_at(lines_u[0], u_grid, truth["times_s"]) * 1000.0))
    t2 = int(round_half_away(interp_at(lines_u[1], u_grid, truth["times_s"]) * 1000.0))
    d = truth["duration_ms"]
    return [t1, t2 - t1, d - t2]


# ---------------------------------------------------------------- output


def dump(obj, path, indent=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if indent is None:
        text = json.dumps(obj, separators=(",", ":"), allow_nan=False)
    else:
        text = json.dumps(obj, indent=indent, allow_nan=False)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text + "\n")


def build():
    rng = random.Random(SEED)
    layout = closed_layout()
    geo = trace(layout)
    u_grid, gx, gy = geo
    spans = corner_spans(layout)
    lines_u = [straight_point(layout, i, f) for i, f in SECTOR_LINES]

    truths = {d: make_lap(d, geo, spans, rng) for d in DRIVERS}
    # Null samples go in after sampling, so they use no random draws and no other lap changes.
    for d in DRIVERS:
        smp = truths[d]["samples"]
        for key, (index, fraction, count) in (
            DRIVER_SIGNAL[d].get("unknown", {}).items()
        ):
            u = straight_point(layout, index, fraction)
            k0 = next(k for k, v in enumerate(smp["dist_m"]) if v >= u)
            for k in range(k0, k0 + count):
                smp[key][k] = None
    laps = {}
    for d in DRIVERS:
        tr = truths[d]
        laps[d] = {
            "schema": "race-engineer.lap/v1",
            "origin": "synthetic",
            "track_id": TRACK_ID,
            "session_id": SESSION_ID,
            "driver": d,
            "lap_no": 1,
            "duration_ms": tr["duration_ms"],
            "sector_ms": sector_ms(tr, lines_u, u_grid)
            if DRIVER_SIGNAL[d]["sectors"]
            else None,
            "valid": True,
            "meta": {"generator": "pipeline/synthetic.py", "seed": SEED},
            "samples": tr["samples"],
        }

    # reference lap: the fastest; its samples are the track path, as the exporter does
    ref = min(DRIVERS, key=lambda d: (laps[d]["duration_ms"], d))
    rs = laps[ref]["samples"]
    s_path = [q(v - rs["dist_m"][0], 2) for v in rs["dist_m"]]
    L = s_path[-1]
    scale = (rs["dist_m"][-1] - rs["dist_m"][0]) / u_grid[-1]

    def on_path(u):
        px = interp_at(u, u_grid, gx)
        py = interp_at(u, u_grid, gy)
        guess = u * scale
        s, _ = project(px, py, rs["x"], rs["y"], s_path, guess - 150.0, guess + 150.0)
        return q(s, 2)

    track = {
        "schema": "race-engineer.track/v1",
        "track_id": TRACK_ID,
        "L_m": L,
        "reference": {"lap_id": f"{ref}-1", "driver": ref, "lap_no": 1},
        "path": {
            "s_m": s_path,
            "x": list(rs["x"]),
            "y": list(rs["y"]),
            "speed_kph": list(rs["speed_kph"]),
        },
        "corners": [
            {"label": lab, "s_m": on_path((u0 + u1) / 2.0)} for lab, u0, u1, _ in spans
        ],
        "sector_lines_m": [on_path(u) for u in lines_u],
    }
    return layout, spans, lines_u, laps, track, ref


def manifest_for(laps, ref):
    drivers = []
    for d in DRIVERS:
        lap = laps[d]
        # the exporter's QA rule, so the demo shows it too
        notes = unknown_notes(lap["samples"])
        drivers.append(
            {
                "code": d,
                "laps": [
                    {
                        "lap_id": f"{d}-1",
                        "lap_no": 1,
                        "duration_ms": lap["duration_ms"],
                        "sector_ms": lap["sector_ms"],
                        "segment": None,
                        "compound": None,
                        "tyre_life": None,
                        "personal_best": True,
                        "deleted": False,
                        "deleted_reason": None,
                        "yellow": None,
                        "qa": "low_confidence" if notes else "ok",
                        "qa_notes": notes,
                    }
                ],
            }
        )
    return {
        "schema": "race-engineer.manifest/v1",
        "sessions": [
            {
                "session_id": SESSION_ID,
                "origin": "synthetic",
                "season": None,
                "round": None,
                "event_name": "Synthetic demo",
                "location": "Synthetic",
                "location_slug": "demo",
                "session_code": "Q",
                "session_name": "Qualifying",
                "date": None,
                "track_id": TRACK_ID,
                "corner_source": "official",
                "default_pair": {"a": "AAA-1", "b": "BBB-1"},
                "drivers": drivers,
                "provenance": {
                    "generator": "pipeline/synthetic.py",
                    "seed": SEED,
                    "reference_lap": f"{ref}-1",
                },
            }
        ],
    }


# Planted truths, stated as what the analysis must find (A's view). Tests assert these.
PLANTED = {
    "schema": "race-engineer.planted/v1",
    "note": "Differences planted by pipeline/synthetic.py (PLANTS). Expected outcomes are stated from driver A's view.",
    "reference_lap": "AAA-1",
    "structure": {
        "group_label": "T6-7",
        "letter_label": "T12A",
        "edge_min_label": "T3",
        "clamped_exit_label": "T12",
        "dropout": {"lap": "BBB-1", "label": "T11"},
        "detector_misses": ["3"],
        "detector_merges": [["6", "7"]],
    },
    "pairs": [
        {
            "a": "AAA-1",
            "b": "BBB-1",
            "track": True,
            "anchored": True,
            "expect": [
                {
                    "label": "T1",
                    "kind": "gain",
                    "cause": "braking",
                    "brake_word": "later",
                    "plant": "BBB brakes with 60% of the deceleration into T1, so it starts braking about 55 m earlier",
                },
                {
                    "label": "T11",
                    "kind": "gain",
                    "cause": "time_only",
                    "plant": "BBB brakes with 60% of the deceleration into T11 (about 41 m earlier), but 3 samples before its brake point are missing, so the braking difference does not beat the sample gap",
                },
                {
                    "label": "T6-7",
                    "kind": "loss",
                    "cause": "min_speed",
                    "min_speed_word": "lower",
                    "plant": "BBB carries 7 km/h more through the T7 apex",
                },
                {
                    "label": "T9",
                    "kind": "loss",
                    "cause": "exit_speed",
                    "exit_speed_word": "lower",
                    "plant": "BBB has 30% more traction for 120 m after the T9 arc",
                },
            ],
        },
        {
            "a": "AAA-1",
            "b": "CCC-1",
            "track": True,
            "anchored": False,
            "expect": [
                {
                    "label": "T2",
                    "kind": "gain",
                    "cause": "min_speed",
                    "min_speed_word": "higher",
                    "plant": "CCC carries 6 km/h less through the T2 apex",
                },
                {
                    "label": "T11",
                    "kind": "loss",
                    "cause": "exit_speed",
                    "exit_speed_word": "lower",
                    "plant": "CCC has 30% more traction for 120 m after the T11 arc",
                },
            ],
        },
    ],
}


def main():
    layout, spans, lines_u, laps, track, ref = build()
    if ref != PLANTED["reference_lap"].split("-")[0]:
        raise SystemExit(
            f"reference lap is {ref}-1, planted.json expects {PLANTED['reference_lap']}"
        )
    demo = os.path.join(ROOT, "public", "demo")
    sess = os.path.join(demo, SESSION_ID)
    dump(manifest_for(laps, ref), os.path.join(demo, "manifest.json"), indent=2)
    dump(track, os.path.join(sess, "track.json"))
    for d in DRIVERS:
        dump(laps[d], os.path.join(sess, "laps", f"{d}-1.json"))

    with open(os.path.join(ROOT, "analysis-config.json"), encoding="utf-8") as f:
        config = json.load(f)
    cases = [("AAA", "BBB", True), ("AAA", "CCC", True), ("AAA", "BBB", False)]
    expected = {
        "schema": "race-engineer.parity/v1",
        "note": "Written by pipeline/synthetic.py from the Python reference. Do not edit by hand.",
        "session_dir": "public/demo/" + SESSION_ID,
        "cases": [
            {
                "a": f"{a}-1",
                "b": f"{b}-1",
                "track": use_track,
                "comparison": analyze_pair(
                    laps[a], laps[b], track if use_track else None, config
                ),
            }
            for a, b, use_track in cases
        ],
        "detector": {
            "input": "track.path",
            "corners": detect_corners(
                track["path"]["s_m"], track["path"]["speed_kph"], config
            ),
        },
    }
    fx = os.path.join(ROOT, "fixtures", "parity")
    dump(expected, os.path.join(fx, "expected.json"))
    dump(PLANTED, os.path.join(fx, "planted.json"), indent=2)
    for d in DRIVERS:
        n = len(laps[d]["samples"]["t_ms"])
        print(
            f"{d}-1: {n} samples, {laps[d]['duration_ms']} ms, sectors {laps[d]['sector_ms']}"
        )
    print(
        f"track {TRACK_ID}: L {track['L_m']} m, {len(track['corners'])} markers, reference {ref}-1"
    )
    print(
        "wrote public/demo/manifest.json, public/demo/synthetic-demo/{track.json,laps/*.json}, fixtures/parity/{expected,planted}.json"
    )


if __name__ == "__main__":
    main()
