// Fallback detector: parity with Python, and what it finds on the synthetic track path.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzePair } from "./index.ts";
import { detectCorners, minimaWithProminence, movingAverage } from "./detect.ts";
import type { AnalysisConfig, Lap, Track } from "./types.ts";

const root = new URL("../../", import.meta.url);
const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, root), "utf8")) as T;
const expected = read<{ session_dir: string; detector: { corners: unknown } }>(
  "fixtures/parity/expected.json",
);
const planted = read<{
  structure: { detector_misses: string[]; detector_merges: [string, string][] };
}>("fixtures/parity/planted.json");
const config = read<AnalysisConfig>("analysis-config.json");
const track = read<Track>(`${expected.session_dir}/track.json`);

describe("detectCorners", () => {
  const det = detectCorners(track.path.s_m, track.path.speed_kph, config);
  const marker = (label: string) => track.corners.find((c) => c.label === label)!.s_m;
  const near = (s: number) => det.filter((d) => Math.abs(d.s_m - s) <= 75);

  it("matches the Python reference exactly", () => {
    expect(JSON.parse(JSON.stringify(det))).toEqual(expected.detector.corners);
  });

  it("misses the flat kink and merges the chicane, by design", () => {
    for (const label of planted.structure.detector_misses) expect(near(marker(label))).toEqual([]);
    for (const [first, last] of planted.structure.detector_merges) {
      const span = det.filter((d) => d.s_m >= marker(first) - 75 && d.s_m <= marker(last) + 75);
      expect(span).toHaveLength(1);
    }
  });

  it("finds every other official corner within 75 m, lowest speed first then spaced", () => {
    const merged = new Set(planted.structure.detector_merges.flat());
    for (const c of track.corners) {
      if (planted.structure.detector_misses.includes(c.label) || merged.has(c.label)) continue;
      expect(near(c.s_m).length, `T${c.label}`).toBe(1);
    }
    for (let k = 1; k < det.length; k++) {
      expect(det[k]!.s_m - det[k - 1]!.s_m).toBeGreaterThanOrEqual(config.detector.min_spacing_m);
    }
    for (const d of det)
      expect(d.prominence_kph).toBeGreaterThanOrEqual(config.detector.prominence_kph);
  });

  it("labels detected corners C1..Cn when there is no track file", () => {
    const lapA = read<Lap>(`${expected.session_dir}/laps/AAA-1.json`);
    const lapB = read<Lap>(`${expected.session_dir}/laps/BBB-1.json`);
    const r = analyzePair(lapA, lapB, null, config);
    expect(r.corner_source).toBe("detected");
    expect(r.anchored).toBe(false);
    expect(r.corners.map((c) => c.label)).toEqual(r.corners.map((_, k) => `C${k + 1}`));
  });
});

describe("detector building blocks", () => {
  it("averages with a window that shrinks at the edges", () => {
    expect(movingAverage([0, 3, 6, 9], 1)).toEqual([1.5, 3, 6, 7.5]);
  });

  it("measures prominence with the lap edges as bases", () => {
    // minimum at index 2 (value 1): left max 5, right max 4, so prominence 3
    expect(minimaWithProminence([5, 3, 1, 2, 4])).toEqual([[2, 3]]);
    // a flat run keeps only its first sample (strict on the left, not on the right)
    expect(minimaWithProminence([4, 2, 2, 4])).toEqual([[1, 2]]);
  });
});
