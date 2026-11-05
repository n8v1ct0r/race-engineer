// Prepared laps, sector anchoring and the time delta. Twin: pipeline/reference/analysis.py, section "delta".

import { align, pick, strictlyIncreasingKeep, type ReferencePath } from "./align.ts";
import { interp } from "./interp.ts";
import type { AnalysisConfig, Lap } from "./types.ts";

/** One lap on the common axis: strictly increasing s, time from 0, optional anchoring ramp. */
export type Prepared = {
  s: number[];
  t: number[];
  v: number[];
  brake: (boolean | null)[];
  thr: (number | null)[];
  gear: (number | null)[];
  x: number[];
  y: number[];
  anchor: [number[], number[]] | null;
};

/** Twin: analysis.py has_sectors(). */
export function hasSectors(lap: Lap): boolean {
  const st = lap.sector_ms;
  return st != null && st.length === 3 && st[0] != null && st[1] != null;
}

/** Aligned, strictly increasing samples of one lap. Time starts at 0. Twin: analysis.py prepare(). */
export function prepare(lap: Lap, path: ReferencePath, cfg: AnalysisConfig): Prepared {
  const s0 = align(lap, path, cfg);
  const smp = lap.samples;
  const tRaw = smp.t_ms;
  const t0 = tRaw[0]!;
  const t = tRaw.map((v) => v - t0);
  const keep = strictlyIncreasingKeep(s0);
  return {
    s: pick(s0, keep),
    t: pick(t, keep),
    v: pick(smp.speed_kph, keep),
    brake: pick(smp.brake, keep),
    thr: pick(smp.throttle_pct, keep),
    gear: pick(smp.gear, keep),
    x: pick(smp.x, keep),
    y: pick(smp.y, keep),
    anchor: null,
  };
}

/**
 * Linear time correction through (0, 0), (line 1, c1), (line 2, c2), (L, 0) so t hits the
 * official splits at the sector lines. Twin: analysis.py anchor_ramp().
 */
export function anchorRamp(
  P: Prepared,
  sectorMs: readonly number[],
  lines: readonly number[],
  L: number,
): [number[], number[]] {
  const c1 = sectorMs[0]! - interp(lines[0]!, P.s, P.t);
  const c2 = sectorMs[0]! + sectorMs[1]! - interp(lines[1]!, P.s, P.t);
  return [
    [0, lines[0]!, lines[1]!, L],
    [0, c1, c2, 0],
  ];
}

/** Twin: analysis.py time_at(). */
export function timeAt(P: Prepared, x: number): number {
  let t = interp(x, P.s, P.t);
  if (P.anchor !== null) t = t + interp(x, P.anchor[0], P.anchor[1]);
  return t;
}

/** delta(x) = tB(x) - tA(x) in ms; above 0 means A gained up to x. Twin: analysis.py delta_at(). */
export function deltaAt(A: Prepared, B: Prepared, x: number): number {
  return timeAt(B, x) - timeAt(A, x);
}
