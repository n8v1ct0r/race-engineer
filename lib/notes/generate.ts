// The notes pipeline for one comparison. Server only. Failure policy (docs/phase-1-plan.md
// section 6): at most 2 model calls; validate every note; 1 retry with the errors; then a
// template per failed note. Infrastructure failures return templates and are never cached.

import "./server-only.ts";
import type { Comparison } from "../analysis/index.ts";
import { cacheKey, NOTES_RECORD_SCHEMA, type NotesCache, type NotesRecord } from "./cache.ts";
import { toNotesError, type NotesClient, type NotesReply } from "./client.ts";
import { buildInsight, modelAllowed, type Insight } from "./insight.ts";
import {
  costMicroUsd,
  microToUsd,
  worstCaseCallMicroUsd,
  type RateLimiter,
  type SpendLedger,
  type SpentOut,
} from "./limits.ts";
import { MAX_TOKENS, NOTES_SCHEMA, PROMPT_VERSION, SYSTEM_PROMPT, userMessage } from "./prompt.ts";
import { templateNotes, type Note, type NotesResponse, type TemplateReason } from "./template.ts";
import { checkNote, checkNotes, VALIDATOR_VERSION, type FailedNote } from "./validate.ts";

/** Per-instance state shared by every request. */
export type NotesState = {
  limiter: RateLimiter;
  ledger: SpendLedger;
  spentOut: SpentOut;
  cache: NotesCache;
};

/** One log line per model call or skipped call. Never holds an IP, the key or SDK text. */
export type NotesLogEvent = {
  event: "notes_call" | "notes_skip" | "notes_cache_hit";
  key: string;
  model: string;
  attempt?: number;
  reason?: TemplateReason | "stop_reason";
  error_kind?: string;
  http_status?: number | null;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  failed_notes?: number;
  errors?: string[];
};

export type GenerateInput = {
  comparison: Comparison;
  pair: { session_id: string; a: string; b: string };
  /** null when ANTHROPIC_API_KEY is not set. */
  client: NotesClient | null;
  /** NOTES_ENABLED kill switch. */
  enabled: boolean;
  ip: string;
  /** analysis-config.json notes.max_chars. */
  maxChars: number;
  state: NotesState;
  now: () => number;
  log?: (e: NotesLogEvent) => void;
};

function asNotes(c: Comparison): Map<string, Note> {
  return new Map(
    templateNotes(c).map((t) => [
      t.finding_id,
      { finding_id: t.finding_id, text: t.text, source: "template" },
    ]),
  );
}

function orderedNotes(
  insight: Insight,
  model: Map<string, string>,
  tpl: Map<string, Note>,
): Note[] {
  return insight.findings.map((f) => {
    const text = model.get(f.id);
    return text === undefined ? tpl.get(f.id)! : { finding_id: f.id, text, source: "model" };
  });
}

/** Stored notes pass the current validator again (free); a note that fails becomes a template. */
function fromRecord(
  rec: NotesRecord,
  insight: Insight,
  tpl: Map<string, Note>,
  maxChars: number,
): Note[] {
  const model = new Map<string, string>();
  for (const n of rec.notes) {
    if (n.source !== "model" || !insight.findings.some((f) => f.id === n.finding_id)) continue;
    if (checkNote(insight, n.finding_id, n.text, maxChars).ok) model.set(n.finding_id, n.text);
  }
  return orderedNotes(insight, model, tpl);
}

export async function generateNotes(input: GenerateInput): Promise<NotesResponse> {
  const { comparison: c, client, state, now, maxChars } = input;
  const log = input.log ?? (() => {});
  const tpl = asNotes(c);
  const templatesOnly = (reason: TemplateReason): NotesResponse => ({
    notes: [...tpl.values()],
    cached: false,
    template_reason: reason,
  });

  if (c.findings.length === 0) return { notes: [], cached: false, template_reason: null };
  const insight = buildInsight(c);
  // Decision D1. The route refuses these first; this is the second lock.
  if (!modelAllowed(insight.origins)) {
    throw new Error("Notes pipeline called for laps a model may not see.");
  }
  if (!input.enabled) return templatesOnly("disabled");
  if (client === null) return templatesOnly("no_key");

  const key = cacheKey(insight, client.model);
  const skip = (reason: TemplateReason): NotesResponse => {
    log({ event: "notes_skip", key: key.slice(0, 12), model: client.model, reason });
    return templatesOnly(reason);
  };
  const hit = state.cache.get(key);
  if (hit !== null) {
    log({ event: "notes_cache_hit", key: key.slice(0, 12), model: client.model });
    return { notes: fromRecord(hit, insight, tpl, maxChars), cached: true, template_reason: null };
  }
  if (state.spentOut.active(now())) return skip("spend_cap");
  if (!state.limiter.take(input.ip, now())) return skip("rate_limited");

  const accepted = new Map<string, string>();
  let pending = insight.findings.map((f) => f.id);
  let feedback: FailedNote[] = [];
  let usage = { input_tokens: 0, output_tokens: 0 };
  let costMicro = 0;
  let infraFailed = false;

  for (let attempt = 1; attempt <= 2 && pending.length > 0; attempt++) {
    const chars =
      SYSTEM_PROMPT.length +
      userMessage(insight, pending, feedback).length +
      JSON.stringify(NOTES_SCHEMA).length;
    const reserved = worstCaseCallMicroUsd(chars, MAX_TOKENS);
    const rid = state.ledger.reserve(reserved, now());
    if (rid === null) {
      if (attempt === 1) return skip("spend_cap");
      break; // no money for the retry: failed notes become templates
    }
    let reply: NotesReply;
    try {
      reply = await client.write({ insight, ids: pending, feedback });
    } catch (e) {
      const err = toNotesError(e);
      if (err.maybeBilled) state.ledger.settle(rid, reserved, now());
      else state.ledger.release(rid, now());
      if (err.kind === "spend_limit") state.spentOut.trip(now());
      log({
        event: "notes_call",
        key: key.slice(0, 12),
        model: client.model,
        attempt,
        reason: "model_error",
        error_kind: err.kind,
        http_status: err.status,
      });
      if (attempt === 1) return templatesOnly("model_error");
      infraFailed = true;
      break;
    }
    const cost = costMicroUsd(reply.usage);
    state.ledger.settle(rid, cost, now());
    costMicro += cost;
    usage = {
      input_tokens: usage.input_tokens + reply.usage.input_tokens,
      output_tokens: usage.output_tokens + reply.usage.output_tokens,
    };
    const check = checkNotes(insight, pending, reply, maxChars);
    for (const [id, text] of check.accepted) accepted.set(id, text);
    feedback = check.failed;
    pending = check.failed.map((f) => f.finding_id);
    log({
      event: "notes_call",
      key: key.slice(0, 12),
      model: client.model,
      attempt,
      ...(reply.stop_reason === "end_turn" ? {} : { reason: "stop_reason" as const }),
      input_tokens: reply.usage.input_tokens,
      output_tokens: reply.usage.output_tokens,
      cost_usd: microToUsd(cost),
      failed_notes: check.failed.length,
      errors: check.failed.flatMap((f) => f.errors.map((m) => `${f.finding_id}: ${m}`)),
    });
  }

  const notes = orderedNotes(insight, accepted, tpl);
  if (!infraFailed) {
    state.cache.set({
      schema: NOTES_RECORD_SCHEMA,
      key,
      model: client.model,
      prompt_version: PROMPT_VERSION,
      validator_version: VALIDATOR_VERSION,
      session_id: input.pair.session_id,
      a: input.pair.a,
      b: input.pair.b,
      notes,
      usage: { ...usage, cost_usd: microToUsd(costMicro) },
    });
  }
  return { notes, cached: false, template_reason: null };
}
