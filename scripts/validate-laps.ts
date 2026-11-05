// Validate lap and track files (acceptance criterion 4).
//
//   node scripts/validate-laps.ts            checks public/demo and public/data (when present)
//   node scripts/validate-laps.ts DIR ...    checks the given data roots instead
//
// A data root holds manifest.json, <session_id>/track.json and <session_id>/laps/<lap_id>.json.
// Checks: lap-schema.json and track-schema.json (JSON Schema 2020-12, ajv), equal array lengths,
// strictly increasing t_ms and path s_m, corners in lap order, and manifest-to-file consistency
// both ways. Two timing invariants the analysis relies on (docs/contracts.md sections 1 and 4):
// t_ms spans exactly duration_ms (the lap gap comes from t_ms, the lap times from duration_ms),
// and the 3 sector times sum to duration_ms (the anchor ramp returns to 0 at the line).
// Prints counts; exits 1 on any failure. Messages never print lap times.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type SchemaObject } from "ajv/dist/2020.js";

const repo = fileURLToPath(new URL("../", import.meta.url));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validateLap = ajv.compile(readJson(join(repo, "lap-schema.json")) as SchemaObject);
const validateTrack = ajv.compile(readJson(join(repo, "track-schema.json")) as SchemaObject);

const LAP_CHANNELS = [
  "t_ms",
  "dist_m",
  "speed_kph",
  "throttle_pct",
  "brake",
  "gear",
  "rpm",
  "x",
  "y",
];
const PATH_CHANNELS = ["s_m", "x", "y", "speed_kph"];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const failures: string[] = [];
const counts = { roots: 0, sessions: 0, tracks: 0, laps: 0 };

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, "utf8")) as Json;
}

function isObj(v: Json | undefined): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function shown(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel === "" || rel.startsWith("..") ? path : rel;
}

function fail(file: string, message: string): void {
  failures.push(`${shown(file)}: ${message}`);
}

function load(file: string): Json | undefined {
  try {
    return readJson(file);
  } catch (err) {
    fail(file, `cannot read JSON (${err instanceof Error ? err.message : String(err)})`);
    return undefined;
  }
}

function strictlyIncreasing(a: Json[]): number {
  for (let i = 1; i < a.length; i++) {
    const prev = a[i - 1];
    const cur = a[i];
    if (typeof prev !== "number" || typeof cur !== "number" || !(cur > prev)) return i;
  }
  return -1;
}

function equalLengths(file: string, obj: Obj, keys: string[], what: string): void {
  const lengths = keys.map((k) => {
    const v = obj[k];
    return Array.isArray(v) ? v.length : -1;
  });
  if (new Set(lengths).size !== 1) {
    fail(
      file,
      `${what} arrays differ in length: ${keys.map((k, i) => `${k}=${lengths[i]}`).join(", ")}`,
    );
  }
}

function checkLap(file: string): Obj | undefined {
  const lap = load(file);
  if (lap === undefined) return undefined;
  counts.laps += 1;
  if (!validateLap(lap)) {
    fail(file, `lap schema: ${ajv.errorsText(validateLap.errors)}`);
    return undefined;
  }
  const lapObj = lap as Obj;
  const samples = lapObj.samples as Obj;
  equalLengths(file, samples, LAP_CHANNELS, "samples");
  const t = samples.t_ms as number[];
  const bad = strictlyIncreasing(t);
  if (bad >= 0) fail(file, `t_ms does not strictly increase at index ${bad}`);
  const duration = lapObj.duration_ms as number;
  if (t[t.length - 1]! - t[0]! !== duration) {
    fail(file, "t_ms does not span duration_ms (last t_ms minus first must equal it)");
  }
  const sectors = lapObj.sector_ms;
  if (Array.isArray(sectors) && (sectors as number[]).reduce((x, y) => x + y, 0) !== duration) {
    fail(file, "sector_ms does not sum to duration_ms");
  }
  return lapObj;
}

function checkTrack(file: string): Obj | undefined {
  const track = load(file);
  if (track === undefined) return undefined;
  counts.tracks += 1;
  if (!validateTrack(track)) {
    fail(file, `track schema: ${ajv.errorsText(validateTrack.errors)}`);
    return undefined;
  }
  const t = track as Obj;
  const path = t.path as Obj;
  equalLengths(file, path, PATH_CHANNELS, "path");
  const bad = strictlyIncreasing(path.s_m as Json[]);
  if (bad >= 0) fail(file, `path.s_m does not strictly increase at index ${bad}`);
  const corners = t.corners as Obj[];
  for (let i = 1; i < corners.length; i++) {
    if ((corners[i]!.s_m as number) < (corners[i - 1]!.s_m as number)) {
      fail(file, `corners are not in lap order at index ${i}`);
      break;
    }
  }
  return t;
}

function sameJson(a: Json | undefined, b: Json | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function checkSession(root: string, session: Obj, seen: Set<string>): void {
  const id = session.session_id;
  const manifestFile = join(root, "manifest.json");
  if (typeof id !== "string" || id.length === 0) {
    fail(manifestFile, "a session has no session_id");
    return;
  }
  counts.sessions += 1;
  seen.add(id);
  const dir = join(root, id);
  const trackFile = join(dir, "track.json");
  if (!existsSync(trackFile)) fail(manifestFile, `session ${id}: missing ${id}/track.json`);
  else {
    const track = checkTrack(trackFile);
    if (track !== undefined && track.track_id !== session.track_id) {
      fail(
        trackFile,
        `track_id ${String(track.track_id)} does not match the manifest (${String(session.track_id)})`,
      );
    }
  }

  const listed = new Set<string>();
  const drivers = Array.isArray(session.drivers) ? session.drivers : [];
  if (drivers.length === 0) fail(manifestFile, `session ${id}: no drivers`);
  for (const d of drivers) {
    if (!isObj(d) || typeof d.code !== "string" || !Array.isArray(d.laps)) {
      fail(manifestFile, `session ${id}: malformed driver entry`);
      continue;
    }
    for (const entry of d.laps) {
      if (!isObj(entry) || typeof entry.lap_id !== "string") {
        fail(manifestFile, `session ${id}: malformed lap entry for ${d.code}`);
        continue;
      }
      const lapId = entry.lap_id;
      listed.add(lapId);
      if (lapId !== `${d.code}-${String(entry.lap_no)}`) {
        fail(manifestFile, `session ${id}: lap_id ${lapId} is not <DRIVER>-<lap_no>`);
      }
      const lapFile = join(dir, "laps", `${lapId}.json`);
      if (!existsSync(lapFile)) {
        fail(
          manifestFile,
          `session ${id}: ${lapId} is listed but ${id}/laps/${lapId}.json is missing`,
        );
        continue;
      }
      const lap = checkLap(lapFile);
      if (lap === undefined) continue;
      const pairs: [string, Json | undefined, Json | undefined][] = [
        ["driver", lap.driver, d.code],
        ["lap_no", lap.lap_no, entry.lap_no],
        ["duration_ms", lap.duration_ms, entry.duration_ms],
        ["sector_ms", lap.sector_ms, entry.sector_ms],
        ["track_id", lap.track_id, session.track_id],
        ["origin", lap.origin, session.origin],
      ];
      if (lap.session_id !== undefined) pairs.push(["session_id", lap.session_id, id]);
      for (const [field, inFile, inManifest] of pairs) {
        if (!sameJson(inFile, inManifest)) {
          fail(
            lapFile,
            `${field} is ${JSON.stringify(inFile)} but the manifest says ${JSON.stringify(inManifest)}`,
          );
        }
      }
    }
  }

  const pair = session.default_pair;
  if (!isObj(pair) || typeof pair.a !== "string" || typeof pair.b !== "string") {
    fail(manifestFile, `session ${id}: default_pair must hold lap ids a and b`);
  } else {
    for (const side of [pair.a, pair.b]) {
      if (!listed.has(side as string))
        fail(manifestFile, `session ${id}: default_pair lap ${String(side)} is not listed`);
    }
  }

  const lapsDir = join(dir, "laps");
  if (existsSync(lapsDir)) {
    for (const name of readdirSync(lapsDir)
      .filter((n) => n.endsWith(".json"))
      .sort()) {
      const lapId = name.slice(0, -5);
      if (!listed.has(lapId)) {
        fail(join(lapsDir, name), "lap file is not listed in the manifest");
        checkLap(join(lapsDir, name));
      }
    }
  }
}

function checkRoot(root: string): void {
  counts.roots += 1;
  const manifestFile = join(root, "manifest.json");
  if (!existsSync(manifestFile)) {
    fail(root, "no manifest.json");
    return;
  }
  const manifest = load(manifestFile);
  if (manifest === undefined) return;
  if (
    !isObj(manifest) ||
    manifest.schema !== "race-engineer.manifest/v1" ||
    !Array.isArray(manifest.sessions)
  ) {
    fail(manifestFile, 'expected { "schema": "race-engineer.manifest/v1", "sessions": [...] }');
    return;
  }
  const seen = new Set<string>();
  for (const s of manifest.sessions) {
    if (!isObj(s)) fail(manifestFile, "a session entry is not an object");
    else checkSession(root, s, seen);
  }
  // Session folders on disk that the manifest does not list (folders without laps/ or track.json,
  // such as notes/, are not sessions).
  for (const name of readdirSync(root).sort()) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory() || seen.has(name)) continue;
    if (existsSync(join(dir, "track.json")) || existsSync(join(dir, "laps"))) {
      fail(dir, "session folder is not listed in manifest.json");
      if (existsSync(join(dir, "track.json"))) checkTrack(join(dir, "track.json"));
      const lapsDir = join(dir, "laps");
      if (existsSync(lapsDir)) {
        for (const f of readdirSync(lapsDir)
          .filter((n) => n.endsWith(".json"))
          .sort())
          checkLap(join(lapsDir, f));
      }
    }
  }
}

const args = process.argv.slice(2);
const roots: string[] = [];
if (args.length > 0) {
  for (const a of args) {
    const dir = resolve(process.cwd(), a);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(dir, "not a directory");
    else roots.push(dir);
  }
} else {
  roots.push(join(repo, "public", "demo"));
  const data = join(repo, "public", "data");
  if (existsSync(data)) roots.push(data);
  else console.log("validate-laps: public/data not present, skipped");
}

for (const root of roots) {
  const before = { ...counts };
  const failedBefore = failures.length;
  checkRoot(root);
  console.log(
    `validate-laps: ${shown(root)}: ${counts.sessions - before.sessions} sessions, ${counts.tracks - before.tracks} tracks, ${counts.laps - before.laps} laps, ${failures.length - failedBefore} failures`,
  );
}

for (const f of failures) console.error(`  FAIL ${f}`);
console.log(
  `validate-laps: ${counts.laps} laps and ${counts.tracks} tracks in ${counts.roots} data roots; ${failures.length === 0 ? "all valid" : `${failures.length} failures`}`,
);
process.exit(failures.length === 0 && roots.length > 0 ? 0 : 1);
