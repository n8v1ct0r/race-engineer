// Planted differences (fixtures/parity/planted.json) must be found where they were planted,
// and findings must follow the selection, cause and display rules in docs/contracts.md section 4.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzePair } from "./index.ts";
import type { AnalysisConfig, Comparison, DisplayStrings, Lap, Track } from "./types.ts";

const root = new URL("../../", import.meta.url);
const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, root), "utf8")) as T;
const dir = "public/demo/synthetic-demo";
const config = read<AnalysisConfig>("analysis-config.json");
const track = read<Track>(`${dir}/track.json`);
const lap = (id: string) => read<Lap>(`${dir}/laps/${id}.json`);

type Expect = {
  label: string;
  kind: "gain" | "loss";
  cause: string;
  brake_word?: string;
  min_speed_word?: string;
  exit_speed_word?: string;
};
const planted = read<{
  structure: {
    group_label: string;
    letter_label: string;
    edge_min_label: string;
    clamped_exit_label: string;
    dropout: { lap: string; label: string };
  };
  pairs: { a: string; b: string; track: boolean; anchored: boolean; expect: Expect[] }[];
}>("fixtures/parity/planted.json");

const cache = new Map<string, Comparison>();
function run(a: string, b: string, useTrack: boolean): Comparison {
  const key = `${a}/${b}/${useTrack}`;
  let r = cache.get(key);
  if (r === undefined) {
    r = analyzePair(lap(a), lap(b), useTrack ? track : null, config);
    cache.set(key, r);
  }
  return r;
}
const allCases: [string, string, boolean][] = [
  ["AAA-1", "BBB-1", true],
  ["AAA-1", "CCC-1", true],
  ["AAA-1", "BBB-1", false],
];

describe("planted differences", () => {
  for (const pair of planted.pairs) {
    for (const exp of pair.expect) {
      it(`${pair.a} vs ${pair.b}: ${exp.label} is a ${exp.kind}, cause ${exp.cause}`, () => {
        const r = run(pair.a, pair.b, pair.track);
        expect(r.anchored).toBe(pair.anchored);
        const f = r.findings.find((x) => x.label === exp.label);
        expect(f, `no finding at ${exp.label}`).toBeDefined();
        expect(f!.kind).toBe(exp.kind);
        expect(f!.cause).toBe(exp.cause);
        expect(Math.sign(f!.delta_ms)).toBe(exp.kind === "gain" ? 1 : -1);
        for (const key of ["brake_word", "min_speed_word", "exit_speed_word"] as const) {
          if (exp[key] !== undefined) expect(f!.display[key]).toBe(exp[key]);
        }
      });
    }
  }

  it("covers the structural cases: group, letter suffix, edge minimum, clamped exit, dropout", () => {
    const st = planted.structure;
    const r = run("AAA-1", "BBB-1", true);
    const row = (label: string) => r.corners.find((c) => c.label === label)!;
    expect(row(st.group_label)).toBeDefined();
    expect(row(st.letter_label)).toBeDefined();
    expect(row(st.edge_min_label).a!.min_edge && row(st.edge_min_label).b!.min_edge).toBe(true);
    expect(row(st.clamped_exit_label).exit_clamped).toBe(true);
    const drop = row(st.dropout.label);
    const diff = Math.abs(drop.b!.brake_before_m! - drop.a!.brake_before_m!);
    expect(drop.b!.brake_gap_m!).toBeGreaterThan(diff);
    expect(diff).toBeGreaterThan(drop.a!.brake_gap_m!);
  });

  it("includes a braking finding that clears the sample-gap rule and a time_only finding", () => {
    const r = run("AAA-1", "BBB-1", true);
    const braking = r.findings.filter((f) => f.cause === "braking");
    expect(braking.length).toBeGreaterThanOrEqual(1);
    const row = r.corners[braking[0]!.corner_index]!;
    expect(Math.abs(braking[0]!.brake_diff_m!)).toBeGreaterThan(row.a!.brake_gap_m!);
    expect(Math.abs(braking[0]!.brake_diff_m!)).toBeGreaterThan(row.b!.brake_gap_m!);
    expect(r.findings.some((f) => f.cause === "time_only")).toBe(true);
  });
});

describe("finding rules", () => {
  const always = ["label", "direction", "time", "delta"];
  const groups: Record<"braking" | "min_speed" | "exit_speed", (keyof DisplayStrings)[]> = {
    braking: ["brake_a", "brake_b", "brake_gap_a", "brake_gap_b", "brake_diff", "brake_word"],
    min_speed: ["min_speed_a", "min_speed_b", "min_speed_diff", "min_speed_word"],
    exit_speed: ["exit_speed_a", "exit_speed_b", "exit_speed_diff", "exit_speed_word"],
  };

  for (const [a, b, useTrack] of allCases) {
    it(`${a} vs ${b} ${useTrack ? "with track" : "laps only"}: selection, cause and display`, () => {
      const r = run(a, b, useTrack);
      expect(r.corners.reduce((s, c) => s + c.delta_ms, 0)).toBe(r.lap_gap_ms);
      expect(r.mini_sectors.reduce((s, m) => s + m.delta_ms, 0)).toBe(r.lap_gap_ms);
      expect(r.mini_sectors).toHaveLength(config.minisectors.count);
      const gains = r.findings.filter((f) => f.kind === "gain");
      const losses = r.findings.filter((f) => f.kind === "loss");
      expect(r.findings).toEqual([...gains, ...losses]);
      expect(gains.length).toBeLessThanOrEqual(config.findings.top_n);
      expect(losses.length).toBeLessThanOrEqual(config.findings.top_n);
      for (const [list, sign] of [
        [gains, 1],
        [losses, -1],
      ] as const) {
        const mags = list.map((f) => sign * f.delta_ms);
        expect(mags).toEqual([...mags].sort((x, y) => y - x));
        list.forEach((f, i) => {
          expect(sign * f.delta_ms).toBeGreaterThanOrEqual(config.findings.min_abs_ms);
          expect(f.id).toBe(`${f.kind}-${i + 1}`);
        });
      }
      for (const f of r.findings) {
        const allowed = new Set<string>(always);
        for (const name of ["braking", "min_speed", "exit_speed"] as const) {
          if (f.checks[name]) for (const k of groups[name]) allowed.add(k);
        }
        expect(new Set(Object.keys(f.display))).toEqual(allowed);
        const first = (["braking", "min_speed", "exit_speed"] as const).find((c) => f.checks[c]);
        expect(f.cause).toBe(first ?? "time_only");
        for (const [k, v] of Object.entries(f.display)) {
          if (k !== "label") expect(v).not.toMatch(/-|–|—/);
        }
      }
    });
  }
});
