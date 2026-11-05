// Parity: the TS analysis must reproduce the Python reference output in fixtures/parity/expected.json.
// Exact for integers, labels, flags, ordering and display strings; abs 1e-9 for floats.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzePair, CORNER_LABEL_RE } from "./index.ts";
import type { AnalysisConfig, Lap, Track } from "./types.ts";

const root = new URL("../../", import.meta.url);
const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, root), "utf8")) as T;

type Case = { a: string; b: string; track: boolean; comparison: unknown };
const expected = read<{ session_dir: string; cases: Case[] }>("fixtures/parity/expected.json");
const config = read<AnalysisConfig>("analysis-config.json");
const track = read<Track>(`${expected.session_dir}/track.json`);
const lap = (id: string) => read<Lap>(`${expected.session_dir}/laps/${id}.json`);

// Fields that must be integers wherever they appear as a property (not grid arrays).
const INT_KEYS = new Set([
  "delta_ms",
  "lap_gap_ms",
  "min_speed_kph",
  "exit_speed_kph",
  "brake_before_m",
  "brake_gap_m",
  "brake_diff_m",
  "min_speed_diff_kph",
  "exit_speed_diff_kph",
  "rank",
  "index",
  "corner_index",
  "duration_ms",
  "lap_no",
  "top_speed_kph",
]);
const FLOAT_TOL = 1e-9;

type Stats = { floats: number; floatsBitEqual: number; ints: number; strings: number };

function compare(
  actual: unknown,
  want: unknown,
  path: string,
  key: string | null,
  stats: Stats,
  errors: string[],
): void {
  if (errors.length >= 25) return;
  if (want === null || typeof want === "boolean" || typeof want === "string") {
    if (actual !== want)
      errors.push(`${path}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
    if (typeof want === "string") stats.strings += 1;
    return;
  }
  if (typeof want === "number") {
    if (typeof actual !== "number") {
      errors.push(`${path}: expected number ${want}, got ${JSON.stringify(actual)}`);
      return;
    }
    const intField = key !== null && INT_KEYS.has(key);
    if (intField || (Number.isInteger(want) && Number.isInteger(actual))) {
      stats.ints += 1;
      if (!Number.isInteger(actual) || actual !== want) {
        errors.push(`${path}: expected integer ${want}, got ${actual}`);
      }
      return;
    }
    stats.floats += 1;
    if (actual === want) stats.floatsBitEqual += 1;
    else if (!(Math.abs(actual - want) <= FLOAT_TOL)) {
      errors.push(`${path}: expected ${want}, got ${actual} (diff ${Math.abs(actual - want)})`);
    }
    return;
  }
  if (Array.isArray(want)) {
    if (!Array.isArray(actual) || actual.length !== want.length) {
      errors.push(
        `${path}: expected array of ${want.length}, got ${Array.isArray(actual) ? actual.length : typeof actual}`,
      );
      return;
    }
    for (let i = 0; i < want.length; i++)
      compare(actual[i], want[i], `${path}[${i}]`, null, stats, errors);
    return;
  }
  if (typeof want === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      errors.push(`${path}: expected object, got ${JSON.stringify(actual)}`);
      return;
    }
    const a = actual as Record<string, unknown>;
    const w = want as Record<string, unknown>;
    const ak = Object.keys(a)
      .filter((k) => a[k] !== undefined)
      .sort();
    const wk = Object.keys(w).sort();
    if (ak.join(",") !== wk.join(",")) {
      errors.push(`${path}: keys differ. expected [${wk.join(", ")}], got [${ak.join(", ")}]`);
      return;
    }
    for (const k of wk) compare(a[k], w[k], `${path}.${k}`, k, stats, errors);
    return;
  }
  errors.push(`${path}: unexpected type ${typeof want}`);
}

/**
 * Paths of every -0, NaN or infinite number in a raw value. It must run before any JSON round
 * trip: JSON.stringify turns -0 into 0 and NaN into null, so a check after it can never fire.
 */
function badNumbers(value: unknown, path: string, out: string[]): string[] {
  if (typeof value === "number") {
    if (Object.is(value, -0)) out.push(`${path} is -0`);
    else if (!Number.isFinite(value)) out.push(`${path} is ${String(value)}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => badNumbers(v, `${path}[${String(i)}]`, out));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) badNumbers(v, `${path}.${k}`, out);
  }
  return out;
}

describe("parity with the Python reference (fixtures/parity/expected.json)", () => {
  it("has the 3 cases", () => {
    expect(expected.cases.map((c) => `${c.a}/${c.b}/${c.track ? "track" : "laps"}`)).toEqual([
      "AAA-1/BBB-1/track",
      "AAA-1/CCC-1/track",
      "AAA-1/BBB-1/laps",
    ]);
  });

  for (const c of expected.cases) {
    it(`${c.a} vs ${c.b}, ${c.track ? "with track" : "laps only"}`, () => {
      const got = analyzePair(lap(c.a), lap(c.b), c.track ? track : null, config);
      // On the raw object, before the round trip hides them.
      expect(badNumbers(got, "comparison", [])).toEqual([]);
      // Round-trip through JSON, as the Python side did, so undefined keys cannot hide.
      const actual: unknown = JSON.parse(JSON.stringify(got));
      const stats: Stats = { floats: 0, floatsBitEqual: 0, ints: 0, strings: 0 };
      const errors: string[] = [];
      compare(actual, c.comparison, "comparison", null, stats, errors);
      expect(errors).toEqual([]);
      expect(stats.floats).toBeGreaterThan(10000);
      expect(stats.strings).toBeGreaterThan(50);
      console.info(
        `parity ${c.a}/${c.b}/${c.track ? "track" : "laps"}: ${stats.floatsBitEqual}/${stats.floats} floats bit-identical, ${stats.ints} integers and ${stats.strings} strings exact`,
      );
    });
  }

  it("the raw-value walk finds -0 and NaN that JSON would hide", () => {
    const raw = { a: [1, -0], b: { c: Number.NaN } };
    expect(badNumbers(raw, "x", [])).toEqual(["x.a[1] is -0", "x.b.c is NaN"]);
    expect(badNumbers(JSON.parse(JSON.stringify(raw)), "x", [])).toEqual([]);
  });

  it("keeps every corner label inside the grammar", () => {
    for (const c of expected.cases) {
      const got = analyzePair(lap(c.a), lap(c.b), c.track ? track : null, config);
      for (const row of got.corners) expect(row.label).toMatch(CORNER_LABEL_RE);
    }
  });
});

describe("speed", () => {
  it("runs a 300-sample lap pair well under 50 ms", () => {
    const a = lap("AAA-1");
    const b = lap("BBB-1");
    expect(a.samples.t_ms.length).toBeGreaterThanOrEqual(300);
    for (let i = 0; i < 3; i++) analyzePair(a, b, track, config);
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      analyzePair(a, b, track, config);
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    const median = times[Math.floor(times.length / 2)]!;
    console.info(
      `analyzePair ${a.samples.t_ms.length}/${b.samples.t_ms.length} samples: median ${median.toFixed(2)} ms, max ${times[times.length - 1]!.toFixed(2)} ms`,
    );
    expect(median).toBeLessThan(50);
  });
});
