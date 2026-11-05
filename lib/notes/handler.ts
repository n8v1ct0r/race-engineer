// Handler for POST /api/notes (docs/contracts.md section 6). Server only. app/api/notes/route.ts
// wires it to real files and env; tests call it with in-memory files and FakeNotesClient.
// The body holds ids only. The server loads the laps itself and never accepts insight JSON.

import "./server-only.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  analyzePair,
  type AnalysisConfig,
  type Lap,
  type Origin,
  type Track,
} from "../analysis/index.ts";
import { cacheDirFor, NotesCache } from "./cache.ts";
import { notesClientFromEnv, type NotesClient } from "./client.ts";
import { generateNotes, type NotesLogEvent, type NotesState } from "./generate.ts";
import { MODEL_ORIGINS } from "./insight.ts";
import {
  clientIp,
  dailyCapMicroUsd,
  notesEnabled,
  RateLimiter,
  SpendLedger,
  SpentOut,
} from "./limits.ts";
import type { NotesErrorResponse, NotesResponse } from "./template.ts";

/** Ids are checked against the manifest; this pattern also keeps them safe inside a file path. */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** The largest body read, in bytes. A longer body is a 413, found without buffering it. */
export const MAX_BODY_BYTES = 2048;
const DATA_ROOTS = ["demo", "data"] as const;
const ORIGINS: readonly Origin[] = ["fastf1", "synthetic", "photoncar"];

/** Every message a caller can see. Plain copy (docs/contracts.md section 7). */
export const MESSAGES = {
  bad_request: "Send a session_id and two lap ids, a and b, and nothing else.",
  too_large: "The request body is too large.",
  same_lap: "Pick two different laps.",
  not_found: "That session or lap is not in the lap files.",
  different_track: "These laps are from different tracks.",
  model_not_allowed:
    "Claude writes notes only for synthetic and Photoncar laps. Formula 1 laps get notes written by code.",
  server_error: "Notes are not available right now.",
} as const;

type ErrorCode = keyof typeof MESSAGES;

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  too_large: 413,
  same_lap: 400,
  not_found: 404,
  different_track: 400,
  model_not_allowed: 403,
  server_error: 500,
};

export type NotesEnv = {
  ANTHROPIC_API_KEY?: string;
  NOTES_ENABLED?: string;
  NOTES_DAILY_SPEND_CAP_USD?: string;
  NODE_ENV?: string;
  /** "1" on Vercel, whose edge overwrites the client IP headers. */
  VERCEL?: string;
};

export type NotesDeps = {
  config: AnalysisConfig;
  /** A parsed JSON file under public/, or undefined when the file does not exist. */
  readPublicJson: (relPath: string) => Promise<unknown>;
  /** NOTES_ENABLED, read per request. */
  enabled: () => boolean;
  /** The notes client, or null when there is no API key. */
  client: () => NotesClient | null;
  state: NotesState;
  now: () => number;
  log?: (e: NotesLogEvent) => void;
  /** True on Vercel: trust its IP headers. Otherwise the proxy-appended hop is used. */
  onVercel?: boolean;
};

export type PairIds = { session_id: string; a: string; b: string };

const headers = { "Cache-Control": "no-store" };

function fail(code: ErrorCode): Response {
  const body: NotesErrorResponse = { error: code, message: MESSAGES[code] };
  return Response.json(body, { status: STATUS[code], headers });
}

class Refusal extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
  }
}

/**
 * The body as text, reading at most MAX_BODY_BYTES. A Content-Length over the cap is refused
 * before any byte is read, and a longer stream is cancelled as soon as it passes the cap, so an
 * upload of any size never sits in memory.
 */
export async function readBody(request: Request): Promise<string> {
  const declared = (request.headers.get("content-length") ?? "").trim();
  if (/^\d+$/.test(declared) && Number(declared) > MAX_BODY_BYTES) throw new Refusal("too_large");
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Refusal("too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** The body must be exactly { session_id, a, b }, each an id string. */
export function parseBody(text: string): PairIds {
  if (text.length > MAX_BODY_BYTES) throw new Refusal("too_large");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Refusal("bad_request");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Refusal("bad_request");
  }
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.join(",") !== "a,b,session_id") throw new Refusal("bad_request");
  const { session_id, a, b } = obj;
  for (const v of [session_id, a, b]) {
    if (typeof v !== "string" || !ID_RE.test(v)) throw new Refusal("bad_request");
  }
  if (a === b) throw new Refusal("same_lap");
  return { session_id: session_id as string, a: a as string, b: b as string };
}

type SessionEntry = {
  session_id: string;
  origin: Origin;
  drivers: { laps: { lap_id: string }[] }[];
};

function sessionsOf(manifest: unknown): SessionEntry[] {
  if (typeof manifest !== "object" || manifest === null) return [];
  const sessions = (manifest as { sessions?: unknown }).sessions;
  return Array.isArray(sessions) ? (sessions as SessionEntry[]) : [];
}

function isLap(x: unknown): x is Lap {
  if (typeof x !== "object" || x === null) return false;
  const lap = x as Partial<Lap>;
  return (
    typeof lap.origin === "string" &&
    ORIGINS.includes(lap.origin) &&
    typeof lap.track_id === "string" &&
    typeof lap.samples === "object" &&
    lap.samples !== null
  );
}

/** Loads the pair from the lap files, refusing Formula 1 laps before any lap file is read. */
async function loadPair(
  ids: PairIds,
  deps: NotesDeps,
): Promise<{ a: Lap; b: Lap; track: Track | null }> {
  for (const root of DATA_ROOTS) {
    const session = sessionsOf(await deps.readPublicJson(`${root}/manifest.json`)).find(
      (s) => s.session_id === ids.session_id,
    );
    if (session === undefined) continue;
    // Decision D1: Claude never sees Formula 1 derived numbers.
    if (!MODEL_ORIGINS.includes(session.origin)) throw new Refusal("model_not_allowed");
    const lapIds = new Set(
      (session.drivers ?? []).flatMap((d) => (d.laps ?? []).map((l) => l.lap_id)),
    );
    if (!lapIds.has(ids.a) || !lapIds.has(ids.b)) throw new Refusal("not_found");
    const dir = `${root}/${ids.session_id}`;
    const a = await deps.readPublicJson(`${dir}/laps/${ids.a}.json`);
    const b = await deps.readPublicJson(`${dir}/laps/${ids.b}.json`);
    if (a === undefined || b === undefined) throw new Refusal("not_found");
    if (!isLap(a) || !isLap(b)) throw new Error("lap file does not match the lap schema");
    // Second lock on D1: the lap files themselves must allow a model.
    if (!MODEL_ORIGINS.includes(a.origin) || !MODEL_ORIGINS.includes(b.origin)) {
      throw new Refusal("model_not_allowed");
    }
    if (a.track_id !== b.track_id) throw new Refusal("different_track");
    const track = await deps.readPublicJson(`${dir}/track.json`);
    return { a, b, track: track === undefined ? null : (track as Track) };
  }
  throw new Refusal("not_found");
}

export async function handleNotesRequest(request: Request, deps: NotesDeps): Promise<Response> {
  try {
    const ids = parseBody(await readBody(request));
    const pair = await loadPair(ids, deps);
    const maxChars = deps.config.notes?.max_chars;
    if (maxChars === undefined) throw new Error("analysis-config.json has no notes.max_chars");
    const comparison = analyzePair(pair.a, pair.b, pair.track, deps.config);
    const res: NotesResponse = await generateNotes({
      comparison,
      pair: ids,
      client: deps.client(),
      enabled: deps.enabled(),
      ip: clientIp(request.headers, deps.onVercel === true),
      maxChars,
      state: deps.state,
      now: deps.now,
      ...(deps.log === undefined ? {} : { log: deps.log }),
    });
    return Response.json(res, { status: 200, headers });
  } catch (e) {
    if (e instanceof Refusal) return fail(e.code);
    // Generic shape only: never the SDK error, a stack or the key.
    console.error("notes route failed:", e instanceof Error ? e.name : "unknown error");
    return fail("server_error");
  }
}

/** Real files, real env, one client per key and one state per instance, for the route. */
export function routeNotesDeps(
  config: AnalysisConfig,
  env: NotesEnv,
  root: string = process.cwd(),
): NotesDeps {
  const publicDir = join(root, "public");
  let memo: { key: string; client: NotesClient | null } | null = null;
  return {
    config,
    readPublicJson: async (rel) => {
      try {
        return JSON.parse(await readFile(join(publicDir, rel), "utf8")) as unknown;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw e;
      }
    },
    enabled: () => notesEnabled(env.NOTES_ENABLED),
    client: () => {
      const key = env.ANTHROPIC_API_KEY ?? "";
      if (memo === null || memo.key !== key) memo = { key, client: notesClientFromEnv(env) };
      return memo.client;
    },
    state: {
      limiter: new RateLimiter(),
      ledger: new SpendLedger(dailyCapMicroUsd(env.NOTES_DAILY_SPEND_CAP_USD)),
      spentOut: new SpentOut(),
      cache: new NotesCache({ dir: cacheDirFor(env, root) }),
    },
    now: () => Date.now(),
    log: (e) => console.info(JSON.stringify(e)),
    onVercel: env.VERCEL === "1",
  };
}
