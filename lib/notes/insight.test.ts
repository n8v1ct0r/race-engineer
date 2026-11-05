// The insight is the model view: ids, labels, causes and display strings of passing fields only.
// It must carry no raw floats and no signed deltas (plan section 3b item 1).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzePair, type AnalysisConfig, type Lap, type Track } from "../analysis/index.ts";
import { buildInsight, canonicalJson, modelAllowed } from "./insight.ts";

const root = new URL("../../", import.meta.url);
const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, root), "utf8")) as T;
const config = read<AnalysisConfig>("analysis-config.json");
const dir = "public/demo/synthetic-demo";
const track = read<Track>(`${dir}/track.json`);
const lap = (id: string) => read<Lap>(`${dir}/laps/${id}.json`);
const LABEL_RE = /\b[TC]\d{1,2}[A-Z]?(-\d{1,2}[A-Z]?)?\b/g;

function walk(x: unknown, visit: (v: unknown, path: string) => void, path = "$"): void {
  visit(x, path);
  if (Array.isArray(x)) x.forEach((v, i) => walk(v, visit, `${path}[${i}]`));
  else if (typeof x === "object" && x !== null) {
    for (const [k, v] of Object.entries(x)) walk(v, visit, `${path}.${k}`);
  }
}

describe("buildInsight", () => {
  for (const [a, b, t] of [
    ["AAA-1", "BBB-1", track],
    ["AAA-1", "CCC-1", track],
    ["BBB-1", "CCC-1", null],
  ] as const) {
    const c = analyzePair(lap(a), lap(b), t, config);
    const insight = buildInsight(c);

    it(`${a} vs ${b}${t === null ? " (no track)" : ""}: no numbers, no signs`, () => {
      walk(insight, (v, path) => {
        expect(typeof v, path).not.toBe("number");
        if (typeof v === "string") {
          const s = v.replace(LABEL_RE, "");
          // A hyphen glued to a word ("gain-1") belongs to an id, not to a signed number.
          expect(s, path).not.toMatch(/(?<![\w.:,])[+\-−]\s?\d/);
        }
      });
      expect(canonicalJson(insight)).not.toMatch(/\d\.\d{4,}/);
    });

    it(`${a} vs ${b}: carries exactly the passing display strings`, () => {
      expect(insight.findings.map((f) => f.id)).toEqual(c.findings.map((f) => f.id));
      for (const [i, f] of c.findings.entries()) {
        const view = insight.findings[i]!;
        expect(view.corner).toBe(f.label);
        expect(view.cause).toBe(f.cause);
        expect(view.kind).toBe(f.kind);
        const expected: Record<string, unknown> = { ...f.display };
        for (const k of ["label", "delta", "brake_gap_a", "brake_gap_b"]) delete expected[k];
        expect(view.display).toEqual(expected);
        if (!f.checks.braking) expect(view.display.brake_diff).toBeUndefined();
        if (!f.checks.min_speed) expect(view.display.min_speed_a).toBeUndefined();
        if (!f.checks.exit_speed) expect(view.display.exit_speed_a).toBeUndefined();
      }
      expect(insight.lap_gap).toEqual({
        direction: c.display.gap_direction,
        time: c.display.gap_time,
      });
    });
  }

  it("keeps the lap origins so a Formula 1 pair can be refused", () => {
    const c = analyzePair(lap("AAA-1"), lap("BBB-1"), track, config);
    expect(buildInsight(c).origins).toEqual({ a: "synthetic", b: "synthetic" });
    expect(modelAllowed({ a: "synthetic", b: "photoncar" })).toBe(true);
    expect(modelAllowed({ a: "fastf1", b: "synthetic" })).toBe(false);
    expect(modelAllowed({ a: "synthetic", b: "fastf1" })).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });
});
