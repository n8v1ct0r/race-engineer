// Notes clients. No test reaches the network: global fetch is replaced by a spy that throws, and
// AnthropicNotesClient gets an injected fetch that returns canned API responses.

import { APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnthropicNotesClient,
  FakeNotesClient,
  fakeWriter,
  NotesClientError,
  notesClientFromEnv,
  parseNotes,
  toNotesError,
  type NotesRequest,
} from "./client.ts";
import type { Insight } from "./insight.ts";
import { MAX_TOKENS, MODEL_ID, NOTES_SCHEMA, SYSTEM_PROMPT } from "./prompt.ts";

const FAKE_KEY = "sk-ant-test-not-a-real-key";

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
const req: NotesRequest = { insight, ids: ["gain-1"] };
const f1Req: NotesRequest = {
  ...req,
  insight: { ...insight, origins: { a: "fastf1", b: "fastf1" } },
};

function apiReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "request-id": "req_test" },
  });
}

const okMessage = {
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: MODEL_ID,
  content: [
    {
      type: "text",
      text: JSON.stringify({
        notes: [{ finding_id: "gain-1", text: "T1, you gain 0.406 s. You brake 67 m later." }],
      }),
    },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1234, output_tokens: 56 },
};

let netSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  netSpy = vi.fn(() => {
    throw new Error("network access in a test");
  });
  vi.stubGlobal("fetch", netSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnthropicNotesClient", () => {
  it("sends the contract request: model, temperature 0, max_tokens 800, structured outputs", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new AnthropicNotesClient({
      apiKey: FAKE_KEY,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return apiReply(okMessage);
      },
    });
    const reply = await client.write(req);
    expect(reply).toEqual({
      stop_reason: "end_turn",
      notes: [{ finding_id: "gain-1", text: "T1, you gain 0.406 s. You brake 67 m later." }],
      usage: { input_tokens: 1234, output_tokens: 56 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/v1\/messages$/);
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(MAX_TOKENS);
    expect(MAX_TOKENS).toBe(800);
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(body.output_config).toEqual({ format: { type: "json_schema", schema: NOTES_SCHEMA } });
    expect(body).not.toHaveProperty("thinking");
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("x-api-key")).toBe(FAKE_KEY);
    expect(headers.get("authorization")).toBeNull();
    expect(netSpy).not.toHaveBeenCalled();
  });

  it("refuses a Formula 1 insight before any request (decision D1)", async () => {
    const fetchSpy = vi.fn(async () => apiReply(okMessage));
    const client = new AnthropicNotesClient({ apiKey: FAKE_KEY, fetch: fetchSpy });
    await expect(client.write(f1Req)).rejects.toMatchObject({ kind: "not_allowed" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(netSpy).not.toHaveBeenCalled();
  });

  it("returns notes null when the output is not the notes object", async () => {
    const bad = { ...okMessage, content: [{ type: "text", text: "not json" }] };
    const client = new AnthropicNotesClient({ apiKey: FAKE_KEY, fetch: async () => apiReply(bad) });
    expect((await client.write(req)).notes).toBeNull();
  });

  it("maps API failures to NotesClientError with no SDK text and no key", async () => {
    const cases: [number, unknown, string][] = [
      [
        429,
        { type: "error", error: { type: "rate_limit_error", message: "slow down" } },
        "rate_limited",
      ],
      [
        400,
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "You have reached your specified workspace API usage limits.",
          },
        },
        "spend_limit",
      ],
      [
        400,
        { type: "error", error: { type: "invalid_request_error", message: "bad" } },
        "bad_request",
      ],
      [401, { type: "error", error: { type: "authentication_error", message: "no" } }, "auth"],
      [529, { type: "error", error: { type: "overloaded_error", message: "busy" } }, "overloaded"],
    ];
    for (const [status, body, kind] of cases) {
      const client = new AnthropicNotesClient({
        apiKey: FAKE_KEY,
        maxRetries: 0,
        fetch: async () => apiReply(body, status),
      });
      const err = await client.write(req).catch((e: unknown) => e);
      expect(err, `HTTP ${status}`).toBeInstanceOf(NotesClientError);
      expect((err as NotesClientError).kind).toBe(kind);
      expect((err as Error).message).not.toContain(FAKE_KEY);
      expect((err as Error).message).not.toMatch(/slow down|workspace|busy/);
    }
    expect(netSpy).not.toHaveBeenCalled();
  });

  it("maps connection failures, which may have been billed", async () => {
    const client = new AnthropicNotesClient({
      apiKey: FAKE_KEY,
      maxRetries: 0,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const err = (await client.write(req).catch((e: unknown) => e)) as NotesClientError;
    expect(err.kind).toBe("network");
    expect(err.maybeBilled).toBe(true);
    expect(toNotesError(new APIConnectionTimeoutError()).kind).toBe("timeout");
  });

  it("sends exactly 1 HTTP request per write, even when that request fails", async () => {
    // The spend ledger reserves one worst-case call per write(). An SDK retry would be a second
    // billed request the ledger never counted.
    for (const respond of [
      async () =>
        apiReply({ type: "error", error: { type: "overloaded_error", message: "busy" } }, 529),
      async () => apiReply({ type: "error", error: { type: "api_error", message: "x" } }, 500),
      async (): Promise<Response> => {
        throw new TypeError("fetch failed");
      },
    ]) {
      let calls = 0;
      const client = new AnthropicNotesClient({
        apiKey: FAKE_KEY,
        fetch: async () => {
          calls++;
          return respond();
        },
      });
      await expect(client.write(req)).rejects.toBeInstanceOf(NotesClientError);
      expect(calls).toBe(1);
    }
    expect(netSpy).not.toHaveBeenCalled();
  });

  it("needs a key and is only built from env when one is set", () => {
    expect(() => new AnthropicNotesClient({ apiKey: "  " })).toThrow(/needs an API key/);
    expect(notesClientFromEnv({})).toBeNull();
    expect(notesClientFromEnv({ ANTHROPIC_API_KEY: " " })).toBeNull();
    const c = notesClientFromEnv({ ANTHROPIC_API_KEY: FAKE_KEY });
    expect(c).toBeInstanceOf(AnthropicNotesClient);
    expect(c!.fake).toBe(false);
    expect(c!.model).toBe(MODEL_ID);
  });
});

describe("FakeNotesClient", () => {
  it("records requests and never touches the network", async () => {
    const fake = new FakeNotesClient();
    const reply = await fake.write(req);
    expect(fake.fake).toBe(true);
    expect(fake.model).toBe("fake-notes-client");
    expect(fake.calls).toEqual([req]);
    expect(reply.notes).toEqual([
      { finding_id: "gain-1", text: "T1 gains 0.406 s on the brakes, 67 m later than BBB." },
    ]);
    expect(netSpy).not.toHaveBeenCalled();
  });

  it("scripts errors and refuses Formula 1 insights too", async () => {
    const fake = new FakeNotesClient(() => new NotesClientError("timeout", null, true));
    await expect(fake.write(req)).rejects.toMatchObject({ kind: "timeout" });
    await expect(new FakeNotesClient(fakeWriter).write(f1Req)).rejects.toMatchObject({
      kind: "not_allowed",
    });
  });
});

describe("parseNotes", () => {
  it("accepts only the notes object", () => {
    expect(parseNotes('{"notes":[{"finding_id":"gain-1","text":"x"}]}')).toEqual([
      { finding_id: "gain-1", text: "x" },
    ]);
    expect(parseNotes('{"notes":[{"finding_id":1,"text":"x"}]}')).toBeNull();
    expect(parseNotes('{"notes":"x"}')).toBeNull();
    expect(parseNotes("[]")).toBeNull();
    expect(parseNotes("{")).toBeNull();
  });
});
