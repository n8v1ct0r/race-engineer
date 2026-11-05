// The note validator. Ports the 32 Phase 1 probe tests (numcheck-v1) to the v1 insight shape,
// then covers the critic's fixes: grouped label T6-7, letter suffix, C-label, the mandatory
// direction check and the 110-character cap. The insight below is made up, not telemetry.

import { describe, expect, it } from "vitest";
import type { Insight, InsightFinding } from "./insight.ts";
import { checkNote, checkNotes, missingNumbers, tokenize } from "./validate.ts";

const MAX = 110;

function finding(
  id: string,
  corner: string,
  cause: InsightFinding["cause"],
  display: Omit<InsightFinding["display"], "direction">,
): InsightFinding {
  const kind = id.startsWith("gain") ? "gain" : "loss";
  return {
    id,
    kind,
    corner,
    cause,
    display: { direction: kind === "gain" ? "gains" : "loses", ...display },
  };
}

const insight: Insight = {
  schema: "race-engineer.insight/v1",
  origins: { a: "synthetic", b: "synthetic" },
  perspective: "A",
  driver_a: { code: "AAA", lap_time: "1:10.270" },
  driver_b: { code: "BBB", lap_time: "1:10.424" },
  lap_gap: { direction: "gains", time: "0.154 s" },
  findings: [
    finding("gain-1", "T1", "braking", {
      time: "0.071 s",
      brake_a: "108 m before",
      brake_b: "116 m before",
      brake_diff: "8 m",
      brake_word: "later",
      min_speed_a: "88 km/h",
      min_speed_b: "84 km/h",
      min_speed_diff: "4 km/h",
      min_speed_word: "higher",
    }),
    finding("gain-2", "T10", "min_speed", {
      time: "0.048 s",
      min_speed_a: "121 km/h",
      min_speed_b: "115 km/h",
      min_speed_diff: "6 km/h",
      min_speed_word: "higher",
    }),
    finding("gain-3", "C3", "time_only", { time: "0.040 s" }),
    finding("loss-1", "T8", "min_speed", {
      time: "0.052 s",
      min_speed_a: "63 km/h",
      min_speed_b: "67 km/h",
      min_speed_diff: "4 km/h",
      min_speed_word: "lower",
    }),
    finding("loss-2", "T12A", "braking", {
      time: "0.029 s",
      brake_a: "90 m before",
      brake_b: "79 m before",
      brake_diff: "11 m",
      brake_word: "earlier",
    }),
    finding("loss-3", "T19", "exit_speed", {
      time: "0.017 s",
      exit_speed_a: "109 km/h",
      exit_speed_b: "113 km/h",
      exit_speed_diff: "4 km/h",
      exit_speed_word: "lower",
    }),
  ],
};

// A second insight with a grouped chicane label.
const grouped: Insight = {
  ...insight,
  findings: [
    finding("loss-1", "T6-7", "min_speed", {
      time: "0.150 s",
      min_speed_a: "124 km/h",
      min_speed_b: "131 km/h",
      min_speed_diff: "7 km/h",
      min_speed_word: "lower",
    }),
  ],
};

const check = (id: string, note: string, ins: Insight = insight) => checkNote(ins, id, note, MAX);

// Phase 1 pass cases. Changes for v1: signed "+4 km/h" is now unsigned, and "lap 12" became the
// lap time (lap numbers are not in the model view).
const PASS: [string, string][] = [
  ["gain-1", "T1, you gain 0.071 s braking 8 m later. Carry that into the apex."],
  ["gain-1", "Turn 1 is good. Minimum speed 88 km/h against 84 km/h, keep it."],
  ["gain-1", "T1: 4 km/h more at the apex and 0.071 s gained. Same again."],
  ["gain-2", "T10 is strong, 121 km/h at the apex. That is 0.048 s."],
  ["loss-1", "T8 costs 0.052 s. Minimum speed 63 km/h against 67 km/h, carry more."],
  ["loss-2", "T12A, you brake 11 m earlier and lose 0.029 s. Trust the car."],
  ["loss-2", "Turn 12A, braking 11 m early costs 0.029 s."],
  ["loss-3", "T19 exit is 109 km/h against 113 km/h. Get on power sooner."],
  ["gain-1", "T1 gains 0.071 s on a 1:10.270 lap. Good."],
  ["gain-1", "T1 gain is 0.071 s. Keep it."],
  ["gain-1", "T1 gains 0.071 seconds. Keep it."],
];

const FAIL: [string, string, RegExp][] = [
  ["gain-1", "T1, you gain 0.07 s braking later.", /number not in insight: "0.07 s"/],
  ["gain-1", "T1, you gain 0.071 s and 0.048 s at T10.", /corner not this finding's: "T10"/],
  ["gain-1", "T1, you gain a tenth on the brakes.", /number word: tenth/],
  ["gain-1", "T1, you gain 0.071 s. That is two car lengths.", /number word: two/],
  ["gain-1", "T1, you gain 0.071 s — keep it.", /em or en dash/],
  ["gain-1", "T1, you gain 0.071 s - keep it.", /spaced hyphen/],
  ["gain-1", "T1, you gain +0.071 s.", /number not in insight: "\+0.071 s"/],
  ["loss-1", "T8, you lose +4 km/h at the apex.", /number not in insight: "\+4 km\/h"/],
  ["gain-1", "T1, you gain 0.071 s at 212 kph.", /number not in insight: "212 km\/h"/],
  ["gain-1", "T1, you gain 0.071 s, 4 m later on the brakes.", /number not in insight: "4 m"/],
  ["gain-1", "You gain 0.071 s here.", /missing own corner label T1/],
  ["gain-1", "T1 is where you gain time.", /cites no number/],
  ["gain-1", "T1, you gain 0.071 s. Robust braking.", /banned word: robust/],
  ["gain-1", "t1, you gain 0.071 s.", /capital letter/],
  ["gain-1", "T1, you gain 0.071 s in F1 terms.", /stray digit|corner/],
  ["gain-1", "T1, gain of 0.071 s, lap 13.", /number not in insight: "13"/],
  ["gain-1", "T1, you gain 0.071 s over 1.2.3 metres.", /stray digit|number not in insight/],
  ["loss-1", "T8 costs 0.052 s, about 5% of the gap.", /number not in insight: "5%"/],
  ["loss-1", "T8 costs 0.052 s \u{1F680}.", /emoji/],
];

describe("tokenizer", () => {
  it("gives canonical number forms", () => {
    expect(
      tokenize("Turn 12A at 1:10.270, +4 km/h, 88km/h, 3rd gear, 11,800 rpm, 85 %").numbers,
    ).toEqual(["1:10.270", "+4 km/h", "88 km/h", "3rd", "11,800 rpm", "85%"]);
    expect(tokenize("Turn 12A and corner 3 and T4").corners).toEqual(["T12A", "C3", "T4"]);
    expect(tokenize("0.071 slower").numbers).toEqual(["0.071"]);
    expect(tokenize("−0.071 s").numbers).toEqual(["-0.071 s"]);
  });

  it("reads grouped labels before numbers", () => {
    const t = tokenize("T6-7 and Turn 6-7 and T12A-13 cost 0.150 s");
    expect(t.corners).toEqual(["T6-7", "T6-7", "T12A-13"]);
    expect(t.numbers).toEqual(["0.150 s"]);
  });
});

describe("Phase 1 pass cases", () => {
  for (const [id, note] of PASS) {
    it(`${id}: ${note}`, () => {
      const r = check(id, note);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    });
  }
});

describe("Phase 1 fail cases", () => {
  for (const [id, note, why] of FAIL) {
    it(`${id}: ${note}`, () => {
      const r = check(id, note);
      expect(r.ok).toBe(false);
      expect(r.errors.join("; ")).toMatch(why);
    });
  }

  it("a sign flip now fails: the model view carries no signed values", () => {
    const r = check("gain-1", "T1, you gain -0.071 s.");
    expect(r.errors).toContain('number not in insight: "-0.071 s"');
  });
});

describe("corner label grammar", () => {
  it("accepts a grouped label and its Turn form", () => {
    expect(
      check("loss-1", "T6-7, you lose 0.150 s. Minimum speed 124 km/h against 131 km/h.", grouped)
        .errors,
    ).toEqual([]);
    expect(check("loss-1", "Turn 6-7 costs 0.150 s. Carry more speed.", grouped).errors).toEqual(
      [],
    );
  });

  it("rejects half of a grouped label", () => {
    const r = check("loss-1", "T6, you lose 0.150 s.", grouped);
    expect(r.errors).toContain('corner not this finding\'s: "T6"');
    expect(r.errors).toContain("missing own corner label T6-7");
    expect(r.errors.join("; ")).not.toMatch(/"-7"/);
  });

  it("accepts a letter suffix in either case and rejects another letter", () => {
    expect(check("loss-2", "T12a, you lose 0.029 s. You brake 11 m earlier.").ok).toBe(true);
    expect(check("loss-2", "T12B, you lose 0.029 s.").errors).toContain(
      'corner not this finding\'s: "T12B"',
    );
    expect(check("loss-2", "T12, you lose 0.029 s.").errors).toContain(
      "missing own corner label T12A",
    );
  });

  it("accepts a detected C-label and rejects the T form of it", () => {
    expect(check("gain-3", "C3, you gain 0.040 s.").ok).toBe(true);
    expect(check("gain-3", "Corner 3 gives you 0.040 s.").ok).toBe(true);
    expect(check("gain-3", "T3, you gain 0.040 s.").errors).toContain(
      "missing own corner label C3",
    );
  });
});

describe("direction check", () => {
  it("a gain note may not say lose, lost or slower", () => {
    for (const w of ["lose", "lost", "slower"]) {
      const r = check("gain-1", `T1, you ${w} nothing here, 0.071 s.`);
      expect(r.errors).toContain(`wrong direction for a gain: ${w}`);
    }
  });

  it("a loss note may not say gain, gained or faster", () => {
    for (const w of ["gain", "gained", "faster"]) {
      const r = check("loss-1", `T8, you ${w} nothing here, 0.052 s.`);
      expect(r.errors).toContain(`wrong direction for a loss: ${w}`);
    }
  });
});

describe("own time (numcheck-v3)", () => {
  it("a lap-level number never stands in for the corner's time", () => {
    // lap_gap.time is 0.154 s; gain-2's own time is 0.048 s.
    for (const [id, note] of [
      ["gain-2", "T10, you gain 0.154 s."],
      ["gain-1", "T1, you gain 0.154 s. You brake 8 m later."],
      ["loss-1", "T8, you lose 0.154 s."],
    ] as const) {
      const r = check(id, note);
      expect(r.ok, note).toBe(false);
      expect(r.errors.join("; ")).toMatch(
        /cites the lap-level "0.154 s" without this corner's own/,
      );
    }
  });

  it("allows a lap-level number next to the corner's own time", () => {
    expect(check("gain-1", "T1, you gain 0.071 s of the 0.154 s lap gap.").errors).toEqual([]);
    expect(check("gain-1", "T1 gains 0.071 s on a 1:10.270 lap. Good.").errors).toEqual([]);
  });

  it("a note without any time still passes when its numbers are its own", () => {
    expect(check("loss-1", "T8, minimum speed 63 km/h against 67 km/h.").errors).toEqual([]);
  });
});

describe("comparison words and order (numcheck-v3)", () => {
  it("rejects a braking word that reverses brake_word", () => {
    // gain-1: brake_word is later.
    expect(check("gain-1", "T1, you gain 0.071 s. You brake 8 m earlier.").errors).toContain(
      'comparison word contradicts the data: "8 m earlier" (it is later)',
    );
    expect(check("gain-1", "T1, you gain 0.071 s. You brake earlier.").errors).toContain(
      "comparison word contradicts the data: earlier (it is later)",
    );
  });

  it("rejects a speed word that reverses the diff's word", () => {
    // loss-1: min_speed_word is lower.
    for (const note of [
      "T8, you lose 0.052 s. Minimum speed 4 km/h higher.",
      "T8, you lose 0.052 s, 4 km/h more at the apex.",
    ]) {
      expect(check("loss-1", note).errors.join("; "), note).toMatch(
        /comparison word contradicts the data: "4 km\/h (higher|more)" \(it is lower\)/,
      );
    }
    expect(check("loss-1", "T8, you lose 0.052 s. Minimum speed is higher.").errors).toContain(
      "comparison word contradicts the data: higher (it is lower)",
    );
  });

  it("rejects advice whose word contradicts the data, since it reads as a reversed fact", () => {
    // loss-2: driver A brakes 11 m earlier. "Brake later" cannot be told apart from "You brake later".
    expect(check("loss-2", "T12A, you lose 0.029 s. Brake later.").errors).toContain(
      "comparison word contradicts the data: later (it is earlier)",
    );
  });

  it("rejects driver B's value before driver A's", () => {
    const r = check("loss-1", "T8, you lose 0.052 s. Minimum speed 67 km/h against 63 km/h.");
    expect(r.errors).toContain(
      "driver B's value comes first: say 63 km/h (driver A) before 67 km/h",
    );
    const g = check(
      "loss-1",
      "T6-7, you lose 0.150 s. Minimum speed 131 km/h against 124 km/h.",
      grouped,
    );
    expect(g.ok).toBe(false);
  });

  it("accepts words that match the data, attached or not", () => {
    expect(check("gain-1", "T1, you gain 0.071 s. You brake 8 m later.").errors).toEqual([]);
    expect(check("gain-1", "T1, you gain 0.071 s. You brake later, 4 km/h higher.").errors).toEqual(
      [],
    );
    expect(check("loss-3", "T19, you lose 0.017 s. Exit speed 4 km/h lower.").errors).toEqual([]);
  });
});

describe("cause words (numcheck-v3)", () => {
  it("a time_only finding gives no reason", () => {
    const r = check("gain-3", "C3, you gain 0.040 s. You brake later and carry more speed.");
    expect(r.errors).toContain("gives a reason for a time_only finding: brake");
    expect(r.errors).toContain("gives a reason for a time_only finding: later");
    expect(r.errors).toContain("gives a reason for a time_only finding: carry");
    expect(r.errors).toContain("gives a reason for a time_only finding: speed");
    expect(check("gain-3", "C3, you gain 0.040 s. Your exit is better.").errors).toContain(
      "gives a reason for a time_only finding: exit",
    );
  });

  it("a note names only causes whose fields passed", () => {
    // gain-2 has min_speed fields only; loss-3 has exit_speed fields only.
    expect(check("gain-2", "T10, you gain 0.048 s. Your exit is better.").errors).toContain(
      "names a cause this finding has no data for: exit",
    );
    expect(check("loss-3", "T19, you lose 0.017 s. Brake later.").errors).toContain(
      "names a cause this finding has no data for: brake",
    );
    expect(check("loss-2", "T12A, you lose 0.029 s at the apex.").errors).toContain(
      "names a cause this finding has no data for: apex",
    );
  });
});

describe("length cap", () => {
  const head = "T1, you gain 0.071 s.";
  const pad = (n: number) => head + " " + "Keep it tidy. ".repeat(10).slice(0, n - head.length - 1);

  it("allows 110 characters and rejects 111", () => {
    const ok = pad(110).trimEnd();
    expect(ok.length).toBeLessThanOrEqual(110);
    expect(check("gain-1", ok).ok).toBe(true);
    const long = head + " " + "x".repeat(111 - head.length - 1);
    expect(long.length).toBe(111);
    expect(check("gain-1", long).errors).toContain("too long: 111 chars, max 110");
  });
});

describe("response checks", () => {
  const ids = ["gain-1", "loss-1"];

  it("accepts good notes, compares ids case-insensitively, first duplicate wins", () => {
    const r = checkNotes(
      insight,
      ids,
      {
        stop_reason: "end_turn",
        notes: [
          { finding_id: "GAIN-1", text: " T1, you gain 0.071 s. " },
          { finding_id: "gain-1", text: "T1, you gain 0.07 s." },
          { finding_id: "loss-1", text: "T8, you lose 0.052 s." },
          { finding_id: "loss-3", text: "ignored, not asked for" },
        ],
      },
      MAX,
    );
    expect([...r.accepted]).toEqual([
      ["gain-1", "T1, you gain 0.071 s."],
      ["loss-1", "T8, you lose 0.052 s."],
    ]);
    expect(r.failed).toEqual([]);
  });

  it("a missing id is a failed note", () => {
    const r = checkNotes(
      insight,
      ids,
      { stop_reason: "end_turn", notes: [{ finding_id: "gain-1", text: "T1, you gain 0.071 s." }] },
      MAX,
    );
    expect(r.failed).toEqual([
      { finding_id: "loss-1", text: null, errors: ["no note for this finding id"] },
    ]);
  });

  it("max_tokens and refusal fail every note", () => {
    for (const stop of ["max_tokens", "refusal"]) {
      const r = checkNotes(insight, ids, { stop_reason: stop, notes: [] }, MAX);
      expect(r.accepted.size).toBe(0);
      expect(r.failed.map((f) => f.finding_id)).toEqual(ids);
    }
  });

  it("unparseable output fails every note", () => {
    const r = checkNotes(insight, ids, { stop_reason: "end_turn", notes: null }, MAX);
    expect(r.failed).toHaveLength(2);
  });
});

describe("missingNumbers", () => {
  it("lists only tokens outside the finding's own strings and the lap strings", () => {
    expect(missingNumbers(insight, "gain-1", "T1 gains 0.071 s, 8 m later, lap 1:10.424.")).toEqual(
      [],
    );
    expect(missingNumbers(insight, "gain-1", "T1 gains 0.048 s and 0.071 s.")).toEqual(["0.048 s"]);
  });
});
