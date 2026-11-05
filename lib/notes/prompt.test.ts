// Prompt, schema and the server-only guard.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisConfig } from "../analysis/index.ts";
import { copyFindings } from "./copy-rules.ts";
import type { Insight } from "./insight.ts";
import { FINDING_IDS, NOTES_SCHEMA, SYSTEM_PROMPT, userMessage } from "./prompt.ts";

const config = JSON.parse(
  readFileSync(new URL("../../analysis-config.json", import.meta.url), "utf8"),
) as AnalysisConfig;

const insight: Insight = {
  schema: "race-engineer.insight/v1",
  origins: { a: "synthetic", b: "synthetic" },
  perspective: "A",
  driver_a: { code: "AAA", lap_time: "1:25.275" },
  driver_b: { code: "BBB", lap_time: "1:25.371" },
  lap_gap: { direction: "gains", time: "0.096 s" },
  findings: [
    {
      id: "gain-1",
      kind: "gain",
      corner: "T1",
      cause: "time_only",
      display: { direction: "gains", time: "0.406 s" },
    },
    {
      id: "loss-1",
      kind: "loss",
      corner: "T9",
      cause: "time_only",
      display: { direction: "loses", time: "0.243 s" },
    },
  ],
};

describe("prompt", () => {
  it("states the same length cap as analysis-config.json", () => {
    expect(SYSTEM_PROMPT).toContain(`at most ${config.notes!.max_chars} characters`);
  });

  it("follows the copy rules it asks for, apart from the quoted banned list", () => {
    const withoutList = SYSTEM_PROMPT.replace(/Do not use these words:[^\n]*/, "");
    expect(copyFindings(withoutList)).toEqual([]);
  });

  it("allows every finding id the analysis can produce", () => {
    const n = config.findings.top_n;
    const ids = [1, 2, 3].slice(0, n).flatMap((r) => [`gain-${r}`, `loss-${r}`]);
    expect([...FINDING_IDS].sort()).toEqual(ids.sort());
    expect(NOTES_SCHEMA.properties.notes.items.properties.finding_id.enum).toEqual([
      ...FINDING_IDS,
    ]);
  });

  it("the retry message carries only the failed findings and their errors", () => {
    const msg = userMessage(
      insight,
      ["loss-1"],
      [
        {
          finding_id: "loss-1",
          text: "T9, you gain 0.24 s.",
          errors: ['number not in insight: "0.24 s"'],
        },
      ],
    );
    expect(msg).toContain('"id":"loss-1"');
    expect(msg).not.toContain('"id":"gain-1"');
    expect(msg).toContain(
      '- loss-1: "T9, you gain 0.24 s.". Errors: number not in insight: "0.24 s".',
    );
    expect(msg).toContain("Write one note for each of these finding ids: loss-1.");
  });
});

describe("server-only guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("server modules throw when a browser loads them", async () => {
    vi.resetModules();
    vi.stubGlobal("window", {});
    for (const m of [
      "./server-only.ts",
      "./client.ts",
      "./cache.ts",
      "./limits.ts",
      "./generate.ts",
      "./handler.ts",
    ]) {
      await expect(import(/* @vite-ignore */ m), m).rejects.toThrow(/imported in a browser/);
    }
  });

  it("the modules the UI imports load in a browser", async () => {
    vi.resetModules();
    vi.stubGlobal("window", {});
    for (const m of [
      "./template.ts",
      "./insight.ts",
      "./validate.ts",
      "./copy-rules.ts",
      "./prompt.ts",
    ]) {
      await expect(import(/* @vite-ignore */ m), m).resolves.toBeDefined();
    }
  });
});
