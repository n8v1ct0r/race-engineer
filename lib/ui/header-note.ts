// The sentence under the compare header: whether the time gap is anchored to sector times, and
// where the corner rows come from. Pure, so the server can render it for a session's default pair
// at build time (on phones it is the page's largest text, so it sets LCP) and the browser renders
// the identical string once its own analysis finishes.

import type { Comparison, Track } from "../analysis/types.ts";

/** Why the time gap is or is not anchored, from the same inputs analyzePair used. */
export function anchorNote(c: Comparison, track: Track | null): string {
  if (c.anchored) return "Time gap anchored to the 3 official sector times of both laps.";
  if (track === null) {
    return "Time gap not anchored to sector times: this session has no track file.";
  }
  if (track.sector_lines_m == null) {
    return "Time gap not anchored to sector times: the track file has no sector lines.";
  }
  return "Time gap not anchored to sector times: at least 1 lap has none.";
}

/** Where the corner rows come from. */
export function cornerNote(c: Comparison): string {
  return c.corner_source === "official"
    ? `${String(c.corners.length)} corner rows from the official corner markers.`
    : `${String(c.corners.length)} corner rows found from speed minima, labeled C1 upward.`;
}

/** The full header sentence. */
export function headerNote(c: Comparison, track: Track | null): string {
  return `${anchorNote(c, track)} ${cornerNote(c)}`;
}
