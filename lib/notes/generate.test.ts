// The notes pipeline with FakeNotesClient: validation, the single retry with errors, template
// fallback, cache hits, limits and infrastructure failures. Nothing reaches the network.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzePair, type AnalysisConfig, type Lap, type Track } from "../analysis/index.ts";
import { NotesCache } from "./cache.ts";
import { FakeNotesClient, fakeWriter, NotesClientError, type FakeResponder } from "./client.ts";
import { generateNotes, type GenerateInput, type NotesState } from "./generate.ts";
import { RateLimiter, SpendLedger, SpentOut } from "./limits.ts";
import { templateNotes } from "./template.ts";

const root = new URL("../../", import.meta.url);
const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, root), "utf8")) as T;
const config = read<AnalysisConfig>("analysis-config.json");
const dir = "public/demo/synthetic-demo";
const lap = (id: string) => read<Lap>(`${dir}/laps/${id}.json`);
const comparison = analyzePair(
  lap("AAA-1"),
  lap("BBB-1"),
  read<Track>(`${dir}/track.json`),
  config,
);
const ids = comparison.findings.map((f) => f.id);
const templates = templateNotes(comparison);
const T0 = Date.UTC(2026, 8, 23, 12);

function state(capMicro = 500_000): NotesState {
  return {
    limiter: new RateLimiter(),
    ledger: new SpendLedger(capMicro),
    spentOut: new SpentOut(),
    cache: new NotesCache(),
  };
}

function input(over: Partial<GenerateInput> = {}): GenerateInput {
  return {
    comparison,
    pair: { session_id: "synthetic-demo", a: "AAA-1", b: "BBB-1" },
    client: new FakeNotesClient(),
    enabled: true,
    ip: "10.0.0.1",
    maxChars: config.notes!.max_chars,
    state: state(),
    now: () => T0,
    ...over,
  };
}

let netSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  netSpy = vi.fn(() => {
    throw new Error("network access in a test");
  });
  vi.stubGlobal("fetch", netSpy);
});
afterEach(() => {
  expect(netSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("generateNotes", () => {
  it("returns validated model notes in findings order and caches them", async () => {
    const st = state();
    const fake = new FakeNotesClient();
    const res = await generateNotes(input({ client: fake, state: st }));
    expect(res.cached).toBe(false);
    expect(res.template_reason).toBeNull();
    expect(res.notes.map((n) => n.finding_id)).toEqual(ids);
    expect(res.notes.every((n) => n.source === "model")).toBe(true);
    expect(res.notes[0]!.text).toBe("T1 gains 0.406 s on the brakes, 67 m later than BBB.");
    expect(fake.calls).toHaveLength(1);
    expect(st.cache.size).toBe(1);

    const again = await generateNotes(input({ client: fake, state: st }));
    expect(again.cached).toBe(true);
    expect(again.notes).toEqual(res.notes);
    expect(fake.calls).toHaveLength(1);
  });

  it("retries once with the failed ids and their errors, then uses templates", async () => {
    const bad: FakeResponder = (req, call) => {
      const good = fakeWriter(req);
      if (call === 1) {
        // gain-1 cites a rounded number; loss-1 is missing.
        good.notes = good
          .notes!.map((n) =>
            n.finding_id === "gain-1" ? { ...n, text: "T1, you gain 0.41 s." } : n,
          )
          .filter((n) => n.finding_id !== "loss-1");
        return good;
      }
      // The retry fixes gain-1 and still fails loss-1 (wrong direction word).
      good.notes = good.notes!.map((n) =>
        n.finding_id === "loss-1" ? { ...n, text: "T9, you gain nothing, 0.243 s." } : n,
      );
      return good;
    };
    const fake = new FakeNotesClient(bad);
    const res = await generateNotes(input({ client: fake }));
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.ids).toEqual(["gain-1", "loss-1"]);
    const fb = fake.calls[1]!.feedback!;
    expect(fb.find((f) => f.finding_id === "gain-1")!.errors).toContain(
      'number not in insight: "0.41 s"',
    );
    expect(fb.find((f) => f.finding_id === "loss-1")!.errors).toEqual([
      "no note for this finding id",
    ]);
    const byId = new Map(res.notes.map((n) => [n.finding_id, n]));
    expect(byId.get("gain-1")!.source).toBe("model");
    expect(byId.get("loss-1")).toEqual({
      finding_id: "loss-1",
      text: templates.find((t) => t.finding_id === "loss-1")!.text,
      source: "template",
    });
    expect(res.template_reason).toBeNull();
  });

  it("serves templates and says why: kill switch, no key", async () => {
    const off = await generateNotes(input({ enabled: false }));
    expect(off.template_reason).toBe("disabled");
    expect(off.notes.every((n) => n.source === "template")).toBe(true);
    const noKey = await generateNotes(input({ client: null }));
    expect(noKey.template_reason).toBe("no_key");
    expect(noKey.notes.map((n) => n.text)).toEqual(templates.map((t) => t.text));
  });

  it("per-IP limit: the 6th generation in 10 minutes gets templates", async () => {
    const st = state();
    const fake = new FakeNotesClient();
    const reasons: (string | null)[] = [];
    for (let i = 0; i < 6; i++) {
      st.cache = new NotesCache(); // a cold cache each time, so every request would call the model
      const res = await generateNotes(input({ client: fake, state: st }));
      reasons.push(res.template_reason);
    }
    expect(reasons).toEqual([null, null, null, null, null, "rate_limited"]);
    expect(fake.calls).toHaveLength(5);
  });

  it("spend cap: no call when the worst case does not fit", async () => {
    const fake = new FakeNotesClient();
    const res = await generateNotes(input({ client: fake, state: state(1000) }));
    expect(res.template_reason).toBe("spend_cap");
    expect(fake.calls).toHaveLength(0);
  });

  it("infrastructure failure: templates, not cached, reservation kept only if maybe billed", async () => {
    for (const [err, committed] of [
      [new NotesClientError("rate_limited", 429, false), 0],
      [new NotesClientError("timeout", null, true), 1],
    ] as const) {
      const st = state();
      const fake = new FakeNotesClient(() => err);
      const res = await generateNotes(input({ client: fake, state: st }));
      expect(res.template_reason).toBe("model_error");
      expect(res.notes.every((n) => n.source === "template")).toBe(true);
      expect(st.cache.size).toBe(0);
      expect(st.ledger.committed(T0) > 0 ? 1 : 0).toBe(committed);
    }
  });

  it("a workspace spend limit stops calls until the next UTC day", async () => {
    const st = state();
    const fake = new FakeNotesClient(() => new NotesClientError("spend_limit", 400, false));
    expect((await generateNotes(input({ client: fake, state: st }))).template_reason).toBe(
      "model_error",
    );
    const second = await generateNotes(input({ client: new FakeNotesClient(), state: st }));
    expect(second.template_reason).toBe("spend_cap");
  });

  it("settles the ledger to real usage", async () => {
    const st = state();
    const fake = new FakeNotesClient((req) => ({
      ...fakeWriter(req),
      usage: { input_tokens: 1500, output_tokens: 350 },
    }));
    await generateNotes(input({ client: fake, state: st }));
    expect(st.ledger.committed(T0)).toBe(3250);
  });

  it("re-validates cached notes and turns a failing one into a template", async () => {
    const st = state();
    const fake = new FakeNotesClient();
    const first = await generateNotes(input({ client: fake, state: st }));
    // Tighter length cap after the notes were stored: long ones fail on read.
    const res = await generateNotes(input({ client: fake, state: st, maxChars: 30 }));
    expect(res.cached).toBe(true);
    expect(fake.calls).toHaveLength(1);
    for (const [i, n] of res.notes.entries()) {
      if (first.notes[i]!.text.length > 30) expect(n.source).toBe("template");
    }
  });

  it("refuses Formula 1 laps before any client call (decision D1)", async () => {
    const f1 = structuredClone(comparison);
    f1.lap_a.origin = "fastf1";
    const fake = new FakeNotesClient();
    await expect(generateNotes(input({ client: fake, comparison: f1 }))).rejects.toThrow(
      /may not see/,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("a pair with no findings gets no notes and no call", async () => {
    const same = analyzePair(lap("AAA-1"), lap("AAA-1"), null, config);
    const fake = new FakeNotesClient();
    const res = await generateNotes(input({ client: fake, comparison: same }));
    expect(res).toEqual({ notes: [], cached: false, template_reason: null });
    expect(fake.calls).toHaveLength(0);
  });
});
