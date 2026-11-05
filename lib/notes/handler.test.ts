// POST /api/notes handler logic. Formula 1 sessions are refused with 403 before any lap file is
// read or any client is built (decision D1). The "fastf1" session here is the synthetic demo data
// relabelled in memory; no Formula 1 data is involved.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisConfig } from "../analysis/index.ts";
import { NotesCache } from "./cache.ts";
import { FakeNotesClient, type NotesClient } from "./client.ts";
import { handleNotesRequest, MESSAGES, routeNotesDeps, type NotesDeps } from "./handler.ts";
import { RateLimiter, SpendLedger, SpentOut } from "./limits.ts";
import { copyFindings } from "./copy-rules.ts";

const repo = new URL("../../", import.meta.url);
const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, repo), "utf8"));
const config = read("analysis-config.json") as AnalysisConfig;

type Files = Map<string, unknown>;

/** public/demo as in the repo, plus a relabelled copy served as a fastf1 session in public/data. */
function files(): Files {
  const m = new Map<string, unknown>();
  const demo = read("public/demo/manifest.json") as { sessions: Record<string, unknown>[] };
  m.set("demo/manifest.json", demo);
  for (const id of ["AAA-1", "BBB-1", "CCC-1"]) {
    m.set(
      `demo/synthetic-demo/laps/${id}.json`,
      read(`public/demo/synthetic-demo/laps/${id}.json`),
    );
  }
  m.set("demo/synthetic-demo/track.json", read("public/demo/synthetic-demo/track.json"));
  const f1Session = { ...demo.sessions[0]!, session_id: "2026-11-q", origin: "fastf1" };
  m.set("data/manifest.json", { schema: "race-engineer.manifest/v1", sessions: [f1Session] });
  return m;
}

function deps(over: Partial<NotesDeps> & { files?: Files } = {}): NotesDeps & { reads: string[] } {
  const f = over.files ?? files();
  const reads: string[] = [];
  return {
    config,
    readPublicJson: async (rel) => {
      reads.push(rel);
      return f.get(rel);
    },
    enabled: () => true,
    client: () => new FakeNotesClient(),
    state: {
      limiter: new RateLimiter(),
      ledger: new SpendLedger(500_000),
      spentOut: new SpentOut(),
      cache: new NotesCache(),
    },
    now: () => Date.UTC(2026, 8, 23, 12),
    log: () => {},
    ...over,
    reads,
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const pair = { session_id: "synthetic-demo", a: "AAA-1", b: "BBB-1" };

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

describe("POST /api/notes handler", () => {
  it("writes notes for a synthetic pair with the contract response shape", async () => {
    const fake = new FakeNotesClient();
    const res = await handleNotesRequest(post(pair), deps({ client: () => fake }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["cached", "notes", "template_reason"]);
    const notes = body.notes as { finding_id: string; text: string; source: string }[];
    expect(notes.map((n) => n.finding_id)).toEqual([
      "gain-1",
      "gain-2",
      "loss-1",
      "loss-2",
      "loss-3",
    ]);
    expect(notes.every((n) => Object.keys(n).sort().join() === "finding_id,source,text")).toBe(
      true,
    );
    expect(fake.calls).toHaveLength(1);
  });

  it("refuses a Formula 1 session with 403 before reading laps or building a client", async () => {
    const client = vi.fn((): NotesClient => new FakeNotesClient());
    const d = deps({ client });
    const res = await handleNotesRequest(
      post({ session_id: "2026-11-q", a: "AAA-1", b: "BBB-1" }),
      d,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "model_not_allowed",
      message: MESSAGES.model_not_allowed,
    });
    expect(client).not.toHaveBeenCalled();
    expect(d.reads.some((r) => r.includes("/laps/"))).toBe(false);
  });

  it("refuses when a lap file says fastf1 even if the manifest does not", async () => {
    const f = files();
    const lap = structuredClone(f.get("demo/synthetic-demo/laps/BBB-1.json")) as Record<
      string,
      unknown
    >;
    lap.origin = "fastf1";
    f.set("demo/synthetic-demo/laps/BBB-1.json", lap);
    const client = vi.fn((): NotesClient => new FakeNotesClient());
    const res = await handleNotesRequest(post(pair), deps({ files: f, client }));
    expect(res.status).toBe(403);
    expect(client).not.toHaveBeenCalled();
  });

  it("accepts ids only", async () => {
    const bad = [
      "not json",
      "[]",
      { session_id: "synthetic-demo", a: "AAA-1" },
      { ...pair, insight: { findings: [] } },
      { ...pair, a: 1 },
      { ...pair, a: "../../etc/passwd" },
      { ...pair, session_id: "" },
    ];
    for (const body of bad) {
      const res = await handleNotesRequest(post(body), deps());
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("bad_request");
    }
    const same = await handleNotesRequest(post({ ...pair, b: "AAA-1" }), deps());
    expect(same.status).toBe(400);
    const big = await handleNotesRequest(post({ ...pair, pad: "x".repeat(3000) }), deps());
    expect(big.status).toBe(413);
  });

  it("refuses a large body with 413 without reading all of it", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024).fill(32));
      },
    });
    const streamed = new Request("http://localhost/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
      body: endless,
      duplex: "half",
    } as RequestInit);
    const res = await handleNotesRequest(streamed, deps());
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe("too_large");
    expect(pulled).toBeLessThanOrEqual(4);

    const declared = new Request("http://localhost/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "50000000" },
      body: JSON.stringify(pair),
    });
    expect((await handleNotesRequest(declared, deps())).status).toBe(413);
  });

  it("returns 404 for an unknown session or a lap the manifest does not list", async () => {
    for (const body of [
      { ...pair, session_id: "2025-99-q" },
      { ...pair, b: "ZZZ-9" },
    ]) {
      const res = await handleNotesRequest(post(body), deps());
      expect(res.status).toBe(404);
    }
  });

  it("serves templates and says why when there is no key or notes are off", async () => {
    const noKey = await handleNotesRequest(post(pair), deps({ client: () => null }));
    expect(noKey.status).toBe(200);
    const a = (await noKey.json()) as { template_reason: string; notes: { source: string }[] };
    expect(a.template_reason).toBe("no_key");
    expect(a.notes.every((n) => n.source === "template")).toBe(true);
    const off = await handleNotesRequest(post(pair), deps({ enabled: () => false }));
    expect(((await off.json()) as { template_reason: string }).template_reason).toBe("disabled");
  });

  it("hides internal errors behind a generic 500", async () => {
    const d = deps({
      readPublicJson: async () => {
        throw new Error("secret detail sk-ant-xyz");
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleNotesRequest(post(pair), d);
    spy.mockRestore();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/secret|sk-ant/);
    expect(JSON.parse(text)).toEqual({ error: "server_error", message: MESSAGES.server_error });
  });

  it("off Vercel, a spoofed x-vercel-forwarded-for does not reset the per-IP bucket", async () => {
    const d = deps();
    const ids = ["AAA-1", "BBB-1", "CCC-1"];
    const pairs = ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => ({ a, b })));
    const reasons: (string | null)[] = [];
    for (const [k, p] of pairs.entries()) {
      const req = new Request("http://localhost/api/notes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vercel-forwarded-for": `203.0.113.${String(k)}`,
          "x-forwarded-for": `198.51.100.${String(k)}, 10.0.0.1`,
        },
        body: JSON.stringify({ session_id: "synthetic-demo", ...p }),
      });
      const res = await handleNotesRequest(req, d);
      reasons.push(((await res.json()) as { template_reason: string | null }).template_reason);
    }
    // 6 distinct pairs (no cache hits) from one proxy hop: the 6th is over the limit of 5.
    expect(reasons).toEqual([null, null, null, null, null, "rate_limited"]);
  });

  it("every message a caller can see follows the copy rules", () => {
    for (const m of Object.values(MESSAGES)) expect(copyFindings(m), m).toEqual([]);
  });
});

describe("routeNotesDeps", () => {
  it("reads the real demo files from disk and serves templates without a key", async () => {
    const root = fileURLToPath(repo);
    const d = { ...routeNotesDeps(config, {}, root), log: () => {} };
    expect(d.client()).toBeNull();
    const res = await handleNotesRequest(post(pair), d);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { template_reason: string; notes: unknown[] };
    expect(body.template_reason).toBe("no_key");
    expect(body.notes).toHaveLength(5);
  });

  it("builds the real client once per key", () => {
    const env: Record<string, string> = { ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key" };
    const d = routeNotesDeps(config, env, fileURLToPath(repo));
    const c1 = d.client();
    expect(c1?.fake).toBe(false);
    expect(d.client()).toBe(c1);
    env.ANTHROPIC_API_KEY = "";
    expect(d.client()).toBeNull();
  });
});
