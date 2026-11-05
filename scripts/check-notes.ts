// Note check (acceptance criterion 3): every number in a note must be a display string of the
// insight it was written from.
//
//   node scripts/check-notes.ts                   check every notes record and template set
//   node scripts/check-notes.ts --write-fixtures  rewrite fixtures/notes/ first, then check
//   node scripts/check-notes.ts DIR ...           read cache records from DIR instead of .cache/notes
//
// Records checked: fixtures/notes/*.json (committed), .cache/notes/*.json (development cache),
// template notes rebuilt for every ordered lap pair of public/demo, and template notes for each
// public/data session's default pair when public/data exists. For each record the script rebuilds
// the insight from the lap files and reports every number token in a note that is not a display
// string of that note's finding or of the lap. Exits 1 on any missing number or broken record.
//
// Output for Formula 1 sessions is counted but never printed, so no Formula 1 derived number is
// echoed into a log that a model might read (decision D1).
//
// --write-fixtures writes, per ordered public/demo pair, one record from FakeNotesClient (labelled
// fake; it is not model output) and one record of template notes. It never writes public/data.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzePair,
  type AnalysisConfig,
  type Comparison,
  type Lap,
  type Origin,
  type Track,
} from "../lib/analysis/index.ts";
import { cacheKey, NOTES_RECORD_SCHEMA, NotesCache } from "../lib/notes/cache.ts";
import { FakeNotesClient } from "../lib/notes/client.ts";
import { generateNotes } from "../lib/notes/generate.ts";
import { buildInsight, MODEL_ORIGINS, type Insight } from "../lib/notes/insight.ts";
import { RateLimiter, SpendLedger, SpentOut } from "../lib/notes/limits.ts";
import { PROMPT_VERSION } from "../lib/notes/prompt.ts";
import { templateNotes, type Note } from "../lib/notes/template.ts";
import { missingNumbers, tokenize, VALIDATOR_VERSION } from "../lib/notes/validate.ts";

const repo = fileURLToPath(new URL("../", import.meta.url));
const FIXTURES = join(repo, "fixtures", "notes");
const args = process.argv.slice(2);
const CACHE_DIRS = args.some((x) => !x.startsWith("--"))
  ? args.filter((x) => !x.startsWith("--")).map((x) => resolve(x))
  : [join(repo, ".cache", "notes")];
const ROOTS = ["demo", "data"] as const;

const config = readJson(join(repo, "analysis-config.json")) as AnalysisConfig;
const maxChars = config.notes?.max_chars;
if (maxChars === undefined) throw new Error("analysis-config.json has no notes.max_chars");

type Session = {
  root: (typeof ROOTS)[number];
  session_id: string;
  origin: Origin;
  lapIds: string[];
  default_pair: { a: string; b: string } | null;
};

type AnyRecord = {
  kind?: string;
  key?: string;
  model?: string;
  prompt_version?: string;
  session_id?: unknown;
  a?: unknown;
  b?: unknown;
  notes?: unknown;
};

const failures: string[] = [];
const totals = {
  fixtureRecords: 0,
  cacheRecords: 0,
  cacheStale: 0,
  templateSets: 0,
  notes: 0,
  numbers: 0,
  missing: 0,
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function loadSessions(): Map<string, Session> {
  const out = new Map<string, Session>();
  for (const root of ROOTS) {
    const path = join(repo, "public", root, "manifest.json");
    if (!existsSync(path)) continue;
    const m = readJson(path) as {
      sessions: {
        session_id: string;
        origin: Origin;
        default_pair?: { a: string; b: string } | null;
        drivers: { laps: { lap_id: string }[] }[];
      }[];
    };
    for (const s of m.sessions) {
      out.set(s.session_id, {
        root,
        session_id: s.session_id,
        origin: s.origin,
        lapIds: s.drivers.flatMap((d) => d.laps.map((l) => l.lap_id)),
        default_pair: s.default_pair ?? null,
      });
    }
  }
  return out;
}

const sessions = loadSessions();
const comparisons = new Map<string, Comparison>();

function comparison(s: Session, a: string, b: string): Comparison {
  const id = `${s.session_id}/${a}/${b}`;
  const hit = comparisons.get(id);
  if (hit !== undefined) return hit;
  const dir = join(repo, "public", s.root, s.session_id);
  const trackPath = join(dir, "track.json");
  const track = existsSync(trackPath) ? (readJson(trackPath) as Track) : null;
  const lapA = readJson(join(dir, "laps", `${a}.json`)) as Lap;
  const lapB = readJson(join(dir, "laps", `${b}.json`)) as Lap;
  const c = analyzePair(lapA, lapB, track, config);
  comparisons.set(id, c);
  return c;
}

const hidden = (s: Session) => !MODEL_ORIGINS.includes(s.origin);

/** Checks the numbers of every note against its own finding and records any failure. */
function checkNoteSet(where: string, s: Session, insight: Insight, notes: Note[]): void {
  for (const n of notes) {
    totals.notes++;
    if (!insight.findings.some((f) => f.id === n.finding_id)) {
      failures.push(`${where}: note for unknown finding ${JSON.stringify(n.finding_id)}`);
      continue;
    }
    totals.numbers += tokenize(n.text).numbers.length;
    const missing = missingNumbers(insight, n.finding_id, n.text);
    totals.missing += missing.length;
    if (missing.length === 0) continue;
    const detail = hidden(s)
      ? `${missing.length} number(s) [Formula 1 output hidden]`
      : `${missing.map((m) => JSON.stringify(m)).join(", ")} in ${JSON.stringify(n.text)}`;
    failures.push(`${where} ${n.finding_id}: not in insight: ${detail}`);
  }
}

function isNoteList(x: unknown): x is Note[] {
  return (
    Array.isArray(x) &&
    x.every(
      (n) =>
        typeof n === "object" &&
        n !== null &&
        typeof (n as Note).finding_id === "string" &&
        typeof (n as Note).text === "string",
    )
  );
}

function checkRecordFile(path: string, fromCache: boolean): void {
  const where = relative(repo, path);
  let rec: AnyRecord;
  try {
    rec = readJson(path) as AnyRecord;
  } catch {
    failures.push(`${where}: not valid JSON`);
    return;
  }
  if (fromCache) totals.cacheRecords++;
  else totals.fixtureRecords++;
  const { session_id, a, b, notes } = rec;
  if (typeof session_id !== "string" || typeof a !== "string" || typeof b !== "string") {
    failures.push(`${where}: missing session_id, a or b`);
    return;
  }
  if (!isNoteList(notes)) {
    failures.push(`${where}: notes is not a list of {finding_id, text}`);
    return;
  }
  const s = sessions.get(session_id);
  if (s === undefined || !s.lapIds.includes(a) || !s.lapIds.includes(b)) {
    if (fromCache) totals.cacheStale++;
    else failures.push(`${where}: ${session_id} ${a} vs ${b} is not in any manifest`);
    return;
  }
  if (hidden(s) && notes.some((n) => (n as Note).source === "model")) {
    failures.push(`${where}: model notes for a ${s.origin} session break decision D1`);
  }
  const insight = buildInsight(comparison(s, a, b));
  if (typeof rec.key === "string" && typeof rec.model === "string") {
    const key = cacheKey(insight, rec.model);
    if (rec.prompt_version !== PROMPT_VERSION || rec.key !== key) {
      if (fromCache) {
        totals.cacheStale++; // an old cache entry is never served; nothing to check
        return;
      }
      failures.push(`${where}: stale record, run node scripts/check-notes.ts --write-fixtures`);
    }
  }
  checkNoteSet(where, s, insight, notes);
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

function orderedPairs(ids: string[]): [string, string][] {
  return ids.flatMap((a) => ids.filter((b) => b !== a).map((b): [string, string] => [a, b]));
}

async function writeFixtures(): Promise<number> {
  mkdirSync(FIXTURES, { recursive: true });
  let written = 0;
  for (const s of sessions.values()) {
    // Committed fixtures come from the synthetic demo only; never from public/data.
    if (s.root !== "demo" || hidden(s)) continue;
    for (const [a, b] of orderedPairs(s.lapIds)) {
      const c = comparison(s, a, b);
      const fake = new FakeNotesClient();
      const res = await generateNotes({
        comparison: c,
        pair: { session_id: s.session_id, a, b },
        client: fake,
        enabled: true,
        ip: "fixture",
        maxChars: maxChars!,
        state: {
          limiter: new RateLimiter(),
          ledger: new SpendLedger(Number.MAX_SAFE_INTEGER),
          spentOut: new SpentOut(),
          cache: new NotesCache(),
        },
        now: () => 0,
      });
      const base = `${s.session_id}.${a}.${b}`;
      const fakeRecord = {
        schema: NOTES_RECORD_SCHEMA,
        kind: "fake-model",
        fake: true,
        generator: "FakeNotesClient via scripts/check-notes.ts --write-fixtures. Not model output.",
        key: cacheKey(buildInsight(c), fake.model),
        model: fake.model,
        prompt_version: PROMPT_VERSION,
        validator_version: VALIDATOR_VERSION,
        session_id: s.session_id,
        a,
        b,
        notes: res.notes,
        usage: null,
      };
      const templateRecord = {
        schema: NOTES_RECORD_SCHEMA,
        kind: "template",
        generator: "templateNotes via scripts/check-notes.ts --write-fixtures.",
        session_id: s.session_id,
        a,
        b,
        notes: templateNotes(c).map((t) => ({
          finding_id: t.finding_id,
          text: t.text,
          source: t.source,
        })),
      };
      writeFileSync(
        join(FIXTURES, `${base}.fake.json`),
        JSON.stringify(fakeRecord, null, 2) + "\n",
      );
      writeFileSync(
        join(FIXTURES, `${base}.template.json`),
        JSON.stringify(templateRecord, null, 2) + "\n",
      );
      written += 2;
    }
  }
  return written;
}

async function main(): Promise<void> {
  if (args.includes("--write-fixtures")) {
    const n = await writeFixtures();
    console.log(`wrote ${n} fixture records to fixtures/notes/`);
  }
  for (const path of jsonFiles(FIXTURES)) checkRecordFile(path, false);
  for (const dir of CACHE_DIRS) for (const path of jsonFiles(dir)) checkRecordFile(path, true);

  let demoSets = 0;
  let dataSets = 0;
  for (const s of sessions.values()) {
    const pairs =
      s.root === "demo"
        ? orderedPairs(s.lapIds)
        : s.default_pair === null
          ? []
          : [[s.default_pair.a, s.default_pair.b] as [string, string]];
    for (const [a, b] of pairs) {
      const c = comparison(s, a, b);
      const notes: Note[] = templateNotes(c).map((t) => ({ ...t }));
      checkNoteSet(`templates ${s.session_id} ${a} vs ${b}`, s, buildInsight(c), notes);
      totals.templateSets++;
      if (s.root === "demo") demoSets++;
      else dataSets++;
    }
  }

  console.log(
    `records: ${totals.fixtureRecords} fixture, ${totals.cacheRecords} dev cache ` +
      `(${totals.cacheStale} stale, skipped); template sets: ${totals.templateSets} ` +
      `(demo ${demoSets}, data ${dataSets}${existsSync(join(repo, "public", "data")) ? "" : ", public/data not present"})`,
  );
  console.log(
    `notes: ${totals.notes}; number tokens: ${totals.numbers}; missing from insight: ${totals.missing}`,
  );
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL ${f}`);
    console.error(`${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log("all notes cite only insight display strings");
}

await main();
