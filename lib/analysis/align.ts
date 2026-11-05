// Alignment onto the common axis s in [0, L]. Twin: pipeline/reference/analysis.py, section "align".

import { interp, project } from "./interp.ts";
import type { AnalysisConfig, Lap, Track } from "./types.ts";

/** The reference path: common axis s, its XY and speed, and its length L. */
export type ReferencePath = { s: number[]; x: number[]; y: number[]; speed: number[]; L: number };

/**
 * Indices of the samples whose s strictly increases (keeps the first).
 * Twin: analysis.py strictly_increasing() (same keep loop; pick() applies it to each array).
 */
export function strictlyIncreasingKeep(s: readonly number[]): number[] {
  const keep = [0];
  for (let i = 1; i < s.length; i++) {
    if (s[i]! > s[keep[keep.length - 1]!]!) keep.push(i);
  }
  return keep;
}

/** Twin: the list comprehensions inside analysis.py strictly_increasing(). */
export function pick<T>(a: readonly T[], keep: readonly number[]): T[] {
  return keep.map((i) => a[i] as T);
}

/**
 * The common axis. From track.path when a track is given, else from lap A's own samples.
 * Twin: analysis.py reference_path().
 */
export function referencePath(lapA: Lap, track: Track | null): ReferencePath {
  if (track !== null) {
    const p = track.path;
    return { s: p.s_m, x: p.x, y: p.y, speed: p.speed_kph, L: track.L_m };
  }
  const smp = lapA.samples;
  const d = smp.dist_m;
  const d0 = d[0]!;
  const sRaw = d.map((v) => v - d0);
  const keep = strictlyIncreasingKeep(sRaw);
  const s = pick(sRaw, keep);
  return {
    s,
    x: pick(smp.x, keep),
    y: pick(smp.y, keep),
    speed: pick(smp.speed_kph, keep),
    L: s[s.length - 1]!,
  };
}

/**
 * Map each sample of a lap onto the reference axis [0, L]. Twin: analysis.py align().
 * 1) proportional guess g = own distance from its start, scaled to L;
 * 2) project each interior sample's XY onto the reference path, offset r = projected - g;
 * 3) average r within +-smooth_half_m of knots every knot_step_m;
 * 4) piecewise-linear warp g -> g + mean r, pinned at 0 and L.
 */
export function align(lap: Lap, path: ReferencePath, cfg: AnalysisConfig): number[] {
  const knotStep = cfg.align.knot_step_m;
  const smoothHalf = cfg.align.smooth_half_m;
  const window = cfg.align.search_window_m;
  const minGap = cfg.align.min_knot_gap_m;
  const smp = lap.samples;
  const d = smp.dist_m;
  const px = smp.x;
  const py = smp.y;
  const n = d.length;
  const dFirst = d[0]!;
  const d0 = d.map((v) => v - dFirst);
  const L = path.L;
  const scale = d0[n - 1]! / L;
  const g = d0.map((v) => v / scale);
  const gs: number[] = [];
  const rs: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const gi = g[i]!;
    const [p] = project(px[i]!, py[i]!, path.x, path.y, path.s, gi - window, gi + window);
    gs.push(gi);
    rs.push(p - gi);
  }
  const kg = [0];
  const ks = [0];
  let j = 1;
  while (knotStep * j < L - knotStep / 2) {
    const c = knotStep * j;
    let acc = 0;
    let cnt = 0;
    for (let q = 0; q < gs.length; q++) {
      if (gs[q]! >= c - smoothHalf && gs[q]! <= c + smoothHalf) {
        acc += rs[q]!;
        cnt += 1;
      }
    }
    if (cnt > 0) {
      const sk = c + acc / cnt;
      if (sk > ks[ks.length - 1]! + minGap && sk < L - minGap) {
        kg.push(c);
        ks.push(sk);
      }
    }
    j += 1;
  }
  kg.push(L);
  ks.push(L);
  return g.map((v) => interp(v, kg, ks));
}
