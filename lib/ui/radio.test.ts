// Radio calls quote only numbers the analysis already computed: the finding's display strings
// and lap A's own elapsed time at the corner exit. Checked on the synthetic pairs.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analyzePair,
  formatLapTime,
  type AnalysisConfig,
  type Lap,
  type Track,
} from "../analysis/index.ts";
import { indexAtDistance } from "./geometry.ts";
import { nextHeardM, radioCalls } from "./radio.ts";

const root = new URL("../../", import.meta.url);
const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, root), "utf8")) as T;
const config = read<AnalysisConfig>("analysis-config.json");
const dir = "public/demo/synthetic-demo";
const track = read<Track>(`${dir}/track.json`);
const lap = (id: string) => read<Lap>(`${dir}/laps/${id}.json`);
const LABEL_RE = /\b[TC]\d{1,2}[A-Z]?(-\d{1,2}[A-Z]?)?\b/g;
const NUM_RE = /\d+(?::\d{2})?(?:\.\d+)?/g;

describe("radioCalls", () => {
  for (const [a, b] of [
    ["AAA-1", "BBB-1"],
    ["AAA-1", "CCC-1"],
  ] as const) {
    const c = analyzePair(lap(a), lap(b), track, config);
    const calls = radioCalls(c, "AAA", "BBB");

    it(`${a} vs ${b}: one call per finding, in lap order`, () => {
      expect(calls.map((x) => x.id).sort()).toEqual(c.findings.map((f) => f.id).sort());
      for (let k = 1; k < calls.length; k++) {
        expect(calls[k]!.triggerM).toBeGreaterThanOrEqual(calls[k - 1]!.triggerM);
      }
    });

    it(`${a} vs ${b}: every number comes from the analysis`, () => {
      for (const call of calls) {
        const f = c.findings.find((x) => x.id === call.id)!;
        const row = c.corners[f.corner_index]!;
        expect(call.label).toBe(f.label);
        expect(call.delta).toBe(f.display.delta);
        expect(call.triggerM).toBe(row.exit_s_m);
        const t = c.grid.a.t_ms[indexAtDistance(c, row.exit_s_m)]!;
        expect(call.at).toBe(formatLapTime(Math.round(t)));
        const allowed = Object.values(f.display).join(" ");
        for (const text of [call.text, ...call.facts]) {
          for (const n of text.replace(LABEL_RE, "").match(NUM_RE) ?? []) {
            expect(allowed, `${call.id}: ${n} in "${text}"`).toContain(n);
          }
        }
      }
    });
  }
});

describe("nextHeardM", () => {
  it("only moves forward while the cursor moves forward or back a little", () => {
    expect(nextHeardM(100, 150, 4000, true)).toBe(150);
    expect(nextHeardM(1000, 900, 4000, true)).toBe(1000);
    expect(nextHeardM(1000, 10, 4000, false)).toBe(1000);
  });

  it("starts a new pass when the replay loops back to the start", () => {
    expect(nextHeardM(3990, 5, 4000, true)).toBe(5);
  });
});
