// Static manifest and lap loaders (docs/contracts.md sections 1 to 3). Browser-safe: no Node
// imports. The browser loads laps from /data/... (exported Formula 1 sessions, gitignored) or
// /demo/... (the synthetic session). No other network call happens on page load.

import type { Lap, Track } from "./analysis/index.ts";

export type DataRoot = "data" | "demo";

export const MANIFEST_SCHEMA = "race-engineer.manifest/v1";

export type ManifestLap = {
  lap_id: string;
  lap_no: number;
  duration_ms: number;
  sector_ms: number[] | null;
  segment: string | null;
  compound: string | null;
  tyre_life: number | null;
  personal_best: boolean | null;
  deleted: boolean | null;
  deleted_reason: string | null;
  yellow: boolean | null;
  qa: "ok" | "low_confidence";
  qa_notes: string[];
};

export type ManifestDriver = { code: string; laps: ManifestLap[] };

export type Session = {
  session_id: string;
  origin: "fastf1" | "synthetic" | "photoncar";
  season: number | null;
  round: number | null;
  event_name: string;
  location: string;
  location_slug: string;
  session_code: string;
  session_name: string;
  date: string | null;
  track_id: string;
  corner_source: "official" | "detected";
  default_pair: { a: string; b: string };
  drivers: ManifestDriver[];
  provenance?: Record<string, unknown>;
};

export type Manifest = { schema: typeof MANIFEST_SCHEMA; sessions: Session[] };

/** What the session pickers need for one session, on either data root. */
export type SessionChoice = {
  root: DataRoot;
  session_id: string;
  season: number | null;
  round: number | null;
  event: string;
  session_name: string;
  date: string | null;
  href: string;
  default_pair: { a: string; b: string };
};

export function isManifest(x: unknown): x is Manifest {
  if (typeof x !== "object" || x === null) return false;
  const m = x as { schema?: unknown; sessions?: unknown };
  return m.schema === MANIFEST_SCHEMA && Array.isArray(m.sessions);
}

/** URL of a session page: /f1/<season>/<location slug>/<session code> or /demo (contracts 2). */
export function sessionHref(root: DataRoot, s: Session): string {
  if (root === "demo") return "/demo";
  return `/f1/${String(s.season)}/${s.location_slug}/${s.session_code.toLowerCase()}`;
}

/**
 * Event title for pickers and headings. Grand Prix names go in BLOCK CAPITALS with the season
 * (contracts section 7): "HUNGARIAN GRAND PRIX 2026". The synthetic session keeps its own name.
 */
export function eventTitle(s: Session): string {
  if (s.origin !== "fastf1" || s.season === null) return s.event_name;
  return `${s.event_name.toUpperCase()} ${String(s.season)}`;
}

export function sessionChoice(root: DataRoot, s: Session): SessionChoice {
  return {
    root,
    session_id: s.session_id,
    season: s.season,
    round: s.round,
    event: eventTitle(s),
    session_name: s.session_name,
    date: s.date,
    href: sessionHref(root, s),
    default_pair: s.default_pair,
  };
}

export function manifestUrl(root: DataRoot): string {
  return `/${root}/manifest.json`;
}

export function trackUrl(root: DataRoot, sessionId: string): string {
  return `/${root}/${encodeURIComponent(sessionId)}/track.json`;
}

export function lapUrl(root: DataRoot, sessionId: string, lapId: string): string {
  return `/${root}/${encodeURIComponent(sessionId)}/laps/${encodeURIComponent(lapId)}.json`;
}

/** Why a data file did not load: no answer, an HTTP error, bad JSON, or the wrong schema. */
export type DataLoadFailure = "network" | "http" | "json" | "schema";

export class DataLoadError extends Error {
  readonly url: string;
  readonly status: number | null;
  readonly kind: DataLoadFailure;
  constructor(message: string, url: string, status: number | null, kind: DataLoadFailure) {
    super(message);
    this.name = "DataLoadError";
    this.url = url;
    this.status = status;
    this.kind = kind;
  }
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new DataLoadError(`Could not reach ${url}.`, url, null, "network");
  }
  if (!res.ok) {
    throw new DataLoadError(`${url} answered HTTP ${res.status}.`, url, res.status, "http");
  }
  try {
    return await res.json();
  } catch {
    throw new DataLoadError(`${url} is not valid JSON.`, url, res.status, "json");
  }
}

/** The session's track file, or null when the session has none (analysis then runs on laps alone). */
export async function fetchTrack(
  root: DataRoot,
  sessionId: string,
  signal?: AbortSignal,
): Promise<Track | null> {
  const url = trackUrl(root, sessionId);
  try {
    const json = await getJson(url, signal);
    const t = json as { schema?: unknown };
    if (t.schema !== "race-engineer.track/v1") {
      throw new DataLoadError(`${url} is not a race-engineer.track/v1 file.`, url, 200, "schema");
    }
    return json as Track;
  } catch (err) {
    if (err instanceof DataLoadError && err.status === 404) return null;
    throw err;
  }
}

export async function fetchLap(
  root: DataRoot,
  sessionId: string,
  lapId: string,
  signal?: AbortSignal,
): Promise<Lap> {
  const url = lapUrl(root, sessionId, lapId);
  const json = await getJson(url, signal);
  const lap = json as { schema?: unknown; samples?: unknown };
  if (lap.schema !== "race-engineer.lap/v1" || typeof lap.samples !== "object") {
    throw new DataLoadError(`${url} is not a race-engineer.lap/v1 file.`, url, 200, "schema");
  }
  return json as Lap;
}

export type LapRef = { driver: ManifestDriver; lap: ManifestLap };

export function findLap(s: Session, lapId: string): LapRef | null {
  for (const driver of s.drivers) {
    for (const lap of driver.laps) {
      if (lap.lap_id === lapId) return { driver, lap };
    }
  }
  return null;
}

/** The driver's fastest lap, preferring laps that were not deleted. */
export function fastestLap(driver: ManifestDriver): ManifestLap | null {
  let best: ManifestLap | null = null;
  for (const lap of driver.laps) {
    if (best === null) {
      best = lap;
      continue;
    }
    const lapDeleted = lap.deleted === true;
    const bestDeleted = best.deleted === true;
    if (lapDeleted !== bestDeleted) {
      if (bestDeleted) best = lap;
      continue;
    }
    if (lap.duration_ms < best.duration_ms) best = lap;
  }
  return best;
}

/** Drivers ordered by their fastest lap, quickest first. */
export function driversByPace(s: Session): ManifestDriver[] {
  const pace = (d: ManifestDriver) => fastestLap(d)?.duration_ms ?? Number.MAX_SAFE_INTEGER;
  return [...s.drivers].sort((x, y) => pace(x) - pace(y) || x.code.localeCompare(y.code));
}

/** One ?a= or ?b= id that is not in the session, and the default lap shown in its place. */
export type Replaced = { slot: "a" | "b"; asked: string; used: string };

export type ResolvedPair = { a: string; b: string; unknown: string[]; replaced: Replaced[] };

/** The pair from ?a=&b=, falling back to the session's default_pair for missing or unknown ids. */
export function resolvePair(s: Session, a: string | null, b: string | null): ResolvedPair {
  const replaced: Replaced[] = [];
  const pick = (slot: "a" | "b", id: string | null, fallback: string): string => {
    if (id === null || id === "") return fallback;
    if (findLap(s, id) === null) {
      replaced.push({ slot, asked: id, used: fallback });
      return fallback;
    }
    return id;
  };
  const pa = pick("a", a, s.default_pair.a);
  const pb = pick("b", b, s.default_pair.b);
  return { a: pa, b: pb, unknown: replaced.map((r) => r.asked), replaced };
}

/**
 * What the page says when a ?a= or ?b= id is not in the session. It names the lap shown instead,
 * because only the default pair's own slot changes: ?a=AAA-9&b=CCC-1 shows AAA-1 against CCC-1.
 */
export function replacedMessage(replaced: readonly Replaced[]): string | null {
  if (replaced.length === 0) return null;
  if (replaced.length === 2) {
    const [x, y] = replaced as [Replaced, Replaced];
    return `${x.asked} and ${y.asked} are not in this session. Showing the default pair, ${x.used} and ${y.used}, instead.`;
  }
  const r = replaced[0]!;
  return `${r.asked} is not in this session. Showing ${r.used}, the default lap ${r.slot.toUpperCase()}, instead.`;
}

/** "Soft" from "SOFT". */
export function compoundName(c: string | null): string | null {
  if (c === null || c === "" || c === "UNKNOWN" || c === "nan") return null;
  return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
}

/** "2 laps old". Tyre life comes as an integer count of laps. */
export function tyreAge(n: number | null): string | null {
  if (n === null || !Number.isInteger(n) || n < 0) return null;
  return n === 1 ? "1 lap old" : `${String(n)} laps old`;
}

/** Short facts about a lap for pickers: segment, tyre, flags. */
export function lapFacts(lap: ManifestLap): string[] {
  const facts: string[] = [];
  if (lap.segment) facts.push(lap.segment);
  const tyre = compoundName(lap.compound);
  const age = tyreAge(lap.tyre_life);
  if (tyre && age) facts.push(`${tyre}, ${age}`);
  else if (tyre) facts.push(tyre);
  else if (age) facts.push(`tyre ${age}`);
  return facts;
}

export type LapFlag = {
  key: "deleted" | "yellow" | "low_confidence";
  label: string;
  detail: string;
};

/**
 * Race control text arrives in block capitals ("TRACK LIMITS AT TURN 7 LAP 12"). The copy rules
 * want sentence case: "Track limits at turn 7, lap 12".
 */
export function sentenceCase(text: string): string {
  const lower = text.trim().replace(/\s+/g, " ").toLowerCase();
  const withComma = lower
    .replace(/\bturn (\d+)([a-z])\b/g, (_m, n: string, x: string) => `turn ${n}${x.toUpperCase()}`)
    .replace(/\b(turn \d+[A-Z]?) (lap \d+)\b/g, "$1, $2");
  return withComma.charAt(0).toUpperCase() + withComma.slice(1);
}

export function lapFlags(lap: ManifestLap): LapFlag[] {
  const flags: LapFlag[] = [];
  if (lap.deleted === true) {
    const reason = lap.deleted_reason ? sentenceCase(lap.deleted_reason) : "";
    flags.push({
      key: "deleted",
      label: "Deleted",
      detail: reason ? `Lap time deleted: ${reason}` : "Lap time deleted",
    });
  }
  if (lap.yellow === true) {
    flags.push({ key: "yellow", label: "Yellow flag", detail: "Set under a yellow flag" });
  }
  if (lap.qa === "low_confidence") {
    const why = lap.qa_notes.length > 0 ? lap.qa_notes.join("; ") : "telemetry gap or large anchor";
    flags.push({
      key: "low_confidence",
      label: "Low confidence",
      detail: `Low confidence: ${why}`,
    });
  }
  return flags;
}

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * The reason behind a flag, as a phrase for the line under the lap selects, or null when the
 * label says it all. "sector anchor correction of 134 ms" from "Low confidence: Sector anchor
 * correction of 134 ms". Words such as "DRS" keep their capitals.
 */
export function flagReason(flag: LapFlag): string | null {
  const at = flag.detail.indexOf(": ");
  if (at < 0) return null;
  return flag.detail
    .slice(at + 2)
    .split("; ")
    .map(lowerFirst)
    .join("; ");
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "25 July 2026" from "2026-07-25". Plain string work, so server and browser always agree. */
export function formatDate(iso: string | null): string | null {
  if (iso === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m === null) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (month === undefined) return null;
  return `${String(Number(m[3]))} ${month} ${m[1]}`;
}
