import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import analysisConfig from "../../analysis-config.json";
import { analyzePair } from "../analysis/index.ts";
import type { AnalysisConfig, Lap, Track } from "../analysis/types.ts";
import { anchorNote, cornerNote, headerNote } from "./header-note.ts";

const dir = path.join(__dirname, "..", "..", "public", "demo", "synthetic-demo");
const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as T;
const config: AnalysisConfig = analysisConfig;
const track = read<Track>("track.json");
const aaa = read<Lap>("laps/AAA-1.json");
const bbb = read<Lap>("laps/BBB-1.json");
const ccc = read<Lap>("laps/CCC-1.json");

describe("header note", () => {
  it("says anchored when both laps have sectors and the track has sector lines", () => {
    const c = analyzePair(aaa, bbb, track, config);
    expect(c.anchored).toBe(true);
    expect(anchorNote(c, track)).toBe(
      "Time gap anchored to the 3 official sector times of both laps.",
    );
    expect(cornerNote(c)).toBe(
      `${String(c.corners.length)} corner rows from the official corner markers.`,
    );
    expect(headerNote(c, track)).toBe(`${anchorNote(c, track)} ${cornerNote(c)}`);
  });

  it("names the lap without sectors (the Photoncar path)", () => {
    const c = analyzePair(aaa, ccc, track, config);
    expect(c.anchored).toBe(false);
    expect(anchorNote(c, track)).toBe(
      "Time gap not anchored to sector times: at least 1 lap has none.",
    );
  });

  it("names a missing track file and falls back to detected corners", () => {
    const c = analyzePair(aaa, bbb, null, config);
    expect(anchorNote(c, null)).toBe(
      "Time gap not anchored to sector times: this session has no track file.",
    );
    expect(cornerNote(c)).toBe(
      `${String(c.corners.length)} corner rows found from speed minima, labeled C1 upward.`,
    );
  });

  it("names a track file without sector lines", () => {
    const noLines: Track = { ...track, sector_lines_m: null };
    const c = analyzePair(aaa, bbb, noLines, config);
    expect(anchorNote(c, noLines)).toBe(
      "Time gap not anchored to sector times: the track file has no sector lines.",
    );
  });
});
