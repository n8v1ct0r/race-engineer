// Pure helpers in lib/data.ts: pair fallback and its message, lap flags. The session below is made
// up, not a manifest from public/data.

import { describe, expect, it } from "vitest";
import {
  flagReason,
  lapFlags,
  replacedMessage,
  resolvePair,
  sentenceCase,
  type ManifestLap,
  type Session,
} from "./data.ts";

function lap(lap_id: string, duration_ms: number, over: Partial<ManifestLap> = {}): ManifestLap {
  return {
    lap_id,
    lap_no: Number(lap_id.split("-")[1]),
    duration_ms,
    sector_ms: null,
    segment: null,
    compound: null,
    tyre_life: null,
    personal_best: null,
    deleted: false,
    deleted_reason: null,
    yellow: null,
    qa: "ok",
    qa_notes: [],
    ...over,
  };
}

const session: Session = {
  session_id: "synthetic-demo",
  origin: "synthetic",
  season: null,
  round: null,
  event_name: "Synthetic demo",
  location: "Nowhere",
  location_slug: "nowhere",
  session_code: "Q",
  session_name: "Qualifying",
  date: null,
  track_id: "synthetic-loop",
  corner_source: "official",
  default_pair: { a: "AAA-1", b: "BBB-1" },
  drivers: [
    { code: "AAA", laps: [lap("AAA-1", 85275)] },
    { code: "BBB", laps: [lap("BBB-1", 85371)] },
    { code: "CCC", laps: [lap("CCC-1", 85341)] },
  ],
};

describe("resolvePair", () => {
  it("replaces only the unknown slot and names the lap shown instead", () => {
    const p = resolvePair(session, "AAA-9", "CCC-1");
    expect([p.a, p.b]).toEqual(["AAA-1", "CCC-1"]);
    expect(p.unknown).toEqual(["AAA-9"]);
    expect(replacedMessage(p.replaced)).toBe(
      "AAA-9 is not in this session. Showing AAA-1, the default lap A, instead.",
    );
  });

  it("says default pair only when both slots fell back", () => {
    const p = resolvePair(session, "AAA-9", "ZZZ-1");
    expect([p.a, p.b]).toEqual(["AAA-1", "BBB-1"]);
    expect(replacedMessage(p.replaced)).toBe(
      "AAA-9 and ZZZ-1 are not in this session. Showing the default pair, AAA-1 and BBB-1, instead.",
    );
  });

  it("has no message when both ids are known or missing", () => {
    expect(replacedMessage(resolvePair(session, "CCC-1", null).replaced)).toBeNull();
  });
});

describe("lap flags", () => {
  it("writes race control text in sentence case", () => {
    expect(sentenceCase("TRACK LIMITS AT TURN 7 LAP 12")).toBe("Track limits at turn 7, lap 12");
    expect(sentenceCase("DOUBLE YELLOW AT TURN 4B")).toBe("Double yellow at turn 4B");
    const flags = lapFlags(
      lap("AAA-2", 86000, { deleted: true, deleted_reason: "TRACK LIMITS AT TURN 7 LAP 12" }),
    );
    expect(flags[0]).toEqual({
      key: "deleted",
      label: "Deleted",
      detail: "Lap time deleted: Track limits at turn 7, lap 12",
    });
  });
});

describe("flag reasons", () => {
  it("shows the reason as a phrase and leaves it off when the label says it all", () => {
    const [low] = lapFlags(
      lap("AAA-3", 86000, {
        qa: "low_confidence",
        qa_notes: ["Telemetry gap of 1250 ms", "Sector anchor correction of 134 ms"],
      }),
    );
    expect(flagReason(low!)).toBe("telemetry gap of 1250 ms; sector anchor correction of 134 ms");
    const [deleted] = lapFlags(
      lap("AAA-4", 86000, { deleted: true, deleted_reason: "TRACK LIMITS AT TURN 7 LAP 12" }),
    );
    expect(flagReason(deleted!)).toBe("track limits at turn 7, lap 12");
    const [yellow] = lapFlags(lap("AAA-5", 86000, { yellow: true }));
    expect(flagReason(yellow!)).toBeNull();
    const [bare] = lapFlags(lap("AAA-6", 86000, { deleted: true }));
    expect(flagReason(bare!)).toBeNull();
  });
});
