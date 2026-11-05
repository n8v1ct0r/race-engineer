// Notes cache. Server only. Key = sha256 of the canonical insight + model id + prompt version, so
// a change to any display string, the model or the prompt makes a new key. Layers: an in-memory
// LRU per instance, plus .cache/notes/<key>.json (gitignored) in development only.

import "./server-only.ts";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Usage } from "./client.ts";
import { canonicalJson, type Insight } from "./insight.ts";
import { PROMPT_VERSION } from "./prompt.ts";
import type { Note } from "./template.ts";

export const NOTES_RECORD_SCHEMA = "race-engineer.notes/v1";

export function cacheKey(
  insight: Insight,
  modelId: string,
  promptVersion = PROMPT_VERSION,
): string {
  return createHash("sha256")
    .update(canonicalJson(insight) + "\n" + modelId + "\n" + promptVersion)
    .digest("hex");
}

/** One stored note set. check-notes.ts rebuilds the insight from session_id, a and b. */
export type NotesRecord = {
  schema: typeof NOTES_RECORD_SCHEMA;
  key: string;
  model: string;
  prompt_version: string;
  validator_version: string;
  session_id: string;
  a: string;
  b: string;
  notes: Note[];
  usage: (Usage & { cost_usd: number }) | null;
};

export type NotesCacheOptions = {
  maxEntries?: number;
  /** Directory for the file layer, or null to keep the cache in memory only. */
  dir?: string | null;
};

const KEY_RE = /^[0-9a-f]{64}$/;

export class NotesCache {
  readonly maxEntries: number;
  readonly dir: string | null;
  readonly #mem = new Map<string, NotesRecord>();

  constructor(opts: NotesCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 200;
    this.dir = opts.dir ?? null;
  }

  get(key: string): NotesRecord | null {
    const hit = this.#mem.get(key);
    if (hit !== undefined) {
      this.#mem.delete(key);
      this.#mem.set(key, hit); // most recently used last
      return hit;
    }
    const fromFile = this.#readFile(key);
    if (fromFile !== null) this.#remember(fromFile);
    return fromFile;
  }

  set(record: NotesRecord): void {
    this.#remember(record);
    this.#writeFile(record);
  }

  get size(): number {
    return this.#mem.size;
  }

  #remember(record: NotesRecord): void {
    this.#mem.delete(record.key);
    this.#mem.set(record.key, record);
    while (this.#mem.size > this.maxEntries) {
      const oldest = this.#mem.keys().next().value;
      if (oldest === undefined) break;
      this.#mem.delete(oldest);
    }
  }

  #readFile(key: string): NotesRecord | null {
    if (this.dir === null || !KEY_RE.test(key)) return null;
    try {
      const rec = JSON.parse(readFileSync(join(this.dir, `${key}.json`), "utf8")) as NotesRecord;
      return rec.schema === NOTES_RECORD_SCHEMA && rec.key === key ? rec : null;
    } catch {
      return null;
    }
  }

  #writeFile(record: NotesRecord): void {
    if (this.dir === null || !KEY_RE.test(record.key)) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      const path = join(this.dir, `${record.key}.json`);
      writeFileSync(`${path}.tmp`, JSON.stringify(record, null, 2) + "\n");
      renameSync(`${path}.tmp`, path);
    } catch {
      // The file layer is a development convenience; memory still holds the record.
    }
  }
}

/** The file layer runs only when NODE_ENV is development. */
export function cacheDirFor(env: { NODE_ENV?: string }, root: string): string | null {
  return env.NODE_ENV === "development" ? join(root, ".cache", "notes") : null;
}
