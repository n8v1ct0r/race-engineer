// Null samples (docs/contracts.md section 4). Twin cases: pipeline/tests/test_lap_qa.py NullPolicyTest.
// Throttle: a gap wherever a bracketing sample is null. Brake and gear: the previous sample's
// value, so a null sample reads null until the next one. A null brake sample is not braking.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cornerMetrics } from "./corners.ts";
import type { Prepared } from "./delta.ts";
import { interpNullable, stepPrev } from "./interp.ts";
import type { Lap } from "./types.ts";

const root = new URL("../../", import.meta.url);
const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, root), "utf8")) as T;

const XP = [0, 10, 20, 30];

function prepared(brake: (boolean | null)[]): Prepared {
  const s = [0, 10, 20, 30, 40, 50];
  return {
    s,
    t: s.map((v) => v * 10),
    v: [200, 190, 180, 170, 100, 150],
    brake,
    thr: s.map(() => null),
    gear: s.map(() => null),
    x: s,
    y: s.map(() => 0),
    anchor: null,
  };
}

describe("null samples", () => {
  it("throttle: the gap spans both intervals next to a null sample", () => {
    const fp = [0, null, 100, 100];
    expect([-1, 0, 5, 10, 15].map((x) => interpNullable(x, XP, fp))).toEqual([
      0,
      0,
      null,
      null,
      null,
    ]);
    expect(interpNullable(20, XP, fp)).toBe(100);
    expect(interpNullable(25, XP, fp)).toBe(100);
  });

  it("brake and gear: carry the previous sample, null included", () => {
    const fp = [false, null, true, true];
    expect([0, 9.9, 10, 19.9, 20, 31].map((x) => stepPrev(x, XP, fp))).toEqual([
      false,
      false,
      null,
      null,
      true,
      true,
    ]);
  });

  it("a null brake sample is not braking", () => {
    const m = cornerMetrics(prepared([false, true, null, true, true, false]), 0, 50, 50);
    expect(m?.brake_s_m).toBe(30); // the run starts after the null sample
    expect(m?.brake_gap_m).toBe(10);
    const none = cornerMetrics(prepared([false, null, null, null, null, false]), 0, 50, 50);
    expect(none?.brake_s_m).toBeNull();
  });

  it("the parity fixture covers null throttle, brake and gear", () => {
    const expected = read<{
      session_dir: string;
      cases: { a: string; b: string; comparison: { grid: { b: Record<string, unknown[]> } } }[];
    }>("fixtures/parity/expected.json");
    const c = expected.cases.find((x) => x.a === "AAA-1" && x.b === "CCC-1");
    expect(c).toBeDefined();
    const lap = read<Lap>(`${expected.session_dir}/laps/CCC-1.json`);
    for (const ch of ["throttle_pct", "brake", "gear"] as const) {
      expect(lap.samples[ch].some((v) => v === null)).toBe(true);
      expect(c!.comparison.grid.b[ch]!.some((v) => v === null)).toBe(true);
    }
  });
});
