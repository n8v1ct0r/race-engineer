// Fallback corner detector: speed minima on the reference path.
// Twin: pipeline/reference/analysis.py, section "detect".

import { roundHalfAway } from "./format.ts";
import { grid, interp } from "./interp.ts";
import type { AnalysisConfig } from "./types.ts";

export type DetectedCorner = { s_m: number; v_smooth_kph: number; prominence_kph: number };

/** Centered moving average, window shrinking at the edges. Twin: analysis.py moving_average(). */
export function movingAverage(v: readonly number[], half: number): number[] {
  const out: number[] = [];
  const n = v.length;
  for (let i = 0; i < n; i++) {
    const lo = i - half > 0 ? i - half : 0;
    const hi = i + half < n - 1 ? i + half : n - 1;
    let acc = 0;
    for (let j = lo; j <= hi; j++) acc += v[j]!;
    out.push(acc / (hi - lo + 1));
  }
  return out;
}

/**
 * Local minima (strict on the left, non-strict on the right) with scipy-style prominence,
 * lap edges acting as bases. Twin: analysis.py minima_with_prominence().
 */
export function minimaWithProminence(v: readonly number[]): [number, number][] {
  const res: [number, number][] = [];
  const n = v.length;
  for (let i = 1; i < n - 1; i++) {
    const vi = v[i]!;
    if (vi < v[i - 1]! && vi <= v[i + 1]!) {
      let lm = vi;
      let j = i - 1;
      while (j >= 0 && v[j]! >= vi) {
        if (v[j]! > lm) lm = v[j]!;
        j -= 1;
      }
      let rm = vi;
      j = i + 1;
      while (j < n && v[j]! >= vi) {
        if (v[j]! > rm) rm = v[j]!;
        j += 1;
      }
      res.push([i, (lm < rm ? lm : rm) - vi]);
    }
  }
  return res;
}

/** Speed minima on the reference path, lowest first, at least min_spacing_m apart. Twin: analysis.py detect_corners(). */
export function detectCorners(
  s: readonly number[],
  speed: readonly number[],
  cfg: AnalysisConfig,
): DetectedCorner[] {
  const step = cfg.grid_step_m;
  const smoothM = cfg.detector.smooth_window_m;
  const prominenceKph = cfg.detector.prominence_kph;
  const minSpacingM = cfg.detector.min_spacing_m;
  const g = grid(s[s.length - 1]!, step);
  const v = g.map((x) => interp(x, s, speed));
  const half = roundHalfAway(smoothM / step / 2);
  const vs = half > 0 ? movingAverage(v, half) : v;
  const cands = minimaWithProminence(vs).filter((ip) => ip[1] >= prominenceKph);
  // lowest speed first, then earliest
  cands.sort((a, b) => vs[a[0]]! - vs[b[0]]! || a[0] - b[0]);
  const kept: [number, number][] = [];
  for (const [i, p] of cands) {
    let ok = true;
    for (const [k] of kept) {
      if (!(Math.abs(g[i]! - g[k]!) >= minSpacingM)) {
        ok = false;
        break;
      }
    }
    if (ok) kept.push([i, p]);
  }
  kept.sort((a, b) => a[0] - b[0]);
  return kept.map(([i, p]) => ({ s_m: g[i]!, v_smooth_kph: vs[i]!, prominence_kph: p }));
}
