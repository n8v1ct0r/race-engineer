// Template notes: every finding of every demo pair gets a cause-aware note that passes the
// validator (plan section 3b item 2: "one test asserts every template note passes").

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analyzePair,
  type AnalysisConfig,
  type Comparison,
  type Lap,
  type Track,
} from "../analysis/index.ts";
import { buildInsight } from "./insight.ts";
import { templateNotes } from "./template.ts";
import { checkNote } from "./validate.ts";

const root = new URL("../../", import.meta.url);
const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, root), "utf8")) as T;
const config = read<AnalysisConfig>("analysis-config.json");
const dir = "public/demo/synthetic-demo";
const track = read<Track>(`${dir}/track.json`);
const lap = (id: string) => read<Lap>(`${dir}/laps/${id}.json`);
const LAPS = ["AAA-1", "BBB-1", "CCC-1"];
const pairs = LAPS.flatMap((a) => LAPS.filter((b) => b !== a).map((b) => [a, b] as const));
const comparisons = new Map<string, Comparison>(
  pairs.map(([a, b]) => [`${a} vs ${b}`, analyzePair(lap(a), lap(b), track, config)]),
);
const maxChars = config.notes!.max_chars;

describe("template notes on the demo pairs", () => {
  it("covers all 6 ordered pairs and all 4 causes", () => {
    const causes = new Set(
      [...comparisons.values()].flatMap((c) => c.findings.map((f) => f.cause)),
    );
    expect(comparisons.size).toBe(6);
    expect([...causes].sort()).toEqual(["braking", "exit_speed", "min_speed", "time_only"]);
  });

  for (const [name, c] of comparisons) {
    it(`${name}: every template note passes the validator`, () => {
      const insight = buildInsight(c);
      const notes = templateNotes(c);
      expect(notes.map((n) => n.finding_id)).toEqual(c.findings.map((f) => f.id));
      for (const n of notes) {
        const r = checkNote(insight, n.finding_id, n.text, maxChars);
        expect(r.errors, n.text).toEqual([]);
        expect(n.source).toBe("template");
      }
    });
  }

  it("is cause-aware on the default pair", () => {
    const c = comparisons.get("AAA-1 vs BBB-1")!;
    const byLabel = new Map(templateNotes(c).map((n) => [n.corner, n.text]));
    expect(byLabel.get("T1")).toBe("T1, you gain 0.406 s. You brake 67 m later.");
    expect(byLabel.get("T11")).toBe("T11, you gain 0.179 s.");
    expect(byLabel.get("T9")).toBe("T9, you lose 0.243 s. Exit speed 144 km/h against 153 km/h.");
    expect(byLabel.get("T6-7")).toBe(
      "T6-7, you lose 0.150 s. Minimum speed 124 km/h against 131 km/h.",
    );
  });

  it("a loss by later braking still says lose, and a braking loss says earlier", () => {
    const c = comparisons.get("BBB-1 vs AAA-1")!;
    const t1 = templateNotes(c).find((n) => n.corner === "T1")!;
    expect(t1.text).toBe("T1, you lose 0.406 s. You brake 67 m earlier.");
  });
});
