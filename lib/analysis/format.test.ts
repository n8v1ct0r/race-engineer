// Formatter rules (docs/contracts.md section 5). The same cases run in pipeline/tests/test_reference.py.

import { describe, expect, it } from "vitest";
import {
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

describe("roundHalfAway", () => {
  it("rounds halves away from zero where JS and Python disagree", () => {
    // Python round(12.5) is 12; JS Math.round(12.5) is 13. Both sides must give 13.
    expect(roundHalfAway(12.5)).toBe(13);
    // JS Math.round(-2.5) is -2. Half away gives -3.
    expect(Math.round(-2.5)).toBe(-2);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(-12.5)).toBe(-13);
    expect(roundHalfAway(0.5)).toBe(1);
    expect(roundHalfAway(-0.5)).toBe(-1);
    expect(roundHalfAway(2.4999)).toBe(2);
    expect(roundHalfAway(7)).toBe(7);
  });

  it("never returns -0", () => {
    // The traps: Math.round(-0.4) is -0 and (-0.4).toFixed(0) is "-0".
    expect(Object.is(Math.round(-0.4), -0)).toBe(true);
    expect((-0.4).toFixed(0)).toBe("-0");
    for (const x of [-0.4, -0, 0, -0.49]) {
      const r = roundHalfAway(x);
      expect(Object.is(r, 0)).toBe(true);
      expect(String(r)).toBe("0");
    }
    expect(formatTimeDelta(roundHalfAway(-0.4))).toBe("level");
    expect(formatSeconds(roundHalfAway(-0.4))).toBe("0.000");
  });
});

describe("time strings", () => {
  it("formats seconds from integer ms with integer math", () => {
    expect(formatSeconds(1250)).toBe("1.250");
    expect(formatSeconds(103)).toBe("0.103");
    expect(formatSeconds(-84)).toBe("0.084");
    expect(formatSeconds(0)).toBe("0.000");
    expect(formatSeconds(5)).toBe("0.005");
    expect(formatTime(1250)).toBe("1.250 s");
  });

  it("uses direction words, never signs", () => {
    expect(formatTimeDelta(103)).toBe("gains 0.103 s");
    expect(formatTimeDelta(-84)).toBe("loses 0.084 s");
    expect(formatTimeDelta(0)).toBe("level");
    expect(directionWord(-1)).toBe("loses");
    expect(deltaDisplay(-1250)).toEqual({
      direction: "loses",
      time: "1.250 s",
      delta: "loses 1.250 s",
    });
    for (const ms of [-1250, -84, -1, 0, 1, 84, 1250])
      expect(formatTimeDelta(ms)).not.toContain("-");
  });

  it("formats lap times as m:ss.sss", () => {
    expect(formatLapTime(85371)).toBe("1:25.371");
    expect(formatLapTime(85275)).toBe("1:25.275");
    expect(formatLapTime(60000)).toBe("1:00.000");
    expect(formatLapTime(5)).toBe("0:00.005");
    expect(formatLapTime(605004)).toBe("10:05.004");
  });
});

describe("units and words", () => {
  it("formats speeds and distances unsigned", () => {
    expect(formatSpeed(234)).toBe("234 km/h");
    expect(formatSpeed(-6)).toBe("6 km/h");
    expect(formatDistance(54)).toBe("54 m");
    expect(formatDistance(-54)).toBe("54 m");
    expect(formatBrakePoint(54)).toBe("54 m before");
    expect(formatBrakePoint(-12)).toBe("12 m after");
    expect(formatPercent(85)).toBe("85%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(100)).toBe("100%");
    expect(laterEarlier(15)).toBe("later");
    expect(laterEarlier(-15)).toBe("earlier");
    expect(higherLower(6)).toBe("higher");
    expect(higherLower(-6)).toBe("lower");
  });

  it("accepts integers only", () => {
    for (const fn of [
      formatSeconds,
      formatLapTime,
      formatSpeed,
      formatDistance,
      formatPercent,
      directionWord,
    ]) {
      expect(() => fn(1.5)).toThrow(TypeError);
      expect(() => fn(Number.NaN)).toThrow(TypeError);
    }
  });
});
