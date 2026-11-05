// Interpolation, projection and the grid. Twin: pipeline/reference/analysis.py, section "interp".
// Same loops, comparisons and operation order as the Python reference; do not "simplify" them,
// parity with fixtures/parity/expected.json depends on it.

/** Linear interpolation, xp strictly increasing, clamped outside. Twin: analysis.py interp(). */
export function interp(x: number, xp: readonly number[], fp: readonly number[]): number {
  const n = xp.length;
  if (x <= xp[0]!) return fp[0]!;
  if (x >= xp[n - 1]!) return fp[n - 1]!;
  let lo = 0;
  let hi = n - 1; // binary search: xp[lo] <= x < xp[hi]
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (xp[mid]! <= x) lo = mid;
    else hi = mid;
  }
  if (x === xp[lo]) return fp[lo]!;
  return fp[lo]! + (fp[hi]! - fp[lo]!) * ((x - xp[lo]!) / (xp[hi]! - xp[lo]!));
}

/** interp() for channels that may hold null: null when either neighbor is null. Twin: analysis.py interp_nullable(). */
export function interpNullable(
  x: number,
  xp: readonly number[],
  fp: readonly (number | null)[],
): number | null {
  const n = xp.length;
  if (x <= xp[0]!) return fp[0] as number | null;
  if (x >= xp[n - 1]!) return fp[n - 1] as number | null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (xp[mid]! <= x) lo = mid;
    else hi = mid;
  }
  if (x === xp[lo]) return fp[lo] as number | null;
  const a = fp[lo] as number | null;
  const b = fp[hi] as number | null;
  if (a === null || b === null) return null;
  return a + (b - a) * ((x - xp[lo]!) / (xp[hi]! - xp[lo]!));
}

/** Previous-value lookup: value of the last sample with xp <= x. Twin: analysis.py step_prev(). */
export function stepPrev<T>(x: number, xp: readonly number[], fp: readonly T[]): T {
  const n = xp.length;
  if (x < xp[0]!) return fp[0] as T;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (xp[mid]! <= x) lo = mid;
    else hi = mid;
  }
  return fp[lo] as T;
}

/**
 * Nearest point on the polyline segments whose D range overlaps [lo, hi].
 * Returns [distance along D, squared lateral error]. Ties keep the first segment (strict <).
 * Squared distances only: Math.hypot differs from Python. Twin: analysis.py project().
 */
export function project(
  px: number,
  py: number,
  X: readonly number[],
  Y: readonly number[],
  D: readonly number[],
  lo: number,
  hi: number,
): [number, number] {
  const n = X.length;
  let k0 = 0;
  while (k0 < n - 2 && D[k0 + 1]! < lo) k0 += 1;
  let k1 = k0;
  while (k1 < n - 2 && D[k1 + 1]! <= hi) k1 += 1;
  let bestE2 = Infinity;
  let bestD = D[k0]!;
  for (let k = k0; k <= k1; k++) {
    const ex = X[k + 1]! - X[k]!;
    const ey = Y[k + 1]! - Y[k]!;
    const l2 = ex * ex + ey * ey;
    let u = l2 === 0 ? 0 : ((px - X[k]!) * ex + (py - Y[k]!) * ey) / l2;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    const qx = X[k]! + u * ex;
    const qy = Y[k]! + u * ey;
    const e2 = (qx - px) * (qx - px) + (qy - py) * (qy - py);
    if (e2 < bestE2) {
      bestE2 = e2;
      bestD = D[k]! + u * (D[k + 1]! - D[k]!);
    }
  }
  return [bestD, bestE2];
}

/** Equal-step grid on [0, L], always ending exactly at L. Twin: analysis.py grid(). */
export function grid(L: number, step: number): number[] {
  const g: number[] = [];
  let i = 0;
  while (i * step < L) {
    g.push(i * step);
    i += 1;
  }
  g.push(L);
  return g;
}
