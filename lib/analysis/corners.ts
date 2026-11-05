// Corner markers, grouping, segments and the corner table.
// Twin: pipeline/reference/analysis.py, section "corners".

import type { ReferencePath } from "./align.ts";
import type { Prepared } from "./delta.ts";
import { detectCorners } from "./detect.ts";
import {
  deltaDisplay,
  formatBrakePoint,
  formatDistance,
  formatSpeed,
  roundHalfAway,
} from "./format.ts";
import { interp } from "./interp.ts";
import type { AnalysisConfig, CornerRow, CornerSource, DriverCorner, Track } from "./types.ts";

export type Marker = { label: string; s_m: number };
export type CornerGroup = { s_first: number; s_last: number; labels: string[]; label: string };

/** Raw per-driver metrics before rounding. */
export type CornerMetrics = {
  min_speed_kph: number;
  min_speed_s_m: number;
  min_edge: boolean;
  brake_s_m: number | null;
  brake_gap_m: number | null;
  brake_at_segment_start: boolean;
  exit_speed_kph: number;
};

/**
 * Official markers from the track file, else detected speed minima labeled 1..n.
 * Twin: analysis.py corner_markers().
 */
export function cornerMarkers(
  track: Track | null,
  path: ReferencePath,
  cfg: AnalysisConfig,
): { markers: Marker[]; source: CornerSource; prefix: "T" | "C" } {
  if (track !== null && track.corners.length > 0) {
    const markers = track.corners.map((c) => ({ label: c.label, s_m: c.s_m }));
    return { markers, source: "official", prefix: "T" };
  }
  const det = detectCorners(path.s, path.speed, cfg);
  const markers: Marker[] = [];
  for (let k = 0; k < det.length; k++) markers.push({ label: String(k + 1), s_m: det[k]!.s_m });
  return { markers, source: "detected", prefix: "C" };
}

/** Consecutive markers closer than groupM become one row: T6-7. Twin: analysis.py group_corners(). */
export function groupCorners(
  markers: readonly Marker[],
  groupM: number,
  prefix: string,
): CornerGroup[] {
  const groups: CornerGroup[] = [];
  for (const c of markers) {
    const last = groups[groups.length - 1];
    if (last !== undefined && c.s_m - last.s_last < groupM) {
      last.s_last = c.s_m;
      last.labels.push(c.label);
    } else {
      groups.push({ s_first: c.s_m, s_last: c.s_m, labels: [c.label], label: "" });
    }
  }
  for (const g of groups) {
    const labels = g.labels;
    if (labels.length === 1) g.label = prefix + labels[0]!;
    else g.label = prefix + labels[0]! + "-" + labels[labels.length - 1]!;
  }
  return groups;
}

/** Segment edges: 0, midpoints between rows, L. Twin: analysis.py boundaries(). */
export function boundaries(groups: readonly CornerGroup[], L: number): number[] {
  const b = [0];
  for (let k = 0; k < groups.length - 1; k++) {
    b.push((groups[k]!.s_last + groups[k + 1]!.s_first) / 2);
  }
  b.push(L);
  return b;
}

/** Raw per-driver corner metrics inside [lo, hi]; null when no sample falls inside. Twin: analysis.py corner_metrics(). */
export function cornerMetrics(
  P: Prepared,
  lo: number,
  hi: number,
  sExit: number,
): CornerMetrics | null {
  const s = P.s;
  const idx: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i]! >= lo && s[i]! <= hi) idx.push(i);
  }
  if (idx.length === 0) return null;
  const first = idx[0]!;
  const last = idx[idx.length - 1]!;
  let imin = first;
  for (const i of idx) {
    if (P.v[i]! < P.v[imin]!) imin = i; // first minimum on ties
  }
  let j = imin;
  let brakeI: number | null = null;
  while (j >= first) {
    // last brake-on sample at or before the minimum
    if (P.brake[j] === true) break;
    j -= 1;
  }
  if (j >= first) {
    // back to the first sample of that brake-on run
    while (j - 1 >= first && P.brake[j - 1] === true) j -= 1;
    brakeI = j;
  }
  return {
    min_speed_kph: P.v[imin]!,
    min_speed_s_m: s[imin]!,
    min_edge: imin === first || imin === last,
    brake_s_m: brakeI === null ? null : s[brakeI]!,
    brake_gap_m: brakeI === null || brakeI === 0 ? null : s[brakeI]! - s[brakeI - 1]!,
    brake_at_segment_start: brakeI !== null && brakeI === first,
    exit_speed_kph: interp(sExit, s, P.v),
  };
}

/** Integers and display strings for one driver's corner metrics. Twin: analysis.py driver_corner(). */
export function driverCorner(m: CornerMetrics | null, markerS: number): DriverCorner | null {
  if (m === null) return null;
  const minInt = roundHalfAway(m.min_speed_kph);
  const exitInt = roundHalfAway(m.exit_speed_kph);
  const before = m.brake_s_m === null ? null : roundHalfAway(markerS - m.brake_s_m);
  const gap = m.brake_gap_m === null ? null : roundHalfAway(m.brake_gap_m);
  return {
    min_speed_kph: minInt,
    min_speed_kph_float: m.min_speed_kph,
    min_speed_s_m: m.min_speed_s_m,
    min_edge: m.min_edge,
    brake_s_m: m.brake_s_m,
    brake_before_m: before,
    brake_gap_m: gap,
    brake_gap_m_float: m.brake_gap_m,
    brake_at_segment_start: m.brake_at_segment_start,
    exit_speed_kph: exitInt,
    exit_speed_kph_float: m.exit_speed_kph,
    display: {
      min_speed: formatSpeed(minInt),
      exit_speed: formatSpeed(exitInt),
      brake: before === null ? null : formatBrakePoint(before),
      brake_gap: gap === null ? null : formatDistance(gap),
    },
  };
}

/** One row per corner group. deltas[k] = delta(b[k]). Twin: analysis.py corner_rows(). */
export function cornerRows(
  A: Prepared,
  B: Prepared,
  groups: readonly CornerGroup[],
  b: readonly number[],
  deltas: readonly number[],
  cfg: AnalysisConfig,
): CornerRow[] {
  const exitOffset = cfg.corners.exit_offset_m;
  const rows: CornerRow[] = [];
  for (let k = 0; k < groups.length; k++) {
    const c = groups[k]!;
    const lo = b[k]!;
    const hi = b[k + 1]!;
    let sExit = c.s_last + exitOffset;
    const clamped = sExit > hi;
    if (clamped) sExit = hi;
    const dlo = deltas[k]!;
    const dhi = deltas[k + 1]!;
    const dInt = roundHalfAway(dhi) - roundHalfAway(dlo); // round the cumulative, then subtract
    rows.push({
      index: k,
      label: c.label,
      s_m: c.s_first,
      s_last_m: c.s_last,
      seg_start_m: lo,
      seg_end_m: hi,
      exit_s_m: sExit,
      exit_clamped: clamped,
      delta_ms: dInt,
      delta_ms_float: dhi - dlo,
      a: driverCorner(cornerMetrics(A, lo, hi, sExit), c.s_first),
      b: driverCorner(cornerMetrics(B, lo, hi, sExit), c.s_first),
      display: deltaDisplay(dInt),
    });
  }
  return rows;
}
