// Cache key stability, LRU order and the development-only file layer.

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cacheDirFor,
  cacheKey,
  NOTES_RECORD_SCHEMA,
  NotesCache,
  type NotesRecord,
} from "./cache.ts";
import type { Insight } from "./insight.ts";
import { MODEL_ID, PROMPT_VERSION } from "./prompt.ts";

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
      cause: "braking",
      display: { direction: "gains", time: "0.406 s", brake_diff: "67 m", brake_word: "later" },
    },
  ],
};

function record(key: string): NotesRecord {
  return {
    schema: NOTES_RECORD_SCHEMA,
    key,
    model: MODEL_ID,
    prompt_version: PROMPT_VERSION,
    validator_version: "numcheck-v2",
    session_id: "synthetic-demo",
    a: "AAA-1",
    b: "BBB-1",
    notes: [{ finding_id: "gain-1", text: "T1, you gain 0.406 s.", source: "model" }],
    usage: null,
  };
}

describe("cacheKey", () => {
  it("is a stable sha256 hex that ignores key order", () => {
    const k = cacheKey(insight, MODEL_ID);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    const reordered = Object.fromEntries(Object.entries(insight).reverse()) as Insight;
    expect(Object.keys(reordered)[0]).toBe("findings");
    expect(cacheKey(reordered, MODEL_ID)).toBe(k);
    // Pinned so a change to the key recipe shows up as a test diff. Python reproduces it with
    // sha256(json.dumps(insight, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    // + "\nm\np").
    expect(cacheKey(insight, "m", "p")).toBe(
      "5a347b409cfe113eef2840b8a63aba9fffc4976786b70979e5cc4000bc320b14",
    );
  });

  it("changes with any display string, the model id or the prompt version", () => {
    const k = cacheKey(insight, MODEL_ID);
    const edited = structuredClone(insight);
    edited.findings[0]!.display.time = "0.407 s";
    expect(cacheKey(edited, MODEL_ID)).not.toBe(k);
    expect(cacheKey(insight, "claude-other")).not.toBe(k);
    expect(cacheKey(insight, MODEL_ID, "notes-v999")).not.toBe(k);
  });
});

describe("NotesCache", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("evicts the least recently used entry", () => {
    const c = new NotesCache({ maxEntries: 2 });
    const [k1, k2, k3] = ["1", "2", "3"].map((s) => s.repeat(64));
    c.set(record(k1!));
    c.set(record(k2!));
    expect(c.get(k1!)).not.toBeNull(); // k1 is now most recent
    c.set(record(k3!));
    expect(c.get(k2!)).toBeNull();
    expect(c.get(k1!)).not.toBeNull();
    expect(c.get(k3!)).not.toBeNull();
    expect(c.size).toBe(2);
  });

  it("writes and reads the file layer when a dir is given", () => {
    const dir = mkdtempSync(join(tmpdir(), "notes-cache-"));
    dirs.push(dir);
    const key = cacheKey(insight, MODEL_ID);
    new NotesCache({ dir }).set(record(key));
    expect(readdirSync(dir)).toEqual([`${key}.json`]);
    const fresh = new NotesCache({ dir });
    expect(fresh.get(key)?.notes[0]?.text).toBe("T1, you gain 0.406 s.");
    expect(fresh.get("../" + key)).toBeNull();
  });

  it("uses the file layer only in development", () => {
    expect(cacheDirFor({ NODE_ENV: "development" }, "/r")).toBe(join("/r", ".cache", "notes"));
    expect(cacheDirFor({ NODE_ENV: "production" }, "/r")).toBeNull();
    expect(cacheDirFor({ NODE_ENV: "test" }, "/r")).toBeNull();
    expect(cacheDirFor({}, "/r")).toBeNull();
  });
});
