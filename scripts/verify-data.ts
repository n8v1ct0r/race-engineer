// Checks on local real data in public/data/ (docs/contracts.md section 8). Run: pnpm verify:data.
//
// 1. Validates public/data with scripts/validate-laps.ts.
// 2. For each session's default pair, runs the TS analysis (lib/analysis) and the Python
//    reference (pipeline/reference/analysis.py, spawned with python3) on the same files and
//    requires parity: exact for integers, labels, flags, ordering and display strings, 1e-9 for
//    floats (the rules of lib/analysis/parity.test.ts). Also checks that the corner rows and the
//    mini-sectors each sum to the lap gap, and that every corner label fits the grammar.
// 3. Runs scripts/check-notes.ts when that script exists. With no arguments it checks the template
//    notes of each public/data session's default pair (plus fixtures, demo pairs and the dev cache).
//
// Skips with exit 0 when public/data is absent: CI and fresh clones have no Formula 1 data.
// Prints counts and pass or fail, never telemetry values. Exits 1 on any failure.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePair, CORNER_LABEL_RE } from "../lib/analysis/index.ts";
import type { AnalysisConfig, Comparison, Lap, Track } from "../lib/analysis/index.ts";

const repo = fileURLToPath(new URL("../", import.meta.url));
const dataRoot = join(repo, "public", "data");
const manifestFile = join(dataRoot, "manifest.json");
const checkNotesScript = join(repo, "scripts", "check-notes.ts");

// Same integer fields and tolerance as lib/analysis/parity.test.ts.
const INT_KEYS = new Set([
  "delta_ms",
  "lap_gap_ms",
  "min_speed_kph",
  "exit_speed_kph",
  "brake_before_m",
  "brake_gap_m",
  "brake_diff_m",
  "min_speed_diff_kph",
  "exit_speed_diff_kph",
  "rank",
  "index",
  "corner_index",
  "duration_ms",
  "lap_no",
  "top_speed_kph",
]);
const FLOAT_TOL = 1e-9;

// The Python side: pipeline/reference/analysis.py analyze_pair() on the same four files.
const PYTHON_ANALYZE = `
import json, sys
sys.path.insert(0, sys.argv[1])
from pipeline.reference.analysis import analyze_pair
def read(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)
out = analyze_pair(read(sys.argv[2]), read(sys.argv[3]), read(sys.argv[4]), read(sys.argv[5]))
sys.stdout.write(json.dumps(out, allow_nan=False))
`;

type Stats = { floats: number; floatsBitEqual: number; ints: number; strings: number };
type ManifestSession = { session_id: string; default_pair: { a: string; b: string } };

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
  console.error(`  FAIL ${message}`);
}

/** Count of -0, NaN or infinite numbers in a raw value. Run before any JSON round trip, which
 * turns -0 into 0 and NaN into null. */
function badNumbers(value: unknown): number {
  if (typeof value === "number") return Object.is(value, -0) || !Number.isFinite(value) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + badNumbers(v), 0);
  if (value !== null && typeof value === "object") {
    return Object.values(value).reduce((n: number, v) => n + badNumbers(v), 0);
  }
  return 0;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function run(label: string, cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { cwd: repo, stdio: "inherit" });
  if (r.error) {
    fail(`${label}: could not start ${cmd} (${r.error.message})`);
    return false;
  }
  if (r.status !== 0) {
    fail(`${label}: exit ${String(r.status)}`);
    return false;
  }
  return true;
}

function compare(
  actual: unknown,
  want: unknown,
  path: string,
  key: string | null,
  stats: Stats,
  errors: string[],
): void {
  if (errors.length >= 25) return;
  if (want === null || typeof want === "boolean" || typeof want === "string") {
    if (actual !== want) errors.push(`${path}: Python ${JSON.stringify(want)}, TS differs`);
    if (typeof want === "string") stats.strings += 1;
    return;
  }
  if (typeof want === "number") {
    if (typeof actual !== "number") {
      errors.push(`${path}: Python has a number, TS has ${typeof actual}`);
      return;
    }
    const intField = key !== null && INT_KEYS.has(key);
    if (intField || (Number.isInteger(want) && Number.isInteger(actual))) {
      stats.ints += 1;
      if (!Number.isInteger(actual) || actual !== want) {
        errors.push(`${path}: integers differ`);
      }
      return;
    }
    stats.floats += 1;
    if (actual === want) stats.floatsBitEqual += 1;
    else if (!(Math.abs(actual - want) <= FLOAT_TOL)) {
      errors.push(`${path}: floats differ by ${Math.abs(actual - want)}`);
    }
    return;
  }
  if (Array.isArray(want)) {
    if (!Array.isArray(actual) || actual.length !== want.length) {
      errors.push(`${path}: array lengths differ`);
      return;
    }
    for (let i = 0; i < want.length; i++) {
      compare(actual[i], want[i], `${path}[${i}]`, null, stats, errors);
    }
    return;
  }
  if (typeof want === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      errors.push(`${path}: TS has no object here`);
      return;
    }
    const a = actual as Record<string, unknown>;
    const w = want as Record<string, unknown>;
    const ak = Object.keys(a)
      .filter((k) => a[k] !== undefined)
      .sort();
    const wk = Object.keys(w).sort();
    if (ak.join(",") !== wk.join(",")) {
      errors.push(`${path}: keys differ. Python [${wk.join(", ")}], TS [${ak.join(", ")}]`);
      return;
    }
    for (const k of wk) compare(a[k], w[k], `${path}.${k}`, k, stats, errors);
    return;
  }
  errors.push(`${path}: unexpected type ${typeof want}`);
}

function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

function checkPair(session: ManifestSession, config: AnalysisConfig, configFile: string): void {
  const id = session.session_id;
  const { a, b } = session.default_pair;
  const dir = join(dataRoot, id);
  const files = {
    a: join(dir, "laps", `${a}.json`),
    b: join(dir, "laps", `${b}.json`),
    track: join(dir, "track.json"),
  };
  for (const f of Object.values(files)) {
    if (!existsSync(f)) {
      fail(`${id}: missing ${relative(repo, f)}`);
      return;
    }
  }
  const lapA = readJson<Lap>(files.a);
  const lapB = readJson<Lap>(files.b);
  const track = readJson<Track>(files.track);

  const t0 = performance.now();
  const got: Comparison = analyzePair(lapA, lapB, track, config);
  const tsMs = performance.now() - t0;
  const bad = badNumbers(got);
  if (bad > 0) fail(`${id} ${a} vs ${b}: ${String(bad)} values are -0, NaN or infinite`);
  const actual: unknown = JSON.parse(JSON.stringify(got));

  const p0 = performance.now();
  const py = spawnSync(
    "python3",
    ["-c", PYTHON_ANALYZE, repo, files.a, files.b, files.track, configFile],
    { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const pyMs = performance.now() - p0;
  if (py.error || py.status !== 0) {
    fail(`${id}: Python reference failed (${py.error?.message ?? py.stderr.trim()})`);
    return;
  }
  const want: unknown = JSON.parse(py.stdout);

  const stats: Stats = { floats: 0, floatsBitEqual: 0, ints: 0, strings: 0 };
  const errors: string[] = [];
  compare(actual, want, "comparison", null, stats, errors);
  if (errors.length > 0) {
    fail(`${id} ${a} vs ${b}: TS and Python differ in ${errors.length} places`);
    for (const e of errors) console.error(`    ${e}`);
  }

  const rows = sum(got.corners.map((r) => r.delta_ms));
  const minis = sum(got.mini_sectors.map((m) => m.delta_ms));
  if (rows !== got.lap_gap_ms) fail(`${id}: corner rows do not sum to the lap gap`);
  if (minis !== got.lap_gap_ms) fail(`${id}: mini-sectors do not sum to the lap gap`);
  const badLabels = got.corners.filter((r) => !CORNER_LABEL_RE.test(r.label));
  if (badLabels.length > 0) fail(`${id}: ${badLabels.length} corner labels break the grammar`);

  console.log(
    `verify-data: ${id} ${a} vs ${b}: ${errors.length === 0 ? "parity ok" : "PARITY FAILED"}, ` +
      `${stats.floatsBitEqual}/${stats.floats} floats bit-identical, ${stats.ints} integers and ` +
      `${stats.strings} strings exact; ` +
      `${got.corners.length} corner rows sum ${rows === got.lap_gap_ms ? "ok" : "WRONG"}, ` +
      `${got.mini_sectors.length} mini-sectors sum ${minis === got.lap_gap_ms ? "ok" : "WRONG"}; ` +
      `${got.corner_source} corners, anchored ${String(got.anchored)}, ` +
      `${got.findings.length} findings; TS ${tsMs.toFixed(1)} ms, Python ${pyMs.toFixed(0)} ms`,
  );
}

function main(): void {
  if (!existsSync(dataRoot)) {
    console.log(
      "verify-data: public/data not present, nothing to check (run pnpm export to create it)",
    );
    process.exit(0);
  }

  console.log("verify-data: validating public/data");
  run("validate-laps", process.execPath, [join(repo, "scripts", "validate-laps.ts"), dataRoot]);

  if (existsSync(manifestFile)) {
    const configFile = join(repo, "analysis-config.json");
    const config = readJson<AnalysisConfig>(configFile);
    const manifest = readJson<{ sessions: ManifestSession[] }>(manifestFile);
    for (const session of manifest.sessions) checkPair(session, config, configFile);
  }

  if (existsSync(checkNotesScript)) {
    console.log("verify-data: checking template notes (scripts/check-notes.ts)");
    run("check-notes", process.execPath, [checkNotesScript]);
  } else {
    console.log("verify-data: scripts/check-notes.ts not present, note check skipped");
  }

  console.log(
    `verify-data: ${failures.length === 0 ? "all checks passed" : `${failures.length} failures`}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
