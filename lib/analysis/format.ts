// Display formatter. Twin: pipeline/reference/format.py (docs/contracts.md section 5).
// Every number that can reach the UI or a note is formatted here, once, from an integer.
// Never call toFixed, toPrecision or Math.round on a value that reaches the UI or a note.

import type { DeltaDisplay, Direction } from "./types.ts";

/**
 * Round to the nearest integer, halves away from zero. Never returns -0.
 * Twin: format.py round_half_away(). Math.round(-2.5) is -2 and Python round(12.5) is 12;
 * this gives -3 and 13 in both languages.
 */
export function roundHalfAway(x: number): number {
  const r = Math.floor(Math.abs(x) + 0.5);
  return x < 0 && r !== 0 ? -r : r;
}

function requireInt(value: number, name: string): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer, got ${String(value)}`);
  }
}

/** Twin: format.py direction_word(). A's view: above 0 gains, below 0 loses, 0 level. */
export function directionWord(ms: number): Direction {
  requireInt(ms, "ms");
  if (ms > 0) return "gains";
  if (ms < 0) return "loses";
  return "level";
}

/** Twin: format.py format_seconds(). Integer ms to an unsigned magnitude, 3 dp: 1250 -> "1.250". */
export function formatSeconds(ms: number): string {
  requireInt(ms, "ms");
  const m = ms < 0 ? -ms : ms;
  let frac = String(m % 1000);
  while (frac.length < 3) frac = "0" + frac;
  return String(Math.floor(m / 1000)) + "." + frac;
}

/** Twin: format.py format_time(). "0.103 s" (magnitude, no sign). */
export function formatTime(ms: number): string {
  return formatSeconds(ms) + " s";
}

/** Twin: format.py format_time_delta(). "gains 0.103 s", "loses 0.084 s" or "level". */
export function formatTimeDelta(ms: number): string {
  const word = directionWord(ms);
  if (word === "level") return "level";
  return word + " " + formatTime(ms);
}

/** Twin: format.py delta_display(). The three display strings of one time delta. */
export function deltaDisplay(ms: number): DeltaDisplay {
  return { direction: directionWord(ms), time: formatTime(ms), delta: formatTimeDelta(ms) };
}

/** Twin: format.py format_lap_time(). Integer ms to "m:ss.sss": 85371 -> "1:25.371". */
export function formatLapTime(ms: number): string {
  requireInt(ms, "ms");
  if (ms < 0) throw new RangeError("lap time must not be negative");
  const minutes = Math.floor(ms / 60000);
  const rest = ms % 60000;
  let secs = String(Math.floor(rest / 1000));
  if (secs.length < 2) secs = "0" + secs;
  let frac = String(rest % 1000);
  while (frac.length < 3) frac = "0" + frac;
  return String(minutes) + ":" + secs + "." + frac;
}

/** Twin: format.py format_speed(). Integer km/h, unsigned: "234 km/h". */
export function formatSpeed(kph: number): string {
  requireInt(kph, "kph");
  return String(kph < 0 ? -kph : kph) + " km/h";
}

/** Twin: format.py format_percent(). Integer percent, unsigned: "85%". */
export function formatPercent(pct: number): string {
  requireInt(pct, "pct");
  return String(pct < 0 ? -pct : pct) + "%";
}

/** Twin: format.py format_distance(). Integer m, unsigned: "54 m". */
export function formatDistance(m: number): string {
  requireInt(m, "m");
  return String(m < 0 ? -m : m) + " m";
}

/** Twin: format.py format_brake_point(). Integer m before the first marker: "54 m before", "12 m after". */
export function formatBrakePoint(beforeM: number): string {
  requireInt(beforeM, "beforeM");
  if (beforeM < 0) return formatDistance(beforeM) + " after";
  return formatDistance(beforeM) + " before";
}

/** Twin: format.py later_earlier(). A's braking point relative to B. */
export function laterEarlier(diffM: number): "later" | "earlier" | "same" {
  requireInt(diffM, "diffM");
  if (diffM > 0) return "later";
  if (diffM < 0) return "earlier";
  return "same";
}

/** Twin: format.py higher_lower(). A's speed relative to B. */
export function higherLower(diff: number): "higher" | "lower" | "same" {
  requireInt(diff, "diff");
  if (diff > 0) return "higher";
  if (diff < 0) return "lower";
  return "same";
}
