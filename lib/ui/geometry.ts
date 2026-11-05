// Where each car is for a given cursor. Distance mode puts both cars at one grid index; time mode
// (the ghost replay) finds each car's own fractional index from its elapsed time on the grid.
// Pure and browser-safe. Values here feed the map and charts; the readout formats them through
// lib/analysis/format.ts.

import type { Comparison, GridTrace } from "../analysis/index.ts";
import type { Cursor } from "../cursor-store.ts";

export type CarPoint = {
  /** Fractional grid index (0 to n-1). */
  f: number;
  s_m: number;
  t_ms: number;
  x: number;
  y: number;
  speed_kph: number;
};

export type CursorPoint = {
  mode: Cursor["mode"];
  /** Nearest grid index for distance mode, or A's nearest index in time mode. */
  i: number;
  a: CarPoint;
  b: CarPoint;
  /** Time delta at the cursor in ms, A's view (above 0 means A is ahead). Distance mode only. */
  delta_ms: number | null;
  /** Elapsed lap time in time mode. */
  t_ms: number | null;
};

function lerp(arr: readonly number[], f: number): number {
  const i0 = Math.floor(f);
  const i1 = Math.min(i0 + 1, arr.length - 1);
  const w = f - i0;
  const v0 = arr[i0] ?? 0;
  const v1 = arr[i1] ?? v0;
  return v0 + (v1 - v0) * w;
}

function carAt(s: readonly number[], tr: GridTrace, f: number): CarPoint {
  return {
    f,
    s_m: lerp(s, f),
    t_ms: lerp(tr.t_ms, f),
    x: lerp(tr.x, f),
    y: lerp(tr.y, f),
    speed_kph: lerp(tr.speed_kph, f),
  };
}

/** Fractional index where a monotonic time trace reaches tMs, clamped to the lap. */
export function indexAtTime(t: readonly number[], tMs: number): number {
  const n = t.length;
  if (n === 0) return 0;
  if (tMs <= (t[0] ?? 0)) return 0;
  if (tMs >= (t[n - 1] ?? 0)) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((t[mid] ?? 0) <= tMs) lo = mid;
    else hi = mid;
  }
  const t0 = t[lo] ?? 0;
  const t1 = t[hi] ?? t0;
  return t1 === t0 ? lo : lo + (tMs - t0) / (t1 - t0);
}

/** Nearest grid index to a distance in m. */
export function indexAtDistance(c: Comparison, sM: number): number {
  const s = c.grid.s_m;
  const n = s.length;
  if (n === 0) return 0;
  let lo = 0;
  let hi = n - 1;
  if (sM <= (s[0] ?? 0)) return 0;
  if (sM >= (s[hi] ?? 0)) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((s[mid] ?? 0) <= sM) lo = mid;
    else hi = mid;
  }
  return sM - (s[lo] ?? 0) <= (s[hi] ?? 0) - sM ? lo : hi;
}

export function clampIndex(c: Comparison, i: number): number {
  const n = c.grid.s_m.length;
  if (n === 0) return 0;
  return Math.max(0, Math.min(n - 1, Math.round(i)));
}

export function cursorPoint(c: Comparison, cursor: Cursor): CursorPoint {
  const s = c.grid.s_m;
  if (cursor.mode === "distance") {
    const i = clampIndex(c, cursor.i);
    return {
      mode: "distance",
      i,
      a: carAt(s, c.grid.a, i),
      b: carAt(s, c.grid.b, i),
      delta_ms: c.grid.delta_ms[i] ?? 0,
      t_ms: null,
    };
  }
  const tMs = Math.max(0, cursor.tMs);
  const fa = indexAtTime(c.grid.a.t_ms, tMs);
  const fb = indexAtTime(c.grid.b.t_ms, tMs);
  return {
    mode: "time",
    i: clampIndex(c, fa),
    a: carAt(s, c.grid.a, fa),
    b: carAt(s, c.grid.b, fb),
    delta_ms: null,
    t_ms: tMs,
  };
}

/** Longest of the two laps on the grid, the end of the replay's time axis. */
export function replayEndMs(c: Comparison): number {
  const ta = c.grid.a.t_ms;
  const tb = c.grid.b.t_ms;
  return Math.max(ta[ta.length - 1] ?? 0, tb[tb.length - 1] ?? 0);
}

/** A's elapsed time at a cursor, for the scrub bar. */
export function cursorTimeMs(c: Comparison, cursor: Cursor): number {
  if (cursor.mode === "time") return Math.max(0, cursor.tMs);
  return c.grid.a.t_ms[clampIndex(c, cursor.i)] ?? 0;
}
