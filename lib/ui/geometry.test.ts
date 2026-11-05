// Replay and cursor math (lib/ui/geometry.ts) on the synthetic pair AAA-1 against BBB-1, plus
// small hand-made traces for the edges. The e2e sync and scrub specs drive the same code in a
// browser; these pin the numbers.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzePair, type AnalysisConfig, type Lap, type Track } from "../analysis/index.ts";
import {
  clampIndex,
  cursorPoint,
  cursorTimeMs,
  indexAtDistance,
  indexAtTime,
  replayEndMs,
} from "./geometry.ts";

const root = new URL("../../", import.meta.url);
const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, root), "utf8")) as T;
const DIR = "public/demo/synthetic-demo";
const lap = (id: string) => read<Lap>(`${DIR}/laps/${id}.json`);
const track = read<Track>(`${DIR}/track.json`);
const config = read<AnalysisConfig>("analysis-config.json");

const a = lap("AAA-1");
const b = lap("BBB-1");
const c = analyzePair(a, b, track, config);
const n = c.grid.s_m.length;
const last = n - 1;

describe("replayEndMs", () => {
  it("is the slower lap's end, in either order", () => {
    const slower = Math.max(a.duration_ms, b.duration_ms);
    expect(a.duration_ms).not.toBe(b.duration_ms);
    expect(replayEndMs(c)).toBe(slower);
    expect(replayEndMs(analyzePair(b, a, track, config))).toBe(slower);
  });

  it("at the end both cars sit on the last grid point", () => {
    const p = cursorPoint(c, { mode: "time", tMs: replayEndMs(c) });
    expect(p.a.f).toBe(last);
    expect(p.b.f).toBe(last);
    expect(p.a.s_m).toBe(c.L_m);
    expect(p.b.s_m).toBe(c.L_m);
    expect(p.b.t_ms).toBe(b.duration_ms);
  });
});

describe("indexAtTime", () => {
  const t = [0, 10, 20, 40];

  it("clamps to the lap at both bounds", () => {
    expect(indexAtTime(t, -5)).toBe(0);
    expect(indexAtTime(t, 0)).toBe(0);
    expect(indexAtTime(t, 40)).toBe(3);
    expect(indexAtTime(t, 1_000)).toBe(3);
    expect(indexAtTime([], 10)).toBe(0);
  });

  it("returns exact indices on samples and fractions between them", () => {
    expect(indexAtTime(t, 10)).toBe(1);
    expect(indexAtTime(t, 15)).toBe(1.5);
    expect(indexAtTime(t, 30)).toBe(2.5);
  });

  it("on the grid, lands where the car's own time equals the cursor time", () => {
    for (const tMs of [1, 12_345, 60_000, a.duration_ms - 1]) {
      const p = cursorPoint(c, { mode: "time", tMs });
      expect(p.a.t_ms).toBeCloseTo(tMs, 6);
      expect(p.b.t_ms).toBeCloseTo(tMs, 6);
    }
  });
});

describe("indexAtDistance", () => {
  it("clamps to the first and last grid point", () => {
    expect(indexAtDistance(c, -10)).toBe(0);
    expect(indexAtDistance(c, 0)).toBe(0);
    expect(indexAtDistance(c, c.L_m)).toBe(last);
    expect(indexAtDistance(c, c.L_m + 100)).toBe(last);
  });

  it("picks the nearest 2 m grid point, the lower one on a tie", () => {
    expect(c.grid.s_m.slice(0, 3)).toEqual([0, 2, 4]);
    expect(indexAtDistance(c, 2.9)).toBe(1);
    expect(indexAtDistance(c, 3)).toBe(1);
    expect(indexAtDistance(c, 3.1)).toBe(2);
  });
});

describe("clampIndex", () => {
  it("keeps an index on the grid and rounds it", () => {
    expect(clampIndex(c, -3)).toBe(0);
    expect(clampIndex(c, 0)).toBe(0);
    expect(clampIndex(c, 1.4)).toBe(1);
    expect(clampIndex(c, 1.5)).toBe(2);
    expect(clampIndex(c, last)).toBe(last);
    expect(clampIndex(c, n + 5)).toBe(last);
  });
});

describe("cursorPoint in distance mode", () => {
  it("puts both cars on one clamped grid index with the delta there", () => {
    const p = cursorPoint(c, { mode: "distance", i: n + 50 });
    expect(p.i).toBe(last);
    expect(p.a.s_m).toBe(p.b.s_m);
    expect(p.delta_ms).toBe(c.grid.delta_ms[last]);
    expect(p.t_ms).toBeNull();

    const q = cursorPoint(c, { mode: "distance", i: 500 });
    expect(q.a.s_m).toBe(c.grid.s_m[500]);
    expect(q.a.t_ms).toBe(c.grid.a.t_ms[500]);
    expect(q.b.t_ms).toBe(c.grid.b.t_ms[500]);
    expect(q.delta_ms).toBe(c.grid.delta_ms[500]);
  });
});

describe("cursorTimeMs", () => {
  it("reads A's time at a distance cursor and the cursor's own time in time mode", () => {
    expect(cursorTimeMs(c, { mode: "distance", i: 0 })).toBe(0);
    expect(cursorTimeMs(c, { mode: "distance", i: 500 })).toBe(c.grid.a.t_ms[500]);
    expect(cursorTimeMs(c, { mode: "distance", i: n + 5 })).toBe(a.duration_ms);
    expect(cursorTimeMs(c, { mode: "time", tMs: 42_000 })).toBe(42_000);
    expect(cursorTimeMs(c, { mode: "time", tMs: -20 })).toBe(0);
  });
});
