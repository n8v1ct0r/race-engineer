// Top gains and losses, their cause and their display strings.
// Twin: pipeline/reference/analysis.py, section "findings".

import {
  directionWord,
  formatBrakePoint,
  formatDistance,
  formatSpeed,
  formatTime,
  formatTimeDelta,
  higherLower,
  laterEarlier,
} from "./format.ts";
import type { AnalysisConfig, Cause, CornerRow, DisplayStrings, Finding } from "./types.ts";

export type FindingChecks = {
  braking: boolean;
  min_speed: boolean;
  exit_speed: boolean;
  brake_diff_m: number | null;
  min_speed_diff_kph: number | null;
  exit_speed_diff_kph: number | null;
};

/** Each supporting fact and whether it passes its own check. Twin: analysis.py finding_checks(). */
export function findingChecks(row: CornerRow, levelKph: number): FindingChecks {
  const a = row.a;
  const b = row.b;
  let brakeDiff: number | null = null;
  let braking = false;
  let minDiff: number | null = null;
  let minOk = false;
  let exitDiff: number | null = null;
  let exitOk = false;
  if (a !== null && b !== null) {
    if (a.brake_before_m !== null && b.brake_before_m !== null) {
      brakeDiff = b.brake_before_m - a.brake_before_m; // above 0: A brakes later
      if (
        a.brake_gap_m !== null &&
        b.brake_gap_m !== null &&
        !a.brake_at_segment_start &&
        !b.brake_at_segment_start
      ) {
        const mag = Math.abs(brakeDiff);
        braking = mag > a.brake_gap_m && mag > b.brake_gap_m;
      }
    }
    minDiff = a.min_speed_kph - b.min_speed_kph;
    minOk = !a.min_edge && !b.min_edge && Math.abs(minDiff) > levelKph;
    exitDiff = a.exit_speed_kph - b.exit_speed_kph;
    exitOk = !row.exit_clamped && Math.abs(exitDiff) > levelKph;
  }
  return {
    braking,
    min_speed: minOk,
    exit_speed: exitOk,
    brake_diff_m: brakeDiff,
    min_speed_diff_kph: minDiff,
    exit_speed_diff_kph: exitDiff,
  };
}

/** Display strings for one finding: only the fields that pass their checks. Twin: analysis.py finding_display(). */
export function findingDisplay(row: CornerRow, chk: FindingChecks): DisplayStrings {
  const ms = row.delta_ms;
  const a = row.a;
  const b = row.b;
  const d: DisplayStrings = {
    label: row.label,
    direction: directionWord(ms) as "gains" | "loses",
    time: formatTime(ms),
    delta: formatTimeDelta(ms),
  };
  if (chk.braking && a !== null && b !== null) {
    d.brake_a = formatBrakePoint(a.brake_before_m!);
    d.brake_b = formatBrakePoint(b.brake_before_m!);
    d.brake_gap_a = formatDistance(a.brake_gap_m!);
    d.brake_gap_b = formatDistance(b.brake_gap_m!);
    d.brake_diff = formatDistance(chk.brake_diff_m!);
    d.brake_word = laterEarlier(chk.brake_diff_m!) as "later" | "earlier";
  }
  if (chk.min_speed && a !== null && b !== null) {
    d.min_speed_a = formatSpeed(a.min_speed_kph);
    d.min_speed_b = formatSpeed(b.min_speed_kph);
    d.min_speed_diff = formatSpeed(chk.min_speed_diff_kph!);
    d.min_speed_word = higherLower(chk.min_speed_diff_kph!) as "higher" | "lower";
  }
  if (chk.exit_speed && a !== null && b !== null) {
    d.exit_speed_a = formatSpeed(a.exit_speed_kph);
    d.exit_speed_b = formatSpeed(b.exit_speed_kph);
    d.exit_speed_diff = formatSpeed(chk.exit_speed_diff_kph!);
    d.exit_speed_word = higherLower(chk.exit_speed_diff_kph!) as "higher" | "lower";
  }
  return d;
}

/** Twin: analysis.py make_finding(). Cause priority: braking, min_speed, exit_speed, time_only. */
export function makeFinding(
  row: CornerRow,
  kind: "gain" | "loss",
  rank: number,
  levelKph: number,
): Finding {
  const chk = findingChecks(row, levelKph);
  let cause: Cause;
  if (chk.braking) cause = "braking";
  else if (chk.min_speed) cause = "min_speed";
  else if (chk.exit_speed) cause = "exit_speed";
  else cause = "time_only";
  return {
    id: kind + "-" + String(rank),
    kind,
    rank,
    corner_index: row.index,
    label: row.label,
    delta_ms: row.delta_ms,
    cause,
    checks: { braking: chk.braking, min_speed: chk.min_speed, exit_speed: chk.exit_speed },
    brake_diff_m: chk.brake_diff_m,
    min_speed_diff_kph: chk.min_speed_diff_kph,
    exit_speed_diff_kph: chk.exit_speed_diff_kph,
    display: findingDisplay(row, chk),
  };
}

/**
 * Top gains then top losses at |delta| >= min_abs_ms, A's view; ties go to the earlier row.
 * Never padded. Twin: analysis.py findings().
 */
export function findings(rows: readonly CornerRow[], cfg: AnalysisConfig): Finding[] {
  const topN = cfg.findings.top_n;
  const minAbs = cfg.findings.min_abs_ms;
  const level = cfg.findings.level_speed_kph;
  const idx = rows.map((_, i) => i);
  const gains = idx.filter((i) => rows[i]!.delta_ms >= minAbs);
  gains.sort((i, j) => rows[j]!.delta_ms - rows[i]!.delta_ms || i - j);
  const losses = idx.filter((i) => rows[i]!.delta_ms <= -minAbs);
  losses.sort((i, j) => rows[i]!.delta_ms - rows[j]!.delta_ms || i - j);
  const out: Finding[] = [];
  for (let r = 0; r < Math.min(topN, gains.length); r++) {
    out.push(makeFinding(rows[gains[r]!]!, "gain", r + 1, level));
  }
  for (let r = 0; r < Math.min(topN, losses.length); r++) {
    out.push(makeFinding(rows[losses[r]!]!, "loss", r + 1, level));
  }
  return out;
}
