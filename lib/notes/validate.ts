// The note validator: a tokenizer that fails closed, plus copy, direction and fact rules.
// Pure and browser-safe. Ported from the Phase 1 probe (numcheck-v1) with the critic's fixes:
// corner labels (including groups like T6-7) are matched before number tokens, the direction
// check is mandatory, and the length cap comes from analysis-config.json (notes.max_chars).
// numcheck-v3 adds the fact rules of docs/contracts.md section 6: a lap-level number never stands
// in for the corner's own time, comparison words and "X against Y" order must match the data, and
// a note names only causes whose display fields passed their checks (code picks the cause).

import { BANNED_WORD_RE, DASH_RE } from "./copy-rules.ts";
import { globalStrings, type Insight, type InsightFinding } from "./insight.ts";

export const VALIDATOR_VERSION = "numcheck-v3";

const UNIT_CANON: Record<string, string> = {
  "km/h": "km/h",
  kph: "km/h",
  kmh: "km/h",
  s: "s",
  sec: "s",
  secs: "s",
  second: "s",
  seconds: "s",
  m: "m",
  metre: "m",
  metres: "m",
  meter: "m",
  meters: "m",
  "%": "%",
  rpm: "rpm",
};

// Longest alternatives first so "seconds" wins over "s" and "km/h" over "m".
const UNIT_RE = "km\\/h|kph|kmh|rpm|seconds|second|secs|sec|metres|meters|metre|meter|s|m|%";

// sign? (lap time | thousands | plain decimal) ordinal? unit?
const NUMBER_RE = new RegExp(
  "(?<![\\w.:,])([+-])?(\\d+:\\d{2}\\.\\d+|\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)" +
    "(st|nd|rd|th)?(?:\\s?(" +
    UNIT_RE +
    "))?(?![A-Za-z0-9])",
  "g",
);

// Corner labels, grammar [TC]\d{1,2}[A-Z]?(-\d{1,2}[A-Z]?)? (docs/contracts.md section 4).
// "Turn 6-7" becomes T6-7 and "Corner 3" becomes C3. Matched before numbers, so the "-7" of a
// group is never read as a signed number.
const CORNER_WORD_RE = /\b(Turns?|Corners?)\s+(\d{1,2})([A-Za-z]?)(?:-(\d{1,2})([A-Za-z]?))?\b/gi;
const CORNER_RE = /\b([TC])(\d{1,2})([A-Za-z]?)(?:-(\d{1,2})([A-Za-z]?))?\b/g;

const NUMBER_WORDS = new Set([
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "hundreds",
  "thousand",
  "thousands",
  "million",
  "half",
  "halves",
  "quarter",
  "quarters",
  "tenth",
  "tenths",
  "hundredth",
  "hundredths",
  "thousandth",
  "thousandths",
  "dozen",
  "double",
  "twice",
  "triple",
  "first",
  "second",
  "seconds",
  "third",
  "fourth",
  "fifth",
]);

/** A gain note may not say it lost time, and a loss note may not say it gained time. */
const WRONG_DIRECTION: Record<"gain" | "loss", Set<string>> = {
  gain: new Set(["lose", "loses", "losing", "lost", "slower"]),
  loss: new Set(["gain", "gains", "gaining", "gained", "faster"]),
};

/**
 * Words that state a cause, and the display fields that must be present to back them. A
 * time_only finding has none of these fields, so its note gives the time and no reason.
 */
type CauseFamily = "brake" | "min_speed" | "exit_speed" | "speed";
const CAUSE_WORDS: Record<string, CauseFamily> = {
  brake: "brake",
  brakes: "brake",
  braked: "brake",
  braking: "brake",
  later: "brake",
  earlier: "brake",
  late: "brake",
  early: "brake",
  apex: "min_speed",
  minimum: "min_speed",
  exit: "exit_speed",
  exits: "exit_speed",
  exiting: "exit_speed",
  speed: "speed",
  speeds: "speed",
  carry: "speed",
  carries: "speed",
  carrying: "speed",
  higher: "speed",
  lower: "speed",
};

/** Comparison words and the display word they assert, from driver A's view. */
type Claim = { family: "brake" | "speed"; word: "later" | "earlier" | "higher" | "lower" };
const COMPARISON_WORDS: Record<string, Claim> = {
  later: { family: "brake", word: "later" },
  late: { family: "brake", word: "later" },
  earlier: { family: "brake", word: "earlier" },
  early: { family: "brake", word: "earlier" },
  higher: { family: "speed", word: "higher" },
  lower: { family: "speed", word: "lower" },
};
/** Right after a diff ("4 km/h more"), these words also compare. */
const ATTACHED_WORDS: Record<string, Claim> = {
  ...COMPARISON_WORDS,
  more: { family: "speed", word: "higher" },
  faster: { family: "speed", word: "higher" },
  less: { family: "speed", word: "lower" },
  slower: { family: "speed", word: "lower" },
};

/** The display fields of one measured quantity: A's value, B's value, the diff and its word. */
const FIELDS = [
  { family: "brake", a: "brake_a", b: "brake_b", diff: "brake_diff", word: "brake_word" },
  {
    family: "speed",
    a: "min_speed_a",
    b: "min_speed_b",
    diff: "min_speed_diff",
    word: "min_speed_word",
  },
  {
    family: "speed",
    a: "exit_speed_a",
    b: "exit_speed_b",
    diff: "exit_speed_diff",
    word: "exit_speed_word",
  },
] as const;

const PLACEHOLDER = "\u0000";
const CORNER_PLACEHOLDER = "\u0001";

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[    ]/g, " ")
    .replace(/−/g, "-");
}

function canonCorner(
  letter: string,
  n1: string,
  s1: string,
  n2: string | undefined,
  s2: string | undefined,
): string {
  const head = `${letter.toUpperCase()}${n1}${s1.toUpperCase()}`;
  return n2 === undefined ? head : `${head}-${n2}${(s2 ?? "").toUpperCase()}`;
}

/** One token of a note, in reading order. Words are lowercased. */
export type Token =
  | { kind: "number"; text: string }
  | { kind: "corner"; text: string }
  | { kind: "word"; text: string };

export type Tokens = {
  numbers: string[];
  corners: string[];
  /** The text with every corner label and number token replaced by a placeholder. */
  residual: string;
  /** Numbers, corner labels and words in reading order. */
  sequence: Token[];
};

/** Corner labels first, then number tokens. residual is the text with both replaced. */
export function tokenize(raw: string): Tokens {
  let text = normalize(raw).replace(/[\u0000\u0001]/g, " ");
  const corners: string[] = [];
  text = text.replace(
    CORNER_WORD_RE,
    (_m, w: string, n1: string, s1: string, n2?: string, s2?: string) => {
      corners.push(canonCorner(w[0]!, n1, s1, n2, s2));
      return ` ${CORNER_PLACEHOLDER} `;
    },
  );
  text = text.replace(
    CORNER_RE,
    (_m, l: string, n1: string, s1: string, n2?: string, s2?: string) => {
      corners.push(canonCorner(l, n1, s1, n2, s2));
      return ` ${CORNER_PLACEHOLDER} `;
    },
  );
  const numbers: string[] = [];
  text = text.replace(NUMBER_RE, (_m, sign?: string, num?: string, ord?: string, unit?: string) => {
    const u = unit === undefined ? undefined : UNIT_CANON[unit.toLowerCase()];
    const base = `${sign ?? ""}${num ?? ""}${ord ?? ""}`;
    numbers.push(u === undefined ? base : u === "%" ? `${base}%` : `${base} ${u}`);
    return ` ${PLACEHOLDER} `;
  });
  // Corner placeholders were placed first, but both passes run left to right, so the k-th
  // placeholder of each kind in the text is the k-th entry of its list.
  const sequence: Token[] = [];
  let ni = 0;
  let ci = 0;
  for (const m of text.matchAll(/\u0000|\u0001|[A-Za-z]+(?:'[A-Za-z]+)?/g)) {
    if (m[0] === PLACEHOLDER) sequence.push({ kind: "number", text: numbers[ni++]! });
    else if (m[0] === CORNER_PLACEHOLDER) sequence.push({ kind: "corner", text: corners[ci++]! });
    else sequence.push({ kind: "word", text: m[0].toLowerCase() });
  }
  return { numbers, corners, residual: text, sequence };
}

function bareOf(token: string): string {
  return token.replace(/ (km\/h|s|m|rpm)$/, "").replace(/%$/, "");
}

export type Allowed = {
  full: Set<string>;
  bare: Set<string>;
  corner: string;
  /** Number tokens of the finding's own display strings only (no lap-level strings). */
  own: { full: Set<string>; bare: Set<string> };
  /** The number token of the finding's own time, for example "0.406 s". */
  time: string;
};

function findingOf(insight: Insight, findingId: string): InsightFinding {
  const f = insight.findings.find((x) => x.id === findingId);
  if (f === undefined) throw new Error(`unknown finding ${findingId}`);
  return f;
}

function numberSet(strings: readonly string[]): { full: Set<string>; bare: Set<string> } {
  const full = new Set<string>();
  for (const s of strings) for (const t of tokenize(s).numbers) full.add(t);
  return { full, bare: new Set([...full].map(bareOf)) };
}

/** A token with a unit must equal a display token; a bare token may drop the unit. */
function inSet(n: string, set: { full: Set<string>; bare: Set<string> }): boolean {
  return n !== bareOf(n) ? set.full.has(n) : set.bare.has(n);
}

/** True when note token n is the number token of display string s. */
function matches(n: string, s: string | undefined): boolean {
  if (s === undefined) return false;
  return inSet(n, numberSet([s]));
}

/** Number tokens one finding's note may cite: its own display strings plus the lap-level ones. */
export function allowedFor(insight: Insight, findingId: string): Allowed {
  const f = findingOf(insight, findingId);
  const own = numberSet(Object.values(f.display));
  const { full, bare } = numberSet([...Object.values(f.display), ...globalStrings(insight)]);
  const corner = tokenize(f.corner).corners[0];
  if (corner === undefined || corner !== f.corner) {
    throw new Error(`bad corner label ${f.corner}`);
  }
  const time = tokenize(f.display.time).numbers[0];
  if (time === undefined) throw new Error(`bad time string ${f.display.time}`);
  return { full, bare, corner, own, time };
}

/** Number tokens in the note that are not display strings of its finding or of the lap. */
export function missingNumbers(insight: Insight, findingId: string, note: string): string[] {
  const { full, bare } = allowedFor(insight, findingId);
  return tokenize(note).numbers.filter((n) => !inSet(n, { full, bare }));
}

/** True when the finding's display fields back a cause word of this family. */
function backed(f: InsightFinding, family: CauseFamily): boolean {
  const d = f.display;
  switch (family) {
    case "brake":
      return d.brake_word !== undefined;
    case "min_speed":
      return d.min_speed_word !== undefined;
    case "exit_speed":
      return d.exit_speed_word !== undefined;
    case "speed":
      return d.min_speed_word !== undefined || d.exit_speed_word !== undefined;
  }
}

/** The display words of one family that passed their checks, for example ["later"]. */
function passingWords(f: InsightFinding, family: Claim["family"]): string[] {
  const out: string[] = [];
  for (const k of FIELDS) {
    const w = f.display[k.word];
    if (k.family === family && w !== undefined) out.push(w);
  }
  return out;
}

/**
 * The fact rules: comparison words must say what the data says, "X against Y" puts driver A's
 * value first, and every cause word needs the display fields that back it.
 */
function factErrors(f: InsightFinding, sequence: readonly Token[]): string[] {
  const errors: string[] = [];
  const d = f.display;
  const attached = new Set<number>();

  // A comparison word right after a diff must be that diff's word ("67 m later").
  for (let i = 0; i + 1 < sequence.length; i++) {
    const n = sequence[i]!;
    const w = sequence[i + 1]!;
    if (n.kind !== "number" || w.kind !== "word") continue;
    const claim = ATTACHED_WORDS[w.text];
    if (claim === undefined) continue;
    const fields = FIELDS.filter((k) => k.family === claim.family && matches(n.text, d[k.diff]));
    if (fields.length === 0) continue;
    attached.add(i + 1);
    if (!fields.some((k) => d[k.word] === claim.word)) {
      const said = fields.map((k) => d[k.word]).join(" or ");
      errors.push(`comparison word contradicts the data: "${n.text} ${w.text}" (it is ${said})`);
    }
  }

  // Any other comparison word must match a passing word of its family.
  sequence.forEach((t, i) => {
    if (t.kind !== "word" || attached.has(i)) return;
    const claim = COMPARISON_WORDS[t.text];
    if (claim === undefined) return;
    const words = passingWords(f, claim.family);
    if (words.length > 0 && !words.includes(claim.word)) {
      errors.push(`comparison word contradicts the data: ${t.text} (it is ${words.join(" or ")})`);
    }
  });

  // "124 km/h against 131 km/h": driver A's value comes first.
  for (const k of FIELDS) {
    const a = d[k.a];
    const b = d[k.b];
    if (a === undefined || b === undefined) continue;
    const posA: number[] = [];
    const posB: number[] = [];
    sequence.forEach((t, i) => {
      if (t.kind !== "number") return;
      if (matches(t.text, a)) posA.push(i);
      if (matches(t.text, b)) posB.push(i);
    });
    if (posA.length > 0 && posB.length > 0 && Math.min(...posA) > Math.max(...posB)) {
      errors.push(`driver B's value comes first: say ${a} (driver A) before ${b}`);
    }
  }

  // Code picks the cause: a word may name only a cause whose display fields passed.
  const named = new Set<string>();
  for (const t of sequence) {
    if (t.kind !== "word") continue;
    const family = CAUSE_WORDS[t.text];
    if (family === undefined || backed(f, family) || named.has(t.text)) continue;
    named.add(t.text);
    errors.push(
      f.cause === "time_only"
        ? `gives a reason for a time_only finding: ${t.text}`
        : `names a cause this finding has no data for: ${t.text}`,
    );
  }
  return errors;
}

export type NoteCheck = { ok: boolean; errors: string[]; numbers: string[]; corners: string[] };

/** Every rule for one note. maxChars comes from analysis-config.json notes.max_chars. */
export function checkNote(
  insight: Insight,
  findingId: string,
  note: string,
  maxChars: number,
): NoteCheck {
  const errors: string[] = [];
  const f = findingOf(insight, findingId);
  const { full, bare, corner, own, time } = allowedFor(insight, findingId);
  const text = normalize(note);

  if (DASH_RE.test(text)) errors.push("contains an em or en dash");
  if (/\s-\s/.test(text)) errors.push("contains a spaced hyphen used as a dash");
  if (/[\r\n]/.test(text)) errors.push("contains a line break");
  if (/[*_#`]/.test(text)) errors.push("contains markdown");
  if (/[<>{}]/.test(text)) errors.push("contains a placeholder or markup");
  if (/\p{Extended_Pictographic}/u.test(text)) errors.push("contains an emoji");
  if (text.length > maxChars) errors.push(`too long: ${text.length} chars, max ${maxChars}`);
  if (!/^[A-Z]/.test(text)) errors.push("does not start with a capital letter");

  const { numbers, corners, residual, sequence } = tokenize(note);
  for (const n of numbers) {
    if (!inSet(n, { full, bare })) errors.push(`number not in insight: "${n}"`);
  }
  // A lap time or the lap gap never stands in for the corner's own time.
  const lapOnly = numbers.filter((n) => inSet(n, { full, bare }) && !inSet(n, own));
  if (lapOnly.length > 0 && !numbers.some((n) => matches(n, f.display.time))) {
    errors.push(`cites the lap-level "${lapOnly[0]!}" without this corner's own time ${time}`);
  }
  for (const c of corners) if (c !== corner) errors.push(`corner not this finding's: "${c}"`);
  if (!corners.includes(corner)) errors.push(`missing own corner label ${corner}`);
  if (numbers.length === 0) errors.push("cites no number");
  if (/\d/.test(residual)) errors.push("stray digit not consumed by a token");

  const words = residual.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  const banned = new RegExp(BANNED_WORD_RE.source, "i");
  for (const w of words) {
    if (banned.test(w)) errors.push(`banned word: ${w}`);
    if (NUMBER_WORDS.has(w)) errors.push(`number word: ${w}`);
    if (WRONG_DIRECTION[f.kind].has(w)) errors.push(`wrong direction for a ${f.kind}: ${w}`);
  }
  errors.push(...factErrors(f, sequence));
  return { ok: errors.length === 0, errors, numbers, corners };
}

/** What a notes client returned for one call. notes is null when the output was unusable. */
export type RawNotes = {
  stop_reason: string | null;
  notes: { finding_id: string; text: string }[] | null;
};

export type FailedNote = { finding_id: string; text: string | null; errors: string[] };

export type NotesCheck = { accepted: Map<string, string>; failed: FailedNote[] };

/**
 * Response-level rules, then every note. stop_reason must be end_turn and each expected id must
 * appear; ids compare case-insensitively (structured outputs do not guarantee enum casing), the
 * first duplicate wins, unknown ids are ignored, and a missing id is a failed note.
 */
export function checkNotes(
  insight: Insight,
  ids: readonly string[],
  raw: RawNotes,
  maxChars: number,
): NotesCheck {
  const accepted = new Map<string, string>();
  const failed: FailedNote[] = [];
  if (raw.stop_reason !== "end_turn" || raw.notes === null) {
    const why =
      raw.stop_reason !== "end_turn"
        ? `stop reason ${raw.stop_reason ?? "none"}`
        : "output was not the notes object";
    for (const id of ids) failed.push({ finding_id: id, text: null, errors: [why] });
    return { accepted, failed };
  }
  const byId = new Map<string, string>();
  for (const n of raw.notes) {
    const id = ids.find((x) => x.toLowerCase() === n.finding_id.toLowerCase());
    if (id !== undefined && !byId.has(id)) byId.set(id, n.text.trim());
  }
  for (const id of ids) {
    const text = byId.get(id);
    if (text === undefined) {
      failed.push({ finding_id: id, text: null, errors: ["no note for this finding id"] });
      continue;
    }
    const r = checkNote(insight, id, text, maxChars);
    if (r.ok) accepted.set(id, text);
    else failed.push({ finding_id: id, text, errors: r.errors });
  }
  return { accepted, failed };
}
