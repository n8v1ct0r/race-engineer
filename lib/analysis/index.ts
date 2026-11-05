// Entry point of the analysis module. Pure, deterministic, browser-safe (no Node imports, no I/O).
// Twin: pipeline/reference/analysis.py analyze_pair(). Parity: fixtures/parity/expected.json.

import { referencePath } from "./align.ts";
import { boundaries, cornerMarkers, cornerRows, groupCorners } from "./corners.ts";
import { anchorRamp, deltaAt, hasSectors, prepare, timeAt, type Prepared } from "./delta.ts";
import { findings } from "./findings.ts";
import {
  directionWord,
  formatLapTime,
  formatSpeed,
  formatTime,
  formatTimeDelta,
  roundHalfAway,
} from "./format.ts";
import { grid, interp, interpNullable, stepPrev } from "./interp.ts";
import { miniSectorEdges, miniSectors } from "./minisectors.ts";
import type { AnalysisConfig, Comparison, GridTrace, Lap, LapMeta, Track } from "./types.ts";

export type * from "./types.ts";
export { detectCorners, type DetectedCorner } from "./detect.ts";
export {
  deltaDisplay,
  directionWord,
  formatBrakePoint,
  formatDistance,
  formatLapTime,
  formatPercent,
  formatSeconds,
  formatSpeed,
  formatTime,
  formatTimeDelta,
  higherLower,
  laterEarlier,
  roundHalfAway,
} from "./format.ts";

/** Corner label grammar from docs/contracts.md section 4: T4, T12A, T6-7, C3. */
export const CORNER_LABEL_RE = /^[TC]\d{1,2}[A-Z]?(-\d{1,2}[A-Z]?)?$/;

export const COMPARISON_SCHEMA = "race-engineer.comparison/v1";

/** Twin: analysis.py lap_meta(). Top speed is the highest raw sample, not the grid maximum. */
export function lapMeta(lap: Lap): LapMeta {
  const st = lap.sector_ms;
  let top = -Infinity;
  for (const v of lap.samples.speed_kph) if (v > top) top = v;
  const topKph = roundHalfAway(top);
  return {
    driver: lap.driver ?? null,
    lap_no: lap.lap_no,
    origin: lap.origin,
    duration_ms: lap.duration_ms,
    sector_ms: st == null ? null : [...st],
    top_speed_kph: topKph,
    display: { lap_time: formatLapTime(lap.duration_ms), top_speed: formatSpeed(topKph) },
  };
}

/** Per-driver channels on the grid. Twin: analysis.py grid_trace(). */
export function gridTrace(P: Prepared, g: readonly number[]): GridTrace {
  const n = g.length;
  const t: number[] = new Array<number>(n);
  const speed: number[] = new Array<number>(n);
  const thr: (number | null)[] = new Array<number | null>(n);
  const brake: (boolean | null)[] = new Array<boolean | null>(n);
  const gear: (number | null)[] = new Array<number | null>(n);
  const x: number[] = new Array<number>(n);
  const y: number[] = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const v = g[i]!;
    t[i] = timeAt(P, v);
    speed[i] = interp(v, P.s, P.v);
    thr[i] = interpNullable(v, P.s, P.thr);
    brake[i] = stepPrev(v, P.s, P.brake);
    gear[i] = stepPrev(v, P.s, P.gear);
    x[i] = interp(v, P.s, P.x);
    y[i] = interp(v, P.s, P.y);
  }
  return { t_ms: t, speed_kph: speed, throttle_pct: thr, brake, gear, x, y };
}

/**
 * Compare lap A with lap B. Every time value is from A's view (above 0 means A gained).
 * track may be null: the reference path then comes from lap A, corners from the speed-minima
 * detector (labels C1..Cn), and there is no sector anchoring. Twin: analysis.py analyze_pair().
 */
export function analyzePair(
  lapA: Lap,
  lapB: Lap,
  track: Track | null,
  config: AnalysisConfig,
): Comparison {
  const path = referencePath(lapA, track);
  const L = path.L;
  const A = prepare(lapA, path, config);
  const B = prepare(lapB, path, config);
  const lines = track === null ? null : (track.sector_lines_m ?? null);
  const anchored = lines !== null && hasSectors(lapA) && hasSectors(lapB);
  if (anchored) {
    A.anchor = anchorRamp(A, lapA.sector_ms!, lines, L);
    B.anchor = anchorRamp(B, lapB.sector_ms!, lines, L);
  }

  const { markers, source, prefix } = cornerMarkers(track, path, config);
  const groups = groupCorners(markers, config.corners.group_m, prefix);
  const b = boundaries(groups, L);
  const rows = cornerRows(
    A,
    B,
    groups,
    b,
    b.map((x) => deltaAt(A, B, x)),
    config,
  );

  const edges = miniSectorEdges(L, config.minisectors.count);
  const minis = miniSectors(
    edges,
    edges.map((x) => deltaAt(A, B, x)),
    config,
  );

  const d0 = deltaAt(A, B, 0);
  const dL = deltaAt(A, B, L);
  const gap = roundHalfAway(dL) - roundHalfAway(d0);

  const g = grid(L, config.grid_step_m);
  const metaA = lapMeta(lapA);
  const metaB = lapMeta(lapB);
  return {
    schema: COMPARISON_SCHEMA,
    L_m: L,
    corner_source: source,
    anchored,
    anchor_ms: {
      a: A.anchor === null ? null : [A.anchor[1][1]!, A.anchor[1][2]!],
      b: B.anchor === null ? null : [B.anchor[1][1]!, B.anchor[1][2]!],
    },
    lap_a: metaA,
    lap_b: metaB,
    lap_gap_ms: gap,
    lap_gap_ms_float: dL - d0,
    display: {
      lap_time_a: metaA.display.lap_time,
      lap_time_b: metaB.display.lap_time,
      gap_direction: directionWord(gap),
      gap_time: formatTime(gap),
      gap: formatTimeDelta(gap),
    },
    corners: rows,
    mini_sectors: minis,
    findings: findings(rows, config),
    grid: {
      s_m: g,
      delta_ms: g.map((x) => deltaAt(A, B, x)),
      a: gridTrace(A, g),
      b: gridTrace(B, g),
    },
  };
}
