// Equal-distance mini-sectors. Twin: pipeline/reference/analysis.py, section "mini-sectors".

import { deltaDisplay, roundHalfAway } from "./format.ts";
import type { AnalysisConfig, Faster, MiniSector } from "./types.ts";

/** count equal-distance slices of [0, L]; the last edge is exactly L. Twin: analysis.py mini_sector_edges(). */
export function miniSectorEdges(L: number, count: number): number[] {
  const edges: number[] = [];
  for (let j = 0; j < count; j++) edges.push((L * j) / count);
  edges.push(L);
  return edges;
}

/** deltas[j] = delta(edges[j]). Twin: analysis.py mini_sectors(). */
export function miniSectors(
  edges: readonly number[],
  deltas: readonly number[],
  cfg: AnalysisConfig,
): MiniSector[] {
  const faintBelow = cfg.minisectors.faint_below_ms;
  const out: MiniSector[] = [];
  for (let j = 0; j < edges.length - 1; j++) {
    const dlo = deltas[j]!;
    const dhi = deltas[j + 1]!;
    const di = roundHalfAway(dhi) - roundHalfAway(dlo);
    let faster: Faster;
    if (di > 0) faster = "A";
    else if (di < 0) faster = "B";
    else faster = "tie";
    out.push({
      index: j,
      s_start_m: edges[j]!,
      s_end_m: edges[j + 1]!,
      delta_ms: di,
      delta_ms_float: dhi - dlo,
      faster,
      faint: Math.abs(di) < faintBelow,
      display: deltaDisplay(di),
    });
  }
  return out;
}
