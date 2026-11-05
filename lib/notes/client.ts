// Notes clients. Server only. AnthropicNotesClient is the one real client; FakeNotesClient is for
// tests and for the labelled fake fixtures in fixtures/notes/, and never runs in the route.

import "./server-only.ts";
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { modelAllowed, type Insight, type InsightFinding } from "./insight.ts";
import {
  MAX_RETRIES,
  MAX_TOKENS,
  MODEL_ID,
  NOTES_SCHEMA,
  SYSTEM_PROMPT,
  TEMPERATURE,
  TIMEOUT_MS,
  userMessage,
} from "./prompt.ts";
import type { FailedNote, RawNotes } from "./validate.ts";

export type NotesRequest = {
  insight: Insight;
  /** The finding ids to write, in insight order. */
  ids: string[];
  /** Failed notes and their validator errors, on the single retry. */
  feedback?: FailedNote[];
};

export type Usage = { input_tokens: number; output_tokens: number };

export type NotesReply = RawNotes & { usage: Usage };

export interface NotesClient {
  /** Model id; part of the cache key. */
  readonly model: string;
  /** True only for FakeNotesClient. */
  readonly fake: boolean;
  write(req: NotesRequest): Promise<NotesReply>;
}

export type NotesErrorKind =
  | "not_allowed"
  | "timeout"
  | "network"
  | "rate_limited"
  | "overloaded"
  | "spend_limit"
  | "auth"
  | "bad_request"
  | "unknown";

/** The only error a notes client throws. Its message never carries SDK text or the key. */
export class NotesClientError extends Error {
  readonly kind: NotesErrorKind;
  readonly status: number | null;
  /** The call may have been billed (the outcome is unknown), so the ledger keeps the reservation. */
  readonly maybeBilled: boolean;

  constructor(kind: NotesErrorKind, status: number | null, maybeBilled: boolean) {
    super(`notes client error: ${kind}${status === null ? "" : ` (HTTP ${status})`}`);
    this.name = "NotesClientError";
    this.kind = kind;
    this.status = status;
    this.maybeBilled = maybeBilled;
  }
}

/** Parse the structured output text. null when it is not the notes object. */
export function parseNotes(text: string): RawNotes["notes"] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const notes = (data as { notes?: unknown }).notes;
  if (!Array.isArray(notes)) return null;
  const out: { finding_id: string; text: string }[] = [];
  for (const n of notes) {
    if (typeof n !== "object" || n === null) return null;
    const { finding_id, text: t } = n as { finding_id?: unknown; text?: unknown };
    if (typeof finding_id !== "string" || typeof t !== "string") return null;
    out.push({ finding_id, text: t });
  }
  return out;
}

/** Map any SDK failure to a NotesClientError. Most specific class first. */
export function toNotesError(e: unknown): NotesClientError {
  if (e instanceof NotesClientError) return e;
  if (e instanceof APIConnectionTimeoutError) return new NotesClientError("timeout", null, true);
  if (e instanceof APIConnectionError) return new NotesClientError("network", null, true);
  if (e instanceof RateLimitError) {
    // The tier spend cap arrives as a 429 with error_code enforced_spend_limit_reached.
    const spent = JSON.stringify(e.error ?? null).includes("enforced_spend_limit_reached");
    return new NotesClientError(spent ? "spend_limit" : "rate_limited", 429, false);
  }
  if (e instanceof BadRequestError) {
    // A workspace spend limit set in the Console arrives as this 400.
    const spent = e.message.includes("workspace API usage limits");
    return new NotesClientError(spent ? "spend_limit" : "bad_request", 400, false);
  }
  if (e instanceof AuthenticationError || e instanceof PermissionDeniedError) {
    return new NotesClientError("auth", e.status, false);
  }
  if (e instanceof InternalServerError) return new NotesClientError("overloaded", e.status, false);
  if (e instanceof APIError) return new NotesClientError("unknown", e.status ?? null, false);
  return new NotesClientError("unknown", null, true);
}

export type AnthropicNotesClientOptions = {
  apiKey: string;
  /** Tests only: a fetch that never reaches the network. */
  fetch?: typeof fetch;
  /** Tests only. Production uses MAX_RETRIES. */
  maxRetries?: number;
};

/**
 * Claude through @anthropic-ai/sdk: claude-haiku-4-5-20251001, structured outputs, temperature 0,
 * max_tokens 800, timeout 20 s, no SDK retry (MAX_RETRIES is 0, so one write() is one billed
 * request and the spend ledger's one reservation covers it). The key is passed explicitly and
 * authToken is nulled, so the SDK never falls back to another credential source (an ant profile
 * or WIF).
 */
export class AnthropicNotesClient implements NotesClient {
  readonly model = MODEL_ID;
  readonly fake = false;
  readonly #sdk: Anthropic;

  constructor(opts: AnthropicNotesClientOptions) {
    const apiKey = opts.apiKey.trim();
    if (apiKey === "") throw new Error("AnthropicNotesClient needs an API key.");
    this.#sdk = new Anthropic({
      apiKey,
      authToken: null,
      timeout: TIMEOUT_MS,
      maxRetries: opts.maxRetries ?? MAX_RETRIES,
      ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
    });
  }

  async write(req: NotesRequest): Promise<NotesReply> {
    // Decision D1: Formula 1 derived numbers never leave this process for a model.
    if (!modelAllowed(req.insight.origins)) throw new NotesClientError("not_allowed", null, false);
    let msg: Anthropic.Message;
    try {
      msg = await this.#sdk.messages.create({
        model: MODEL_ID,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage(req.insight, req.ids, req.feedback) }],
        output_config: { format: { type: "json_schema", schema: NOTES_SCHEMA } },
      });
    } catch (e) {
      throw toNotesError(e);
    }
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return {
      stop_reason: msg.stop_reason,
      notes: parseNotes(text),
      usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
    };
  }
}

/** The real client when ANTHROPIC_API_KEY is set, otherwise null (the route serves templates). */
export function notesClientFromEnv(env: { ANTHROPIC_API_KEY?: string }): NotesClient | null {
  const key = (env.ANTHROPIC_API_KEY ?? "").trim();
  return key === "" ? null : new AnthropicNotesClient({ apiKey: key });
}

/** A fake reply or error for one call. `call` counts from 1. */
export type FakeResponder = (req: NotesRequest, call: number) => NotesReply | NotesClientError;

function fakeText(f: InsightFinding, other: string): string {
  const d = f.display;
  const head = `${f.corner} ${d.direction} ${d.time}`;
  if (f.cause === "braking" && d.brake_diff !== undefined && d.brake_word !== undefined) {
    return `${head} on the brakes, ${d.brake_diff} ${d.brake_word} than ${other}.`;
  }
  if (f.cause === "min_speed" && d.min_speed_a !== undefined && d.min_speed_b !== undefined) {
    return `${head}. You carry ${d.min_speed_a} at the apex, ${other} carries ${d.min_speed_b}.`;
  }
  if (
    f.cause === "exit_speed" &&
    d.exit_speed_diff !== undefined &&
    d.exit_speed_word !== undefined
  ) {
    return `${head}. Your exit speed is ${d.exit_speed_diff} ${d.exit_speed_word}.`;
  }
  return `${head}. No single cause shows in the data.`;
}

/** The default fake: deterministic notes from display strings, phrased unlike the templates. */
export const fakeWriter = (req: NotesRequest): NotesReply => ({
  stop_reason: "end_turn",
  notes: req.insight.findings
    .filter((f) => req.ids.includes(f.id))
    .map((f) => ({ finding_id: f.id, text: fakeText(f, req.insight.driver_b.code) })),
  usage: { input_tokens: 0, output_tokens: 0 },
});

/** Tests and labelled fake fixtures only. Never reaches the network; records every request. */
export class FakeNotesClient implements NotesClient {
  readonly model = "fake-notes-client";
  readonly fake = true;
  readonly calls: NotesRequest[] = [];
  readonly #respond: FakeResponder;

  constructor(respond: FakeResponder = fakeWriter) {
    this.#respond = respond;
  }

  async write(req: NotesRequest): Promise<NotesReply> {
    if (!modelAllowed(req.insight.origins)) throw new NotesClientError("not_allowed", null, false);
    this.calls.push(req);
    const r = this.#respond(req, this.calls.length);
    if (r instanceof NotesClientError) throw r;
    return r;
  }
}
