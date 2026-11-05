// Team radio calls: one per finding, in the order the cars meet the corners. Pure and
// browser-safe. Every number in a call is a display string the analysis already made (the note
// text comes from templateText, the facts from the finding's display fields) or the reference
// lap's own elapsed time at the corner exit, read off the shared grid. Nothing here invents a
// value; lib/ui/radio.test.ts checks that.

import { formatLapTime, type Comparison, type Finding } from "../analysis/index.ts";
import { templateText } from "../notes/template.ts";
import { indexAtDistance } from "./geometry.ts";

export type RadioCall = {
  /** The finding id, "gain-1".."loss-3". */
  id: string;
  kind: "gain" | "loss";
  cornerIndex: number;
  /** Corner label, "T4". */
  label: string;
  /** Distance in m along the reference lap where the call comes in: the corner's exit point. */
  triggerM: number;
  /** Lap A's elapsed time at that point, "0:23.412". */
  at: string;
  /** "gains 0.103 s" from A's view. */
  delta: string;
  /** The note, written by code from display strings only. */
  text: string;
  /** Braking, minimum speed and exit speed lines, each present only when its check passed. */
  facts: string[];
};

/** Said when no braking or speed gap passed its check, so the call quotes the time alone. */
export const TIME_ONLY = "Braking and speeds match within the check limits here.";

function facts(f: Finding, codeA: string, codeB: string): string[] {
  const d = f.display;
  const out: string[] = [];
  if (d.brake_a !== undefined && d.brake_b !== undefined) {
    const diff =
      d.brake_diff !== undefined && d.brake_word !== undefined
        ? `, ${d.brake_diff} ${d.brake_word}`
        : "";
    out.push(`Braking ${codeA} ${d.brake_a}, ${codeB} ${d.brake_b}${diff}`);
  }
  if (d.min_speed_a !== undefined && d.min_speed_b !== undefined) {
    const diff =
      d.min_speed_diff !== undefined && d.min_speed_word !== undefined
        ? `, ${d.min_speed_diff} ${d.min_speed_word}`
        : "";
    out.push(`Minimum speed ${codeA} ${d.min_speed_a}, ${codeB} ${d.min_speed_b}${diff}`);
  }
  if (d.exit_speed_a !== undefined && d.exit_speed_b !== undefined) {
    const diff =
      d.exit_speed_diff !== undefined && d.exit_speed_word !== undefined
        ? `, ${d.exit_speed_diff} ${d.exit_speed_word}`
        : "";
    out.push(`Exit speed ${codeA} ${d.exit_speed_a}, ${codeB} ${d.exit_speed_b}${diff}`);
  }
  if (out.length === 0) out.push(TIME_ONLY);
  return out;
}

/** The calls for a comparison, sorted by where they come in along the lap. */
export function radioCalls(c: Comparison, codeA: string, codeB: string): RadioCall[] {
  const calls: RadioCall[] = [];
  for (const f of c.findings) {
    const row = c.corners[f.corner_index];
    if (!row) continue;
    const t = c.grid.a.t_ms[indexAtDistance(c, row.exit_s_m)] ?? 0;
    calls.push({
      id: f.id,
      kind: f.kind,
      cornerIndex: f.corner_index,
      label: f.label,
      triggerM: row.exit_s_m,
      at: formatLapTime(Math.max(0, Math.round(t))),
      delta: f.display.delta,
      text: templateText(f),
      facts: facts(f, codeA, codeB),
    });
  }
  return calls.sort((x, y) => x.triggerM - y.triggerM);
}

/**
 * How far along the lap the radio has heard, given the previous mark and car A's distance now.
 * Moving forward extends it. A replay that loops back to the start (a jump back of more than
 * half the lap) starts a new pass, so the calls come in again.
 */
export function nextHeardM(prev: number, nowM: number, lapM: number, looped: boolean): number {
  if (looped && nowM < prev - lapM / 2) return nowM;
  return Math.max(prev, nowM);
}
