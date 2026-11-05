// Template notes: written by code from a finding's display strings only. Pure and browser-safe:
// the UI imports this module to show notes on page load with no model call (plan section 3b
// item 6), and Formula 1 laps only ever get these notes (decision D1).

import type { Comparison, Finding } from "../analysis/index.ts";

export type NoteSource = "model" | "template";

/** One note as the UI shows it and as POST /api/notes returns it (docs/contracts.md section 6). */
export type Note = { finding_id: string; text: string; source: NoteSource };

export type TemplateNote = {
  finding_id: string;
  corner: string;
  text: string;
  source: "template";
};

/**
 * Why a notes response holds only template notes. null means the model route ran; single notes
 * may still be templates after a failed validation, marked by their own source.
 */
export type TemplateReason =
  "no_key" | "disabled" | "rate_limited" | "spend_cap" | "model_error" | null;

/** Body of a 200 response from POST /api/notes. */
export type NotesResponse = {
  notes: Note[];
  cached: boolean;
  template_reason: TemplateReason;
};

/** Body of any non-200 response from POST /api/notes. */
export type NotesErrorResponse = { error: string; message: string };

/**
 * One cause-aware note for one finding, built only from its display strings, so every number in
 * it is a display string by construction. A gain note says "gain", a loss note says "lose".
 */
export function templateText(f: Finding): string {
  const d = f.display;
  const verb = f.kind === "gain" ? "gain" : "lose";
  const head = `${d.label}, you ${verb} ${d.time}.`;
  switch (f.cause) {
    case "braking":
      if (d.brake_diff !== undefined && d.brake_word !== undefined) {
        return `${head} You brake ${d.brake_diff} ${d.brake_word}.`;
      }
      return head;
    case "min_speed":
      if (d.min_speed_a !== undefined && d.min_speed_b !== undefined) {
        return `${head} Minimum speed ${d.min_speed_a} against ${d.min_speed_b}.`;
      }
      return head;
    case "exit_speed":
      if (d.exit_speed_a !== undefined && d.exit_speed_b !== undefined) {
        return `${head} Exit speed ${d.exit_speed_a} against ${d.exit_speed_b}.`;
      }
      return head;
    case "time_only":
      return head;
  }
}

/** Template notes for every finding of a comparison, in findings order. */
export function templateNotes(c: Comparison): TemplateNote[] {
  return c.findings.map((f) => ({
    finding_id: f.id,
    corner: f.label,
    text: templateText(f),
    source: "template",
  }));
}
