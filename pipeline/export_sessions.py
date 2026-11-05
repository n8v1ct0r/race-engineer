"""Export the chosen Formula 1 qualifying sessions to public/data/ (gitignored). Run: pnpm export.

Needs pipeline/.venv:
    python3 -m venv pipeline/.venv
    pipeline/.venv/bin/pip install -r pipeline/requirements.txt

Reads pipeline/sessions.json and writes, per session (docs/contracts.md sections 1 to 3):
    public/data/<session_id>/laps/<lap_id>.json   lap-schema.json, one per QA-passed timed lap
    public/data/<session_id>/track.json           track-schema.json
    public/data/manifest.json                     one entry per session

Formula 1 derived data never enters git (docs/phase-1-plan.md section 1): public/data/ and the
FastF1 cache in .cache/fastf1/ are gitignored. No team names, driver full names or images are
written. FastF1's rate limits are left as they are, Jolpica gets a custom User-Agent, and the
F1 TV sign-in and the live client are never used.

Lap rows (plan section 2): car rows plus 2 edge rows at t = 0 and t = lap time. XY comes from the
position feed, interpolated at car timestamps after dropping X = Y = Z = 0 rows, 0.1 m to m.
Precision: t_ms int, dist_m 2 dp from 0, speed_kph as delivered, throttle_pct int, brake bool,
gear int, rpm int, x and y 1 dp.

QA (plan 3b item 9, numbers from analysis-config.json "qa"): reject a lap with no usable
telemetry, 0 m distance, distance outside distance_tolerance_pct of the session median, or
missing XY or speed. Flag it (keep it, qa "low_confidence") for a telemetry gap over max_gap_ms,
a sector anchor correction over anchor_flag_ms, or a null throttle, brake or gear sample
(pipeline/lap_qa.py). A raw throttle outside 0 to 100 (FastF1 sentinels such as 104) is written
as null, never clamped.

Track (plan 3b items 8 and 11): the reference lap is the fastest QA-passed lap that is not
deleted and is marked accurate by FastF1 (its distance is within the tolerance by QA). Its
samples are the path. Official markers from get_circuit_info() are
projected onto that path; when FastF1 has no circuit info, corners is empty and the analysis
detects corners itself. Sector lines are the median, over accurate non-deleted laps, of each
lap's aligned position at its official S1 and S2 split times. Alignment, projection and
anchoring reuse pipeline/reference/analysis.py.
"""

import argparse
import datetime
import gzip
import json
import logging
import math
import os
import re
import sqlite3
import statistics
import sys
import time
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import fastf1  # noqa: E402
import fastf1.ergast.interface  # noqa: E402
import pandas as pd  # noqa: E402  (installed with fastf1)

from pipeline.reference.analysis import (  # noqa: E402
    anchor_ramp,
    has_sectors,
    interp,
    prepare,
    project,
    reference_path,
)
from pipeline.reference.format import round_half_away  # noqa: E402
from pipeline.lap_qa import throttle_pct, unknown_notes  # noqa: E402

FASTF1_VERSION = "3.8.3"
USER_AGENT = f"race-engineer-export/0.1.0 FastF1/{FASTF1_VERSION}"
PRODUCER = "pipeline/export_sessions.py"
SESSIONS_FILE = os.path.join(ROOT, "pipeline", "sessions.json")
CONFIG_FILE = os.path.join(ROOT, "analysis-config.json")
CACHE_DIR = os.path.join(ROOT, ".cache", "fastf1")
HTTP_CACHE = os.path.join(CACHE_DIR, "fastf1_http_cache.sqlite")
OUT_DIR = os.path.join(ROOT, "public", "data")

LIVETIMING_HOST = "livetiming.formula1.com"
MIRROR_HOST = "livetiming-mirror.fastf1.dev"
MULTIVIEWER_HOST = "api.multiviewer.app"
JOLPICA_HOST = "api.jolpi.ca"

DRIVER_RE = re.compile(r"^[A-Z]{3}$")
MARKER_LABEL_RE = re.compile(r"^[0-9]{1,2}[A-Z]?$")
SEGMENTS = ("Q1", "Q2", "Q3")
COMPOUNDS = ("SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET")

# Jolpica asks every client for its own User-Agent (plan section 1, item 5).
fastf1.ergast.interface.HEADERS["User-Agent"] = USER_AGENT


class LapRejected(Exception):
    """A lap fails exporter QA. The message is the reason."""


class LogCapture(logging.Handler):
    """Keeps FastF1's log records so provenance can say what FastF1 actually did."""

    def __init__(self):
        super().__init__(logging.DEBUG)
        self.records = []

    def emit(self, record):
        self.records.append((record.levelno, record.getMessage()))

    def reset(self):
        self.records = []

    def seen(self, text, level=logging.DEBUG):
        return any(lv >= level and text in msg for lv, msg in self.records)


# ---------------------------------------------------------------- small helpers


def q(value, dp):
    """Fixed precision for the data files (input data, not display). Same as synthetic.py q()."""
    scale = 10**dp
    return round_half_away(value * scale) / scale


def num(value):
    """Integral values as int so the JSON stays short (285, not 285.0)."""
    return int(value) if float(value).is_integer() else value


def ns_to_ms(ns):
    """Integer ms from integer ns, halves away from zero."""
    ns = int(ns)
    r = (abs(ns) + 500_000) // 1_000_000
    return -r if ns < 0 else r


def td_ms(td):
    """Integer ms from a pandas Timedelta, None when missing."""
    if td is None or pd.isna(td):
        return None
    return ns_to_ms(td.value)


def missing(value):
    return value is None or bool(pd.isna(value))


def slug(text):
    """Lowercase, accents stripped, spaces (and any other run of symbols) to one hyphen."""
    plain = (
        unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    )
    return re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")


def session_id_of(spec):
    return f"{spec['season']}-{spec['round']:02d}-{spec['session'].lower()}"


def dump(obj, path, indent=None):
    """Same writer as pipeline/synthetic.py. Returns the bytes written."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if indent is None:
        text = json.dumps(obj, separators=(",", ":"), allow_nan=False)
    else:
        text = json.dumps(obj, indent=indent, allow_nan=False)
    data = (text + "\n").encode("utf-8")
    with open(path, "wb") as f:
        f.write(data)
    return data


# ---------------------------------------------------------------- one lap


def lap_telemetry(lap):
    """Car rows plus the 2 edge rows of one lap, XY at car timestamps.

    The Phase 1 fast path (no driver-ahead channel). Position rows at X = Y = Z = 0 are padding
    and are dropped before the merge so they cannot pull the interpolated XY. The slice starts
    and ends exactly at the lap start and end. Those edge rows are usually labeled
    "interpolation", but "pos" when a position sample falls exactly on the edge (5 of 192 timed
    laps in 2026 Hungary Q), so the first and last rows are kept whatever their label.
    """
    pos = lap.get_pos_data(pad=1, pad_side="both")
    pos = pos.loc[~((pos["X"] == 0) & (pos["Y"] == 0) & (pos["Z"] == 0))]
    car = lap.get_car_data(pad=1, pad_side="both").add_distance()
    tel = pos.merge_channels(car).slice_by_lap(lap, interpolate_edges=True)
    keep = (tel["Source"] == "car").to_numpy()
    if len(keep) > 0:
        keep[0] = True
        keep[-1] = True
    return tel.loc[keep]


def lap_samples(tel, duration_ms):
    """Lap-schema sample arrays from car and edge rows. Raises LapRejected with a QA reason.

    Returns (samples, raw throttle values outside 0 to 100 that became null).
    """
    n = len(tel)
    if n < 2:
        raise LapRejected("no telemetry")
    t_all = [ns_to_ms(v) for v in tel["Time"].astype("int64").tolist()]
    if t_all[0] != 0 or t_all[n - 1] != duration_ms:
        raise LapRejected("edge rows do not match the lap time")
    # Car rows whose integer ms would repeat a kept row (or the end edge) are dropped, so t_ms
    # strictly increases and the edges stay exactly at 0 and the lap time.
    keep = [0]
    for i in range(1, n - 1):
        if t_all[i] > t_all[keep[-1]] and t_all[i] < t_all[n - 1]:
            keep.append(i)
    keep.append(n - 1)

    X = tel["X"].tolist()
    Y = tel["Y"].tolist()
    D = tel["Distance"].tolist()
    V = tel["Speed"].tolist()
    THR = tel["Throttle"].tolist()
    BRK = tel["Brake"].tolist()
    GEAR = tel["nGear"].tolist()
    RPM = tel["RPM"].tolist()
    for i in keep:
        if missing(X[i]) or missing(Y[i]):
            raise LapRejected("missing XY")
        if missing(V[i]) or missing(D[i]):
            raise LapRejected("missing speed or distance")

    d0 = D[keep[0]]
    dist = [num(q(D[i] - d0, 2)) for i in keep]
    if dist[-1] <= 0:
        raise LapRejected("0 m distance")
    if min(dist) < 0:
        raise LapRejected("distance runs backwards")
    t = [t_all[i] for i in keep]
    throttle = [None if missing(THR[i]) else throttle_pct(THR[i]) for i in keep]
    nulled = [
        THR[i] for i, v in zip(keep, throttle) if v is None and not missing(THR[i])
    ]
    samples = {
        "t_ms": t,
        "dist_m": dist,
        "speed_kph": [num(q(V[i], 2)) for i in keep],
        "throttle_pct": throttle,
        "brake": [None if missing(BRK[i]) else bool(BRK[i]) for i in keep],
        "gear": [None if missing(GEAR[i]) else int(GEAR[i]) for i in keep],
        "rpm": [None if missing(RPM[i]) else round_half_away(RPM[i]) for i in keep],
        "x": [num(q(X[i] / 10.0, 1)) for i in keep],
        "y": [num(q(Y[i] / 10.0, 1)) for i in keep],
    }
    return samples, nulled


def check_lap(lap):
    """Exporter self-check of what JSON Schema and scripts/validate-laps.ts enforce. Fails loudly."""
    s = lap["samples"]
    n = len(s["t_ms"])
    lap_id = f"{lap['driver']}-{lap['lap_no']}"
    problems = []
    for key, values in s.items():
        if len(values) != n:
            problems.append(f"{key} has {len(values)} values, t_ms has {n}")
    if n < 2:
        problems.append("fewer than 2 samples")
    if any(s["t_ms"][i] <= s["t_ms"][i - 1] for i in range(1, n)):
        problems.append("t_ms does not strictly increase")
    if s["t_ms"][0] != 0 or s["t_ms"][-1] != lap["duration_ms"]:
        problems.append("edge rows are not at 0 and the lap time")
    if any(v < 0 for v in s["dist_m"]) or any(v < 0 for v in s["speed_kph"]):
        problems.append("negative distance or speed")
    if any(v is not None and not (0 <= v <= 100) for v in s["throttle_pct"]):
        problems.append("throttle outside 0 to 100")
    if any(v is not None and not (0 <= v <= 10) for v in s["gear"]):
        problems.append("gear outside 0 to 10")
    if any(v is not None and v < 0 for v in s["rpm"]):
        problems.append("negative rpm")
    st = lap["sector_ms"]
    if st is not None and (
        len(st) != 3 or any((not isinstance(v, int)) or v < 1 for v in st)
    ):
        problems.append("sector_ms is not 3 positive integers")
    if problems:
        raise RuntimeError(f"{lap['session_id']} {lap_id}: " + "; ".join(problems))


# ---------------------------------------------------------------- track


def official_markers(session, path, cfg):
    """Official corner markers projected onto the reference path, in lap order.

    Returns (markers, max lateral error in m, error text or None). FastF1 raises when MultiViewer
    has no circuit (2026 Madrid: AttributeError); then there are no markers.
    """
    try:
        info = session.get_circuit_info()
    except Exception as err:  # noqa: BLE001  (any failure means: no official markers)
        return [], None, f"{type(err).__name__}: {err}"
    if info is None or info.corners is None or len(info.corners) == 0:
        return [], None, "no corners in circuit info"
    window = float(cfg["align"]["search_window_m"])
    L = path["L"]
    markers = []
    worst = 0.0
    for r in info.corners.itertuples():
        letter = "" if missing(r.Letter) else str(r.Letter).strip()
        label = f"{int(r.Number)}{letter}"
        if not MARKER_LABEL_RE.match(label):
            raise RuntimeError(
                f"corner label {label!r} does not match {MARKER_LABEL_RE.pattern}"
            )
        guess = float(r.Distance)
        lo, hi = (guess - window, guess + window) if math.isfinite(guess) else (0.0, L)
        s_m, e2 = project(
            float(r.X) / 10.0,
            float(r.Y) / 10.0,
            path["x"],
            path["y"],
            path["s"],
            lo,
            hi,
        )
        worst = max(worst, math.sqrt(e2))
        markers.append({"label": label, "s_m": q(s_m, 2)})
    markers.sort(key=lambda m: m["s_m"])
    return markers, worst, None


def sector_lines(laps, path, prepared):
    """Median aligned position at the official S1 and S2 split times, 2 dp. None without splits."""
    at_s1 = []
    at_s2 = []
    for c in laps:
        P = prepared[c["lap_id"]]
        st = c["json"]["sector_ms"]
        at_s1.append(interp(float(st[0]), P["t"], P["s"]))
        at_s2.append(interp(float(st[0] + st[1]), P["t"], P["s"]))
    if len(at_s1) == 0:
        return None
    lines = [q(statistics.median(at_s1), 2), q(statistics.median(at_s2), 2)]
    if not (0.0 < lines[0] < lines[1] < path["L"]):
        raise RuntimeError(f"sector lines {lines} are not inside (0, {path['L']})")
    return lines


# ---------------------------------------------------------------- provenance


def mirror_in_http_cache(api_path):
    """True when FastF1's HTTP cache holds a livetiming mirror response for this session."""
    if not os.path.exists(HTTP_CACHE):
        return False
    con = sqlite3.connect(f"file:{HTTP_CACHE}?mode=ro", uri=True)
    try:
        needle = (MIRROR_HOST + api_path).encode("utf-8")
        row = con.execute(
            "SELECT count(*) FROM responses WHERE instr(value, ?) > 0", (needle,)
        ).fetchone()
    finally:
        con.close()
    return row[0] > 0


# ---------------------------------------------------------------- one session


def lap_facts(idx, lap, seg_of):
    """Timing facts for one timed lap (no telemetry yet)."""
    code = str(lap["Driver"])
    if not DRIVER_RE.match(code):
        raise RuntimeError(f"driver code {code!r} is not 3 capital letters")
    lap_no = int(lap["LapNumber"])
    duration = td_ms(lap["LapTime"])
    sectors = [
        td_ms(lap["Sector1Time"]),
        td_ms(lap["Sector2Time"]),
        td_ms(lap["Sector3Time"]),
    ]
    if any(v is None or v < 1 for v in sectors):
        sectors = None
    deleted = None if missing(lap["Deleted"]) else bool(lap["Deleted"])
    reason = None
    if deleted and not missing(lap["DeletedReason"]):
        reason = str(lap["DeletedReason"]).strip() or None
    status = lap["TrackStatus"]
    compound = None if missing(lap["Compound"]) else str(lap["Compound"]).upper()
    return {
        "idx": idx,
        "lap": lap,
        "code": code,
        "lap_no": lap_no,
        "lap_id": f"{code}-{lap_no}",
        "duration_ms": duration,
        "sector_ms": sectors,
        "segment": seg_of.get(idx),
        "compound": compound if compound in COMPOUNDS else None,
        "tyre_life": None if missing(lap["TyreLife"]) else int(lap["TyreLife"]),
        "personal_best": False
        if missing(lap["IsPersonalBest"])
        else bool(lap["IsPersonalBest"]),
        "deleted": deleted,
        "deleted_reason": reason,
        "yellow": None if missing(status) else ("2" in str(status)),
        "accurate": False if missing(lap["IsAccurate"]) else bool(lap["IsAccurate"]),
        "end_ns": None if missing(lap["Time"]) else int(lap["Time"].value),
        "reject": None,
        "qa_notes": [],
        "nulled_throttle": [],
        "gap_ms": None,
        "json": None,
    }


def rank_key(c):
    """Faster first; on equal times the lap that ended earlier in the session first."""
    return (
        c["duration_ms"],
        c["end_ns"] if c["end_ns"] is not None else 0,
        c["lap_id"],
    )


def export_session(spec, config, capture, exported_at, verbose):
    t_start = time.perf_counter()
    capture.reset()
    qa = config["qa"]
    season, rnd, code = spec["season"], spec["round"], spec["session"]
    session_id = session_id_of(spec)

    session = fastf1.get_session(season, rnd, code)
    ev = session.event
    if (
        int(ev["RoundNumber"]) != rnd
        or ev["EventName"] != spec["expect_event"]
        or ev["Location"] != spec["expect_location"]
    ):
        raise SystemExit(
            f"{season} round {rnd} {code} resolved to {ev['EventName']} ({ev['Location']}); "
            f"pipeline/sessions.json expects {spec['expect_event']} ({spec['expect_location']})"
        )
    session.load(laps=True, telemetry=True, weather=False, messages=True)
    circuit = ((session.session_info or {}).get("Meeting") or {}).get("Circuit") or {}
    if not circuit.get("ShortName"):
        raise SystemExit(f"{session_id}: FastF1 session info has no circuit name")
    track_id = slug(str(circuit["ShortName"]))

    seg_of = {}
    for name, part in zip(SEGMENTS, session.laps.split_qualifying_sessions()):
        if part is not None:
            for idx in part.index:
                seg_of[idx] = name

    timed = session.laps.loc[
        session.laps["LapTime"].notna() & session.laps["LapNumber"].notna()
    ]
    cands = []
    for idx, lap in timed.iterlaps():
        c = lap_facts(idx, lap, seg_of)
        try:
            samples, c["nulled_throttle"] = lap_samples(
                lap_telemetry(lap), c["duration_ms"]
            )
        except LapRejected as err:
            c["reject"] = str(err)
        except Exception as err:  # noqa: BLE001  (FastF1 raises many types for missing data)
            c["reject"] = f"no usable telemetry ({type(err).__name__})"
        else:
            c["qa_notes"].extend(unknown_notes(samples))
            c["dist_m"] = samples["dist_m"][-1]
            t = samples["t_ms"]
            c["gap_ms"] = max(t[i] - t[i - 1] for i in range(1, len(t)))
            c["json"] = {
                "schema": "race-engineer.lap/v1",
                "origin": "fastf1",
                "track_id": track_id,
                "session_id": session_id,
                "driver": c["code"],
                "lap_no": c["lap_no"],
                "duration_ms": c["duration_ms"],
                "sector_ms": c["sector_ms"],
                "valid": c["deleted"] is not True,
                "meta": {"producer": PRODUCER, "fastf1": fastf1.__version__},
                "samples": samples,
            }
        cands.append(c)

    # QA: distance against the session median
    dists = [c["dist_m"] for c in cands if c["reject"] is None]
    if len(dists) == 0:
        raise SystemExit(f"{session_id}: no lap has usable telemetry")
    median_m = statistics.median(dists)
    tol = float(qa["distance_tolerance_pct"])
    for c in cands:
        if c["reject"] is None and abs(c["dist_m"] - median_m) > median_m * tol / 100.0:
            c["reject"] = (
                f"distance more than {qa['distance_tolerance_pct']}% off the session median"
            )
    passed = [c for c in cands if c["reject"] is None]
    max_gap = qa["max_gap_ms"]
    for c in passed:
        if c["gap_ms"] > max_gap:
            c["qa_notes"].append(f"Telemetry gap of {c['gap_ms']} ms")

    # Reference lap and path (a gap flag does not exclude a lap: 2026 car data runs at about
    # 1.1 s max gap on most laps, including pole laps)
    ref_pool = [c for c in passed if c["deleted"] is not True and c["accurate"]]
    if len(ref_pool) == 0:
        raise SystemExit(f"{session_id}: no lap qualifies as the reference lap")
    ref = min(ref_pool, key=rank_key)
    path = reference_path(ref["json"], None)

    markers, lateral_max, circuit_error = official_markers(session, path, config)
    corner_source = "official" if len(markers) > 0 else "detected"

    prepared = {}
    for c in passed:
        if has_sectors(c["json"]):
            prepared[c["lap_id"]] = prepare(c["json"], path, config)
    line_laps = [
        c
        for c in passed
        if c["lap_id"] in prepared and c["accurate"] and c["deleted"] is not True
    ]
    lines = sector_lines(line_laps, path, prepared)

    # QA: sector anchor correction, measured against the lines this track file will carry
    flag_ms = float(qa["anchor_flag_ms"])
    if lines is not None:
        for c in passed:
            P = prepared.get(c["lap_id"])
            if P is None:
                continue
            _, corr = anchor_ramp(P, c["json"]["sector_ms"], lines, path["L"])
            worst = max(abs(corr[1]), abs(corr[2]))
            if worst > flag_ms:
                c["qa_notes"].append(
                    f"Sector anchor correction of {round_half_away(worst)} ms"
                )

    track = {
        "schema": "race-engineer.track/v1",
        "track_id": track_id,
        "L_m": num(path["L"]),
        "reference": {
            "lap_id": ref["lap_id"],
            "driver": ref["code"],
            "lap_no": ref["lap_no"],
        },
        "path": {
            "s_m": [num(v) for v in path["s"]],
            "x": [num(v) for v in path["x"]],
            "y": [num(v) for v in path["y"]],
            "speed_kph": [num(v) for v in path["speed"]],
        },
        "corners": markers,
        "sector_lines_m": lines,
    }

    # Default pair: the two fastest drivers' personal-best laps
    best = {}
    for c in passed:
        if c["personal_best"] and c["deleted"] is not True:
            if c["code"] not in best or rank_key(c) < rank_key(best[c["code"]]):
                best[c["code"]] = c
    top = sorted(best.values(), key=rank_key)
    if len(top) < 2:
        raise SystemExit(f"{session_id}: fewer than 2 drivers have a personal-best lap")

    # Write laps and track; remove lap files a previous export left behind
    sess_dir = os.path.join(OUT_DIR, session_id)
    laps_dir = os.path.join(sess_dir, "laps")
    raw_bytes = 0
    gz_bytes = 0
    for c in sorted(passed, key=lambda c: (c["code"], c["lap_no"])):
        check_lap(c["json"])
        data = dump(c["json"], os.path.join(laps_dir, f"{c['lap_id']}.json"))
        raw_bytes += len(data)
        gz_bytes += len(gzip.compress(data, mtime=0))
    data = dump(track, os.path.join(sess_dir, "track.json"))
    raw_bytes += len(data)
    gz_bytes += len(gzip.compress(data, mtime=0))
    written = {c["lap_id"] + ".json" for c in passed}
    stale = sorted(
        f for f in os.listdir(laps_dir) if f.endswith(".json") and f not in written
    )
    for f in stale:
        os.remove(os.path.join(laps_dir, f))

    # Manifest entry
    drivers = {}
    for c in passed:
        drivers.setdefault(c["code"], []).append(c)

    def driver_key(code):
        laps = drivers[code]
        clean = [c for c in laps if c["deleted"] is not True]
        return (0 if clean else 1,) + rank_key(min(clean or laps, key=rank_key))

    mirror = capture.seen("livetiming mirror") or mirror_in_http_cache(session.api_path)
    ergast_failed = capture.seen("Ergast", level=logging.WARNING)
    # FastF1 falls back to the mirror page by page, so a mirror session may mix both hosts.
    hosts = [LIVETIMING_HOST, MIRROR_HOST] if mirror else [LIVETIMING_HOST]
    if corner_source == "official":
        hosts.append(MULTIVIEWER_HOST)
    if not ergast_failed:
        hosts.append(JOLPICA_HOST)
    entry = {
        "session_id": session_id,
        "origin": "fastf1",
        "season": season,
        "round": rnd,
        "event_name": str(ev["EventName"]),
        "location": str(ev["Location"]),
        "location_slug": slug(str(ev["Location"])),
        "session_code": code,
        "session_name": str(session.name),
        "date": ev.get_session_date(code, utc=False).date().isoformat(),
        "track_id": track_id,
        "corner_source": corner_source,
        "default_pair": {"a": top[0]["lap_id"], "b": top[1]["lap_id"]},
        "drivers": [
            {
                "code": code_,
                "laps": [
                    {
                        "lap_id": c["lap_id"],
                        "lap_no": c["lap_no"],
                        "duration_ms": c["duration_ms"],
                        "sector_ms": c["sector_ms"],
                        "segment": c["segment"],
                        "compound": c["compound"],
                        "tyre_life": c["tyre_life"],
                        "personal_best": c["personal_best"],
                        "deleted": c["deleted"],
                        "deleted_reason": c["deleted_reason"],
                        "yellow": c["yellow"],
                        "qa": "low_confidence" if c["qa_notes"] else "ok",
                        "qa_notes": c["qa_notes"],
                    }
                    for c in sorted(drivers[code_], key=lambda c: c["lap_no"])
                ],
            }
            for code_ in sorted(drivers, key=driver_key)
        ],
        "provenance": {
            "fastf1": fastf1.__version__,
            "exported_at": exported_at,
            "livetiming_mirror_used": mirror,
            "jolpica_fields": [] if ergast_failed else ["results"],
            "hosts": hosts,
        },
    }

    rejected = [c for c in cands if c["reject"] is not None]
    flagged = [c for c in passed if c["qa_notes"]]
    reasons = {}
    for c in rejected:
        reasons[c["reject"]] = reasons.get(c["reject"], 0) + 1
    seconds = time.perf_counter() - t_start
    print(
        f"{session_id} ({ev['EventName']}, track {track_id}): {len(cands)} timed laps, "
        f"{len(passed)} exported, {len(rejected)} rejected, {len(flagged)} flagged; "
        f"{len(markers)} official markers ({corner_source}"
        + (f", circuit info failed: {circuit_error}" if circuit_error else "")
        + (f", max lateral {lateral_max:.1f} m" if lateral_max is not None else "")
        + f"); reference {ref['lap_id']}; sector lines from {len(line_laps)} laps; "
        f"default pair {top[0]['lap_id']} vs {top[1]['lap_id']}; "
        f"{raw_bytes} B raw, {gz_bytes} B gzip; {seconds:.1f} s"
    )
    for reason, count in sorted(reasons.items()):
        print(f"  rejected {count}: {reason}")
    notes = {}
    for c in flagged:
        for n in c["qa_notes"]:
            kind = re.sub(r" (of|at) \d.*$", "", n)
            notes[kind] = notes.get(kind, 0) + 1
    for kind, count in sorted(notes.items()):
        print(f"  flagged {count}: {kind}")
    nulled = [c for c in passed if c["nulled_throttle"]]
    if nulled:
        raw = sorted({num(v) for c in nulled for v in c["nulled_throttle"]})
        print(
            f"  throttle outside 0 to 100 written as null: "
            f"{sum(len(c['nulled_throttle']) for c in nulled)} samples on {len(nulled)} laps "
            f"(raw values {', '.join(str(v) for v in raw)})"
        )
    if verbose:
        for c in rejected:
            print(f"  reject {c['lap_id']}: {c['reject']}")
        for c in flagged:
            print(f"  flag {c['lap_id']}: {'; '.join(c['qa_notes'])}")
    if stale:
        print(
            f"  removed {len(stale)} lap files from an earlier export: {', '.join(stale)}"
        )
    stats = {
        "session_id": session_id,
        "timed": len(cands),
        "exported": len(passed),
        "rejected": len(rejected),
        "flagged": len(flagged),
        "raw_bytes": raw_bytes,
        "gzip_bytes": gz_bytes,
        "seconds": seconds,
    }
    return entry, stats


# ---------------------------------------------------------------- main


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--only",
        nargs="+",
        metavar="SESSION_ID",
        help="export only these sessions (for example 2026-11-q); other manifest entries are kept",
    )
    parser.add_argument(
        "--verbose", action="store_true", help="list every rejected and flagged lap"
    )
    args = parser.parse_args()

    if fastf1.__version__ != FASTF1_VERSION:
        raise SystemExit(
            f"FastF1 {FASTF1_VERSION} is pinned; found {fastf1.__version__}"
        )
    with open(SESSIONS_FILE, encoding="utf-8") as f:
        specs = json.load(f)["sessions"]
    with open(CONFIG_FILE, encoding="utf-8") as f:
        config = json.load(f)
    known = [session_id_of(s) for s in specs]
    if args.only:
        unknown = sorted(set(args.only) - set(known))
        if unknown:
            raise SystemExit(f"not in pipeline/sessions.json: {', '.join(unknown)}")

    os.makedirs(CACHE_DIR, exist_ok=True)
    fastf1.Cache.enable_cache(CACHE_DIR)
    fastf1.set_log_level("WARNING")
    capture = LogCapture()
    logging.getLogger("fastf1").addHandler(capture)

    manifest_path = os.path.join(OUT_DIR, "manifest.json")
    kept = {}
    if args.only and os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as f:
            for e in json.load(f).get("sessions", []):
                kept[e["session_id"]] = e

    exported_at = datetime.date.today().isoformat()
    entries = []
    all_stats = []
    t0 = time.perf_counter()
    for spec, sid in zip(specs, known):
        if args.only and sid not in args.only:
            if sid in kept:
                entries.append(kept[sid])
            continue
        entry, stats = export_session(spec, config, capture, exported_at, args.verbose)
        entries.append(entry)
        all_stats.append(stats)

    dump(
        {"schema": "race-engineer.manifest/v1", "sessions": entries},
        manifest_path,
        indent=2,
    )
    if "fastf1.livetiming.client" in sys.modules:
        raise SystemExit(
            "the FastF1 live client was imported; the export must never use it"
        )
    print(
        f"wrote {os.path.relpath(OUT_DIR, ROOT)}/: {len(entries)} sessions in the manifest; "
        f"this run {sum(s['exported'] for s in all_stats)} laps exported, "
        f"{sum(s['rejected'] for s in all_stats)} rejected, "
        f"{sum(s['flagged'] for s in all_stats)} flagged, "
        f"{sum(s['raw_bytes'] for s in all_stats)} B raw, "
        f"{sum(s['gzip_bytes'] for s in all_stats)} B gzip, "
        f"{time.perf_counter() - t0:.1f} s"
    )


if __name__ == "__main__":
    main()
