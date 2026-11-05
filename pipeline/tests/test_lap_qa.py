"""Tests for the lap QA rules (pipeline/lap_qa.py) and the null-sample policy of the reference.

Run: pnpm test:py. The null-policy cases are mirrored in lib/analysis/nulls.test.ts.
"""

import json
import os
import unittest

from pipeline.lap_qa import throttle_pct, unknown_notes
from pipeline.reference.analysis import corner_metrics, interp_nullable, step_prev

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEMO = os.path.join(ROOT, "public", "demo")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def samples(throttle, brake, gear, rpm):
    return {"throttle_pct": throttle, "brake": brake, "gear": gear, "rpm": rpm}


class ThrottleTest(unittest.TestCase):
    def test_sentinel_above_100_is_null_never_clamped(self):
        self.assertIsNone(throttle_pct(104))
        self.assertIsNone(throttle_pct(104.0))
        self.assertIsNone(throttle_pct(100.4))

    def test_below_0_is_null(self):
        self.assertIsNone(throttle_pct(-1))

    def test_in_range_rounds_half_away(self):
        self.assertEqual(throttle_pct(0), 0)
        self.assertEqual(throttle_pct(0.4), 0)
        self.assertEqual(throttle_pct(99.5), 100)
        self.assertEqual(throttle_pct(100), 100)
        self.assertIsInstance(throttle_pct(55.0), int)


class UnknownNotesTest(unittest.TestCase):
    def test_counts_each_shown_channel_in_sentence_case(self):
        s = samples(
            [None, 100, None], [None, True, False], [3, 4, 5], [None, None, 11000]
        )
        self.assertEqual(
            unknown_notes(s),
            ["Throttle unknown at 2 samples", "Brake unknown at 1 sample"],
        )

    def test_rpm_alone_does_not_flag(self):
        self.assertEqual(
            unknown_notes(samples([0, 100], [False, False], [2, 3], [None, None])), []
        )

    def test_demo_manifest_follows_the_rule(self):
        manifest = load(os.path.join(DEMO, "manifest.json"))
        seen_flag = False
        for session in manifest["sessions"]:
            for driver in session["drivers"]:
                for lap in driver["laps"]:
                    path = os.path.join(
                        DEMO, session["session_id"], "laps", f"{lap['lap_id']}.json"
                    )
                    notes = unknown_notes(load(path)["samples"])
                    self.assertEqual(lap["qa_notes"], notes, lap["lap_id"])
                    self.assertEqual(
                        lap["qa"], "low_confidence" if notes else "ok", lap["lap_id"]
                    )
                    seen_flag = seen_flag or bool(notes)
        self.assertTrue(seen_flag, "no demo lap has a null sample; parity misses nulls")


class NullPolicyTest(unittest.TestCase):
    """Twin: lib/analysis/nulls.test.ts. Throttle: gap wherever a bracketing sample is null.
    Brake and gear: the previous sample's value, so a null sample reads null until the next one.
    """

    XP = [0.0, 10.0, 20.0, 30.0]

    def test_throttle_gap_spans_both_neighbor_intervals(self):
        fp = [0, None, 100, 100]
        got = [interp_nullable(x, self.XP, fp) for x in (-1.0, 0.0, 5.0, 10.0, 15.0)]
        self.assertEqual(got, [0, 0, None, None, None])
        self.assertEqual(interp_nullable(20.0, self.XP, fp), 100)
        self.assertEqual(interp_nullable(25.0, self.XP, fp), 100.0)

    def test_brake_and_gear_carry_the_previous_sample(self):
        fp = [False, None, True, True]
        got = [step_prev(x, self.XP, fp) for x in (0.0, 9.9, 10.0, 19.9, 20.0, 31.0)]
        self.assertEqual(got, [False, False, None, None, True, True])

    def test_null_brake_is_not_braking(self):
        P = {
            "s": [0.0, 10.0, 20.0, 30.0, 40.0, 50.0],
            "v": [200.0, 190.0, 180.0, 170.0, 100.0, 150.0],
            "brake": [False, True, None, True, True, False],
        }
        m = corner_metrics(P, 0.0, 50.0, 50.0)
        self.assertEqual(m["brake_s_m"], 30.0)  # the run starts after the null sample
        self.assertEqual(m["brake_gap_m"], 10.0)
        P["brake"] = [False, None, None, None, None, False]
        self.assertIsNone(corner_metrics(P, 0.0, 50.0, 50.0)["brake_s_m"])


if __name__ == "__main__":
    unittest.main()
