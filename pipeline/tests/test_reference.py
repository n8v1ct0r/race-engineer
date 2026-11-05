"""Tests for the stdlib reference analysis (pipeline/reference/) on the synthetic session.

Run: pnpm test:py  (python3 -m unittest discover -s pipeline/tests -t .)
"""

import json
import os
import re
import unittest

from pipeline.reference.analysis import analyze_pair, detect_corners
from pipeline.reference.format import (
    delta_display,
    direction_word,
    format_brake_point,
    format_distance,
    format_lap_time,
    format_percent,
    format_seconds,
    format_speed,
    format_time,
    format_time_delta,
    round_half_away,
)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SESSION = os.path.join(ROOT, "public", "demo", "synthetic-demo")
LABEL_RE = re.compile(r"^[TC]\d{1,2}[A-Z]?(-\d{1,2}[A-Z]?)?$")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


CONFIG = load(os.path.join(ROOT, "analysis-config.json"))
TRACK = load(os.path.join(SESSION, "track.json"))
LAPS = {
    k: load(os.path.join(SESSION, "laps", f"{k}.json"))
    for k in ("AAA-1", "BBB-1", "CCC-1")
}
EXPECTED = load(os.path.join(ROOT, "fixtures", "parity", "expected.json"))
PLANTED = load(os.path.join(ROOT, "fixtures", "parity", "planted.json"))
CASES = [(c["a"], c["b"], c["track"]) for c in EXPECTED["cases"]]
RESULTS = {}


def run(a, b, use_track):
    key = (a, b, use_track)
    if key not in RESULTS:
        RESULTS[key] = analyze_pair(
            LAPS[a], LAPS[b], TRACK if use_track else None, CONFIG
        )
    return RESULTS[key]


def display_strings(obj):
    """Every string under any 'display' key."""
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "display":
                out.extend(s for s in _strings(v))
            else:
                out.extend(display_strings(v))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(display_strings(v))
    return out


def _strings(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for k, x in v.items():
            if k != "label":
                yield from _strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from _strings(x)


class FormatterTest(unittest.TestCase):
    def test_round_half_away_from_zero(self):
        self.assertEqual(round_half_away(12.5), 13)  # Python round() gives 12
        self.assertEqual(round_half_away(-2.5), -3)  # JS Math.round gives -2
        self.assertEqual(round_half_away(0.5), 1)
        self.assertEqual(round_half_away(-0.5), -1)
        self.assertEqual(round_half_away(2.4999), 2)
        self.assertEqual(round_half_away(-12.5), -13)
        self.assertEqual(round_half_away(7), 7)

    def test_no_negative_zero(self):
        for x in (-0.4, -0.0, 0.0, -0.49):
            r = round_half_away(x)
            self.assertEqual(r, 0)
            self.assertIsInstance(r, int)
            self.assertEqual(str(r), "0")

    def test_seconds_from_integer_ms(self):
        self.assertEqual(format_seconds(1250), "1.250")
        self.assertEqual(format_seconds(103), "0.103")
        self.assertEqual(format_seconds(-84), "0.084")
        self.assertEqual(format_seconds(0), "0.000")
        self.assertEqual(format_seconds(5), "0.005")
        self.assertEqual(format_time(1250), "1.250 s")

    def test_direction_words_never_signs(self):
        self.assertEqual(format_time_delta(103), "gains 0.103 s")
        self.assertEqual(format_time_delta(-84), "loses 0.084 s")
        self.assertEqual(format_time_delta(0), "level")
        self.assertEqual(direction_word(-1), "loses")
        self.assertEqual(
            delta_display(-1250),
            {"direction": "loses", "time": "1.250 s", "delta": "loses 1.250 s"},
        )
        for ms in (-1250, -84, -1, 0, 1, 84, 1250):
            self.assertNotIn("-", format_time_delta(ms))

    def test_lap_time(self):
        self.assertEqual(format_lap_time(85371), "1:25.371")
        self.assertEqual(format_lap_time(85275), "1:25.275")
        self.assertEqual(format_lap_time(60000), "1:00.000")
        self.assertEqual(format_lap_time(5), "0:00.005")
        self.assertEqual(format_lap_time(605004), "10:05.004")

    def test_units(self):
        self.assertEqual(format_speed(234), "234 km/h")
        self.assertEqual(format_speed(-6), "6 km/h")
        self.assertEqual(format_distance(54), "54 m")
        self.assertEqual(format_distance(-54), "54 m")
        self.assertEqual(format_brake_point(54), "54 m before")
        self.assertEqual(format_brake_point(-12), "12 m after")
        self.assertEqual(format_percent(85), "85%")
        self.assertEqual(format_percent(0), "0%")
        self.assertEqual(format_percent(100), "100%")

    def test_integers_only(self):
        for fn in (
            format_seconds,
            format_lap_time,
            format_speed,
            format_distance,
            format_percent,
            direction_word,
        ):
            with self.assertRaises(TypeError):
                fn(1.5)
            with self.assertRaises(TypeError):
                fn(True)


class ConservationTest(unittest.TestCase):
    def test_rows_and_mini_sectors_sum_to_the_lap_gap(self):
        for a, b, use_track in CASES:
            with self.subTest(a=a, b=b, track=use_track):
                r = run(a, b, use_track)
                self.assertEqual(
                    sum(c["delta_ms"] for c in r["corners"]), r["lap_gap_ms"]
                )
                self.assertEqual(len(r["mini_sectors"]), CONFIG["minisectors"]["count"])
                self.assertEqual(
                    sum(m["delta_ms"] for m in r["mini_sectors"]), r["lap_gap_ms"]
                )
                # t_ms ends at duration_ms on every synthetic lap, so the gap is the official one
                self.assertEqual(
                    r["lap_gap_ms"], LAPS[b]["duration_ms"] - LAPS[a]["duration_ms"]
                )

    def test_segments_tile_the_lap(self):
        for a, b, use_track in CASES:
            r = run(a, b, use_track)
            rows = r["corners"]
            self.assertEqual(rows[0]["seg_start_m"], 0.0)
            self.assertEqual(rows[-1]["seg_end_m"], r["L_m"])
            for k in range(len(rows) - 1):
                self.assertEqual(rows[k]["seg_end_m"], rows[k + 1]["seg_start_m"])
            self.assertEqual(r["mini_sectors"][-1]["s_end_m"], r["L_m"])

    def test_grid(self):
        r = run("AAA-1", "BBB-1", True)
        g = r["grid"]
        self.assertEqual(g["s_m"][0], 0.0)
        self.assertEqual(g["s_m"][-1], r["L_m"])
        n = len(g["s_m"])
        for side in ("a", "b"):
            for ch in ("t_ms", "speed_kph", "throttle_pct", "brake", "gear", "x", "y"):
                self.assertEqual(len(g[side][ch]), n, f"{side}.{ch}")
        self.assertEqual(len(g["delta_ms"]), n)
        self.assertAlmostEqual(g["delta_ms"][-1], r["lap_gap_ms_float"], places=9)


class PlantedTest(unittest.TestCase):
    def test_planted_differences_found_where_planted(self):
        for pair in PLANTED["pairs"]:
            r = run(pair["a"], pair["b"], pair["track"])
            self.assertEqual(r["anchored"], pair["anchored"])
            by_label = {f["label"]: f for f in r["findings"]}
            for exp in pair["expect"]:
                with self.subTest(pair=(pair["a"], pair["b"]), label=exp["label"]):
                    self.assertIn(
                        exp["label"], by_label, f"no finding at {exp['label']}"
                    )
                    f = by_label[exp["label"]]
                    self.assertEqual(f["kind"], exp["kind"])
                    self.assertEqual(f["cause"], exp["cause"])
                    if exp["kind"] == "gain":
                        self.assertGreater(f["delta_ms"], 0)
                    else:
                        self.assertLess(f["delta_ms"], 0)
                    for key in ("brake_word", "min_speed_word", "exit_speed_word"):
                        if key in exp:
                            self.assertEqual(f["display"][key], exp[key])

    def test_structure(self):
        st = PLANTED["structure"]
        r = run("AAA-1", "BBB-1", True)
        rows = {c["label"]: c for c in r["corners"]}
        self.assertIn(st["group_label"], rows)
        self.assertIn(st["letter_label"], rows)
        edge = rows[st["edge_min_label"]]
        self.assertTrue(edge["a"]["min_edge"] and edge["b"]["min_edge"])
        self.assertTrue(rows[st["clamped_exit_label"]]["exit_clamped"])
        drop = rows[st["dropout"]["label"]]
        diff = abs(drop["b"]["brake_before_m"] - drop["a"]["brake_before_m"])
        self.assertGreater(
            drop["b"]["brake_gap_m"],
            diff,
            "the dropout gap must hide the braking difference",
        )
        self.assertGreater(
            diff,
            drop["a"]["brake_gap_m"],
            "without the dropout the difference would have passed",
        )

    def test_braking_finding_clears_the_sample_gap(self):
        r = run("AAA-1", "BBB-1", True)
        f = [x for x in r["findings"] if x["cause"] == "braking"]
        self.assertGreaterEqual(len(f), 1)
        row = r["corners"][f[0]["corner_index"]]
        self.assertGreater(abs(f[0]["brake_diff_m"]), row["a"]["brake_gap_m"])
        self.assertGreater(abs(f[0]["brake_diff_m"]), row["b"]["brake_gap_m"])


class FindingsRuleTest(unittest.TestCase):
    ALWAYS = {"label", "direction", "time", "delta"}
    GROUPS = {
        "braking": {
            "brake_a",
            "brake_b",
            "brake_gap_a",
            "brake_gap_b",
            "brake_diff",
            "brake_word",
        },
        "min_speed": {"min_speed_a", "min_speed_b", "min_speed_diff", "min_speed_word"},
        "exit_speed": {
            "exit_speed_a",
            "exit_speed_b",
            "exit_speed_diff",
            "exit_speed_word",
        },
    }

    def test_selection_and_display(self):
        f_cfg = CONFIG["findings"]
        for a, b, use_track in CASES:
            r = run(a, b, use_track)
            gains = [f for f in r["findings"] if f["kind"] == "gain"]
            losses = [f for f in r["findings"] if f["kind"] == "loss"]
            self.assertEqual(r["findings"], gains + losses)
            self.assertLessEqual(len(gains), f_cfg["top_n"])
            self.assertLessEqual(len(losses), f_cfg["top_n"])
            for lst, sign in ((gains, 1), (losses, -1)):
                mags = [sign * f["delta_ms"] for f in lst]
                self.assertEqual(mags, sorted(mags, reverse=True))
                for rank, f in enumerate(lst, start=1):
                    self.assertGreaterEqual(sign * f["delta_ms"], f_cfg["min_abs_ms"])
                    self.assertEqual(f["rank"], rank)
                    self.assertEqual(f["id"], f"{f['kind']}-{rank}")
            for f in r["findings"]:
                keys = set(f["display"])
                allowed = set(self.ALWAYS)
                for name, group in self.GROUPS.items():
                    if f["checks"][name]:
                        allowed |= group
                        self.assertTrue(
                            group <= keys, f"{f['label']} misses {name} strings"
                        )
                self.assertEqual(
                    keys,
                    allowed,
                    f"{f['label']} display holds a field that did not pass",
                )
                first = next(
                    (
                        c
                        for c in ("braking", "min_speed", "exit_speed")
                        if f["checks"][c]
                    ),
                    "time_only",
                )
                self.assertEqual(f["cause"], first)

    def test_no_signs_or_negative_zero_in_display(self):
        for a, b, use_track in CASES:
            for s in display_strings(run(a, b, use_track)):
                if s is None:
                    continue
                self.assertNotIn("-", s)
                self.assertNotRegex(s, r"–|—")


class LabelTest(unittest.TestCase):
    def test_grammar(self):
        for good in ("T4", "T12A", "T6-7", "C3", "T12-12A", "C10"):
            self.assertRegex(good, LABEL_RE)
        for bad in ("T6-", "6", "T123", "X4", "T6-7-8", "t4", "C3a"):
            self.assertNotRegex(bad, LABEL_RE)

    def test_labels_in_output(self):
        for a, b, use_track in CASES:
            r = run(a, b, use_track)
            prefix = "T" if use_track else "C"
            self.assertEqual(
                r["corner_source"], "official" if use_track else "detected"
            )
            for c in r["corners"]:
                self.assertRegex(c["label"], LABEL_RE)
                self.assertTrue(c["label"].startswith(prefix))
        official = [c["label"] for c in run("AAA-1", "BBB-1", True)["corners"]]
        self.assertIn("T6-7", official)
        self.assertIn("T12A", official)


class LapsOnlyTest(unittest.TestCase):
    def test_laps_only_path(self):
        r = run("AAA-1", "BBB-1", False)
        self.assertFalse(r["anchored"])
        self.assertIsNone(r["anchor_ms"]["a"])
        self.assertEqual(r["corner_source"], "detected")
        self.assertEqual(
            [c["label"] for c in r["corners"]],
            [f"C{k + 1}" for k in range(len(r["corners"]))],
        )
        self.assertGreater(len(r["findings"]), 0)

    def test_photoncar_path_has_no_anchoring(self):
        r = run("AAA-1", "CCC-1", True)
        self.assertIsNone(LAPS["CCC-1"]["sector_ms"])
        self.assertFalse(r["anchored"])
        self.assertEqual(r["corner_source"], "official")

    def test_detector_misses_the_kink_and_merges_the_chicane(self):
        det = detect_corners(TRACK["path"]["s_m"], TRACK["path"]["speed_kph"], CONFIG)
        markers = {c["label"]: c["s_m"] for c in TRACK["corners"]}
        near = lambda s: [d for d in det if abs(d["s_m"] - s) <= 75.0]  # noqa: E731
        for label in PLANTED["structure"]["detector_misses"]:
            self.assertEqual(
                near(markers[label]), [], f"detector found the flat kink T{label}"
            )
        for first, last in PLANTED["structure"]["detector_merges"]:
            span = [
                d
                for d in det
                if markers[first] - 75.0 <= d["s_m"] <= markers[last] + 75.0
            ]
            self.assertEqual(
                len(span), 1, f"T{first}-{last} should give one detected corner"
            )
        for label, s in markers.items():
            if label in PLANTED["structure"]["detector_misses"]:
                continue
            self.assertTrue(
                near(s)
                or any(
                    label in pair for pair in PLANTED["structure"]["detector_merges"]
                ),
                label,
            )


class DriftTest(unittest.TestCase):
    def test_expected_json_matches_a_fresh_run(self):
        for case in EXPECTED["cases"]:
            with self.subTest(a=case["a"], b=case["b"], track=case["track"]):
                fresh = json.loads(json.dumps(run(case["a"], case["b"], case["track"])))
                self.assertEqual(
                    fresh,
                    case["comparison"],
                    "expected.json is stale: run pnpm synthetic",
                )
        det = json.loads(
            json.dumps(
                detect_corners(TRACK["path"]["s_m"], TRACK["path"]["speed_kph"], CONFIG)
            )
        )
        self.assertEqual(det, EXPECTED["detector"]["corners"])


if __name__ == "__main__":
    unittest.main()
