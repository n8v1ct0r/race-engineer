// The insight: the only view of a Comparison a model ever sees. Pure and browser-safe.
// It carries ids, corner labels, causes and display strings of passing fields only. Every value
// is a string code formatted once (docs/contracts.md section 5): no raw floats, no signed deltas.

import type { Cause, Comparison, Direction, Origin } from "../analysis/index.ts";

export const INSIGHT_SCHEMA = "race-engineer.insight/v1";

/** Origins Claude may write notes for (decision D1). Formula 1 laps never reach a model. */
export const MODEL_ORIGINS: readonly Origin[] = ["synthetic", "photoncar"];

/**
 * Display strings a note may quote. Each field is present only when its check passed. The
 * braking sample gaps (a resolution, not a fact) and the "delta" string (it repeats direction and
 * time) stay out.
 */
export type InsightDisplay = {
  direction: "gains" | "loses";
  time: string;
  brake_a?: string;
  brake_b?: string;
  brake_diff?: string;
  brake_word?: "later" | "earlier";
  min_speed_a?: string;
  min_speed_b?: string;
  min_speed_diff?: string;
  min_speed_word?: "higher" | "lower";
  exit_speed_a?: string;
  exit_speed_b?: string;
  exit_speed_diff?: string;
  exit_speed_word?: "higher" | "lower";
};

export type InsightFinding = {
  /** "gain-1".."gain-3", "loss-1".."loss-3". */
  id: string;
  kind: "gain" | "loss";
  /** Corner label, grammar ^[TC]\d{1,2}[A-Z]?(-\d{1,2}[A-Z]?)?$ */
  corner: string;
  cause: Cause;
  display: InsightDisplay;
};

export type Insight = {
  schema: typeof INSIGHT_SCHEMA;
  origins: { a: Origin; b: Origin };
  /** Every note talks to driver A. */
  perspective: "A";
  driver_a: { code: string; lap_time: string };
  driver_b: { code: string; lap_time: string };
  lap_gap: { direction: Direction; time: string };
  findings: InsightFinding[];
};

const DISPLAY_KEYS = [
  "brake_a",
  "brake_b",
  "brake_diff",
  "brake_word",
  "min_speed_a",
  "min_speed_b",
  "min_speed_diff",
  "min_speed_word",
  "exit_speed_a",
  "exit_speed_b",
  "exit_speed_diff",
  "exit_speed_word",
] as const;

/** The model view of a comparison. Only strings, arrays and objects; no numbers at all. */
export function buildInsight(c: Comparison): Insight {
  return {
    schema: INSIGHT_SCHEMA,
    origins: { a: c.lap_a.origin, b: c.lap_b.origin },
    perspective: "A",
    driver_a: { code: c.lap_a.driver ?? "A", lap_time: c.display.lap_time_a },
    driver_b: { code: c.lap_b.driver ?? "B", lap_time: c.display.lap_time_b },
    lap_gap: { direction: c.display.gap_direction, time: c.display.gap_time },
    findings: c.findings.map((f) => {
      const display: InsightDisplay = { direction: f.display.direction, time: f.display.time };
      for (const k of DISPLAY_KEYS) {
        const v = f.display[k];
        if (v !== undefined) (display as Record<string, string>)[k] = v;
      }
      return { id: f.id, kind: f.kind, corner: f.label, cause: f.cause, display };
    }),
  };
}

/** True only when both laps may be sent to a model (decision D1). */
export function modelAllowed(origins: { a: Origin; b: Origin }): boolean {
  return MODEL_ORIGINS.includes(origins.a) && MODEL_ORIGINS.includes(origins.b);
}

/** Display strings any note of this insight may quote, besides its own finding's. */
export function globalStrings(insight: Insight): string[] {
  return [insight.driver_a.lap_time, insight.driver_b.lap_time, insight.lap_gap.time];
}

/** JSON with keys sorted at every level and no whitespace, so equal insights give equal text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}
