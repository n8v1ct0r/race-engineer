// Server side: read the static manifests from disk at build or request time. Pages pass what they
// need to client components as props, so the browser fetches only the track and lap files.
// public/data/ is gitignored, so it is absent in the public repo; that is the empty state.

import { readFile } from "node:fs/promises";
import path from "node:path";
import analysisConfig from "@/analysis-config.json";
import { analyzePair } from "@/lib/analysis/index.ts";
import type { AnalysisConfig, Lap, Track } from "@/lib/analysis/types.ts";
import {
  isManifest,
  sessionChoice,
  type DataRoot,
  type Manifest,
  type Session,
  type SessionChoice,
} from "@/lib/data.ts";
import { headerNote } from "@/lib/ui/header-note.ts";

async function readManifest(root: DataRoot): Promise<Manifest | null> {
  const file = path.join(process.cwd(), "public", root, "manifest.json");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const json: unknown = JSON.parse(text);
  if (!isManifest(json)) {
    throw new Error(`public/${root}/manifest.json is not a race-engineer.manifest/v1 file`);
  }
  return json;
}

export type Catalog = {
  /** Exported Formula 1 sessions from public/data/, newest season first. Empty when absent. */
  f1: Session[];
  /** The synthetic session from public/demo/, or null if the demo files are missing. */
  demo: Session | null;
  /** Every session for the pickers, F1 first, demo last. */
  choices: SessionChoice[];
  /** False when public/data/manifest.json does not exist (the public repo case). */
  hasF1Data: boolean;
};

function byRecency(x: Session, y: Session): number {
  return (y.season ?? 0) - (x.season ?? 0) || (y.round ?? 0) - (x.round ?? 0);
}

export async function readCatalog(): Promise<Catalog> {
  const [data, demo] = await Promise.all([readManifest("data"), readManifest("demo")]);
  const f1 = (data?.sessions ?? []).filter((s) => s.origin === "fastf1").sort(byRecency);
  const demoSession = demo?.sessions.find((s) => s.session_id === "synthetic-demo") ?? null;
  const choices = f1.map((s) => sessionChoice("data", s));
  if (demoSession !== null) choices.push(sessionChoice("demo", demoSession));
  return { f1, demo: demoSession, choices, hasF1Data: data !== null };
}

/** The F1 session behind /f1/<season>/<location>/<session>, or null. */
export async function findF1Session(
  season: string,
  location: string,
  sessionCode: string,
): Promise<Session | null> {
  const { f1 } = await readCatalog();
  return (
    f1.find(
      (s) =>
        String(s.season) === season &&
        s.location_slug === location &&
        s.session_code.toLowerCase() === sessionCode.toLowerCase(),
    ) ?? null
  );
}

async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

/**
 * The header sentence for the session's default pair, computed at build time with the same
 * analyzePair the browser runs. On phones that sentence is the page's largest text, so rendering
 * it into the first HTML moves LCP from "after analysis" to first paint. Null if a file is
 * missing or unreadable: the view then shows the sentence once its own analysis finishes.
 */
export async function defaultHeaderNote(root: DataRoot, s: Session): Promise<string | null> {
  const dir = path.join(process.cwd(), "public", root, s.session_id);
  try {
    let track: Track | null = null;
    try {
      track = (await readJsonFile(path.join(dir, "track.json"))) as Track;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const [a, b] = await Promise.all([
      readJsonFile(path.join(dir, "laps", `${s.default_pair.a}.json`)),
      readJsonFile(path.join(dir, "laps", `${s.default_pair.b}.json`)),
    ]);
    const config: AnalysisConfig = analysisConfig;
    return headerNote(analyzePair(a as Lap, b as Lap, track, config), track);
  } catch {
    return null;
  }
}

/**
 * The session the home page opens on: FEATURED_SESSION if it was exported here, else the newest
 * Formula 1 session, else null (no real data, so the home page opens the synthetic demo).
 */
export const FEATURED_SESSION_ID = process.env.FEATURED_SESSION ?? "2026-11-q";

export function featuredSession(f1: Session[]): Session | null {
  return f1.find((s) => s.session_id === FEATURED_SESSION_ID) ?? f1[0] ?? null;
}
